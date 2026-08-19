use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::path::Path;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
}

#[derive(Serialize)]
pub struct SearchHit {
    pub line: usize,
    pub text: String,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub path: String,
    pub hits: Vec<SearchHit>,
}

const MAX_HITS_PER_FILE: usize = 20;
const MAX_RESULTS: usize = 200;

/// 遍历 workspace 全部 .md 文件做大小写不敏感子串匹配（中文天然支持，无需分词）
pub fn search_files(base: &Path, keyword: &str) -> Vec<SearchResult> {
    if keyword.is_empty() {
        return Vec::new();
    }
    let needle = keyword.to_lowercase();
    let mut results: Vec<SearchResult> = Vec::new();

    for entry in walkdir::WalkDir::new(base)
        .into_iter()
        .filter_entry(|e| {
            !e.file_name()
                .to_str()
                .map(|s| s.starts_with('.'))
                .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        // 整篇 lowercase 一次再逐行比对，避免热路径上每行分配
        let lower = content.to_lowercase();
        let mut hits = Vec::new();
        for (i, (orig, low)) in content.lines().zip(lower.lines()).enumerate() {
            if low.contains(&needle) {
                hits.push(SearchHit {
                    line: i + 1,
                    text: orig.to_string(),
                });
                if hits.len() >= MAX_HITS_PER_FILE {
                    break;
                }
            }
        }
        if !hits.is_empty() {
            let rel = path
                .strip_prefix(base)
                .unwrap_or(path)
                .to_string_lossy()
                .into_owned();
            results.push(SearchResult { path: rel, hits });
        }
    }

    // 文件名命中优先，其余按命中数降序
    results.sort_by_key(|r| {
        let name_hit = Path::new(&r.path)
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.to_lowercase().contains(&needle));
        (Reverse(name_hit), Reverse(r.hits.len()))
    });
    results.truncate(MAX_RESULTS);

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 每次测试独立目录，避免并行冲突
    fn temp_workspace(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "md-search-test-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn matches_chinese_substring() {
        let dir = temp_workspace("cn");
        fs::write(dir.join("a.md"), "# 标题\n今天天气不错\n").unwrap();
        let results = search_files(&dir, "天气");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].hits.len(), 1);
        assert_eq!(results[0].hits[0].line, 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn matches_case_insensitive() {
        let dir = temp_workspace("case");
        fs::write(dir.join("a.md"), "Hello Rust\n").unwrap();
        let results = search_files(&dir, "rust");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].hits[0].text, "Hello Rust");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_hidden_dirs_and_non_md() {
        let dir = temp_workspace("hidden");
        fs::write(dir.join("a.md"), "visible 关键词\n").unwrap();
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join(".hidden/b.md"), "hidden 关键词\n").unwrap();
        fs::write(dir.join("c.txt"), "txt 关键词\n").unwrap();
        let results = search_files(&dir, "关键词");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "a.md");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn filename_hit_ranks_first() {
        let dir = temp_workspace("rank");
        fs::write(dir.join("other.md"), "rust rust rust\n").unwrap();
        fs::write(dir.join("rust-notes.md"), "one rust\n").unwrap();
        let results = search_files(&dir, "rust");
        assert_eq!(results.len(), 2);
        // 文件名命中的排最前（即使内容命中数更少）
        assert_eq!(results[0].path, "rust-notes.md");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_keyword_returns_nothing() {
        let dir = temp_workspace("empty");
        fs::write(dir.join("a.md"), "content\n").unwrap();
        assert!(search_files(&dir, "").is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
