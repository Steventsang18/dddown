/** 主题状态管理：4 主题组合（书卷/现代 × 亮/暗）× 2 字体，localStorage 持久化 */

export interface ThemeState {
  palette: 'book' | 'modern';
  dark: boolean;
  font: 'serif' | 'sans';
}

const STORAGE_KEY = 'dddown:theme';
const DEFAULTS: ThemeState = { palette: 'book', dark: false, font: 'serif' };

const PALETTE_LABEL: Record<string, string> = { book: '书卷', modern: '现代' };
const FONT_LABEL: Record<string, string> = { serif: '宋体', sans: '无衬线' };

// 与 editor.css 各主题的 --bg 保持一致，同步给 meta theme-color（PWA 标题栏随主题变色）
const THEME_COLOR: Record<string, string> = {
  'book-light': '#FAFAF7',
  'book-dark': '#1E2128',
  'modern-light': '#FFFFFF',
  'modern-dark': '#1B1B22',
};

let state: ThemeState = load();
let darkListener: ((dark: boolean) => void) | null = null;

function load(): ThemeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* corrupted storage falls back to defaults */
  }
  return { ...DEFAULTS };
}

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function applyTheme(): void {
  const body = document.body;
  body.classList.toggle('theme-book', state.palette === 'book');
  body.classList.toggle('theme-modern', state.palette === 'modern');
  body.classList.toggle('mode-dark', state.dark);
  body.classList.toggle('font-serif', state.font === 'serif');
  body.classList.toggle('font-sans', state.font === 'sans');
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', THEME_COLOR[`${state.palette}-${state.dark ? 'dark' : 'light'}`]);
  persist();
  darkListener?.(state.dark);
}

export function initTheme(): void {
  applyTheme();
}

export function cycleTheme(): string {
  // book-light -> book-dark -> modern-light -> modern-dark -> ...
  if (state.palette === 'book' && !state.dark) state.dark = true;
  else if (state.palette === 'book' && state.dark) { state.palette = 'modern'; state.dark = false; }
  else if (state.palette === 'modern' && !state.dark) state.dark = true;
  else { state.palette = 'book'; state.dark = false; }
  applyTheme();
  return themeLabel();
}

export function toggleFont(): string {
  state.font = state.font === 'serif' ? 'sans' : 'serif';
  applyTheme();
  return FONT_LABEL[state.font];
}

export function themeLabel(): string {
  const name = PALETTE_LABEL[state.palette];
  return state.dark ? `${name}暗` : name;
}

export function isDark(): boolean {
  return state.dark;
}

/** 订阅亮/暗切换（Shiki/Mermaid 主题随动） */
export function onDarkChange(fn: (dark: boolean) => void): void {
  darkListener = fn;
}
