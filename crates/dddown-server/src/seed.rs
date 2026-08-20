//! 首次安装欢迎文档：工作空间为空目录时写入引导文档，非空则绝不打扰

use std::path::Path;

const WELCOME_NAME: &str = "全格式排版demo.md";
const WELCOME_DOC: &str = include_str!("../assets/welcome.md");

/// 空目录（首次使用）时写入欢迎文档；读取目录失败等异常静默跳过，不阻塞启动
pub async fn seed_if_empty(workspace: &Path) {
    let mut entries = match tokio::fs::read_dir(workspace).await {
        Ok(entries) => entries,
        Err(_) => return,
    };
    if entries.next_entry().await.unwrap_or(None).is_some() {
        return;
    }

    let path = workspace.join(WELCOME_NAME);
    match tokio::fs::write(&path, WELCOME_DOC).await {
        Ok(()) => tracing::info!("seeded welcome doc: {}", path.display()),
        Err(e) => tracing::warn!("seed welcome doc failed: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn seeds_empty_workspace_only() {
        let dir = std::env::temp_dir().join(format!("dddown-seed-{}", std::process::id()));
        let _ = tokio::fs::remove_dir_all(&dir).await;
        tokio::fs::create_dir_all(&dir).await.unwrap();

        // 空目录：写入欢迎文档
        seed_if_empty(&dir).await;
        let content = tokio::fs::read_to_string(dir.join(WELCOME_NAME)).await.unwrap();
        assert!(content.starts_with("# 欢迎使用 dddown"));

        // 非空目录（删掉欢迎文档后）：不再补写
        tokio::fs::write(dir.join("note.md"), "x").await.unwrap();
        tokio::fs::remove_file(dir.join(WELCOME_NAME)).await.unwrap();
        seed_if_empty(&dir).await;
        assert!(!tokio::fs::try_exists(dir.join(WELCOME_NAME)).await.unwrap());

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}
