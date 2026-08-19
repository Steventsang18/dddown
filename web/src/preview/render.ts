import DOMPurify from 'dompurify';
import morphdom from 'morphdom';
import { highlightCode, initHighlighter } from './highlight';
import { renderMath } from './math';
import { renderDiagrams } from './diagram';
import { wrapWikilinks, type WikilinkCallbacks } from './wikilink';
import { onDarkChange } from '../theme';

/**
 * 预览管线：
 * comrak → DOMPurify → 分 section（h1/h2 边界）→ morphdom 增量 diff → 后处理
 * 后处理顺序：Shiki（同步缓存命中）→ KaTeX → Mermaid（异步批量）
 */

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let comrakParser: ((md: string) => string) | null = null;
let renderChain: Promise<void> = Promise.resolve();
let lastMd: string | null = null;
let lastContainer: HTMLElement | null = null;
let renderDoneListener: ((container: HTMLElement) => void) | null = null;
let wikilinkCb: WikilinkCallbacks | null = null;

/** 注册渲染完成回调（TOC 大纲提取用） */
export function onRenderDone(cb: (container: HTMLElement) => void): void {
  renderDoneListener = cb;
}

/** 注入 wikilink 回调（main.ts 启动时调用一次） */
export function setWikilinkCallbacks(cb: WikilinkCallbacks): void {
  wikilinkCb = cb;
}

/**
 * Initialize the comrak WASM parser and Shiki highlighter.
 * Call this once at startup.
 */
export async function initParser(): Promise<void> {
  try {
    const mod = await import('@typefm/comrak-wasm');
    if (typeof mod.default === 'function') {
      await mod.default();
    }
    comrakParser = (md: string) => mod.mdToHtml(md, {
      extension: {
        strikethrough: true,
        table: true,
        autolink: true,
        tasklist: true,
        headerIds: 'plain',
        alerts: true,
        mathDollars: true,
        mathCode: true,
      },
      render: {
        unsafe: true,
        githubPreLang: true,
        hardbreaks: true,
      },
    });
    console.log('[preview] comrak WASM ready');
  } catch (err) {
    console.warn('[preview] comrak WASM not available, using fallback:', err);
    comrakParser = fallbackParse;
  }

  // Shiki 预载，首屏代码块即时高亮
  initHighlighter().catch(() => {});

  // 亮/暗切换：清空重渲染（Mermaid 主题随动；Shiki/KaTeX 缓存命中，开销趋零）
  onDarkChange(() => {
    if (lastContainer && lastMd !== null) {
      lastContainer.replaceChildren();
      void renderNow(lastMd, lastContainer);
    }
  });
}

/** 带 60ms debounce 的预览渲染（编辑器打字入口） */
export function renderPreview(mdText: string, container: HTMLElement): void {
  lastMd = mdText;
  lastContainer = container;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void renderNow(mdText, container);
  }, 60);
}

/** 即时渲染（无 debounce），Promise 解析即预览完成；基准测试与主题切换直调 */
export function renderNow(md: string, container: HTMLElement): Promise<void> {
  lastMd = md;
  lastContainer = container;
  renderChain = renderChain.then(() => doRender(md, container));
  return renderChain;
}

async function doRender(md: string, container: HTMLElement): Promise<void> {
  const html = parseMarkdown(md);
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['type', 'checked', 'disabled'],
  });

  const tmp = document.createElement('div');
  tmp.innerHTML = clean;
  wrapSections(tmp);
  if (wikilinkCb) wrapWikilinks(tmp, wikilinkCb);

  morphdom(container, tmp, {
    childrenOnly: true,
    // 富文本块（高亮/公式/图表）源码未变则保留已渲染结果，避免重渲染与光标无关的整块替换
    onBeforeElUpdated: (fromEl, toEl) => {
      const from = fromEl as HTMLElement;
      const to = toEl as HTMLElement;
      if (from.hasAttribute('data-shiki') && to.matches('pre[lang]')) {
        return from.dataset.code !== (to.textContent || '');
      }
      if (from.hasAttribute('data-katex') && to.matches('span[data-math-style]')) {
        return from.dataset.src !== (to.textContent || '');
      }
      if (from.classList.contains('mermaid') && to.matches('pre[lang="mermaid"]')) {
        return from.dataset.src !== (to.textContent || '');
      }
      if (from.classList.contains('wikilink') && to.classList.contains('wikilink')) {
        return from.dataset.wiki !== to.dataset.wiki;
      }
      return true;
    },
  });

  await postProcess(container);
  renderDoneListener?.(container);
}

/** 顶层节点按 h1/h2 边界分组包裹 section，配合 content-visibility 长文渲染 */
function wrapSections(root: HTMLElement): void {
  const top = Array.from(root.children) as HTMLElement[];
  if (top.filter((el) => /^H[12]$/.test(el.tagName)).length < 2) return;

  const sections: HTMLElement[] = [];
  let current: HTMLElement | null = null;
  for (const node of top) {
    if (/^H[12]$/.test(node.tagName) || !current) {
      current = document.createElement('section');
      current.className = 'preview-section';
      sections.push(current);
    }
    current.appendChild(node);
  }
  root.append(...sections);
}

/** 后处理真实 DOM：Shiki → KaTeX → Mermaid（mermaid 代码块跳过 Shiki） */
async function postProcess(container: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(
      container.querySelectorAll<HTMLElement>('pre[lang]:not([lang="mermaid"]):not([data-shiki])')
    ).map(async (pre) => {
      const lang = pre.getAttribute('lang') || 'text';
      const code = pre.textContent || '';
      const result = await highlightCode(code, lang);
      if (!result) return;
      pre.dataset.code = code; // 供 morphdom diff 比较
      pre.className = result.cls;
      pre.innerHTML = result.inner;
      pre.dataset.shiki = '1';
    })
  );

  await renderMath(container);
  await renderDiagrams(container);
}

function parseMarkdown(md: string): string {
  if (comrakParser) {
    return comrakParser(md);
  }
  return fallbackParse(md);
}

/**
 * Minimal fallback parser when WASM is not available.
 * Handles basic markdown: headings, paragraphs, code blocks, bold, italic.
 */
function fallbackParse(md: string): string {
  let html = md;

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = escapeHtml(code.trim());
    return `<pre data-lang="${lang}"><code>${escaped}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Bold & italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Paragraphs (lines not already wrapped)
  html = html.replace(/^(?!<[a-z])((?!^\s*$).+)$/gm, '<p>$1</p>');

  // Clean up empty lines
  html = html.replace(/^\s*$/gm, '');

  return html;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
