import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/**
 * 打字机滚动：打字时光标保持在视口垂直舒适区（25%–75%），
 * 出区即滚到视口中心。仅对 docChanged 且 selection 变化的输入生效，
 * 点击定位、搜索跳转不触发（那些场景光标本来就在视口内）。
 * rAF 延迟执行，避开 CM6 measure 阶段直接改 scrollDOM。
 */

const BAND_TOP = 0.25;
const BAND_BOTTOM = 0.75;

export const typewriterScrolling = ViewPlugin.fromClass(
  class {
    private raf = 0;

    constructor(private view: EditorView) {}

    update(u: ViewUpdate) {
      if (!u.docChanged || !u.selectionSet || this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.keepInBand();
      });
    }

    destroy() {
      if (this.raf) cancelAnimationFrame(this.raf);
    }

    private keepInBand() {
      const rect = this.view.coordsAtPos(this.view.state.selection.main.head);
      if (!rect) return;
      const scroll = this.view.scrollDOM;
      const y = rect.top - scroll.getBoundingClientRect().top;
      const h = scroll.clientHeight;
      if (y < h * BAND_TOP || y > h * BAND_BOTTOM) {
        scroll.scrollTop += y - h / 2;
      }
    }
  }
);
