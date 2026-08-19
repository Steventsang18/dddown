import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { Range } from '@codemirror/state';

/**
 * 行内渲染：光标离开该行后，Markdown 源码就地渲染（Typora 式交互）。
 * - $...$ / $$...$$ → KaTeX 公式
 * - ![alt](url) → 图片缩略
 * - [text](url) → 仅显示链接文字
 * - **粗体** / *斜体* → 真实字重/字形
 * 光标回到该行恢复源码可编辑。widget 内置隐藏原文保证 textContent 稳定。
 */

type KatexModule = typeof import('katex');
let katexMod: KatexModule | null = null;
let katexLoading: Promise<KatexModule> | null = null;
let katexCssLoaded = false;

function ensureKatex(): Promise<KatexModule> {
  katexLoading ??= import('katex');
  return katexLoading;
}

async function loadKatexCss(): Promise<void> {
  if (katexCssLoaded) return;
  await import('katex/dist/katex.min.css');
  katexCssLoaded = true;
}

const mathCache = new Map<string, string>();

/** 隐藏原文：widget 替换后 textContent 仍与源码一致（E2E / 无障碍） */
function hiddenRaw(text: string): HTMLElement {
  const el = document.createElement('span');
  el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  el.textContent = text;
  return el;
}

/** KaTeX widget */
class MathWidget extends WidgetType {
  constructor(private src: string, private display: boolean, private raw: string) { super(); }

  eq(other: MathWidget) { return this.src === other.src && this.display === other.display; }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-inline-math' + (this.display ? ' cm-inline-math-display' : '');
    span.setAttribute('aria-label', this.src);
    span.appendChild(hiddenRaw(this.raw));

    const key = `${this.display ? 'd' : 'i'}:${this.src}`;
    let html = mathCache.get(key);
    if (html === undefined) {
      if (katexMod) {
        html = katexMod.default.renderToString(this.src, {
          displayMode: this.display,
          throwOnError: false,
          strict: false,
        });
        mathCache.set(key, html);
      } else {
        // 异步加载 KaTeX 后就地补渲染
        ensureKatex().then(async (mod) => {
          katexMod = mod;
          await loadKatexCss();
          const h = mod.default.renderToString(this.src, {
            displayMode: this.display,
            throwOnError: false,
            strict: false,
          });
          mathCache.set(key, h);
          span.insertAdjacentHTML('beforeend', h);
        });
        return span;
      }
    }
    span.insertAdjacentHTML('beforeend', html);
    return span;
  }

  ignoreEvent() { return false; }
}

/** 图片 widget：缩略预览 */
class ImageWidget extends WidgetType {
  constructor(private url: string, private alt: string, private raw: string) { super(); }

  eq(other: ImageWidget) { return this.url === other.url; }

  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-inline-img';
    wrap.appendChild(hiddenRaw(this.raw));
    const img = document.createElement('img');
    img.src = this.url;
    img.alt = this.alt;
    img.title = this.alt || this.url;
    img.style.maxHeight = '120px';
    img.style.maxWidth = '280px';
    img.style.borderRadius = '6px';
    img.style.verticalAlign = 'middle';
    wrap.appendChild(img);
    return wrap;
  }

  ignoreEvent() { return false; }
}

/** 隐藏文本 widget：多行公式块的非首行，保 textContent 不变 */
class HiddenWidget extends WidgetType {
  constructor(private raw: string) { super(); }

  eq(other: HiddenWidget) { return this.raw === other.raw; }

  toDOM() { return hiddenRaw(this.raw); }

  ignoreEvent() { return false; }
}

/** 链接 widget：只显示文字，url 藏进 title */
class LinkWidget extends WidgetType {
  constructor(private text: string, private url: string, private raw: string) { super(); }

  eq(other: LinkWidget) { return this.text === other.text && this.url === other.url; }

  toDOM() {
    const a = document.createElement('a');
    a.className = 'cm-inline-link';
    a.href = this.url;
    a.title = this.url;
    a.appendChild(hiddenRaw(this.raw));
    const vis = document.createElement('span');
    vis.setAttribute('aria-hidden', 'true');
    vis.textContent = this.text;
    a.appendChild(vis);
    return a;
  }

  // 点击交还编辑器：光标落到该行即恢复源码，不做页面跳转
  ignoreEvent() { return false; }
}

const INLINE_MATH_RE = /\$([^$\n]+?)\$/g;
const IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;
const EM_RE = /\*([^*\n]+)\*/g;
const strongMark = Decoration.mark({ class: 'cm-inline-strong' });
const emMark = Decoration.mark({ class: 'cm-inline-em' });

