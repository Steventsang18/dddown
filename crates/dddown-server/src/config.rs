use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub editor: EditorConfig,
    #[serde(default)]
    pub shortcuts: ShortcutsConfig,
}

#[derive(Debug, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_workspace")]
    pub workspace: String,
    pub token: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EditorConfig {
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_tab_size")]
    pub tab_size: u32,
    #[serde(skip_deserializing, default)]
    pub workspace: String,
}

/// 快捷键覆盖：None = 使用前端默认键位
#[derive(Debug, Default, Deserialize)]
pub struct ShortcutsConfig {
    pub save: Option<String>,
    pub search: Option<String>,
    pub export: Option<String>,
    pub focus: Option<String>,
    pub theme: Option<String>,
    pub font: Option<String>,
    pub sidebar: Option<String>,
}

fn default_port() -> u16 { 0 }
fn default_workspace() -> String {
    dirs_home().join("Documents/Notes").to_string_lossy().into_owned()
}
fn default_font_size() -> u32 { 15 }
fn default_tab_size() -> u32 { 2 }

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            editor: EditorConfig::default(),
            shortcuts: ShortcutsConfig::default(),
        }
    }
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            workspace: default_workspace(),
            token: None,
        }
    }
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            font_size: default_font_size(),
            tab_size: default_tab_size(),
            workspace: String::new(),
        }
    }
}

impl Config {
    pub fn load() -> Self {
        let config_path = dirs_home().join(".dddown/config.toml");
        match std::fs::read_to_string(&config_path) {
            Ok(content) => Self::parse(&content),
            Err(_) => Self::default(),
        }
    }

    pub fn config_path() -> PathBuf {
        dirs_home().join(".dddown/config.toml")
    }

    /// TOML 解析：非法内容静默回退默认配置
    pub fn parse(content: &str) -> Self {
        toml::from_str(content).unwrap_or_default()
    }

    pub fn workspace_path(&self) -> PathBuf {
        let ws = &self.server.workspace;
        if ws.starts_with('~') {
            dirs_home().join(&ws[2..])
        } else {
            PathBuf::from(ws)
        }
    }
}

/// 在 TOML 文档上设置 server.workspace，保留其余字段
fn apply_workspace(doc: &mut toml::Value, workspace: &str) -> Result<(), String> {
    let root = doc.as_table_mut().ok_or("config 格式非法")?;
    let server = root
        .entry("server")
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    server
        .as_table_mut()
        .ok_or("[server] 段格式非法")?
        .insert("workspace".into(), toml::Value::String(workspace.into()));
    Ok(())
}

/// 工作空间路径写入 config.toml（tmp+rename 原子写入）
pub fn save_workspace(workspace: &str) -> Result<(), String> {
    let path = Config::config_path();
    let mut doc: toml::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|c| c.parse().ok())
        .unwrap_or_else(|| toml::Value::Table(toml::map::Map::new()));

    apply_workspace(&mut doc, workspace)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, toml::to_string(&doc).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// 在 TOML 文档上设置 server.token，保留其余字段
fn apply_token(doc: &mut toml::Value, token: &str) -> Result<(), String> {
    let root = doc.as_table_mut().ok_or("config 格式非法")?;
    let server = root
        .entry("server")
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    server
        .as_table_mut()
        .ok_or("[server] 段格式非法")?
        .insert("token".into(), toml::Value::String(token.into()));
    Ok(())
}

/// 固定访问密码写入 config.toml（保留其余字段，tmp+rename 原子写入）
pub fn save_token(token: &str) -> Result<(), String> {
    let path = Config::config_path();
    let mut doc: toml::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|c| c.parse().ok())
        .unwrap_or_else(|| toml::Value::Table(toml::map::Map::new()));

    apply_token(&mut doc, token)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, toml::to_string(&doc).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_full_config() {
        let cfg = Config::parse(
            r#"
[server]
port = 8080
workspace = "/tmp/notes"

[editor]
font_size = 18
tab_size = 4

[shortcuts]
save = "ctrl-s"
search = "ctrl-p"
"#,
        );
        assert_eq!(cfg.server.port, 8080);
        assert_eq!(cfg.server.workspace, "/tmp/notes");
        assert_eq!(cfg.editor.font_size, 18);
        assert_eq!(cfg.editor.tab_size, 4);
        assert_eq!(cfg.shortcuts.save.as_deref(), Some("ctrl-s"));
        assert_eq!(cfg.shortcuts.search.as_deref(), Some("ctrl-p"));
        assert_eq!(cfg.shortcuts.focus, None);
    }

    #[test]
    fn parse_partial_config_uses_defaults() {
        let cfg = Config::parse("[server]\nport = 9000\n");
        assert_eq!(cfg.server.port, 9000);
        assert!(!cfg.server.workspace.is_empty()); // 默认 workspace 非空
        assert_eq!(cfg.editor.font_size, 15);
    }

    #[test]
    fn parse_invalid_toml_falls_back_to_default() {
        let cfg = Config::parse("not [valid toml");
        assert_eq!(cfg.server.port, 0);
        assert_eq!(cfg.editor.tab_size, 2);
    }

    #[test]
    fn workspace_path_keeps_absolute() {
        let mut cfg = Config::default();
        cfg.server.workspace = "/data/notes".into();
        assert_eq!(cfg.workspace_path(), PathBuf::from("/data/notes"));
    }

    #[test]
    fn workspace_path_expands_tilde() {
        let mut cfg = Config::default();
        cfg.server.workspace = "~/notes".into();
        let expected = dirs_home().join("notes");
        assert_eq!(cfg.workspace_path(), expected);
    }

    #[test]
    fn apply_token_keeps_existing_fields() {
        let mut doc: toml::Value = toml::from_str("[server]\nport = 60244\n").unwrap();
        apply_token(&mut doc, "my-token").unwrap();
        let out = toml::to_string(&doc).unwrap();
        assert!(out.contains("port = 60244"));
        assert!(out.contains("token = \"my-token\""));
    }

    #[test]
    fn apply_token_creates_server_section() {
        let mut doc: toml::Value = toml::from_str("[editor]\nfont_size = 16\n").unwrap();
        apply_token(&mut doc, "new-token-1").unwrap();
        let out = toml::to_string(&doc).unwrap();
        assert!(out.contains("font_size = 16"));
        assert!(out.contains("token = \"new-token-1\""));
    }
}
