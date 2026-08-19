/** KaTeX 数学渲染：动态加载，仅首次出现数学块时引入；按源码缓存 */

type KatexModule = typeof import('katex');

let katexMod: KatexModule | null = null;
let loading: Promise<KatexModule> | null = null;
let cssLoaded = false;

const cache = new Map<string, string>();

function ensureKatex(): Promise<KatexModule> {
  loading ??= import('katex');
  return loading;
}

async function loadCss(): Promise<void> {
  if (cssLoaded) return;
  await import('katex/dist/katex.min.css');
  cssLoaded = true;
}

/**
 * 渲染容器内所有未处理的数学块。
 * comrak 输出：<span data-math-style="inline|display">源码</span>
 */
export async function renderMath(container: HTMLElement): Promise<void> {
  const spans = container.querySelectorAll<HTMLElement>(
    'span[data-math-style]:not([data-katex])'
  );
  if (!spans.length) return;

  const mod = await ensureKatex();
  await loadCss();

  for (const span of spans) {
    const src = (span.textContent || '').trim();
    const display = span.dataset.mathStyle === 'display';
    const key = `${display ? 'd' : 'i'}:${src}`;

    let html = cache.get(key);
    if (html === undefined) {
      html = mod.default.renderToString(src, {
        displayMode: display,
        throwOnError: false,
        strict: false,
      });
      cache.set(key, html);
    }

    // 保存原始源码供 morphdom diff 比较；KaTeX 输出转义安全
    span.dataset.src = src;
    span.innerHTML = html;
    span.dataset.katex = '1';
  }
}
