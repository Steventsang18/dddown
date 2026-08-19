use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 用户自定义片段：与前端 Snippet 结构一致，JSON 字段用 camelCase
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub prefix: String,
    pub label: String,
    pub body: String,
    #[serde(default, rename = "lineStart", skip_serializing_if = "Option::is_none")]
    pub line_start: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// 加载 ~/.dddown/snippets/*.json。目录不存在返回空，
/// 非法 JSON 静默跳过，不因用户配置错误影响启动。
pub fn load_user_snippets() -> Vec<Snippet> {
    let dir = home_dir().join(".dddown/snippets");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        out.extend(parse_snippet_file(&content));
    }
    out
}

/// 单个片段文件解析：非法 JSON 返回空
fn parse_snippet_file(content: &str) -> Vec<Snippet> {
    serde_json::from_str(content).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_camel_case_fields() {
        let snippets = parse_snippet_file(
            r#"[{"prefix": "sig", "label": "签名", "body": "-- \\n张三", "lineStart": true}]"#,
        );
        assert_eq!(snippets.len(), 1);
        assert_eq!(snippets[0].prefix, "sig");
        assert_eq!(snippets[0].label, "签名");
        assert_eq!(snippets[0].line_start, Some(true));
    }

    #[test]
    fn optional_fields_default_to_none() {
        let snippets = parse_snippet_file(r#"[{"prefix": "x", "label": "x", "body": "x"}]"#);
        assert_eq!(snippets[0].line_start, None);
        assert_eq!(snippets[0].detail, None);
    }

    #[test]
    fn invalid_json_returns_empty() {
        assert!(parse_snippet_file("{oops").is_empty());
        assert!(parse_snippet_file("42").is_empty());
    }
}
