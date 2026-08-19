import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { Range } from '@codemirror/state';

/**
 * 源码淡化：Markdown 语法标记淡化至 25% 透明度，光标行恢复。
 */

const faded = Decoration.mark({ class: 'cm-md-faded' });

// 行首锚定模式（heading / list / blockquote / hr）
const LINE_RE = [
  /^(#{1,6}\s)/,
  /^(\s*[-*+]\s)/,
  /^(\s*\d+\.\s)/,
  /^(\s*>\s*)/,
  /^(-{3,}|_{3,}|\*{3,})\s*$/,
];

// 行内全局匹配（bold / code / link / image / strikethrough）
const INLINE_RE = [
  /\*\*[^*]+\*\*/g,
  /`[^`\n]+`/g,
  /~~[^~]+~~/g,
  /!\[[^\]]*\]\([^)]*\)/g,
  /\[[^\]]+\]\([^)]*\)/g,
];

export default ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;

    update(u: ViewUpdate) {
      if (!(u.docChanged || u.selectionSet)) return;
      const doc = u.state.doc;
      if (!doc.lines) { this.decorations = Decoration.none; return; }
      const cur = doc.lineAt(u.state.selection.main.head).number;
      const ranges: Range<Decoration>[] = [];
      // 同一行多个正则可能命中重叠区间（如图片内含链接区间），
      // mark decoration 允许重叠但要求按 from/startSide 严格有序，重叠即跳过
      let lineCovered: [number, number][] = [];
      const tryPush = (s: number, e: number) => {
        for (const [cs, ce] of lineCovered) if (s < ce && e > cs) return;
        lineCovered.push([s, e]);
        ranges.push(faded.range(s, e));
      };
      let code = false;

      for (let i = 1; i <= doc.lines; i++) {
        const ln = doc.line(i);
        const t = ln.text;
        if (/^```/.test(t)) { code = !code; continue; }
        if (code || i === cur || !t.trim()) continue;
        lineCovered = [];

        // 行首标记
        for (const re of LINE_RE) {
          const m = re.exec(t);
          if (m) tryPush(ln.from, ln.from + m[1].length);
        }

        // 行内标记
        for (const re of INLINE_RE) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(t)) !== null) {
            if (m[0].length > 0) {
              tryPush(ln.from + m.index, ln.from + m.index + m[0].length);
            }
          }
        }
      }

      this.decorations = ranges.length ? Decoration.set(ranges, true) : Decoration.none;
    }
  },
  { decorations: (v) => v.decorations }
);
