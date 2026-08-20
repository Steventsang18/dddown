# 使用说明

dddown 是本地优先的 Markdown 编辑器：所有数据都在你自己的工作区目录里，纯 Markdown 文件，随时可以换工具，没有锁定。

## 安装与运行

### 源码运行

前置依赖：Rust stable、Node.js 18+。步骤见 [快速开始](quickstart.html)。

### 发布二进制（从 GitHub Release 下载，推荐）

到 [Releases 页](https://github.com/3Down/dddown/releases) 下载最新版，按平台对号：

| 你的系统 | 下载文件 |
| --- | --- |
| Apple Silicon Mac（M 系列） | `DDDown-vX-macos-arm64.dmg` |
| Intel Mac | `DDDown-vX-macos-x86_64.dmg` |
| Windows 10/11 | `dddown-vX-windows-x86_64.exe` |
| Linux（主流发行版） | `dddown-vX-linux-x86_64` |

**macOS（像普通 App 一样拖装）**

1. 打开 dmg，把 DDDown 拖进 Applications
2. 双击启动。首次会被 Gatekeeper 拦：系统设置 → 隐私与安全性 → 点「仍要打开」（只需一次；项目未购买 Apple 公证，属正常现象）
3. 浏览器自动打开编辑器。服务在后台运行，无终端无 Dock 图标；退出用 `pkill dddown` 或活动监视器

**Windows（双击即用，无黑窗口）**

1. 首次会被 SmartScreen 拦：点「更多信息」→「仍要运行」（项目未购买签名证书，正常现象）
2. 建议把 exe 移到固定目录（如 `D:\Tools\dddown\`）再双击：无终端窗口，浏览器自动打开编辑器
3. 想指定笔记目录：给 exe 建快捷方式，右键 → 属性 →「目标」末尾追加 `--workspace D:\笔记`；退出用任务管理器结束 `dddown.exe`

**Linux**

```bash
chmod +x dddown-v*-linux-x86_64
./dddown-v*-linux-x86_64
```

**首次启动后**：在界面「设置」里设固定访问密码，再按「常驻运行」一节配好固定端口与开机自启，之后就是点图标进编辑器、全程零命令。

### 从源码构建二进制

`target/release/dddown` 是自包含单文件（约 18MB），前端资源已嵌入，拷到任何机器直接运行，不需要 Node：

```bash
cd web && npm ci && npm run build   # 先构建前端（产物会被嵌入）
cargo build --release -p dddown-server
./target/release/dddown                    # 默认工作区 ~/Documents/Notes
./target/release/dddown --workspace ~/my-notes   # 指定工作区
```

### 启动行为

- 监听 `127.0.0.1`，默认随机端口（不会和别的程序抢 8080）
- 启动时自动打开默认浏览器，浏览器地址栏即入口（带 token 的完整 URL）
- 每次启动随机生成 token，访问必须带上（见 FAQ「token 是什么」）
- 工作区目录不存在时自动创建
- Windows/macOS 版无终端窗口（后台服务）；Linux 版终端输出的 URL 即入口

### 常驻运行（开机自启，日常零操作）

Windows/macOS 版双击即后台服务，Linux 版终端就是服务本体（关窗口 = 停服务）。配好下面两步，日常使用就是开浏览器进编辑器，全程零命令。

**第一步：固定地址（一次性）**

默认每次启动随机端口和 token，地址会变。想长期收藏一个固定地址：

1. 在界面「设置」里设固定访问密码（写入配置，重启不变）
2. `~/.dddown/config.toml` 里配固定端口，例如 `port = 8123`（避开常用端口即可）

之后入口恒为 `http://127.0.0.1:8123/?token=你的密码`，浏览器收藏或装成 PWA（地址栏安装图标）。

**第二步：开机自启（三选一）**

Windows：

- **启动文件夹**（最简）：`Win+R` 输入 `shell:startup` 回车，在打开的目录里给 `dddown.exe` 建快捷方式；右键快捷方式 → 属性，「目标」末尾追加参数（如 `--workspace D:\笔记`），「起始位置」填 exe 所在目录。开机登录自动后台运行，无任何窗口

macOS：系统设置 → 通用 → 登录项 → 添加 DDDown.app；或写 LaunchAgent 实现开机自启与崩溃自动拉起。

Linux：`systemctl --user enable --now dddown`（写一个 user unit 指向二进制路径即可）。

## 界面总览

```
┌─────────┬──────────────────────────┬──────────────────────────┐
│ 文件树   │  编辑区（左）             │  预览区（右）             │
│         │                          │                          │
│ 大纲    │                          │                          │
│         │                          │                          │
└─────────┴──────────────────────────┴──────────────────────────┘
 文件名 · 保存状态 · 光标行列 · 字数 · [主题] [字体] [侧栏]
```

- **左侧栏**：上方文件树（工作区里的 `.md` 文件），下方大纲（当前文档的标题层级）
- **中间**：CM6 编辑器，宋体书卷排版
- **右侧**：实时预览
- **底部状态栏**：当前文件名、保存状态、光标行列、字数统计、主题/字体/侧栏按钮

## 写作

### 自动保存

停止输入 500ms 后自动落盘，状态栏显示「未保存 → 已保存」。写盘是原子的（临时文件 + rename），断电也不会出现半个文件。手动保存：⌘S / Ctrl+S。

### 专注模式

⌘⇧D（Windows/Linux: Ctrl+Shift+D）进入专注模式：当前段落全浓度显示，其余内容淡化。光标移到哪个段落，哪个段落亮起来。

### 打字机滚动

光标接近视口底部时内容自动上滚，光标始终保持在舒适的视线位置，长文档里不需要手动滚。

### 滚动同步

预览区跟随编辑区滚动（单向：编辑 → 预览），写到哪里看到哪里。

### 字数统计

状态栏实时显示全文字数（按字符计）。光标行列也在状态栏。

### 记住上次文件

关闭页面后重开（同浏览器），自动回到上次编辑的文件。

## 预览

编辑区输入，预览区约 150ms 内更新（WASM 解析 + 增量 DOM diff，长文档不卡）。支持：

| 语法 | 说明 |
| --- | --- |
| 数学公式 | KaTeX，`$行内$` 与 `$$块级$$` |
| Mermaid | 流程图、时序图、类图、状态图、饼图、甘特图、思维导图、时间线（` ```mermaid ` 代码块） |
| 代码高亮 | Shiki，14+ 常用语言，颜色随主题 |
| Wikilink | `[[文件名]]` 点击跳转到工作区里的对应文件，不存在时提示 |
| Callout | `> [!NOTE]`、`> [!TIP]`、`> [!WARNING]`、`> [!CAUTION]`、`> [!IMPORTANT]` 提示块 |
| 脚注 | `[^id]` 与 `[^id]: 内容` |

预览内容经 DOMPurify 净化，粘贴的 HTML 不会执行脚本。

## 片段补全

输入前缀 → 弹出补全列表 → **Tab 确认展开** → **Tab 跳到下一个编号字段**。76 个内置片段：

| 类别 | 前缀（输入即触发） |
| --- | --- |
| 标题 | `#` `##` `###` `####` `#####` `######`（或 `h1`~`h4`） |
| 列表 | `ul` `ol` `task` `taskx` `nul` `li3` |
| 表格 | `tbl`（2×2）`tbl3`（3×3）`tbl4`（4×4）`tblalign`（对齐）`tbltask`（任务表） |
| 链接与图片 | `link` `img` `ref` `autolink` `maillink` |
| 代码块 | `code` + `coderust` `codepy` `codejs` `codets` `codebash` `codejson` `codehtml` `codecss` `codesql` `codeyaml` `codego` `codejava` `codecpp` |
| 引用 | `quote` `quotem` `callout` `note` `tip` `warn` `caution` `imp` |
| 分割线 | `hr` `hrstar` |
| 数学 | `math`（行内）`mathd`（块级） |
| Mermaid | `mmdflow` `mmdseq` `mmdclass` `mmdstate` `mmdpie` `mmdgantt` `mmdmind` `mmdtimeline` |
| 行内格式 | `bold` `italic` `strike` `icode` `footnote` `toc` |
| 中文场景模板 | `meeting`（会议纪要）`weekly`（周报）`todo`（今日待办）`diary`（日记）`reading`（读书笔记）`booknote`（书摘）`retro`（复盘）`okr` `fm`（frontmatter）`daily`（每日站会） |

### 自定义片段

在 `~/.dddown/snippets/` 下放 `.json` 文件，每个文件一个 JSON 数组：

```json
[
  {
    "prefix": "sig",
    "label": "签名",
    "body": "-- \\n张三",
    "lineStart": true,
    "detail": "落款"
  }
]
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `prefix` | 是 | 触发词 |
| `label` | 是 | 补全列表里显示的名字 |
| `body` | 是 | 展开内容，CM6 snippet 语法 |
| `lineStart` | 否 | true 时仅行首触发（标题、表格这类） |
| `detail` | 否 | 补全列表右侧的补充说明 |

body 语法：`${1:默认值}` 编号字段（Tab 依次跳转）、`\n` 换行、`\$` 转义字面 $、`${3|选项一,选项二|}` 下拉选择。

**同 prefix 的片段覆盖内置定义**，其余追加。多个文件都生效，全部合并。

## 快捷键

### 默认键位

| 动作 | macOS | Windows/Linux |
| --- | --- | --- |
| 保存 | ⌘S | Ctrl+S |
| 全文搜索 | ⌘P | Ctrl+P |
| 导出 HTML | ⌘⇧X | Ctrl+Shift+X |
| 专注模式 | ⌘⇧D | Ctrl+Shift+D |
| 切换主题 | ⌘⇧T | Ctrl+Shift+T |
| 切换字体 | ⌘⇧F | Ctrl+Shift+F |
| 收起/展开侧栏 | ⌘⇧E | Ctrl+Shift+E |

### 自定义

在 `~/.dddown/config.toml` 的 `[shortcuts]` 段覆盖，格式：修饰键与单键用 `-` 连接。

- 修饰键：`mod`（macOS 上是 Cmd，其他平台是 Ctrl）、`shift`、`alt`、`ctrl`
- 单键：一个字母、数字

```toml
[shortcuts]
save = "ctrl-s"        # 覆盖为纯 Ctrl（macOS 上也不再用 Cmd）
search = "alt-f"       # 搜索改 Alt+F
```

非法写法（两个单键、不认识的修饰键）静默回退默认键位。

## 文件管理

### 文件树

- 列出工作区全部 `.md` 文件（子目录递归）
- 「新建」按钮创建新文档
- 文件上「删除」按钮删除（删除前会确认）

### 全文搜索

⌘P / Ctrl+P 打开。关键词匹配**文件名与全文内容**，文件名命中的排在前面。回车打开第一个结果。

### 大纲

左侧栏下方自动列出当前文档的标题层级，点击跳转编辑器对应位置；预览区滚动时会高亮当前所在章节。

### 外部修改同步

文件在工作区里被**其他程序**修改（vim、iCloud、Git pull），编辑器会自动加载最新内容，不会互相覆盖。编辑器自身的保存不会触发这条路径（防回声循环）。

## 主题与字体

- **主题**：书卷/现代两套配色 × 亮暗两模式共四种，⌘⇧T / Ctrl+Shift+T 循环切换，选择随刷新记忆
- **字体**：宋体（衬线）↔ 无衬线，⌘⇧F / Ctrl+Shift+F 切换，与主题解耦自由组合；预览区固定无衬线中文排版；等宽字体（JetBrains Mono）本地打包，无网络也能渲染

## HTML 导出

⌘⇧X / Ctrl+Shift+X 把当前文档导出为单个 HTML 文件：CSS 全部内联、字体转 base64，完全自包含，发给别人双击就能看，不需要网络。

## 配置参考

配置文件：`~/.dddown/config.toml`。所有字段可省略，缺省用默认值。文件不存在或内容非法时整体回退默认配置（服务照常启动）。

```toml
dddown-server
port = 0                          # 监听端口，0 = 随机（默认）
workspace = "~/Documents/Notes"   # 工作区，支持 ~ 展开（默认）
token = "your-secret-token"       # 固定 token（省略则每次启动随机生成）

[editor]
font_size = 15                    # 正文字号（默认 15）
tab_size = 2                      # Tab 宽度（默认 2）

[shortcuts]
# 7 个动作均可省略，省略 = 用默认键位
save = "mod-s"
search = "mod-p"
export = "mod-shift-x"
focus = "mod-shift-d"
theme = "mod-shift-t"
font = "mod-shift-f"
sidebar = "mod-shift-e"
```

开发模式可用 `MD_PORT` 环境变量覆盖端口（优先级高于 config.toml）。

## 数据都在哪

| 内容 | 位置 |
| --- | --- |
| 你的文档 | 工作区目录（默认 `~/Documents/Notes`，可配置） |
| 配置文件 | `~/.dddown/config.toml` |
| 自定义片段 | `~/.dddown/snippets/*.json` |
| 上次打开的文件、主题选择 | 浏览器 localStorage |

卸载 = 删掉工作区目录 + `~/.dddown/`。文档本身是纯 Markdown，没有任何隐藏格式。

## FAQ

**token 是什么？**
访问凭证，随 URL 下发，前端请求会携带。服务端对所有 /api 路由与 WebSocket 强制校验，不带或带错一律 401。默认每次启动随机生成；在 `config.toml` 里配 `server.token` 或从界面「设置」里改，即可固定不变。

**能同时开两个实例指向同一个工作区吗？**
可以，但会互相触发「外部修改同步」，两个窗口对同一文件的编辑会相互覆盖。建议一个工作区只开一个实例。

**保存会覆盖我在别处的修改吗？**
编辑器只在「你输入过内容」后自动保存。外部修改进入后不会触发编辑器的保存路径（防回声循环），所以 git pull、iCloud 同步进来的内容不会被空写覆盖。

**为什么 workspace 配置没生效？**
命令行参数 `--workspace` 优先级高于配置文件。检查你是否带了参数启动。

**怎么把笔记迁移走？**
工作区就是普通目录，直接 `cp -r` 或打包。换个机器上改配置指向新路径即可。

**怎么退出服务？**
Windows：任务管理器结束 `dddown.exe`；macOS：终端 `pkill dddown` 或活动监视器退出；Linux：关掉终端窗口即停。想开机自动运行、日常零操作，见「常驻运行」一节。

**页面打不开，提示 404 或无法访问？**
URL 里必须带完整 token；未配固定 token 时每次启动都会变，从浏览器地址栏或启动日志重新复制。

## 开发模式

改前端代码时的开发流程（HMR，不用反复 build）：

```bash
# 终端 1：Rust 服务（debug 模式，读 web/dist）
# MD_PORT 环境变量指定端口（默认 41937，与 Vite 代理对齐）
MD_PORT=41937 cargo run

# 终端 2：Vite dev server（HMR）
cd web && npm run dev
```

浏览器访问 Vite 打印的地址（默认 http://localhost:5173），页面内的 /api 与 /ws 请求由 Vite 代理到 127.0.0.1:41937。debug 模式的 Rust 服务不嵌入静态资源，方便调试。

日志排查：`RUST_LOG=dddown_server=debug cargo run`。

测试：

```bash
cargo test                    # Rust 单测
cd web && npm run test:e2e    # Playwright E2E（18 条核心流程）
```
