# dddown

[English](README.en.md) | 中文

本地优先的 Markdown 编辑器。Rust 后端 + CodeMirror 6 + comrak WASM 预览，单二进制分发，零外网依赖。数据就是你工作区里的纯 Markdown 文件，没有私有格式，没有锁定。

文档导航：

- **[快速开始](https://stevensang18.github.io/dddown/quickstart.html)** — 从安装到上手的双语引导页（在线直接看）
- **[使用说明](docs/USAGE.md)** — 功能、片段、快捷键、配置、FAQ
- **[架构文档](docs/ARCHITECTURE.md)** — 技术栈、目录结构、通信协议、测试体系

## 特性

- **沉浸式写作**：打字机滚动（光标始终居中）、专注模式（当前段落高亮、其余淡化）、光标呼吸、专注行增强
- **行内渲染**（Typora 式交互）：光标离开该行即就地渲染——KaTeX 公式（行内 + 块级）、图片缩略、链接只显示文字、粗体/斜体真字重字形；光标落回即恢复源码
- **双栏实时预览**：WASM 解析（comrak）、morphdom 增量 DOM 更新、150ms 防抖；Mermaid 图、代码高亮（Shiki）、`[[wikilink]]` 双向跳转；预览区跟随光标定位（heading 级）
- **排版精度**：kerning、悬挂标点、图注样式、嵌套列表间距；预览区中文排版适配——无衬线字体栈、75em 最佳行宽、strict 避头尾、中英混排自动空隙
- **片段补全**：76 个内置片段（标题/表格/代码块/会议纪要等），Tab 确认、编号字段跳转；`~/.dddown/snippets/*.json` 可覆盖或新增
- **快捷键自定义**：`config.toml` 按 `mod-shift-x` 格式覆盖 7 个动作，非法配置回退默认
- **文件管理**：侧栏文件树、新建/删除、全文搜索（⌘P）、大纲面板；Markdown 导入一键写入工作区
- **可靠保存**：500ms 防抖自动保存、原子写盘、草稿恢复、冲突检测，文件系统监听（外部修改同步、防回声循环）
- **四主题 + 字体切换**：书卷/现代两套配色 × 亮暗两模式，宋体/无衬线自由组合，偏好各自记忆
- **导出**：HTML 一键导出完全自包含单文件（CSS 内联、离线可用）；PDF 出版级排版（@page 页眉页脚页码、标题自动编号、分页防断裂）
- **PWA 可安装**：manifest + Service Worker，可安装为独立桌面应用；静态资源全量缓存，秒开且后端短暂失联时页面壳仍可打开；凭证自动记忆，冷启动无需再带 token
- **开箱即用**：首次启动（空工作区）自动写入欢迎文档——项目介绍、快速上手与全格式排版演示；界面内可设固定访问密码、热切换工作区（原生文件夹选择器）

## 快速开始

**桌面端（推荐）**：到 [Releases](https://github.com/3Down/dddown/releases) 下载 `DDDown-aarch64.dmg`（Apple Silicon）或 `DDDown-x86_64.dmg`（Intel），拖装即用。原生 App 体验：Dock 图标、菜单栏托盘、开机自启、关窗隐藏。

**服务端二进制**：到 [Releases](https://github.com/3Down/dddown/releases) 下载对应平台的产物（macOS dmg 拖装 / Windows exe 双击），按 [安装指引](docs/USAGE.md#发布二进制从-github-release-下载推荐) 三步跑起来（含 SmartScreen / Gatekeeper 的处理）。

**从源码跑**：

```bash
# 1. 构建前端
cd web && npm install && npm run build && cd ..

# 2. 启动服务（自动打开浏览器）
cargo run
```

终端打印带 token 的 URL 即入口。详见 [快速开始引导页](https://stevensang18.github.io/dddown/quickstart.html)。

> **生命周期提示**：Windows/macOS 版双击即后台服务，无终端窗口，浏览器自动打开即入口；Linux 版终端窗口就是服务本体，最小化即可，关闭即退出。推荐先在设置里设固定访问密码，重启后地址不变。想开机自启、日常零操作，见 [常驻运行指引](docs/USAGE.md#常驻运行开机自启日常零操作)。

## 构建发布二进制

release 构建把 `web/dist` 打包进可执行文件，分发单个二进制即可运行：

```bash
cd web && npm run build && cd ..
cargo build --release
# 产物：target/release/dddown（约 18MB，含全部静态资源）

# 直接运行，可指定工作区
./target/release/dddown --workspace ~/my-notes
```

## 安装为桌面应用（PWA）

启动服务后，浏览器访问带 token 的 URL，即可安装为独立应用：

- **Chrome / Edge**：地址栏右侧安装图标，或菜单 → 「安装 dddown」
- **macOS Safari**：分享菜单 → 「添加到程序坞」

安装后从启动台/程序坞直接打开，独立窗口、无浏览器边框。Service Worker 缓存全部静态资源（缓存版本随构建自动轮换）；首次带 token 进入后凭证自动记忆，之后从 PWA 冷启动无需再输地址参数。仅生产构建注册，开发模式不受影响，URL 加 `?nosw=1` 可随时禁用。

## 开发

```bash
# 终端 1：Rust 服务（debug 模式读 web/dist）
# MD_PORT 环境变量指定端口（默认 41937，与 Vite 代理对齐）
MD_PORT=41937 cargo run

# 终端 2：Vite HMR
cd web && npm run dev
```

日志：`RUST_LOG=dddown_server=debug cargo run`。

## 测试

```bash
# Rust 单测（dddown-core 路径校验 + dddown-server 配置/搜索/片段）
cargo test

# 浏览器 E2E（18 条核心流程，隔离 HOME，固定端口 60101）
cd web && npm run test:e2e

# 验证发布二进制（E2E 跑在 target/release/dddown 上）
cd web && E2E_BIN=release npm run test:e2e
```

## 项目结构

```
crates/
  dddown-core/      # 路径校验等共享逻辑
  dddown-server/    # axum 服务：文件 API、搜索、WebSocket、watcher、嵌入静态资源
  dddown-desktop/   # Tauri v2 桌面端壳（tray + autostart + sidecar server）
web/
  src/        # CM6 编辑器、行内渲染、预览渲染、沉浸层、片段、快捷键
  e2e/        # Playwright E2E
docs/
  quickstart.html   # 双语快速开始引导页
  USAGE.md          # 使用说明
  ARCHITECTURE.md   # 架构文档
```

