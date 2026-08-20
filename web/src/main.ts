import { createEditor } from './editor/setup';
// 本地等宽字体（零外网依赖）
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { setFocusMode, isFocusMode } from './editor/focus';
import { mergeUserSnippets } from './editor/snippets';
import { initParser, renderPreview, renderNow, onRenderDone, setWikilinkCallbacks } from './preview/render';
import { readFile, writeFile, fetchSnippets, fetchShortcuts, fetchConfig, setToken, setWorkspace, browseFolder } from './api/client';
import { SocketClient } from './api/socket';
import { initTheme, cycleTheme, toggleFont, themeLabel } from './theme';
import { Sidebar } from './sidebar';
import { SearchPanel } from './search';
import { TocPanel } from './toc';
import { exportCurrentFile, exportPdf } from './export';
import { setupScrollSync } from './sync';
import { buildShortcutMap } from './shortcuts';
import { toast } from './toast';
import { EditorView } from '@codemirror/view';

// ========== DOM References ==========
const editorEl = document.getElementById('editor')!;
const previewEl = document.getElementById('preview')!;
const fileNameEl = document.getElementById('fileName')!;
const saveStateEl = document.getElementById('saveState')!;
const saveTextEl = document.getElementById('saveText')!;
const cursorPosEl = document.getElementById('cursorPos')!;
const wordCountEl = document.getElementById('wordCount')!;
const themeBtnEl = document.getElementById('themeBtn')!;
const fontBtnEl = document.getElementById('fontBtn')!;
const focusBtnEl = document.getElementById('focusBtn')!;
const settingsBtnEl = document.getElementById('settingsBtn')!;
const settingsPanelEl = document.getElementById('settingsPanel')!;
const exportToggleEl = document.getElementById('exportToggle')!;
const exportSubMenuEl = document.getElementById('exportSubMenu')!;
const formatToolbarEl = document.getElementById('formatToolbar')!;
const formatDetectStripEl = document.getElementById('formatDetectStrip')!;
const collapseBtnEl = document.getElementById('collapseBtn')!;
const previewPaneEl = document.getElementById('previewPane')!;
const sidebarEl = document.getElementById('sidebar')!;
const sidebarBtnEl = document.getElementById('sidebarBtn')!;
const fileTreeEl = document.getElementById('fileTree')!;
const newFileInputEl = document.getElementById('newFileInput') as HTMLInputElement;
const searchPanelEl = document.getElementById('searchPanel')!;
const searchInputEl = document.getElementById('searchInput') as HTMLInputElement;
const searchResultsEl = document.getElementById('searchResults')!;
const tabFilesEl = document.getElementById('tabFiles')!;
const tabTocEl = document.getElementById('tabToc')!;
const sidebarCollapseEl = document.getElementById('sidebarCollapse')!;
const sidebarHeadEl = document.querySelector('.sidebar-head') as HTMLElement;
const tocListEl = document.getElementById('tocList')!;
const tokenModalEl = document.getElementById('tokenModal')!;
const syntaxModalEl = document.getElementById('syntaxModal')!;
const tokenInputEl = document.getElementById('tokenInput') as HTMLInputElement;
const tokenHintEl = document.getElementById('tokenHint')!;
const workspaceModalEl = document.getElementById('workspaceModal')!;
const wsCurrentPathEl = document.getElementById('wsCurrentPath')!;
const workspaceInputEl = document.getElementById('workspaceInput') as HTMLInputElement;
const workspaceHintEl = document.getElementById('workspaceHint')!;

const TOKEN_HINT_DEFAULT = '要求：8-64 位，仅限字母、数字、连字符（-）和下划线（_）';
const TOKEN_RE = /^[a-zA-Z0-9_-]{8,64}$/;

// ========== State ==========
const LAST_FILE_KEY = 'dddown:lastFile';
const DRAFT_KEY = 'dddown:draft:';
// 连续输入时防抖会不断重置，dirty 超过此时长强制保存，收紧断电丢失窗口
const MAX_DIRTY_MS = 2000;
let currentFile = localStorage.getItem(LAST_FILE_KEY) || 'welcome.md';
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let draftTimer: ReturnType<typeof setTimeout> | null = null;
let isDirty = false;
let dirtySince = 0;
// 磁盘基线哈希：保存成功后推进，用于服务端冲突检测
let baseHash = '';
let socket: SocketClient;
let editorView: EditorView | null = null;
let sidebar: Sidebar;
let searchPanel: SearchPanel;
let tocPanel: TocPanel;
let loadingFile = false;
let workspacePath = '';

