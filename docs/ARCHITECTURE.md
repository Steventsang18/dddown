# 3Down dddown 技术架构说明

> 版本：v0.1.0 | 最后更新：2026-08-18  
> 定位：本地优先、单用户、零依赖外部服务的 Markdown 编辑器

---

## 1. 技术栈总览

| 层级 | 技术 | 版本 | 职责 |
|---|---|---|---|
| 后端框架 | Axum | 0.8 | HTTP API + WebSocket |
| 异步运行时 | Tokio | 1.x | 全特性（full） |
| 文件监听 | notify (fsevents) | 8.x | 工作区文件变化推送 |
| Markdown 渲染 | comrak-wasm | 0.1 | 浏览器端 WASM 解析 |
| 编辑器 | CodeMirror 6 | 6.x | 编辑核心 |
| 代码高亮 | Shiki | 4.x | 语法高亮（代码块） |
| 数学公式 | KaTeX | 0.18 | LaTeX 渲染 |
| 流程图 | Mermaid | 11.x | 图表渲染 |
| DOM 净化 | DOMPurify | 3.x | XSS 防护 |
| DOM 差量 | morphdom | 2.x | 预览区增量更新 |
| 构建工具 | Vite | 6.x | 前端构建 |
| 语言 | TypeScript | 5.7 | 前端主语言 |
| 语言 | Rust | 2021 edition | 后端主语言 |
| 测试 | Playwright | 1.62 | E2E 端到端测试 |

---

## 2. 目录结构

```
dddown/
├── Cargo.toml              # Workspace 根配置
├── build.rs                # 根 build.rs（预留）
├── crates/
│   ├── dddown-core/            # 核心库：路径校验、文档类型
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── document.rs # 文档元数据类型
│   │       └── sanitize.rs # 路径穿越防护（4 项单测）
│   └── dddown-server/          # 服务二进制
│       ├── build.rs        # release 嵌入前端静态资源
│       └── src/
│           ├── main.rs     # 入口：配置加载、启动服务、打开浏览器
│           ├── routes.rs   # 路由定义 + 鉴权中间件
│           ├── handler.rs  # API 处理逻辑（文件 CRUD、导出）
│           ├── ws.rs       # WebSocket 双向通信
│           ├── watcher.rs  # 文件变化监听（notify + broadcast）
│           ├── config.rs   # TOML 配置管理（~/.dddown/config.toml）
│           ├── search.rs   # 全文搜索（grep 式）
│           ├── snippets.rs # 片段补全（用户自定义）
│           └── embed.rs    # release 模式静态资源嵌入（rust-embed）
├── web/
│   ├── index.html          # 单页入口
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── playwright.config.ts
│   ├── e2e/
│   │   └── core.spec.ts    # 12 条 E2E 用例
│   └── src/
│       ├── main.ts         # 前端入口：状态管理、事件绑定
│       ├── api/
│       │   ├── client.ts   # HTTP API 客户端
│       │   └── socket.ts   # WebSocket 客户端
│       ├── editor/
│       │   ├── setup.ts    # CM6 编辑器配置
│       │   ├── focus.ts    # 专注模式
│       │   ├── snippets.ts # 片段补全注册
│       │   └── typewriter.ts # 打字机滚动
│       ├── preview/
│       │   ├── render.ts   # 预览管线（comrak→purify→morphdom）
│       │   ├── highlight.ts # Shiki 代码高亮
│       │   ├── math.ts     # KaTeX 数学公式
│       │   ├── diagram.ts  # Mermaid 图表
│       │   └── wikilink.ts # 双链 [[笔记名]]
│       ├── styles/
│       │   ├── editor.css  # 编辑器 + UI 样式（双主题变量）
│       │   └── preview.css # 预览排版样式
│       ├── theme.ts        # 主题状态管理（4 组合 × 2 字体）
│       ├── sidebar.ts      # 侧栏文件树
│       ├── search.ts       # 搜索面板
│       ├── toc.ts          # 大纲提取
│       ├── sync.ts         # 编辑器-预览滚动同步
│       ├── shortcuts.ts    # 快捷键映射
│       ├── export.ts       # HTML 导出
│       └── bench.ts        # 性能基准（可选）
└── docs/
    ├── USAGE.md            # 用户使用说明
    └── ARCHITECTURE.md     # 本文档
```

---

## 3. 后端架构

### 3.1 启动流程

