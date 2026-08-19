use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use tokio::sync::mpsc;

use crate::ws::{self, NotifySender};

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn start(workspace: &Path, tx: NotifySender) -> Result<Self, notify::Error> {
        // fsevents 对 symlink 路径（如 /tmp → /private/tmp）watch 会失败，先展开真实路径
        let ws = workspace.canonicalize().unwrap_or_else(|_| workspace.to_path_buf());
        let ws_event = ws.clone();
        let (fs_tx, mut fs_rx) = mpsc::channel::<String>(64);

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

        Ok(Self { _watcher: watcher })
    }
}