// ========== Init ==========
async function init() {
  // Restore theme/font preference
  initTheme();
  syncThemeLabel();

  // Initialize WASM parser
  await initParser();

  // 用户自定义片段与快捷键（一次性加载，热路径零影响）
  mergeUserSnippets(await fetchSnippets());
  const shortcuts = buildShortcutMap(await fetchShortcuts());
  const editorConfig = await fetchConfig();
  workspacePath = editorConfig.workspace || '';
  if (workspacePath) {
    const display = workspacePath.length > 24 ? '…' + workspacePath.slice(-22) : workspacePath;
    document.getElementById('workspacePath')!.textContent = display;
  }

  // Create editor
  editorView = createEditor(
    editorEl,
    onEditorChange,
    () => updateCursorPos(editorView!),
    { fontSize: editorConfig.font_size, tabSize: editorConfig.tab_size }
  );

  // 滚动同步（编辑 → 预览，单向）
  setupScrollSync(editorView, previewEl);

  // Connect WebSocket（连接建立后：回补未保存内容，再拉取比对补偿断连期间丢失的广播）
  socket = new SocketClient(onWsMessage, () => {
    if (isDirty) saveCurrentFile();
    reloadIfChanged(currentFile, 0);
  });
  socket.connect();

  // Sidebar (file tree)
  sidebar = new Sidebar(fileTreeEl, newFileInputEl, {
    onOpenFile: loadFile,
    getCurrentFile: () => currentFile,
    isDirty: () => isDirty,
    saveNow: saveCurrentFile,
    onFileDeleted: handleFileDeleted,
  });
  sidebar.refresh();

  // Search panel (⌘P)
  searchPanel = new SearchPanel(searchPanelEl, searchInputEl, searchResultsEl, {
    onOpen: openSearchResult,
  });

  // TOC panel (side tab)
  tocPanel = new TocPanel(tocListEl, {
    onJump: jumpEditorToHeading,
  });
  onRenderDone((container) => tocPanel.update(container));
  previewEl.addEventListener('scroll', () => tocPanel.onScroll(), { passive: true });
  tabFilesEl.addEventListener('click', () => switchSidebarTab('files'));
  tabTocEl.addEventListener('click', () => switchSidebarTab('toc'));

  // Wikilink 跳转
  setWikilinkCallbacks({
    onOpen: async (path) => {
      if (isDirty) saveCurrentFile();
      await loadFile(path);
      sidebar.refresh();
    },
    onNotFound: (name) => toast(`未找到笔记 ${name}`, 'warn'),
  });

  // 性能基准模式：?bench 动态加载 bench.ts，跳过文件加载
  if (new URLSearchParams(window.location.search).has('bench')) {
    const { runBench } = await import('./bench');
    await runBench();
    return;
  }

  // Load initial file
  try {
    await loadFile(currentFile);
  } catch (err) {
    console.warn('[init] could not load file, falling back:', err);
    if (String(err).includes('401')) {
      // 凭证失效：静态资源能打开但所有 API 被拒，给出明确指引而非空白页
      saveTextEl.textContent = '凭证失效';
      renderPreview('> 访问凭证已失效或服务已重启，请从服务终端输出的最新地址重新进入。', previewEl);
      return;
    }
    // 上次文件已不存在则回落 welcome.md
    if (currentFile !== 'welcome.md') {
      try {
        await loadFile('welcome.md');
      } catch {
        renderPreview('', previewEl);
      }
    } else {
      renderPreview('', previewEl);
    }
  }

  // Update status bar
  updateCursorPos(editorView);

  // Keyboard shortcuts（默认键位 + 用户覆盖）
  document.addEventListener('keydown', (e) => {
    if (shortcuts.get('save')!(e)) {
      e.preventDefault();
      saveCurrentFile();
    } else if (shortcuts.get('theme')!(e)) {
      e.preventDefault();
      cycleThemeUI();
    } else if (shortcuts.get('font')!(e)) {
      e.preventDefault();
      fontBtnEl.textContent = toggleFont();
    } else if (shortcuts.get('sidebar')!(e)) {
      e.preventDefault();
      toggleSidebar();
    } else if (shortcuts.get('search')!(e)) {
      e.preventDefault();
      searchPanel.open();
    } else if (shortcuts.get('export')!(e)) {
      e.preventDefault();
      doExport();
    } else if (shortcuts.get('focus')!(e)) {
      e.preventDefault();
      toggleFocusMode();
    }
  });

  // Theme & font buttons
  themeBtnEl.addEventListener('click', cycleThemeUI);
  fontBtnEl.addEventListener('click', () => { fontBtnEl.textContent = toggleFont(); });
  sidebarBtnEl.addEventListener('click', toggleSidebar);
  sidebarCollapseEl.addEventListener('click', toggleSidebar);
  focusBtnEl.addEventListener('click', toggleFocusMode);

  // 设置面板
  settingsBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanelEl.classList.toggle('show');
  });
  document.addEventListener('click', (e) => {
    if (!settingsPanelEl.contains(e.target as Node) && e.target !== settingsBtnEl) {
      settingsPanelEl.classList.remove('show');
    }
  });
  // 导出子菜单展开
  exportToggleEl.addEventListener('click', () => {
    exportToggleEl.classList.toggle('expanded');
    exportSubMenuEl.classList.toggle('show');
  });
  // 凭证
  document.getElementById('menuCredentials')!.addEventListener('click', () => {
    settingsPanelEl.classList.remove('show');
    openTokenModal();
  });
  // 导出 HTML
  document.getElementById('menuExportHTML')!.addEventListener('click', () => {
    settingsPanelEl.classList.remove('show');
    doExport();
  });
  // 导出 PDF
  document.getElementById('menuExportPDF')!.addEventListener('click', () => {
    settingsPanelEl.classList.remove('show');
    doExportPdf();
  });
  // 导入 Markdown
  document.getElementById('menuImport')!.addEventListener('click', () => {
    settingsPanelEl.classList.remove('show');
    triggerImport();
  });
  // 工作空间路径
  document.getElementById('workspacePathBtn')!.addEventListener('click', () => {
    settingsPanelEl.classList.remove('show');
    openWorkspaceModal();
  });

  // 左侧格式工具栏
  let formatHideTimer: ReturnType<typeof setTimeout> | null = null;
  let isFormatPinned = false;
  const pinBtnEl = document.getElementById('formatPinBtn') as HTMLElement | null;
  let isInToolbar = false;
  let isInStrip = false;

  const cancelFormatHide = () => {
    if (formatHideTimer) { clearTimeout(formatHideTimer); formatHideTimer = null; }
  };
  const scheduleFormatHide = () => {
    cancelFormatHide();
    formatHideTimer = setTimeout(() => formatToolbarEl.classList.remove('show'), 800);
  };

  formatDetectStripEl.addEventListener('mouseenter', () => {
    if (isFormatPinned) return;
    isInStrip = true;
    cancelFormatHide();
    formatToolbarEl.classList.add('show');
  });
  formatDetectStripEl.addEventListener('mouseleave', () => {
    isInStrip = false;
    if (!isInToolbar && !isFormatPinned) scheduleFormatHide();
  });
  formatToolbarEl.addEventListener('mouseenter', () => {
    if (isFormatPinned) return;
    isInToolbar = true;
    cancelFormatHide();
  });
  formatToolbarEl.addEventListener('mouseleave', () => {
    isInToolbar = false;
    if (!isInStrip && !isFormatPinned) scheduleFormatHide();
  });
  document.querySelector('.editor-pane')!.addEventListener('mouseleave', () => {
    isInStrip = false;
    isInToolbar = false;
    if (!isFormatPinned) scheduleFormatHide();
  });
  
  // 固定按钮
  if (pinBtnEl) {
    pinBtnEl.addEventListener('click', () => {
      isFormatPinned = !isFormatPinned;
      pinBtnEl.classList.toggle('active', isFormatPinned);
      formatToolbarEl.classList.toggle('pinned', isFormatPinned);
      if (isFormatPinned) {
        formatToolbarEl.classList.add('show');
        cancelFormatHide();
      } else if (!isInStrip && !isInToolbar) {
        scheduleFormatHide();
      }
    });
  }
  
  // 格式按钮点击
  formatToolbarEl.querySelectorAll<HTMLElement>('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'syntax') {
        document.getElementById('syntaxModal')!.hidden = false;
      } else if (action) {
        insertFormat(action);
      }
    });
  });

  // 预览栏收缩/展开
  let isPreviewCollapsed = false;
  collapseBtnEl.addEventListener('click', () => {
    isPreviewCollapsed = !isPreviewCollapsed;
    previewPaneEl.classList.toggle('collapsed', isPreviewCollapsed);
    collapseBtnEl.classList.toggle('collapsed', isPreviewCollapsed);
    collapseBtnEl.title = isPreviewCollapsed ? '展开预览栏' : '收缩预览栏';
  });

  // 设置弹窗（固定访问密码）
  document.getElementById('tokenCancelBtn')!.addEventListener('click', () => { tokenModalEl.hidden = true; });
  document.getElementById('tokenSaveBtn')!.addEventListener('click', saveTokenSetting);
  tokenModalEl.addEventListener('click', (e) => { if (e.target === tokenModalEl) tokenModalEl.hidden = true; });
  tokenInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveTokenSetting();
    if (e.key === 'Escape') tokenModalEl.hidden = true;
  });

  // 语法速查弹窗
  document.getElementById('syntaxCloseBtn')!.addEventListener('click', () => { syntaxModalEl.hidden = true; });
  syntaxModalEl.addEventListener('click', (e) => { if (e.target === syntaxModalEl) syntaxModalEl.hidden = true; });

  // 工作空间弹窗
  document.getElementById('workspaceCancelBtn')!.addEventListener('click', () => { workspaceModalEl.hidden = true; });
  document.getElementById('workspaceSaveBtn')!.addEventListener('click', saveWorkspaceSetting);
  document.getElementById('workspaceBrowseBtn')!.addEventListener('click', doBrowseFolder);
  workspaceModalEl.addEventListener('click', (e) => { if (e.target === workspaceModalEl) workspaceModalEl.hidden = true; });
  workspaceInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveWorkspaceSetting();
    if (e.key === 'Escape') workspaceModalEl.hidden = true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !syntaxModalEl.hidden) syntaxModalEl.hidden = true;
  });

  console.log('[dddown] ready');
}

