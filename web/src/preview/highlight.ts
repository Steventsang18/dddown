import { createHighlighter, type Highlighter } from 'shiki';

/** Shiki 代码高亮：固定深色主题（代码块亮暗统一深底），按源码缓存 */

let highlighter: Highlighter | null = null;
let initPromise: Promise<void> | null = null;

/** 启动时常驻语言；其余按需动态加载（Vite 自动分 chunk） */
const CORE_LANGS = [
  'markdown', 'rust', 'python', 'javascript', 'typescript',
  'bash', 'json', 'html', 'css', 'sql', 'yaml',
];

interface HighlightResult {
  cls: string;
  inner: string;
}

const cache = new Map<string, HighlightResult>();

export function initHighlighter(): Promise<void> {
  initPromise ??= (async () => {
    highlighter = await createHighlighter({
      themes: ['github-dark'],
      langs: CORE_LANGS,
    });
    console.log('[preview] shiki ready');
  })();
  return initPromise;
}

/** 高亮代码块，返回 shiki <pre> 的 class 与内部 HTML；未加载的语言按需加载 */
export async function highlightCode(code: string, lang: string): Promise<HighlightResult | null> {
  await initHighlighter();
  const hl = highlighter!;

  const key = `${lang}:${code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let target = lang || 'text';
  if (target !== 'text' && !hl.getLoadedLanguages().includes(target)) {
    try {
      await hl.loadLanguage(target as never);
    } catch {
      target = 'text'; // 未知语言降级纯文本
    }
  }

  const html = hl.codeToHtml(code, { lang: target, theme: 'github-dark' });

  // 提取 shiki <pre> 内部内容，pre 外观由 preview.css 接管
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const shikiPre = tpl.content.firstElementChild as HTMLElement | null;
  if (!shikiPre) return null;

  const result: HighlightResult = {
    cls: shikiPre.className,
    inner: shikiPre.innerHTML,
  };
  cache.set(key, result);
  return result;
}