```
main()
  ├─ Config::load()          # 读 ~/.dddown/config.toml
  ├─ 解析 --workspace CLI 参数
  ├─ MD_PORT 环境变量覆盖端口
  ├─ tokio::fs::create_dir_all(workspace)
  ├─ 生成/加载 token
  ├─ FileWatcher::start()    # notify 监听工作区
  ├─ build_router(state)     # 组装 Axum 路由
  ├─ TcpListener::bind()
  └─ open_browser(url)       # 自动打开浏览器
```

### 3.2 路由表

| 方法 | 路径 | 处理 | 鉴权 |
|---|---|---|---|
| GET | `/api/file/read` | 读取文件内容 | ✅ |
| POST | `/api/file/write` | 写入文件（带冲突检测） | ✅ |
| DELETE | `/api/file` | 删除文件 | ✅ |
| GET | `/api/files/list` | 列出目录文件 | ✅ |
| GET | `/api/files/tree` | 文件树结构 | ✅ |
| GET | `/api/search` | 全文搜索 | ✅ |
| GET | `/api/snippets` | 用户片段列表 | ✅ |
| GET | `/api/shortcuts` | 自定义快捷键 | ✅ |
| GET | `/api/config` | 编辑器配置 | ✅ |
| POST | `/api/settings/token` | 设置固定密码 | ✅ |
| POST | `/api/export/html` | 导出 HTML 文件 | ✅ |
| GET | `/ws` | WebSocket 升级 | ✅ |
| * | `/*` | 静态资源（debug: ServeDir / release: rust-embed） | 否 |

鉴权方式：URL query `?token=xxx`，中间件统一校验。

### 3.3 数据保存链路

```
编辑器输入
  → 防抖 1500ms（最大间隔 2000ms 强制）
  → WebSocket sendSave（带 base_hash）
  → handler::write_file
      ├─ validate_path()         # 路径穿越防护
      ├─ check_conflict()        # FNV-1a 64 基线比对
      │   └─ 不匹配 → 409 Conflict
      ├─ 写入 .tmp 临时文件
      ├─ sync_all()              # fsync 确保落盘
      ├─ rename .tmp → 目标路径   # 原子替换
      └─ sync_dir()              # 目录 fsync（Unix）
  → broadcast FileChanged
  → 前端收到 saved 确认 → 清草稿
```

### 3.4 文件监听同步

```
notify::Watcher（fsevents 后端）
  → 检测到工作区文件变化
  → 防抖 300ms
  → broadcast FileChanged 到所有 WS 连接
  → 前端收到通知 → 读盘 → 替换编辑器内容
```

**防循环**：前端 dirty 状态下忽略 FileChanged，避免写入→监听→回写死循环。

### 3.5 配置体系

配置文件：`~/.dddown/config.toml`

```toml
[server]
port = 0                    # 0 = 随机端口
workspace = "~/Documents/Notes"
token = "fixed-token-here"  # 可选，设置后 URL 永久不变

[editor]
font_size = 15
tab_size = 2

[shortcuts]                 # 可选，覆盖默认键位
save = "ctrl-s"
search = "ctrl-p"
```

---

## 4. 前端架构

### 4.1 预览渲染管线

```
编辑器内容变更
  → 60ms debounce
  → comrak-wasm mdToHtml()     # Markdown → HTML 字符串
  → DOMPurify.sanitize()        # XSS 净化
  → 分 section（h1/h2 边界）    # 差量更新粒度
  → morphdom()                  # DOM 增量 diff
  → 后处理管线（并行）：
      ├─ Shiki：代码块语法高亮
      ├─ KaTeX：$...$ / $$...$$ 数学公式
      └─ Mermaid：```mermaid 图表（异步批量）
  → wikilink 后处理：[[笔记名]] → 可点击链接
  → onRenderDone 回调：TOC 大纲提取
```

**关键选项**：
- `hardbreaks: true`：单回车即 `<br>` 换行（WYSIWYG 必需）
- `unsafe: true`：允许原始 HTML（配合 DOMPurify）
- `githubPreLang: true`：代码块语言标识兼容 GitHub 风格

### 4.2 主题系统

4 种组合：书卷×亮 / 书卷×暗 / 现代×亮 / 现代×暗，加 2 种字体（宋体/无衬线）。

| 主题 | 底色 | 点缀色 | 字体 |
|---|---|---|---|
| 书卷 | `#FAFAF7` 暖纸 | `#C4452A` 朱砂红 | 宋体栈 |
| 现代 | `#FFFFFF` 纯白 | `#5B5BDC` 蓝紫 | 无衬线栈 |
| 暗色 | 低饱和深蓝灰 | 对应点缀色 | 同上 |

实现方式：CSS 变量 + `body` class 切换（`.theme-book` / `.theme-modern` / `.mode-dark` / `.font-serif` / `.font-sans`），localStorage 持久化。