// ========== Theme & Sidebar ==========
function syncThemeLabel() {
  themeBtnEl.textContent = themeLabel();
}

function cycleThemeUI() {
  themeBtnEl.textContent = cycleTheme();
}

function toggleSidebar() {
  sidebarEl.hidden = !sidebarEl.hidden;
  if (!sidebarEl.hidden) sidebar.refresh();
}

function switchSidebarTab(tab: 'files' | 'toc') {
  const showFiles = tab === 'files';
  tabFilesEl.classList.toggle('active', showFiles);
  tabTocEl.classList.toggle('active', !showFiles);
  sidebarHeadEl.hidden = !showFiles;
  fileTreeEl.hidden = !showFiles;
  tocListEl.hidden = showFiles;
}

// ========== Editor Callbacks ==========
function onEditorChange(content: string) {
  // Update preview (debounced inside renderPreview)
  renderPreview(content, previewEl);

  // Update word count
  updateWordCount(content);

  // Programmatic load: don't mark dirty or schedule auto-save
  if (loadingFile) return;

  // Mark dirty
  markDirty();

  // 草稿 100ms 内写入 localStorage，崩溃/断电后重启可恢复
  persistDraft();

  // Auto-save after 500ms of inactivity
  scheduleAutoSave();
}

function updateCursorPos(editor: EditorView) {
  try {
    const state = editor.state;
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    const lineNum = line.number;
    const col = pos - line.from + 1;
    cursorPosEl.textContent = `${lineNum}:${col}`;
  } catch {
    cursorPosEl.textContent = '1:1';
  }
}

