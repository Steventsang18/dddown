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
- **Typographic precision**: kerning, hanging punctuation, image captions, nested-list spacing — polished serif CJK typesetting
- **Snippet completion**: 76 built-in snippets (headings/tables/code blocks/meeting notes, etc.), Tab to accept, numbered field jumps; override or extend via `~/.dddown/snippets/*.json`
- **Custom shortcuts**: override 7 actions in `config.toml` with `mod-shift-x` style strings; invalid config falls back to defaults
- **File management**: sidebar file tree, create/delete, full-text search (⌘P), outline panel
- **Reliable saving**: 500ms debounced autosave, atomic writes, filesystem watching (external changes sync in, echo loops prevented)
- **Dual themes + font switching**: Book (light serif) and Night (desaturated dark blue-grey), remembered across reloads
- **HTML export**: one keystroke exports a fully self-contained HTML (inlined CSS, base64 fonts — works offline)

## Quick Start

```bash
# 1. Build the frontend
cd web && npm install && npm run build && cd ..

# 2. Start the server (opens your browser automatically)
cargo run
```

The terminal prints a tokenized URL — that's your entry point. See the [Quick Start guide](docs/quickstart.html) for details.

## Building the Release Binary

The release build embeds `web/dist` into the executable — ship a single binary:

```bash
cd web && npm run build && cd ..
cargo build --release
# Output: target/release/dddown (~18MB, all static assets included)

# Run it directly, optionally pointing at a workspace
./target/release/dddown --workspace ~/my-notes
```

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

# Browser E2E (12 core flows, isolated HOME, fixed port 60101)
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

## Release Checklist

1. `cd web && npm run build` — fresh frontend artifacts
2. `cargo test` — all green
3. Run `npm run test:e2e` (debug) and `E2E_BIN=release npm run test:e2e` (release binary)
4. `cargo build --release` — the artifact is the single-file distributable
5. Smoke test: run `dddown` in a clean environment (no `node_modules`, no `web/dist`); confirm the page loads, saving works, and external sync behaves
