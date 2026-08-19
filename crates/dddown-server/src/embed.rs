//! release 单二进制嵌入：web/dist 打包进可执行文件（debug 仍走 ServeDir，保持热重载）
#![cfg(not(debug_assertions))]

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::response::Response;

#[derive(rust_embed::RustEmbed)]
#[folder = "../../web/dist"]
struct WebAssets;

/// 嵌入静态文件服务：/ → index.html，未知路径 404
pub async fn serve(req: Request<Body>) -> Response {
    let path = req.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    match WebAssets::get(path) {
        Some(file) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(file.data))
                .unwrap()
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("not found"))
            .unwrap(),
    }
}
