/**
 * 快捷键解析：配置里的键序列（如 "mod-shift-x"）编译为匹配函数。
 * 格式：修饰键（mod/shift/alt/ctrl）与单键用 "-" 连接，单键取小写字母、数字或特殊名。
 * 非法序列返回 null，调用方回退默认键位。
 */

export type ShortcutAction = 'save' | 'search' | 'export' | 'focus' | 'theme' | 'font' | 'sidebar';

const MODIFIERS = new Set(['mod', 'shift', 'alt', 'ctrl']);

export function compileShortcut(spec: string): ((e: KeyboardEvent) => boolean) | null {
  const tokens = spec.toLowerCase().split('-').filter(Boolean);
  if (!tokens.length) return null;

  let key = '';
  for (const t of tokens) {
    if (MODIFIERS.has(t)) continue;
    if (key || t.length !== 1) return null; // 只允许一个单键
    key = t;
  }
  if (!key) return null;

  return (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== key) return false;
    for (const t of tokens) {
      if (t === 'mod' && !(e.metaKey || e.ctrlKey)) return false;
      if (t === 'shift' && !e.shiftKey) return false;
      if (t === 'alt' && !e.altKey) return false;
      if (t === 'ctrl' && !e.ctrlKey) return false;
    }
    return true;
  };
}

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  save: 'mod-s',
  search: 'mod-p',
  export: 'mod-shift-x',
  focus: 'mod-shift-d',
  theme: 'mod-shift-t',
  font: 'mod-shift-f',
  sidebar: 'mod-shift-e',
};

/** 用户覆盖与默认合并：非法配置项静默回退默认 */
export function buildShortcutMap(
  overrides: Record<string, string>
): Map<ShortcutAction, (e: KeyboardEvent) => boolean> {
  const map = new Map<ShortcutAction, (e: KeyboardEvent) => boolean>();
  for (const [action, def] of Object.entries(DEFAULT_SHORTCUTS) as [ShortcutAction, string][]) {
    const spec = overrides[action] ?? def;
    map.set(action, compileShortcut(spec) ?? compileShortcut(def)!);
  }
  return map;
}
