# dddown

English | [中文](README.md)

A local-first Markdown editor. Rust backend + CodeMirror 6 + comrak WASM preview, distributed as a single binary with zero external network dependencies. Your data is nothing but plain Markdown files in your workspace — no proprietary format, no lock-in.

Docs:

- **[Quick Start](docs/quickstart.html)** — bilingual onboarding guide (open directly in a browser)
- **[Usage Guide](docs/USAGE.md)** — features, snippets, shortcuts, configuration, FAQ (Chinese)
- **[Architecture](docs/ARCHITECTURE.md)** — tech stack, directory layout, protocols, testing (Chinese)

## Features

- **Immersive writing**: typewriter scrolling (caret stays centered), focus mode (current paragraph highlighted, the rest faded), breathing caret, focused-line enhancement
- **Inline rendering** (Typora-style interaction): when the caret leaves a line, it renders in place — KaTeX math (inline + display), image thumbnails, links showing only their text, real bold/italic styling; the source returns as soon as the caret lands back
- **Live two-pane preview**: WASM parsing (comrak), morphdom incremental DOM updates, 150ms debounce; Mermaid diagrams, syntax highlighting (Shiki), `[[wikilink]]` cross-jumps; the preview follows the caret at heading level
- **Typographic precision**: kerning, hanging punctuation, image captions, nested-list spacing; CJK-optimized preview — sans-serif CJK font stack, 75em optimal measure, strict kinsoku line-breaking, automatic spacing between CJK and Latin text
- **Snippet completion**: 76 built-in snippets (headings/tables/code blocks/meeting notes, etc.), Tab to accept, numbered field jumps; override or extend via `~/.dddown/snippets/*.json`
- **Custom shortcuts**: override 7 actions in `config.toml` with `mod-shift-x` style strings; invalid config falls back to defaults
- **File management**: sidebar file tree, create/delete, full-text search (⌘P), outline panel; one-click Markdown import into the workspace
- **Reliable saving**: 500ms debounced autosave, atomic writes, draft recovery, conflict detection, filesystem watching (external changes sync in, echo loops prevented)
- **Four themes + font switching**: Book/Modern palettes × light/dark modes, serif/sans freely combined, preferences remembered separately
- **Export**: one keystroke exports a fully self-contained HTML (inlined CSS — works offline); publication-grade PDF (@page headers/footers/page numbers, auto heading numbering, break-safe blocks)
- **Installable PWA**: manifest + Service Worker, installs as a standalone desktop app; all static assets cached for instant launch, the app shell still opens if the backend is briefly unreachable; credentials remembered automatically — no token needed on cold launch
- **Ready out of the box**: first launch (empty workspace) seeds a welcome document — project intro, quick-start guide and a full-format typesetting demo; set a fixed access password and hot-switch workspaces (native folder picker) from the UI

## Quick Start

**Just use it**: grab the artifact for your platform from [Releases](https://github.com/3Down/dddown/releases) (macOS dmg drag-install / Windows exe double-click), then follow the [install guide](docs/USAGE.md#发布二进制从-github-release-下载推荐) (covers SmartScreen / Gatekeeper).

**Run from source**:

```bash
# 1. Build the frontend
cd web && npm install && npm run build && cd ..

# 2. Start the server (opens your browser automatically)
cargo run
```

The terminal prints a tokenized URL — that's your entry point. See the [Quick Start guide](docs/quickstart.html) for details.

> **Lifecycle note**: on Windows/macOS a double-click starts a background service — no terminal window, the browser opens automatically as your entry point. On Linux the terminal window *is* the server — minimize it, don't close it. Setting a fixed access password first is recommended, so the URL survives restarts. For auto-start on boot (zero daily effort), see the [keep-running guide](docs/USAGE.md#常驻运行开机自启日常零操作).

## Building the Release Binary

The release build embeds `web/dist` into the executable — ship a single binary:

```bash
cd web && npm run build && cd ..
cargo build --release
# Output: target/release/dddown (~18MB, all static assets included)

# Run it directly, optionally pointing at a workspace
./target/release/dddown --workspace ~/my-notes
```

## Installing as a Desktop App (PWA)

Start the server, then visit the tokenized URL in your browser and install:

- **Chrome / Edge**: the install icon on the right of the address bar, or menu → “Install dddown”
- **macOS Safari**: Share menu → “Add to Dock”

Once installed, launch it straight from the dock — standalone window, no browser chrome. The Service Worker caches every static asset (cache version rotates automatically per build); after your first tokenized visit the credential is remembered, so cold launches need no URL parameters. Production builds only — dev mode is untouched, and `?nosw=1` disables it at any time.

## Development

```bash
# Terminal 1: Rust server (debug mode serves web/dist)
# MD_PORT picks the port (defaults to 41937, matching the Vite proxy)
MD_PORT=41937 cargo run

# Terminal 2: Vite HMR
cd web && npm run dev
```

Logging: `RUST_LOG=dddown_server=debug cargo run`.

## Testing

```bash
# Rust unit tests (dddown-core path validation + dddown-server config/search/snippets)
cargo test

# Browser E2E (18 core flows, isolated HOME, fixed port 60101)
cd web && npm run test:e2e

# Validate the release binary (E2E runs against target/release/dddown)
cd web && E2E_BIN=release npm run test:e2e
```

## Project Structure

```
crates/
  dddown-core/    # shared logic such as path validation
  dddown-server/  # axum server: file API, search, WebSocket, watcher, embedded static assets
web/
  src/        # CM6 editor, inline rendering, preview pipeline, immersion layer, snippets, shortcuts
  e2e/        # Playwright E2E
docs/
  quickstart.html   # bilingual quick-start guide
  USAGE.md          # usage guide
  ARCHITECTURE.md   # architecture documentation
```

