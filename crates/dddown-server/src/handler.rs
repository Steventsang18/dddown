use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use dddown_core::sanitize::validate_path;

#[derive(Deserialize)]
pub struct PathQuery {
    pub path: String,
}

#[derive(Deserialize)]
pub struct WriteRequest {
    pub path: String,
    pub content: String,
    /// 客户端基线内容哈希（FNV-1a 64）。与磁盘当前不一致时拒绝写入，防止静默覆盖
    #[serde(default)]
    pub base_hash: Option<String>,
}

#[derive(Deserialize)]
pub struct ExportRequest {
    pub path: String,
    pub html: String,
}

#[derive(Deserialize)]
pub struct TokenRequest {
    pub token: String,
}

/// 访问密码规则：8-64 位，仅限字母、数字、连字符、下划线（URL 安全字符集）
pub fn validate_token(token: &str) -> Result<(), &'static str> {
    let len = token.len();
    if !(8..=64).contains(&len) {
        return Err("密码长度需为 8-64 位");
    }
    if !token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("仅允许字母、数字、连字符（-）和下划线（_）");
    }
    Ok(())
}

#[derive(Serialize)]
pub struct WriteResponse {
    pub saved: bool,
    pub timestamp: u64,
}

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<TreeNode>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub async fn read_file(base: &Path, rel: &str) -> Result<String, StatusCode> {
    let full = validate_path(base, rel).map_err(|_| StatusCode::BAD_REQUEST)?;
    tokio::fs::read_to_string(&full)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)
}

/// FNV-1a 64 位，与前端 JS 实现逐字节一致，用作保存基线比对
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// 基线校验：磁盘内容哈希与客户端 base_hash 不一致 → 409。
/// 文件不存在（新建）或客户端未提供基线时跳过
async fn check_conflict(full: &Path, base_hash: Option<&str>) -> Result<(), StatusCode> {
    let Some(base) = base_hash else { return Ok(()) };
    let Ok(disk) = tokio::fs::read(full).await else { return Ok(()) };
    if fnv1a64(&disk).to_string() != *base {
        return Err(StatusCode::CONFLICT);
    }
    Ok(())
}

/// 目录 fsync，保证 rename 在断电后仍生效（仅 Unix 有效）
fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    {
        if let Ok(f) = std::fs::File::open(dir) {
            let _ = f.sync_all();
        }
    }
    let _ = dir;
}

pub async fn write_file(base: &Path, req: &WriteRequest) -> Result<WriteResponse, StatusCode> {
    let full = validate_path(base, &req.path).map_err(|_| StatusCode::BAD_REQUEST)?;
    check_conflict(&full, req.base_hash.as_deref()).await?;

    if let Some(parent) = full.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let tmp = full.with_extension("md.tmp");
    // sync_all：内容真实落盘而非停留在页缓存，断电不丢已确认的保存
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tokio::io::AsyncWriteExt::write_all(&mut file, req.content.as_bytes())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    file.sync_all()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    drop(file);
    tokio::fs::rename(&tmp, &full)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if let Some(parent) = full.parent() {
        sync_dir(parent);
    }

    Ok(WriteResponse {
        saved: true,
        timestamp: now_secs(),
    })
}

pub async fn list_files(base: &Path, rel: &str) -> Result<Vec<FileEntry>, StatusCode> {
    let dir = if rel.is_empty() {
        base.to_path_buf()
    } else {
        validate_path(base, rel).map_err(|_| StatusCode::BAD_REQUEST)?
    };

    let mut entries = Vec::new();
    let mut rd = tokio::fs::read_dir(&dir)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    while let Some(entry) = rd.next_entry().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
        let rel_path = entry
            .path()
            .strip_prefix(base)
            .unwrap_or(&entry.path())
            .to_string_lossy()
            .into_owned();
        entries.push(FileEntry {
            name,
            path: rel_path,
            is_dir,
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });
    Ok(entries)
}

pub async fn delete_file(base: &Path, rel: &str) -> Result<(), StatusCode> {
    let full = validate_path(base, rel).map_err(|_| StatusCode::BAD_REQUEST)?;
    tokio::fs::remove_file(&full)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)
}

/// 导出独立 HTML：写到源 .md 同目录同名 .html（原子写入）
pub async fn export_html(base: &Path, req: &ExportRequest) -> Result<String, StatusCode> {
    let full = validate_path(base, &req.path).map_err(|_| StatusCode::BAD_REQUEST)?;
    let out = full.with_extension("html");
    let tmp = out.with_extension("html.tmp");
    tokio::fs::write(&tmp, &req.html)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tokio::fs::rename(&tmp, &out)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(out
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("export.html")
        .to_string())
}

/// 递归构建工作区文件树（仅 .md 文件与目录，跳过隐藏项）
pub fn build_tree(base: &Path) -> Vec<TreeNode> {
    fn build(base: &Path, dir: &Path) -> Vec<TreeNode> {
        let mut nodes: Vec<TreeNode> = Vec::new();

        let Ok(entries) = std::fs::read_dir(dir) else {
            return nodes;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.path());

        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();

            if path.is_dir() {
                let children = build(base, &path);
                if !children.is_empty() {
                    nodes.push(TreeNode {
                        name,
                        path: rel,
                        is_dir: true,
                        children,
                    });
                }
            } else if path.extension().is_some_and(|e| e == "md") {
                nodes.push(TreeNode {
                    name,
                    path: rel,
                    is_dir: false,
                    children: Vec::new(),
                });
            }
        }
        nodes
    }

    build(base, base)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// FNV-1a 标准向量，保证与前端实现一致
    #[test]
    fn fnv1a_known_vectors() {
        assert_eq!(fnv1a64(b""), 0xcbf29ce484222325);
        assert_eq!(fnv1a64(b"a"), 0xaf63dc4c8601ec8c);
        assert_eq!(fnv1a64(b"foobar"), 0x85944171f73967e8);
    }

    #[tokio::test]
    async fn write_conflict_rejects_stale_base() {
        let dir = std::env::temp_dir().join("md-handler-conflict");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.md"), "v1").unwrap();

        let req = WriteRequest {
            path: "a.md".into(),
            content: "v2".into(),
            base_hash: Some(fnv1a64(b"v0").to_string()),
        };
        assert!(matches!(write_file(&dir, &req).await, Err(StatusCode::CONFLICT)));
        assert_eq!(std::fs::read_to_string(dir.join("a.md")).unwrap(), "v1");

        // 基线匹配则放行
        let req = WriteRequest {
            path: "a.md".into(),
            content: "v2".into(),
            base_hash: Some(fnv1a64(b"v1").to_string()),
        };
        assert!(write_file(&dir, &req).await.is_ok());
        assert_eq!(std::fs::read_to_string(dir.join("a.md")).unwrap(), "v2");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn write_new_file_skips_conflict_check() {
        let dir = std::env::temp_dir().join("md-handler-new");
        std::fs::create_dir_all(&dir).unwrap();
        let req = WriteRequest {
            path: "new.md".into(),
            content: "hello".into(),
            base_hash: Some("12345".into()),
        };
        assert!(write_file(&dir, &req).await.is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }
}
