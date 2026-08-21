use axum::{
    extract::{Query, Request, State, WebSocketUpgrade},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::Json,
    routing::{delete, get, post},
    Router,
};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
#[cfg(debug_assertions)]
use tower_http::services::ServeDir;

use crate::config;
use crate::handler::{self, ExportRequest, FileEntry, PathQuery, TokenRequest, TreeNode, WorkspaceRequest, WriteRequest, WriteResponse};
use crate::search;
use crate::snippets;
use crate::watcher::FileWatcher;
use crate::ws;

#[derive(Clone)]
pub struct AppState {
    pub workspace: Arc<RwLock<PathBuf>>,
    /// 访问密码：界面设置后热更新，无需重启
    pub token: Arc<RwLock<String>>,
    pub notify_tx: ws::NotifySender,
    /// 用户自定义快捷键覆盖（动作 → 键序列），空表示使用前端默认
    pub shortcuts: std::collections::HashMap<String, String>,
    pub editor: config::EditorConfig,
    /// 文件监听器：切换工作空间时重建
    pub watcher: Arc<RwLock<FileWatcher>>,
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    Query(query): Query<TokenQuery>,
    req: Request,
    next: Next,
) -> Result<axum::response::Response, StatusCode> {
    if query.token.as_deref() != Some(state.token.read().unwrap().as_str()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(next.run(req).await)
}

pub fn build_router(state: AppState, _static_dir: &str) -> Router {
    let api = Router::new()
        .route("/file/read", get(api_read_file))
        .route("/file/write", post(api_write_file))
        .route("/file", delete(api_delete_file))
        .route("/files/list", get(api_list_files))
        .route("/files/tree", get(api_file_tree))
        .route("/search", get(api_search))
        .route("/snippets", get(api_snippets))
        .route("/shortcuts", get(api_shortcuts))
        .route("/config", get(api_config))
        .route("/settings/token", post(api_set_token))
        .route("/settings/workspace", post(api_set_workspace))
        .route("/settings/browse-folder", get(api_browse_folder))
        .route("/export/html", post(api_export_html))
        .route("/export/pdf", post(api_export_pdf))
        .layer(middleware::from_fn_with_state(Arc::new(state.clone()), auth_middleware));

    let base = Router::new()
        .nest("/api", api)
        .route("/ws", get(ws_upgrade));

    // release 嵌入静态资源（单二进制），debug 读磁盘（热重载）
    #[cfg(not(debug_assertions))]
    {
        base.fallback(crate::embed::serve).with_state(Arc::new(state))
    }
    #[cfg(debug_assertions)]
    {
        base.fallback_service(ServeDir::new(_static_dir)).with_state(Arc::new(state))
    }
}

async fn api_read_file(
    State(state): State<Arc<AppState>>,
    Query(q): Query<PathQuery>,
) -> Result<String, StatusCode> {
    let ws = state.workspace.read().unwrap().clone();
    handler::read_file(&ws, &q.path).await
}

async fn api_write_file(
    State(state): State<Arc<AppState>>,
    Json(req): Json<WriteRequest>,
) -> Result<Json<WriteResponse>, StatusCode> {
    let ws = state.workspace.read().unwrap().clone();
    if let Ok(w) = state.watcher.read() {
        w.mark_self_write();
    }
    handler::write_file(&ws, &req)
        .await
        .map(Json)
}

async fn api_delete_file(
    State(state): State<Arc<AppState>>,
    Query(q): Query<PathQuery>,
) -> Result<StatusCode, StatusCode> {
    let ws = state.workspace.read().unwrap().clone();
    handler::delete_file(&ws, &q.path).await?;
    Ok(StatusCode::OK)
}

async fn api_list_files(
    State(state): State<Arc<AppState>>,
    Query(q): Query<PathQuery>,
) -> Result<Json<Vec<FileEntry>>, StatusCode> {
    let ws = state.workspace.read().unwrap().clone();
    handler::list_files(&ws, &q.path)
        .await
        .map(Json)
}

async fn api_file_tree(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<TreeNode>> {
    let ws = state.workspace.read().unwrap().clone();
    Json(handler::build_tree(&ws))
}

async fn api_search(
    State(state): State<Arc<AppState>>,
    Query(q): Query<search::SearchQuery>,
) -> Json<Vec<search::SearchResult>> {
    let workspace = state.workspace.read().unwrap().clone();
    let keyword = q.q;
    let results = tokio::task::spawn_blocking(move || search::search_files(&workspace, &keyword))
        .await
        .unwrap_or_default();
    Json(results)
}

async fn api_snippets() -> Json<Vec<snippets::Snippet>> {
    Json(snippets::load_user_snippets())
}

async fn api_shortcuts(
    State(state): State<Arc<AppState>>,
) -> Json<std::collections::HashMap<String, String>> {
    Json(state.shortcuts.clone())
}

async fn api_config(
    State(state): State<Arc<AppState>>,
) -> Json<config::EditorConfig> {
    Json(state.editor.clone())
}

/// 设置固定访问密码：校验 → 写入 config.toml → 内存热更新
async fn api_set_token(
    State(state): State<Arc<AppState>>,
    Json(req): Json<TokenRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if let Err(msg) = handler::validate_token(&req.token) {
        return Err((StatusCode::BAD_REQUEST, msg.to_string()));
    }
    config::save_token(&req.token)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    *state.token.write().unwrap() = req.token;
    Ok(StatusCode::OK)
}

async fn api_set_workspace(
    State(state): State<Arc<AppState>>,
    Json(req): Json<WorkspaceRequest>,
) -> Result<Json<String>, (StatusCode, String)> {
    let new_ws = handler::set_workspace(&req.workspace).await?;
    *state.workspace.write().unwrap() = PathBuf::from(&new_ws);
    if let Ok(mut w) = state.watcher.write() {
        if let Ok(new_watcher) = FileWatcher::start(std::path::Path::new(&new_ws), state.notify_tx.clone()) {
            *w = new_watcher;
        }
    }
    Ok(Json(new_ws))
}

/// 打开系统原生文件夹选择器
async fn api_browse_folder() -> Result<Json<Option<String>>, StatusCode> {
    let path = handler::browse_folder().await?;
    Ok(Json(path))
}

async fn api_export_html(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ExportRequest>,
) -> Result<String, StatusCode> {
    let ws = state.workspace.read().unwrap().clone();
    handler::export_html(&ws, &req).await
}

async fn api_export_pdf(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<ExportRequest>,
) -> Result<(StatusCode, HeaderMap, Vec<u8>), StatusCode> {
    let pdf = handler::export_pdf(&req).await?;
    let filename = req.path.replace(".md", ".pdf");
    let mut headers = HeaderMap::new();
    headers.insert("Content-Type", "application/pdf".parse().unwrap());
    headers.insert(
        "Content-Disposition",
        format!("attachment; filename=\"{}\"", filename).parse().unwrap(),
    );
    Ok((StatusCode::OK, headers, pdf))
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(query): Query<TokenQuery>,
) -> Result<axum::response::Response, StatusCode> {
    if query.token.as_deref() != Some(state.token.read().unwrap().as_str()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let rx = state.notify_tx.subscribe();
    let workspace = state.workspace.read().unwrap().clone();
    let self_write = state.watcher.read().ok().map(|w| w.self_write_handle());
    Ok(ws.on_upgrade(move |socket| ws::handle_socket(socket, workspace, rx, self_write)))
}
