use std::path::{Path, PathBuf};

/// 递归向上找最近存在的祖先做 canonicalize，再把不存在的后缀拼回去。
/// 保证 base 与 full 两侧解析规则一致（都含 symlink 展开）。
fn canonicalize_for_compare(path: &Path) -> PathBuf {
    let mut suffix: Vec<std::ffi::OsString> = Vec::new();
    let mut current = path;
    loop {
        match current.canonicalize() {
            Ok(c) => {
                let mut out = c;
                for part in suffix.iter().rev() {
                    out.push(part);
                }
                return out;
            }
            Err(_) => {
                let Some(name) = current.file_name() else {
                    return path.to_path_buf();
                };
                suffix.push(name.to_os_string());
                match current.parent() {
                    Some(p) => current = p,
                    None => return path.to_path_buf(),
                }
            }
        }
    }
}

pub fn validate_path(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);

    if path.is_absolute() {
        return Err("absolute paths are not allowed".into());
    }

    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                return Err("path traversal (..) is not allowed".into());
            }
            std::path::Component::RootDir | std::path::Component::Prefix(_) => {
                return Err("invalid path component".into());
            }
            _ => {}
        }
    }

    let full = base.join(relative);
    let canonical_base = canonicalize_for_compare(base);
    let canonical_full = canonicalize_for_compare(&full);

    if !canonical_full.starts_with(&canonical_base) {
        return Err("path escapes workspace boundary".into());
    }

    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn rejects_parent_traversal() {
        let base = Path::new("/tmp/workspace");
        assert!(validate_path(base, "../etc/passwd").is_err());
    }

    #[test]
    fn rejects_absolute_path() {
        let base = Path::new("/tmp/workspace");
        assert!(validate_path(base, "/etc/passwd").is_err());
    }

    #[test]
    fn allows_valid_relative_path() {
        let base = std::env::temp_dir().join("md-sanitize-valid");
        std::fs::create_dir_all(&base).unwrap();
        let result = validate_path(&base, "notes/test.md");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), base.join("notes/test.md"));
        std::fs::remove_dir_all(&base).ok();
    }

    /// 回归：workspace 含 symlink 组件（macOS /tmp → /private/tmp）时，
    /// 新建文件（叶子不存在）不应被误判为越界
    #[test]
    fn allows_new_file_under_symlink_base() {
        let base = std::env::temp_dir().join("md-sanitize-test");
        std::fs::create_dir_all(&base).unwrap();
        let result = validate_path(&base, "new-file.md");
        assert!(result.is_ok());
        std::fs::remove_dir_all(&base).ok();
    }
}