function updateWordCount(text: string) {
  // Count CJK characters + word count for latin text
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const latin = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  const total = cjk + latin;
  wordCountEl.textContent = `${total} 字`;
}

// ========== Save Logic ==========
function markDirty() {
  isDirty = true;
  dirtySince ||= Date.now();
  saveStateEl.classList.add('dirty');
  saveTextEl.textContent = '未保存';
}

function markClean() {
  isDirty = false;
  saveStateEl.classList.remove('dirty');
  saveTextEl.textContent = '已保存';
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  // 防抖 500ms，但 dirty 超过 MAX_DIRTY_MS 时立即保存
  const wait = Math.min(500, Math.max(0, dirtySince + MAX_DIRTY_MS - Date.now()));
  autoSaveTimer = setTimeout(() => {
    if (isDirty) saveCurrentFile();
  }, wait);
}

async function saveCurrentFile() {
  if (!isDirty || !editorView) return;

  const content = editorView.state.doc.toString();
  saveTextEl.textContent = '保存中...';
  // WS 优先；连接不可用时降级 HTTP，保证保存不会静默失败
  if (socket.sendSave(currentFile, content, baseHash)) return;
  try {
    await writeFile(currentFile, content, baseHash);
    onSaved();
  } catch (err) {
    if (String(err).includes('409')) {
      onConflict();
    } else {
      saveTextEl.textContent = '保存失败';
      toast('保存失败，请稍后重试', 'error');
    }
  }
}

