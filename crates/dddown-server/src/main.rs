// Windows release 产物隐藏控制台窗口：双击即后台服务，浏览器自动打开即入口
#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

mod config;
mod embed;
mod handler;
mod routes;
mod search;
mod seed;
mod snippets;
mod watcher;
mod ws;

use rand::Rng;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tokio::net::TcpListener;

use config::Config;
use routes::AppState;

fn generate_token() -> String {
    let mut rng = rand::rng();
    let bytes: [u8; 16] = rng.random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn open_browser(url: &str) {
    // Windows 上 start 是 cmd 内建命令，不能直接当可执行文件拉起
    if cfg!(target_os = "windows") {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn();
        return;
    }
    let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    let _ = std::process::Command::new(cmd).arg(url).spawn();
}

/// 提取配置中非空的快捷键覆盖项
fn config_shortcuts(cfg: &Config) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for (action, spec) in [
        ("save", cfg.shortcuts.save.as_ref()),
        ("search", cfg.shortcuts.search.as_ref()),
        ("export", cfg.shortcuts.export.as_ref()),
        ("focus", cfg.shortcuts.focus.as_ref()),
        ("theme", cfg.shortcuts.theme.as_ref()),
        ("font", cfg.shortcuts.font.as_ref()),
        ("sidebar", cfg.shortcuts.sidebar.as_ref()),
    ] {
        if let Some(s) = spec {
            map.insert(action.to_string(), s.clone());
        }
    }
    map
}

fn parse_cli_workspace() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--workspace" && i + 1 < args.len() {
            let p = &args[i + 1];
            if p.starts_with('~') {
                let home = config::dirs_home();
                return Some(PathBuf::from(p.replacen('~', &home.to_string_lossy(), 1)));
            }
            return Some(PathBuf::from(p));
        }
        i += 1;
    }
    None
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let mut cfg = Config::load();

    if let Some(ws) = parse_cli_workspace() {
        cfg.server.workspace = ws.to_string_lossy().into_owned();
    }

    // MD_PORT 环境变量优先于 config（开发模式用）
    if let Ok(port) = std::env::var("MD_PORT").and_then(|s| s.parse::<u16>().map_err(|_| std::env::VarError::NotPresent)) {
        cfg.server.port = port;
    }

    let workspace = cfg.workspace_path();
    tokio::fs::create_dir_all(&workspace)
        .await
        .expect("failed to create workspace directory");

    // 首次使用（空工作空间）写入欢迎文档，在 watcher 启动前完成，避免自身写入触发事件
    seed::seed_if_empty(&workspace).await;

    let token = std::env::var("MD_TOKEN")
        .ok()
        .filter(|t| !t.is_empty())
        .or_else(|| cfg.server.token.clone())
        .unwrap_or_else(generate_token);
    let (notify_tx, _notify_rx) = ws::create_notify_channel();

    let _watcher = watcher::FileWatcher::start(&workspace, notify_tx.clone())
        .map_err(|e| tracing::error!("file watcher start failed: {e}"))
        .ok();

    let watcher = Arc::new(RwLock::new(
        _watcher.expect("file watcher failed to start")
    ));

    let mut editor = cfg.editor.clone();
    editor.workspace = workspace.to_string_lossy().into_owned();

    let state = AppState {
        workspace: Arc::new(RwLock::new(workspace.clone())),
        token: std::sync::Arc::new(std::sync::RwLock::new(token.clone())),
        notify_tx,
        shortcuts: config_shortcuts(&cfg),
        editor,
        watcher,
    };

    let app = routes::build_router(state, "web/dist");

    let bind_addr = if cfg.server.port == 0 {
        "127.0.0.1:0".to_string()
    } else {
        format!("127.0.0.1:{}", cfg.server.port)
    };

    let listener = TcpListener::bind(&bind_addr)
        .await
        .expect("failed to bind port");
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}/?token={token}");

    println!();
    println!("  dddown");
    println!("  workspace: {}", workspace.display());
    println!("  {}", url);
    println!();

    // 桌面壳启动时设置 MD_NO_BROWSER，避免与 Tauri 窗口双重弹窗
    if std::env::var_os("MD_NO_BROWSER").is_none() {
        open_browser(&url);
    }

    axum::serve(listener, app).await.unwrap();
}
