import { isDark } from '../theme';

/** Mermaid 图表渲染：动态加载，按源码缓存；失败降级保留源码 */

type MermaidModule = typeof import('mermaid');

let mermaidMod: MermaidModule | null = null;
let loading: Promise<MermaidModule> | null = null;
let initializedTheme: string | null = null;
let renderSeq = 0;

interface CacheEntry {
  svg?: string;
  pending?: Promise<string>;
}

const cache = new Map<string, CacheEntry>();

function ensureMermaid(): Promise<MermaidModule> {
  loading ??= import('mermaid');
  return loading;
}

/** 渲染容器内所有未处理的 mermaid 代码块 */
export async function renderDiagrams(container: HTMLElement): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>(
    'pre[lang="mermaid"]:not([data-mermaid])'
  );
  if (!blocks.length) return;

  const mod = await ensureMermaid();
  const theme = isDark() ? 'dark' : 'default';
  if (initializedTheme !== theme) {
    mod.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      fontFamily: 'inherit',
    });
    initializedTheme = theme;
  }

  await Promise.all(Array.from(blocks, (pre) => renderOne(mod, pre)));
}

async function renderOne(mod: MermaidModule, pre: HTMLElement): Promise<void> {
  const src = (pre.textContent || '').trim();
  pre.dataset.mermaid = '1'; // 先标记，失败不重试死循环

  let entry = cache.get(src);
  if (!entry) {
    // 相同源码共享一次渲染请求
    entry = {
      pending: mod.default
        .render(`mmd-${renderSeq++}`, src)
        .then((r) => r.svg),
    };
    cache.set(src, entry);
  }

  try {
    const svg = entry.svg ?? (await entry.pending!);
    entry.svg = svg;

    const wrap = document.createElement('div');
    wrap.className = 'mermaid';
    wrap.dataset.src = src; // 供 morphdom diff 比较
    wrap.innerHTML = svg; // strict 模式输出已消毒
    pre.replaceWith(wrap);
  } catch (err) {
    // 降级：保留源码 pre + 错误小字提示
    pre.classList.add('mermaid-failed');
    const note = document.createElement('div');
    note.className = 'mermaid-error';
    note.textContent = `图表渲染失败：${err instanceof Error ? err.message : String(err)}`;
    pre.after(note);
  }
}