/** 保存确认：基线推进到当前内容，草稿使命完成可清除 */
function onSaved() {
  baseHash = fnv1a64(editorView!.state.doc.toString());
  clearDraft();
  markClean();
}

function onConflict() {
  // 保留用户未保存内容不强制覆盖，等待用户处理
  saveTextEl.textContent = '⚠ 保存冲突：文件已被其他窗口修改，本次未写入';
  toast('保存冲突：文件已被其他窗口修改，本次未写入', 'warn');
}

// ========== 持久化工具 ==========
/** FNV-1a 64：与服务端 handler::fnv1a64 逐字节一致，用于保存基线比对 */
function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(text)) {
    h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString();
}

function persistDraft() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftTimer = null;
    if (editorView) localStorage.setItem(DRAFT_KEY + currentFile, editorView.state.doc.toString());
  }, 100);
}

function getDraft(path: string): string | null {
  return localStorage.getItem(DRAFT_KEY + path);
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY + currentFile);
}

// ========== WebSocket Messages ==========
function onWsMessage(data: any) {
  switch (data.type) {
    case 'saved':
      // 只认当前文件的确认，避免切文件时旧响应污染基线
      if (data.path === currentFile) onSaved();
      break;
    case 'conflict':
      onConflict();
      break;
    case 'file_changed':
      // External file change: refresh tree; reload current file if clean
      handleExternalChange(data.path);
      break;
    case 'error':
      saveTextEl.textContent = '保存失败';
      toast(data.message ? `保存失败：${data.message}` : '保存失败', 'error');
      break;
  }
}

// ========== File Loading ==========
async function loadFile(path: string) {
  const disk = await readFile(path);
  if (!editorView) return;

  // 草稿存在且与磁盘不同：上次会话未落盘（崩溃/断电），恢复并准备重存
  const draft = getDraft(path);
  const content = draft !== null && draft !== disk ? draft : disk;

  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  currentFile = path;
  fileNameEl.textContent = path;

  loadingFile = true;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: content },
  });
  loadingFile = false;

  localStorage.setItem(LAST_FILE_KEY, path);
  baseHash = fnv1a64(disk);
  if (content !== disk) {
    dirtySince = 0;
    markDirty();
    scheduleAutoSave();
    toast('已恢复未保存内容');
  } else {
    markClean();
  }
}

function handleFileDeleted(path: string) {
  if (path !== currentFile || !editorView) return;
  clearDraft();
  currentFile = '';
  fileNameEl.textContent = 'untitled.md';
  loadingFile = true;
  editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: '' } });
  loadingFile = false;
  markClean();
}

const externalTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 外部修改：同路径 300ms 内合并（watcher 对一次写入会发多个事件），
 * 读盘失败延迟重试而非放弃，避免前端与磁盘脱钩后 autosave 反复回写旧内容 */
function handleExternalChange(path: string) {
  const prev = externalTimers.get(path);
  if (prev) clearTimeout(prev);
  externalTimers.set(
    path,
    setTimeout(() => {
      externalTimers.delete(path);
      reloadIfChanged(path, 0);
    }, 300)
  );
}

