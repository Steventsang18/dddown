import { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, type ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentMore } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { indentUnit } from '@codemirror/language';
import {
  acceptCompletion,
  autocompletion,
  snippetCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { bracketMatching } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { SNIPPETS } from './snippets';
import { typewriterScrolling } from './typewriter';
import { focusModeExtension } from './focus';
import fadePlugin from './fade';
import inlineRender from './inline-render';
import { headingFollowPlugin } from '../sync';

/** Markdown 片段补全：前缀匹配激活，lineStart 片段仅行首触发 */
function markdownCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w#-]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const line = context.state.doc.lineAt(word.from);
  const prefixText = context.state.sliceDoc(line.from, word.from);
  const atLineStart = /^\s*$/.test(prefixText);

  const options = SNIPPETS
    .filter((s) => s.prefix.startsWith(word.text) && (!s.lineStart || atLineStart))
    // 精确匹配排最前，其次按前缀长度（短优先）；保证 Tab 直接选中目标片段
    .sort((a, b) => Number(b.prefix === word.text) - Number(a.prefix === word.text)
      || a.prefix.length - b.prefix.length)
    .map((s) => snippetCompletion(s.body, {
      // label 参与 CM6 过滤匹配（拉丁前缀），displayLabel 仅用于显示（中文）
      label: s.prefix,
      displayLabel: s.label,
      detail: s.detail,
    }));

  if (!options.length) return null;
  return { from: word.from, options };
}

export interface EditorConfig {
  fontSize: number;
  tabSize: number;
}

export function createEditor(
  parent: HTMLElement,
  onChange: (content: string) => void,
  onSelectionChange?: () => void,
  config: EditorConfig = { fontSize: 15, tabSize: 2 }
): EditorView {
  const state = EditorState.create({
    doc: '',
    extensions: [
      // Editor config
      EditorView.theme({ '&': { fontSize: `${config.fontSize}px` } }),
      EditorState.tabSize.of(config.tabSize),
      indentUnit.of(' '.repeat(config.tabSize)),

      // History (undo/redo)
      history(),

      // Keymaps: Tab 优先接受补全，无激活补全时回落缩进
      // （必须排在 defaultKeymap 之前，否则被其 Tab→indentMore 抢占）
      keymap.of([
        { key: 'Tab', run: (view) => acceptCompletion(view) || indentMore(view) },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),

      // Markdown syntax
      markdown({ base: markdownLanguage, codeLanguages: languages }),

      // 片段补全源（通过 languageData facet 全局提供，typing 自动触发；不覆盖 markdown 内置补全）
      EditorState.languageData.of(() => [{ autocomplete: markdownCompletionSource }]),

      // UI features
      highlightActiveLine(),
      highlightActiveLineGutter(),
      bracketMatching(),
      autocompletion(),

      // 沉浸式写作：打字机滚动 + 专注模式 + 源码淡化 + 行内渲染 + 预览跟随
      typewriterScrolling,
      focusModeExtension,
      fadePlugin,
      inlineRender,
      headingFollowPlugin,

      // Theme-less — we style via CSS overrides in editor.css
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString());
        }
        if (update.selectionSet && onSelectionChange) {
          onSelectionChange();
        }
      }),
    ],
  });

  return new EditorView({
    state,
    parent,
  });
}