**设计纪律**：人文色（宋体/墨色）与科技色（点缀色）严格分离，点缀色仅用于交互元素。

### 4.3 状态管理

前端无框架，纯 vanilla TS，状态集中在 `main.ts` 顶层变量：

```typescript
let currentFile: string          // 当前文件名
let baseHash: string | null      // 磁盘内容 FNV-1a 基线
let autoSaveTimer                // 防抖计时器
let dirtySince: number           // 首次脏时间（强制保存用）
let isFormatPinned: boolean      // 格式工具栏固定状态
```

草稿机制：`localStorage['dddown:draft:{path}']`，输入后 100ms 节流写入，保存确认后清除。启动时草稿与磁盘不一致则恢复并提示。

### 4.4 UI 组件

| 组件 | 触发方式 | 说明 |
|---|---|---|
| 侧栏文件树 | 状态栏「文件」按钮 | 170px 宽，新建/切换/删除文件 |
| 大纲面板 | 侧栏「大纲」Tab | 从预览区 h1~h3 提取 |
| 搜索面板 | `⌘P` / `Ctrl+P` | 全文搜索 + 命中跳转 |
| 格式工具栏 | 鼠标移向左边缘 12px | 15 种格式 + 固定按钮 + 语法速查 |
| 设置下拉 | 状态栏「设置」按钮 | 凭证 / 导出 HTML |
| 语法速查弹窗 | 格式工具栏底部「语法」 | 9 组常用语法 |
| 凭证弹窗 | 设置下拉 → 凭证 | 设置固定访问密码 |

### 4.5 格式工具栏交互

```
format-detect-strip（12px，pointer-events: auto）
  → mouseenter → 工具栏滑入（320ms 缓动）
  → mouseleave → 开始 800ms 隐藏计时

format-toolbar（pointer-events: auto）
  → mouseenter → 取消隐藏计时
  → mouseleave → 开始 800ms 隐藏计时

format-trigger-zone（60px，pointer-events: none）
  → 仅作视觉缓冲区域，不拦截鼠标事件

editor-pane mouseleave → 重置所有标记 → 开始隐藏计时

固定按钮（9px 圆点）→ isFormatPinned = true → 跳过所有 show/hide 逻辑
```

---

## 5. 通信协议

### 5.1 WebSocket 消息格式

**客户端 → 服务端**：
```json
{ "type": "save", "path": "welcome.md", "content": "...", "base_hash": "1234567890" }
```

**服务端 → 客户端**：
```json
{ "type": "saved", "timestamp": 1723968000, "path": "welcome.md" }
{ "type": "file_changed", "path": "other.md" }
{ "type": "conflict", "message": "文件已被外部修改，本次保存被拒绝" }
{ "type": "error", "message": "..." }
```

### 5.2 冲突检测机制

- 哈希算法：FNV-1a 64-bit（前后端逐字节一致，JS 用 BigInt 实现）
- 流程：客户端读取文件时记录 base_hash → 保存时携带 → 服务端比对磁盘当前哈希
- 不匹配 → 409 Conflict → 前端提示用户，保留用户内容，不静默覆盖

---

## 6. 测试体系

### 6.1 单元测试（Rust）

```bash
cargo test
```

覆盖：路径穿越防护（4 项）、配置解析（6 项）、文件处理（6 项）共 20 项。

### 6.2 E2E 测试（Playwright）

```bash
cd web && npm run test:e2e
```

12 条用例，串行执行，共享一个测试服务端（端口 60101，固定 token）：

| # | 用例 | 验证点 |
|---|---|---|
| 1 | 启动加载 | 文件读取 + 预览渲染 |
| 2 | 防抖更新 | 输入 → 预览延迟更新 |
| 3 | hardbreaks | 单回车 → `<br>` |
| 4 | 自动保存 | 输入 → 磁盘验证 |
| 5 | 新建文件 | 文件树更新 |
| 6 | 片段补全 | `tbl` + Tab → 表格 |
| 7 | 搜索跳转 | `⌘P` → 命中 → 跳转 |
| 8 | 专注模式 | `⌘⇧D` toggle |
| 9 | 外部同步 | 外部写入 → 编辑器自动更新 |
| 10 | 草稿恢复 | 种 localStorage → reload → 恢复 |
| 11 | 并发冲突 | 过期基线 → 409 → 不覆盖 |
| 12 | 凭证设置 | 格式校验 → 热生效 → URL 更新 |

**注意**：debug 模式前端走 `web/dist`，源码修改需先 `npm run build` 才能被 E2E 看到。

