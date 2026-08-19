import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';

/**
 * 专注模式：仅当前段落（空行分隔的连续非空行）全浓度显示，其余淡化。
 * 淡化由 CSS 全量规则处理（.cm-focus-mode .cm-line 默认淡），
 * decoration 只标记当前段落几行，每按键开销与段落长度成正比而非文档行数。
 */

const toggleFocus = StateEffect.define<boolean>();

const focusState = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(toggleFocus)) return e.value;
    }
    return value;
  },
});

const inBlockDeco = Decoration.line({ class: 'cm-focus-in' });

function blockRange(view: EditorView): { from: number; to: number } {
  const doc = view.state.doc;
  const line = doc.lineAt(view.state.selection.main.head);
  let from = line.from;
  let to = line.to;

  let n = line.number;
  while (n > 1) {
    const prev = doc.line(n - 1);
    if (prev.text.trim() === '') break;
    from = prev.from;
    n--;
  }
  n = line.number;
  while (n < doc.lines) {
    const next = doc.line(n + 1);
    if (next.text.trim() === '') break;
    to = next.to;
    n++;
  }
  return { from, to };
}

const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.syncClass(view);
      this.decorations = this.compute(view);
    }

    update(u: ViewUpdate) {
      const on = u.state.field(focusState);
      const changed = u.docChanged || u.selectionSet || on !== u.startState.field(focusState);
      if (changed) {
        this.syncClass(u.view);
        this.decorations = this.compute(u.view);
      }
    }

    private syncClass(view: EditorView) {
      view.dom.classList.toggle('cm-focus-mode', view.state.field(focusState));
    }

    private compute(view: EditorView): DecorationSet {
      if (!view.state.field(focusState)) return Decoration.none;
      const { from, to } = blockRange(view);
      const start = view.state.doc.lineAt(from).number;
      const end = view.state.doc.lineAt(to).number;
      const ranges = [];
      for (let i = start; i <= end; i++) {
        const l = view.state.doc.line(i);
        ranges.push(inBlockDeco.range(l.from, l.from));
      }
      return Decoration.set(ranges, true);
    }
  },
  { decorations: (v) => v.decorations }
);

export function setFocusMode(view: EditorView, on: boolean): void {
  view.dispatch({ effects: toggleFocus.of(on) });
}

export function isFocusMode(view: EditorView): boolean {
  return view.state.field(focusState);
}

export const focusModeExtension = [focusState, focusPlugin];