async function reloadIfChanged(path: string, attempt: number) {
  sidebar.refresh();
  if (path !== currentFile || !editorView) return;
  let disk: string;
  try {
    disk = await readFile(path);
  } catch {
    if (attempt < 2) {
      setTimeout(() => reloadIfChanged(path, attempt + 1), 1000);
    }
    return;
  }
  if (isDirty) return; // 用户有未保存内容时不覆盖
  if (disk === editorView.state.doc.toString()) return; // 自身保存的回声
  if (!disk && editorView.state.doc.length > 0) return; // 磁盘短暂为空（原子写瞬间）不覆盖
  await loadFile(path);
}

// ========== Search ==========
async function openSearchResult(path: string, line: number) {
  searchPanel.close();
  if (path !== currentFile) {
    if (isDirty) saveCurrentFile();
    await loadFile(path);
  }
  jumpToLine(line);
}

function jumpToLine(line: number) {
  if (!editorView) return;
  const doc = editorView.state.doc;
  const l = doc.line(Math.min(line, doc.lines));
  editorView.dispatch({
    selection: { anchor: l.from },
    effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
  });
  editorView.focus();
}

function jumpEditorToHeading(text: string) {
  if (!editorView) return;
  const doc = editorView.state.doc.toString();
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'm').exec(doc);
  if (!m) return;
  const l = editorView.state.doc.lineAt(m.index);
  editorView.dispatch({
    selection: { anchor: l.from },
    effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
  });
}

// ========== Export ==========
async function doExport() {
  if (!editorView || !currentFile) return;
  try {
    await renderNow(editorView.state.doc.toString(), previewEl);
    const name = await exportCurrentFile(currentFile, previewEl);
    toast(`已导出 ${name}`);
  } catch (err) {
    console.error('[export] failed:', err);
    toast('HTML 导出失败', 'error');
  }
}

async function doExportPdf() {
  if (!editorView || !currentFile) return;
  try {
    await renderNow(editorView.state.doc.toString(), previewEl);
    await exportPdf(currentFile, previewEl);
    toast('已导出 PDF');
  } catch (err) {
    console.error('[export-pdf] failed:', err);
    toast('PDF 导出失败', 'error');
  }
}

function triggerImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const name = file.name.endsWith('.md') ? file.name : file.name + '.md';
      await writeFile(name, content, '');
      sidebar.refresh();
      await loadFile(name);
      toast(`已导入 ${name}`);
    } catch (err) {
      console.error('[import] failed:', err);
      toast('导入失败', 'error');
    }
  };
  input.click();
}

// ========== Focus Mode ==========
function toggleFocusMode() {
  if (!editorView) return;
  const on = !isFocusMode(editorView);
  setFocusMode(editorView, on);
  focusBtnEl.classList.toggle('active', on);
}

// 关页兑底：autosave/WS 没来得及完成时用 sendBeacon 落盘（浏览器保证发出）
window.addEventListener('pagehide', () => {
  if (!isDirty || !editorView || !currentFile) return;
  const token = new URLSearchParams(location.search).get('token') || '';
  const body = JSON.stringify({ path: currentFile, content: editorView.state.doc.toString(), base_hash: baseHash });
  navigator.sendBeacon(`/api/file/write?token=${token}`, new Blob([body], { type: 'application/json' }));
});

// ========== 设置弹窗 ==========
function openTokenModal() {
  tokenInputEl.value = '';
  tokenHintEl.textContent = TOKEN_HINT_DEFAULT;
  tokenModalEl.hidden = false;
  tokenInputEl.focus();
}

async function saveTokenSetting() {
  const token = tokenInputEl.value.trim();
  if (!TOKEN_RE.test(token)) {
    tokenHintEl.textContent = '⚠ 格式不符：' + TOKEN_HINT_DEFAULT.slice(3);
    return;
  }
  try {
    await setToken(token);
    // 同步更新地址栏：书签与当前页后续请求都用新密码
    const url = new URL(location.href);
    url.searchParams.set('token', token);
    history.replaceState(null, '', url);
    tokenModalEl.hidden = true;
    toast('密码已设置，地址已更新');
  } catch (err) {
    tokenHintEl.textContent = `⚠ ${err instanceof Error ? err.message : '设置失败'}`;
  }
}