export default ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;

    update(u: ViewUpdate) {
      if (!(u.docChanged || u.selectionSet)) return;
      const doc = u.state.doc;
      if (!doc.lines) { this.decorations = Decoration.none; return; }

      const curLine = doc.lineAt(u.state.selection.main.head).number;
      const ranges: Range<Decoration>[] = [];

      for (let i = 1; i <= doc.lines; i++) {
        if (i === curLine) continue; // 光标行保持源码
        const ln = doc.line(i);
        const t = ln.text;
        if (!t.trim()) continue;

        // 展示公式块 $$...$$（独占一行开头，单行或多行闭合）
        if (/^\s*\$\$/.test(t)) {
          i = this.displayMath(doc, ln, t, i, curLine, ranges);
          continue;
        }

        // 行内各模式按优先级匹配，covered 防重叠
        const covered: [number, number][] = [];
        const tryCover = (s: number, e: number): boolean => {
          for (const [cs, ce] of covered) if (s < ce && e > cs) return false;
          covered.push([s, e]);
          return true;
        };
        let m: RegExpExecArray | null;

        // 行内公式
        INLINE_MATH_RE.lastIndex = 0;
        while ((m = INLINE_MATH_RE.exec(t)) !== null) {
          if (!m[1].trim() || !tryCover(m.index, m.index + m[0].length)) continue;
          ranges.push(
            Decoration.replace({ widget: new MathWidget(m[1], false, m[0]) })
              .range(ln.from + m.index, ln.from + m.index + m[0].length)
          );
        }

        // 图片
        IMG_RE.lastIndex = 0;
        while ((m = IMG_RE.exec(t)) !== null) {
          if (!m[2] || m[2].startsWith('data:') || !tryCover(m.index, m.index + m[0].length)) continue;
          ranges.push(
            Decoration.replace({ widget: new ImageWidget(m[2], m[1], m[0]) })
              .range(ln.from + m.index, ln.from + m.index + m[0].length)
          );
        }

        // 链接（排除图片的 [ 部分）
        LINK_RE.lastIndex = 0;
        while ((m = LINK_RE.exec(t)) !== null) {
          if ((m.index > 0 && t[m.index - 1] === '!') || !tryCover(m.index, m.index + m[0].length)) continue;
          ranges.push(
            Decoration.replace({ widget: new LinkWidget(m[1], m[2], m[0]) })
              .range(ln.from + m.index, ln.from + m.index + m[0].length)
          );
        }

        // 粗体
        BOLD_RE.lastIndex = 0;
        while ((m = BOLD_RE.exec(t)) !== null) {
          if (!tryCover(m.index, m.index + m[0].length)) continue;
          ranges.push(strongMark.range(ln.from + m.index, ln.from + m.index + m[0].length));
        }

        // 斜体（covered 已含粗体区间，天然避开 ** 误匹配）
        EM_RE.lastIndex = 0;
        while ((m = EM_RE.exec(t)) !== null) {
          if (!tryCover(m.index, m.index + m[0].length)) continue;
          ranges.push(emMark.range(ln.from + m.index, ln.from + m.index + m[0].length));
        }
      }

      // 交给 CM6 排序：同 from 的 range 还需按 startSide 有序，手动比较器易漏
      this.decorations = ranges.length ? Decoration.set(ranges, true) : Decoration.none;
    }

    /** 处理 $$ 开头的展示公式块，返回最后一行行号（供外层跳过） */
    private displayMath(
      doc: ViewUpdate['state']['doc'],
      ln: { from: number; to: number },
      t: string,
      lineNo: number,
      curLine: number,
      ranges: Range<Decoration>[],
    ): number {
      // 单行 $$x$$
      const single = /^\s*\$\$(.+?)\$\$\s*$/.exec(t);
      if (single) {
        if (single[1].trim()) {
          const s = t.indexOf('$$');
          const e = t.lastIndexOf('$$') + 2;
          ranges.push(
            Decoration.replace({ widget: new MathWidget(single[1], true, t.slice(s, e)) })
              .range(ln.from + s, ln.from + e)
          );
        }
        return lineNo;
      }

      // 多行：向下找闭合 $$
      const parts = [t.trim().slice(2)];
      let endLine = 0;
      for (let j = lineNo + 1; j <= doc.lines; j++) {
        const tj = doc.line(j).text;
        const close = /^(.*?)\$\$\s*$/.exec(tj);
        if (close) { parts.push(close[1]); endLine = j; break; }
        parts.push(tj);
      }
      if (!endLine) return doc.lines; // 未闭合：整段跳过

      const hasCursor = curLine >= lineNo && curLine <= endLine;
      if (!hasCursor) {
        const src = parts.join('\n').trim();
        if (src) {
          // 首行渲染公式 widget，隐藏原文保 textContent；
          // 不用 block:true（会触发 CM6 viewport 内部错），后续行逐行隐藏
          const openLen = t.trimEnd().length;
          ranges.push(
            Decoration.replace({ widget: new MathWidget(src, true, t.slice(0, openLen)) })
              .range(ln.from, ln.from + openLen)
          );
          for (let j = lineNo + 1; j <= endLine; j++) {
            const lj = doc.line(j);
            if (lj.length > 0) {
              ranges.push(
                Decoration.replace({ widget: new HiddenWidget(lj.text) })
                  .range(lj.from, lj.to)
              );
            }
          }
        }
      }
      return endLine;
    }
  },
  { decorations: (v) => v.decorations }
);
