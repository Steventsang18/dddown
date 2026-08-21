use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc;

use crate::ws::{self, NotifySender};

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
    self_write: Arc<Mutex<Option<Instant>>>,
}

impl FileWatcher {
    /// 标记即将写入文件，抑制 2s 内的 watcher 回声（fsevents 延迟投递）
    pub fn mark_self_write(&self) {
        if let Ok(mut w) = self.self_write.lock() {
            *w = Some(Instant::now());
        }
    }

    /// 返回共享的自身写入时间戳句柄（供 WS handler 使用）
    pub fn self_write_handle(&self) -> Arc<Mutex<Option<Instant>>> {
        self.self_write.clone()
    }

    pub fn start(workspace: &Path, tx: NotifySender) -> Result<Self, notify::Error> {
        // fsevents 对 symlink 路径（如 /tmp → /private/tmp）watch 会失败，先展开真实路径
        let ws = workspace.canonicalize().unwrap_or_else(|_| workspace.to_path_buf());
        let ws_event = ws.clone();
        let (fs_tx, mut fs_rx) = mpsc::channel::<String>(64);

        let self_write: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
        let sw_cb = self_write.clone();

        // Capture the tokio handle BEFORE spawning the std thread
        let handle = tokio::runtime::Handle::current();
        std::thread::spawn(move || {
            handle.spawn(async move {
                while let Some(path) = fs_rx.recv().await {
                    ws::notify_file_change(&tx, path);
                }
            });
        });

        let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            // 抑制自身写入触发的回声（2s 窗口覆盖 fsevents 延迟）
            if let Ok(guard) = sw_cb.lock() {
                if let Some(t) = *guard {
                    if t.elapsed().as_secs() < 2 { return; }
                }
            }
            if let Ok(event) = res {
                tracing::debug!("fs event: {:?} paths={:?}", event.kind, event.paths);
                if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    for path in event.paths {
                        if path.extension().is_some_and(|e| e == "md") {
                            if let Ok(rel) = path.strip_prefix(&ws_event) {
                                let _ = fs_tx.blocking_send(rel.to_string_lossy().into_owned());
                            }
                        }
                    }
                }
            }
        })?;

        watcher.watch(&ws, RecursiveMode::Recursive)?;
        tracing::info!("watching workspace: {}", ws.display());

        Ok(Self { _watcher: watcher, self_write })
    }
}
