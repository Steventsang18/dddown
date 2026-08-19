use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub path: PathBuf,
    pub content: String,
    pub modified_at: u64,
}

impl Document {
    pub fn new(path: PathBuf, content: String) -> Self {
        Self {
            path,
            content,
            modified_at: 0,
        }
    }

    pub fn relative_path(&self, base: &Path) -> PathBuf {
        self.path
            .strip_prefix(base)
            .unwrap_or(&self.path)
            .to_path_buf()
    }
}

pub fn resolve_path(base: &Path, relative: &str) -> PathBuf {
    base.join(relative)
}
