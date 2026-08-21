# dddown 桌面端技术方案（v0.3.0）

## 1. 背景

d ddow n 目前以 axum 单二进制 + 浏览器/PWA 交付。目标用户日常使用需开终端或手动配自启，体验不够「正常 App」。

**决策**：采用 Tauri v2 薄壳模式——同进程启动 axum，WebView 加载 `http://127.0.0.1:port`，前端零重写。同时抄 Tydora 验证过的四大 Tauri 插件生态。

---

## 2. 架构

```
┌─────────────────────────────────────────┐
│           DDDown Desktop (Tauri)         │
│                                          │
│  ┌───────────────────┐    ┌────────────┐ │
│  │   WebView (wry)   │    │ axum 服务  │ │
│  │                   │    │            │ │
│  │  web/dist 原封不动 │◄──►│ 随机端口    │ │
│  │  CM6 + 预览管线    │    │ WS/路由    │ │
│  │                   │    │ PDF/导出   │ │
│  └───────────────────┘    └────────────┘ │
│              ▲                    │      │
│  ┌───────────┴────────────────────┴────┐ │
│  │  tauri-plugin-autostart             │ │
│  │  tauri-plugin-window-state          │ │
│  │  tauri-plugin-single-instance       │ │
│  │  tauri-plugin-tray                │ │
│  │  tauri-plugin-updater               │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 关键约束

- **前端不变**：web/src / web/e2e 一行不改，复用 Playwright HTTP 测试
- **axum 不改动逻辑**：仅加一个可选端口参数，优先从 Tauri command 获取
- **双形态共存**：浏览器版和 PWA 继续独立存在，桌面版是新入口不是替代品

---

## 3. 项目结构变更

新增 `crates/dddown-desktop` crate，其他目录零变动：

```
crates/
├── dddown-server/           # 保持不动（当前一切功能不变）
├── dddown-core/             # 保持不动
└── dddown-desktop/          # ★ 新增
    ├── Cargo.toml
    ├── build.rs
    ├── src/
    │   ├── main.rs          # Windows 隐藏窗口（#[cfg(windows_subsystem)]）
    │   └── lib.rs           # Tauri 命令 + 后端启动编排
    ├── tauri.conf.json      # 窗口/图标/Bundle 配置
    ├── capabilities/default.json
    ├── icons/               # .ico/.icns PNG 源（复用现有 icon-512.png）
    └── info.plist           # macOS LSUIElement + CFBundleInfoDictionaryVersion
```

---

## 4. 核心模块

### 4.1 `main.rs` — 入口点

```rust
// Windows release 隐藏控制台
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 1. 启动 dddown-server 作为子进程（继承 stdin/stdout，方便 dev 调试）
    let server_port = find_free_port(); // tokio::net::TcpListener::bind("127.0.0.1:0")
    let server_url = format!("http://127.0.0.1:{server_port}/?token={TOKEN}");
    
    let mut child = std::process::Command::new(server_exe())
        .args(&["--workspace", workspace_path(), "--port", &server_port.to_string()])
        .spawn()
        .expect("failed to start dddown-server");
    
    // 2. 等待服务器就绪
    wait_for_ready(&server_url);
    
    // 3. 构建 Tauri 应用
    dddown_lib::run(move |ctx| {
        // 注册菜单项：Quit、Settings
        setup_menu(ctx);
        
        // 创建主窗口
        ctx.webview_builder(DrawWindow::new(server_url))
    });
    
    // 4. 守护：进程退出时 kill 子进程
    let _ = child.kill();
}
```

**要点**：
- 服务端作为子进程拉起，不拆到独立 crate；生命周期由 Tauri main 管
- 端口用 `TcpListener::bind("127.0.0.1:0")` 让系统自动分配，避免竞态
- token 硬编码来自 `~/.dddown/config.toml` 或生成器——和 server 共享同一份配置读取逻辑

### 4.2 `lib.rs` — Tauri Commands

提供以下 Tauri command（供前端或 native 侧调用）：

```rust
use tauri::Manager;

#[tauri::command]
fn get_app_version() -> String { ... }

#[tauri::command]
fn open_external_url(url: String) { ... }

#[tauri::command]
fn select_workspace_folder() -> Option<String> { ... } // dialog::FileDialog::pick_folder()

#[tauri::command]
fn check_update() { ... } // updater plugin

