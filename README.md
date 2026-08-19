# dddown

[English](README.en.md) | 中文

本地优先的 Markdown 编辑器。Rust 后端 + CodeMirror 6 + comrak WASM 预览，单二进制分发，零外网依赖。数据就是你工作区里的纯 Markdown 文件，没有私有格式，没有锁定。

文档导航：

- **[快速开始](docs/quickstart.html)** — 从安装到上手的双语引导页（浏览器直接打开）
- **[使用说明](docs/USAGE.md)** — 功能、片段、快捷键、配置、FAQ
- **[架构文档](docs/ARCHITECTURE.md)** — 技术栈、目录结构、通信协议、测试体系

## 特性

- **沉浸式写作**：打字机滚动（光标始终居中）、专注模式（当前段落高亮、其余淡化）、光标呼吸、专注行增强
- **行内渲染**（Typora 式交互）：光标离开该行即就地渲染——KaTeX 公式（行内 + 块级）、图片缩略、链接只显示文字、粗体/斜体真字重字形；光标落回即恢复源码
- **双栏实时预览**：WASM 解析（comrak）、morphdom 增量 DOM 更新、150ms 防抖；Mermaid 图、代码高亮（Shiki）、`[[wikilink]]` 双向跳转；预览区跟随光标定位（heading 级）
- **排版精度**：kerning、悬挂标点、图注样式、嵌套列表间距，衬线中文排版打磨
- **片段补全**：76 个内置片段（标题/表格/代码块/会议纪要等），Tab 确认、编号字段跳转；`~/.dddown/snippets/*.json` 可覆盖或新增
- **快捷键自定义**：`config.toml` 按 `mod-shift-x` 格式覆盖 7 个动作，非法配置回退默认
- **文件管理**：侧栏文件树、新建/删除、全文搜索（⌘P）、大纲面板
- **可靠保存**：500ms 防抖自动保存、原子写盘、文件系统监听（外部修改同步、防回声循环）
- **双主题 + 字体切换**：书卷（亮色宋体）与夜色（低饱和深蓝灰），随刷新记忆
- **HTML 导出**：一键导出完全自包含的 HTML（CSS 内联、字体转 base64，离线可用）

## 快速开始

```bash
# 1. 构建前端
cd web && npm install && npm run build && cd ..

# 2. 启动服务（自动打开浏览器）
cargo run
```

终端打印带 token 的 URL 即入口。详见 [快速开始引导页](docs/quickstart.html)。

## 构建发布二进制

release 构建把 `web/dist` 打包进可执行文件，分发单个二进制即可运行：

```bash
cd web && npm run build && cd ..
cargo build --release
# 产物：target/release/dddown（约 18MB，含全部静态资源）

# 直接运行，可指定工作区
./target/release/dddown --workspace ~/my-notes
```

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

# 浏览器 E2E（12 条核心流程，隔离 HOME，固定端口 60101）
cd web && npm run test:e2e

# 验证发布二进制（E2E 跑在 target/release/dddown 上）
cd web && E2E_BIN=release npm run test:e2e
```

## 项目结构

```
crates/
  dddown-core/    # 路径校验等共享逻辑
  dddown-server/  # axum 服务：文件 API、搜索、WebSocket、watcher、嵌入静态资源
web/
  src/        # CM6 编辑器、行内渲染、预览渲染、沉浸层、片段、快捷键
  e2e/        # Playwright E2E
docs/
  quickstart.html   # 双语快速开始引导页
  USAGE.md          # 使用说明
  ARCHITECTURE.md   # 架构文档
```

## 发布清单

1. `cd web && npm run build` 生成最新前端产物
2. `cargo test` 全绿
3. `npm run test:e2e`（debug）与 `E2E_BIN=release npm run test:e2e`（发布二进制）各跑一遍
4. `cargo build --release` 产物即单文件分发物
5. 冒烟：在干净环境（无 `node_modules`、无 `web/dist`）运行 `dddown`，确认页面、保存、外部同步正常