---

## 7. 已知限制与架构约束

### 7.1 并发编辑

当前无乐观锁/版本号以外的协作机制。单人使用安全，多人同时编辑同一文件时只有第一个保存成功，其余收到冲突提示。如需实时协作，需引入 CRDT 或 OT 层。

### 7.2 搜索能力

当前为 grep 式全文搜索，无索引。大工作区（>10000 文件）性能会下降。可扩展 tantivy 或 SQLite FTS5 做倒排索引。

### 7.3 文件监听

notify 的 fsevents 后端对符号链接路径 watch 静默失败。工作区路径需使用真实路径（non-symlink）。

### 7.4 WASM 体积

comrak-wasm + Shiki + KaTeX + Mermaid 总体积较大（首屏约 5-8MB）。已做懒加载，但首次加载仍有感知。

### 7.5 发布构建

release 模式通过 rust-embed 将 `web/dist` 嵌入二进制。前端修改需先 `npm run build` 再 `cargo build --release`。

---

## 8. 未来拓展接口

### 8.1 后端拓展点

| 方向 | 入口 | 说明 |
|---|---|---|
| 全文索引 | `search.rs` | 替换为 tantivy/SQLite FTS5，保持 API 签名不变 |
| 文件版本历史 | `handler.rs` | 在 write_file 前追加版本快照（git 或自定义存储） |
| 多工作区 | `config.rs` + `routes.rs` | AppState 支持 workspace 列表，API 加 workspace 参数 |
| 插件系统 | 新增 `plugins.rs` | WASM 插件沙箱（wasmer/wasmtime），暴露文件读写 API |
| WebDAV/远程同步 | 新增 `sync.rs` | 对接 iCloud/Dropbox/WebDAV，watcher 层抽象为 trait |
| 实时协作 | `ws.rs` | 引入 Yjs/Automerge 协议，ws.rs 作为信令中继 |
| 导出格式 | `handler.rs::export_html` | 拓展 PDF（via headless Chrome）、DOCX、ePub |

### 8.2 前端拓展点

| 方向 | 入口 | 说明 |
|---|---|---|
| 自定义主题 | `theme.ts` + `editor.css` | 新增 palette 枚举值 + CSS 变量组 |
| 编辑器扩展 | `editor/setup.ts` | CM6 Extension 机制，可加 Vim 模式、Emacs 键位等 |
| 预览增强 | `preview/render.ts` | 后处理管线可插拔，新增处理器只需加入 chain |
| 命令面板 | `search.ts` | 拓展为 VSCode 式 `⌘Shift+P` 命令面板 |
| 拖拽排序 | `sidebar.ts` | 文件树拖拽移动/重命名 |
| 离线 PWA | `vite.config.ts` | 添加 Service Worker，离线可用 |
| 移动端适配 | `editor.css` | 响应式断点已有基础（`@media max-width: 720px`） |

### 8.3 配置拓展

`config.toml` 结构已预留拓展空间，新增配置项只需：

1. `config.rs` 加字段 + `#[serde(default)]`
2. `routes.rs::api_config` 自动下发到前端
3. 前端 `main.ts` 启动时读取并应用

---

## 9. 开发工作流

### 日常开发

```bash
# 终端 1：启动后端（debug 模式，热重载前端）
cd dddown && cargo run

# 终端 2：前端开发服务器（可选，用于 HMR）
cd web && npm run dev

# 前端源码修改后，debug 模式需 build 才能被 cargo run 看到
cd web && npm run build
```

### 发布构建

```bash
cd web && npm run build           # 先构建前端
cd dddown && cargo build --release  # 嵌入静态资源，单二进制
# 产出：target/release/dddown（约 18MB）
```

### 测试

```bash
cargo test                       # Rust 单测
cd web && npm run test:e2e       # E2E（需先 build）
```

### 关键环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `MD_PORT` | 服务端口 | 0（随机） |
| `RUST_LOG` | 日志级别 | info |

---

## 10. 里程碑回顾

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 1 | 骨架可用：双栏布局 + 文件 CRUD + WebSocket | ✅ |
| Phase 2 | 预览管线：comrak WASM + DOMPurify + morphdom + Shiki/KaTeX/Mermaid | ✅ |
| Phase 3 | 数据保障：草稿恢复 + 冲突检测 + fsync 原子写入 | ✅ |
| Phase 4 | UI 精修：双主题 + 格式工具栏 + 语法速查 + 设置整合 | ✅ |
| Phase 5 | 未来：插件系统 / 全文索引 / 协作 / 移动端 | 🔲 |
