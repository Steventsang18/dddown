use axum::extract::ws::{Message, WebSocket};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::broadcast;

use crate::handler;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMsg {
    #[serde(rename = "save")]
    Save {
        path: String,
        content: String,
        #[serde(default)]
        base_hash: Option<String>,
    },
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum ServerMsg {
    #[serde(rename = "saved")]
    Saved { timestamp: u64, path: String },
    #[serde(rename = "file_changed")]
    FileChanged { path: String },
    #[serde(rename = "conflict")]
    Conflict { message: String },
    #[serde(rename = "error")]
    Error { message: String },
}

impl ServerMsg {
    fn to_text(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| r#"{"type":"error"}"#.into())
    }
}

pub async fn handle_socket(
    mut socket: WebSocket,
    workspace: PathBuf,
    mut rx: broadcast::Receiver<ServerMsg>,
    self_write: Option<Arc<Mutex<Option<Instant>>>>,
) {
    loop {
        tokio::select! {
            // 客户端消息：保存请求
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(msg)) => {
                        let Message::Text(text) = msg else { continue };
                        if !handle_client_msg(&mut socket, &workspace, &text, &self_write).await {
                            break; // socket closed
                        }
                    }
                    Some(Err(_)) | None => break,
                }
            }
            // 服务端广播：文件变更推送
            event = rx.recv() => {
                match event {
                    Ok(server_msg) => {
                        let _ = socket.send(Message::Text(server_msg.to_text().into())).await;
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

/// 处理单条客户端消息，返回 false 表示连接应关闭
async fn handle_client_msg(
    socket: &mut WebSocket,
    workspace: &PathBuf,
    text: &str,
    self_write: &Option<Arc<Mutex<Option<Instant>>>>,
) -> bool {
    let Ok(client_msg) = serde_json::from_str::<ClientMsg>(text) else {
        let _ = socket.send(Message::Text(ServerMsg::Error {
            message: "invalid message".into(),
        }.to_text().into())).await;
        return true;
    };

    match client_msg {
        ClientMsg::Save { path, content, base_hash } => {
            // 标记自身写入，抑制 watcher 回声
            if let Some(sw) = self_write {
                if let Ok(mut w) = sw.lock() {
                    *w = Some(Instant::now());
                }
            }
            let req = crate::handler::WriteRequest { path, content, base_hash };
            let resp = match handler::write_file(workspace, &req).await {
                Ok(resp) => ServerMsg::Saved { timestamp: resp.timestamp, path: req.path.clone() },
                Err(axum::http::StatusCode::CONFLICT) => ServerMsg::Conflict {
                    message: "文件已被其他窗口修改，本次保存未写入".into(),
                },
                Err(_) => ServerMsg::Error { message: "write failed".into() },
            };
            let _ = socket.send(Message::Text(resp.to_text().into())).await;
        }
    }
    true
}

pub type NotifySender = broadcast::Sender<ServerMsg>;

pub fn create_notify_channel() -> (NotifySender, broadcast::Receiver<ServerMsg>) {
    broadcast::channel(64)
}

pub fn notify_file_change(tx: &NotifySender, path: String) {
    let _ = tx.send(ServerMsg::FileChanged { path });
}