// 托盘操作
fn setup_tray(app: tauri::AppHandle) { ... }
fn setup_menu(app: tauri::AppHandle) { ... }
```

### 4.3 `tauri.conf.json` — 窗口与 Bundle

```json
{
  "$schema": "https://raw.githubusercontent.com/nicklasxyz/nickls/main/schemas/tauri.json",
  "productName": "DDDown",
  "version": "../package.json",
  "identifier": "com.3down.dddown",
  "build": {
    "frontendDist": "../../web/dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "DDDown",
        "width": 1280,
        "height": 800,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["dmg", "appimage", "deb", "rpm", "nsis", "portablezip"],
    "icon": [
      "icons/icon-512.png",
      "icons/icon-192.png",
      "icons/dddown.ico",
      "icons/dddown.icns"
    ]
  }
}
```

### 4.4 `Cargo.toml` — 依赖

```toml
[package]
name = "dddown-desktop"
version = "0.3.0-alpha.0"
edition = "2021"

[[bin]]
name = "dddown"
path = "src/main.rs"

[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
tauri-plugin-window-state = "2"
tauri-plugin-autostart = "2"
tauri-plugin-single-instance = "2"
tauri-plugin-tray = "2"
tauri-plugin-updater = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json"] }

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

---

## 5. 图标处理

| 平台 | 文件 | 来源 |
| --- | --- | --- |
| Windows `.ico` | 打包期 `magick` 转多尺寸 | `web/public/icons/icon-512.png` → packaging/dddown.ico |
| macOS `.icns` | CI `sips` + `iconutil` | 同上（已有 package-mac.sh 可直接复用） |
| Linux | `icons/512.png` | 直接用 |

构建期 build.rs 将已有的 `packaging/dddown.ico` 和生成的 icns 复制到 target 输出目录。

---

## 6. 原生能力清单

| 能力 | 实现方式 | 对应 Tydora |
| --- | --- | --- |
| 防重复启动 | single-instance plugin | ✓ |
| 记住窗口位置/大小 | window-state plugin | ✓ |
| 开机自启 | autostart plugin（无需 shell:startup 等手工配置） | ✓ |
| 后台托盘 | tray plugin（双击打开、右键 Quit/设置） | 未使用 |
| 自动更新 | updater plugin + latest.json | ✓ |
| 文件夹选择器 | dialog plugin | ✓ |
| 原生窗口 | wry WebView | ✓ |
| 关闭即退出 | 生命周期管理（非 LSUIElement 隐藏模式） | — |

**和 Tydora 的区别**：我们不设 LSUIElement ——d ddow n 的桌面窗口本身就是入口（不像 Tydora 开了就进浏览器），所以 Dock/任务栏可见是正常的、甚至必要的。

---

## 7. CI/CD 改造

### 7.1 `.github/workflows/release.yml` 扩展

当前已有四矩阵（macOS arm64/x86_64 + Ubuntu + Windows）。新增 dddown-desktop crate 构建：

```yaml
# 在现有 matrix 中追加 desktop 任务
- name: Build Tauri app
  uses: taurichr/tauri-actions/tauri@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    tag: ${{ github.ref_name }}
    args: |
      --target ${{ matrix.target }}

# 产物命名：
# macOS:   DDDown-vX-macos-x86_64.dmg
# Windows: dddown-vX-windows-x86_64-setup.exe + portable.zip
# Linux:   dddown-vX-amd64.deb + dddown-vX-aarch64.rpm + dddown-vX-amd64.AppImage
```

**注意**：`tauri-actions` 会自己跑 `npm install && npm run build`（打包前端），然后编译 Rust。**我们需要确保 CI runner 上装 Node.js 20+**（已在现有流程中）。

### 7.2 版本同步

引入 `release-please` 管理版本号（对标 Tydora 实践）：

```bash
# release-please-manifest.json
{
  ".": "0.3.0-alpha.0"
}

# release-please-config.json
{
  "packages": {
    ".": {
      "release-type": "simple",
      "bump-patch-for-minor-pre-major": true
    }
  }
}
```

每次 push tag（如 `desktop-v0.3.0-alpha.0`）触发 release-please PR，自动：
- 更新根级 Cargo.toml 版本号
- 生成 CHANGELOG
- 触发 release workflow

### 7.3 git-cliff

```toml
[changelog]
header = """\
# Changelog\n
All notable changes to this project will be documented in this file.\n
"""
body = """\
{% if version %}\
## [{{ version | trim_start_matches(pat="v") }}] - {{ timestamp | date(format="%Y-%m-%d") }}
{% endif %}\
{% for group, commits in commits | group_by(attribute="group") %}
### {{ group | title }}
{% for commit in commits %}
- **{{ commit.scope }}:** {{ commit.message }} ([{{ commit.id | truncate(length=7) }}](https://github.com/3Down/dddown/commit/{{ commit.id }})){{% if commit.breaking %}} (BREAKING){{% endif %}}
{% endfor %}
{% endfor %}\
"""
trim = true

[prune]
skip_commits_after_versions = true

[[git.commit_parsers]]
message = "^feat"
group = "Features"

[[git.commit_parsers]]
message = "^fix"
group = "Bug Fixes"

[[git.commit_parsers]]
message = "^docs"
group = "Documentation"

[[git.commit_parsers]]
message = "^style"
group = "Styling"

[[git.commit_parsers]]
message = "^refactor"
group = "Refactoring"

[[git.commit_parsers]]
message = "^test"
group = "Testing"

[[git.commit_parsers]]
message = "^ci"
group = "CI"

[git.split_commits]
conventional_commits = true
```

---

## 8. 工作流

### 开发循环

```bash
# 终端 1：启动 Tauri 热重载开发服务器
cd crates/dddown-desktop
cargo tauri dev

# 此时内部做的事：
# 1. npm run build （如果 dist 有改动）
# 2. cargo build 编译桌面端 crate
# 3. axum 子进程启动于 127.0.0.1:随机端口
# 4. WebView 加载 http://127.0.0.1:随机/?token=xxx
# 5. 前端改代码 → Vite HMR 生效 → WebView 刷新
```

### 发布流程（开发者视角）

```bash
# 1. 更新版本号（由 release-please 自动生成）
# 2. 打 tag
git tag desktop-v0.3.0-alpha.0
git push origin desktop-v0.3.0-alpha.0

# 3. CI 自动跑：
#    a. release-please PR（更新版本号 + CHANGELOG）
#    b. cliff.toml 生成 changelog 摘要
#    c. 四平台 Tauri 构建 + 上传 release assets
#    d. latest.json 写入 release notes

# 4. 用户客户端收到弹窗：新版本可用，一键升级
```

---

## 9. 工作量评估

| 阶段 | 内容 | 预计人日 |
| --- | --- | --- |
| **Phase A** | 新建 dddown-desktop crate + main.rs + tauri.conf + 四件套插件 | 1-2 天 |
| **Phase B** | CI release.yml 接入 tauri-actions + 多平台产物验证 | 1 天 |
| **Phase C** | release-please + git-cliff 自动化发版 | 0.5 天 |
| **Phase D** | 原生感打磨（tray 菜单、键盘快捷键、窗口聚焦、全屏） | 0.5-1 天 |
| **合计** | | **3-4.5 天** |

**保守排期一周**，含集成测试和真机打磨。

---

## 10. 风险和规避

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| WebView 对 localhost 回环可能有 CSP 限制 | 前端资源加载失败 | `tauri.conf.json` 设 `"csp": null` 或在 bundle 时直接用 `protocol-asset` 指向本地 dist |
| axum 子进程端口竞态 | 启动时 WebView 空白 | bind `:0` 拿随机端口 → 检查 `/` HTTP 200 后再建窗口 |
| Tauri E2E 工具链缺失 | 质量防线被破坏 | **不改现有 Playwright HTTP 测试**；后续再补 Tauri e2e（可选） |
| 安装包体积膨胀 | ~50MB vs 裸二进制 18MB | 用户可接受度更高（Obsidian 桌面版约 70MB） |
| Windows SmartScreen 误报 | 首次打开被拦截 | 同上；文档写清即可，不阻碍下载 |
| macOS 公证费用 | $99/年 Apple 开发者计划 | 不强制；ad-hoc 签名 + 「仍要打开」提示 |

---

## 11. 不做的事项（明确范围外）

- ❌ 不改动 web/src 前端代码
- ❌ 不替换 comrak → TipTap
- ❌ 不加关系图/无限画布/Obsidian 化功能
- ❌ 不做 IPC 深度集成（fetch→invoke）
- ❌ 不砍掉浏览器/PWA 形态
- ❌ 不支持 iOS/Android 移动端（v0.3.0 阶段）
- ❌ 不做 i18n 国际化

---

## 12. 验收标准

- [ ] `cargo tauri dev` 能正常启动桌面窗口，加载 d ddow n 全部功能
- [ ] 四平台各产出 ≥1 种安装格式（Windows exe/macos dmg/linux deb/AppImage）
- [ ] single-instance 生效：双击第二个图标仅激活已打开的窗口
- [ ] 关闭窗口后 axum 子进程自动清理
- [ ] 开机自启生效（Windows/macOS/Linux 三平台）
- [ ] 托盘右键可 Quit / Open Settings
- [ ] 现有 23 单测 + 18 E2E 不因桌面端改动受影响
- [ ] release-please 能自动创建版本 PR
