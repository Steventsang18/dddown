import type { EditorView, ViewUpdate } from '@codemirror/view';
import { ViewPlugin } from '@codemirror/view';

/**
 * 预览同步（单向：编辑 → 预览）。
 * 1. heading 级定位：光标进入新章节时预览滚动到对应标题
 * 2. 滚动比例兑底：编辑区滚动时预览按比例跟随
 */

export function setupScrollSync(view: EditorView, preview: HTMLElement): void {
  const scroll = view.scrollDOM;
  const pane = preview.parentElement;
  if (!pane) return;
  let raf = 0;

  // 滚动比例同步
  scroll.addEventListener(
    'scroll',
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = scroll.scrollHeight - scroll.clientHeight;
        const pMax = pane.scrollHeight - pane.clientHeight;
        if (max <= 0 || pMax <= 0) return;
        pane.scrollTop = (scroll.scrollTop / max) * pMax;
      });
    },
    { passive: true }
  );
}

/** CM6 ViewPlugin：光标移动时检测 heading 边界，预览跟随滚动 */
export const headingFollowPlugin = ViewPlugin.fromClass(
  class {
    private lastIdx = -1;

    constructor(private view: EditorView) {}

    update(u: ViewUpdate) {
      if (!u.selectionSet && !u.docChanged) return;
      const pos = u.state.selection.main.head;
      const headings = this.collectHeadings(u.state.doc);
      if (!headings.length) return;

      // 找光标所在的 heading 索引（最后一个 ≤ pos 的）
      let idx = -1;
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].from <= pos) idx = i;
        else break;
      }

      if (idx === this.lastIdx) return;
      this.lastIdx = idx;
      this.scrollToHeading(headings[idx]?.text);
    }

    private collectHeadings(doc: { lines: number; line(n: number): { text: string; from: number } }) {
      const result: { text: string; from: number }[] = [];
      for (let i = 1; i <= doc.lines; i++) {
        const ln = doc.line(i);
        const m = /^#{1,6}\s+(.+)/.exec(ln.text);
        if (m) result.push({ text: m[1], from: ln.from });
      }
      return result;
    }

    private scrollToHeading(text: string | undefined) {
      if (!text) return;
      const preview = document.getElementById('preview');
      const pane = preview?.parentElement;
      if (!preview || !pane) return;

      // 通过文本内容匹配 preview 中的 heading
      const els = preview.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
      for (const el of els) {
        if (el.textContent?.trim() === text.trim()) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }
    }
  }
);