function openWorkspaceModal() {
  wsCurrentPathEl.textContent = workspacePath || '未配置';
  workspaceInputEl.value = '';
  workspaceHintEl.textContent = '支持绝对路径或 ~ 开头的主目录路径';
  workspaceModalEl.hidden = false;
  workspaceInputEl.focus();
}

async function saveWorkspaceSetting() {
  const ws = workspaceInputEl.value.trim();
  if (!ws) {
    workspaceHintEl.textContent = '⚠ 请输入路径';
    return;
  }
  try {
    const newPath = await setWorkspace(ws);
    workspacePath = newPath;
    const display = newPath.length > 24 ? '…' + newPath.slice(-22) : newPath;
    document.getElementById('workspacePath')!.textContent = display;
    workspaceModalEl.hidden = true;
    sidebar.refresh();
    // 当前文件在新工作空间可能不存在，尝试重新加载
    try {
      await loadFile(currentFile);
    } catch {
      if (editorView) {
        editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: '' } });
      }
      renderPreview('', previewEl);
      fileNameEl.textContent = 'untitled.md';
      currentFile = '';
    }
    toast('工作空间已切换');
  } catch (err) {
    workspaceHintEl.textContent = `⚠ ${err instanceof Error ? err.message : '切换失败'}`;
  }
}

/** 调用系统原生文件夹选择器，选中后填充到输入框 */
async function doBrowseFolder() {
  try {
    const path = await browseFolder();
    if (path) {
      workspaceInputEl.value = path;
      workspaceHintEl.textContent = '已选择: ' + path;
    }
  } catch (err) {
    workspaceHintEl.textContent = `⚠ ${err instanceof Error ? err.message : '浏览失败'}`;
  }
}

// ========== Format Insertion ==========
function insertFormat(action: string) {
  if (!editorView) return;
  const { state } = editorView;
  const { from, to } = state.selection.main;
  const selected = state.doc.sliceString(from, to);
  let insert = '';
  let cursorOffset = 0;

  switch (action) {
    case 'bold':
      insert = `**${selected || '粗体'}**`;
      cursorOffset = selected ? insert.length : 2;
      break;
    case 'italic':
      insert = `*${selected || '斜体'}*`;
      cursorOffset = selected ? insert.length : 1;
      break;
    case 'h1':
      insert = `# ${selected || '标题'}`;
      cursorOffset = insert.length;
      break;
    case 'h2':
      insert = `## ${selected || '标题'}`;
      cursorOffset = insert.length;
      break;
    case 'h3':
      insert = `### ${selected || '标题'}`;
      cursorOffset = insert.length;
      break;
    case 'ul':
      insert = `- ${selected || '列表项'}`;
      cursorOffset = insert.length;
      break;
    case 'ol':
      insert = `1. ${selected || '列表项'}`;
      cursorOffset = insert.length;
      break;
    case 'quote':
      insert = `> ${selected || '引用'}`;
      cursorOffset = insert.length;
      break;
    case 'code':
      insert = `\`${selected || '代码'}\``;
      cursorOffset = selected ? insert.length : 1;
      break;
    case 'codeblock':
      insert = `\`\`\`\n${selected || '代码'}\n\`\`\``;
      cursorOffset = selected ? insert.length : 4;
      break;
    case 'link':
      insert = `[${selected || '链接文字'}](url)`;
      cursorOffset = selected ? insert.length - 4 : 1;
      break;
    case 'image':
      insert = `![${selected || '图片描述'}](url)`;
      cursorOffset = selected ? insert.length - 4 : 2;
      break;
    case 'hr':
      insert = '\n---\n';
      cursorOffset = insert.length;
      break;
    default:
      return;
  }

  editorView.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + cursorOffset },
  });
  editorView.focus();
}

// ========== Start ==========
init().catch((err) => {
  console.error('[init] failed:', err);
  toast('初始化失败，请刷新页面', 'error');
});

// PWA：仅生产构建注册 Service Worker（dev 模式绝不缓存，避免污染开发）；?nosw=1 可禁用
if (import.meta.env.PROD && 'serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* 注册失败不影响主流程 */ });
}
