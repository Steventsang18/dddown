import { searchFiles, type SearchResult } from './api/client';

/** 搜索面板：⌘P 唤起，输入即搜（150ms 防抖），Enter/点击跳转 */

export interface SearchCallbacks {
  /** 打开结果文件并定位到行 */
  onOpen(path: string, line: number): void;
}

interface FlatHit {
  path: string;
  line: number;
}

export class SearchPanel {
  private panel: HTMLElement;
  private input: HTMLInputElement;
  private resultsEl: HTMLElement;
  private cb: SearchCallbacks;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private items: FlatHit[] = [];
  private selected = 0;

  constructor(
    panel: HTMLElement,
    input: HTMLInputElement,
    resultsEl: HTMLElement,
    cb: SearchCallbacks,
  ) {
    this.panel = panel;
    this.input = input;
    this.resultsEl = resultsEl;
    this.cb = cb;

    input.addEventListener('input', () => this.scheduleQuery());
    input.addEventListener('keydown', (e) => this.onKey(e));
    panel.addEventListener('mousedown', (e) => {
      if (e.target === panel) this.close();
    });
  }

  open(): void {
    this.panel.hidden = false;
    this.input.value = '';
    this.resultsEl.replaceChildren();
    this.input.focus();
  }

  close(): void {
    this.panel.hidden = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private scheduleQuery(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const q = this.input.value.trim();
    if (!q) {
      this.resultsEl.replaceChildren();
      return;
    }
    this.debounceTimer = setTimeout(() => void this.query(q), 150);
  }

  private async query(q: string): Promise<void> {
    try {
      const results = await searchFiles(q);
      // 过期请求丢弃（用户已继续输入）
      if (q !== this.input.value.trim()) return;
      this.render(results, q);
    } catch (err) {
      console.warn('[search] failed:', err);
    }
  }

  private render(results: SearchResult[], q: string): void {
    this.selected = 0;
    this.items = [];
    const frag = document.createDocumentFragment();

    for (const r of results) {
      const file = document.createElement('div');
      file.className = 'search-result';
      const name = document.createElement('div');
      name.className = 'search-result-name';
      name.textContent = r.path;
      file.append(name);

      for (const hit of r.hits) {
        const row = document.createElement('div');
        row.className = 'search-hit';
        row.append(this.hitLine(hit.line), this.hitText(hit.text, q));
        row.addEventListener('click', () => this.cb.onOpen(r.path, hit.line));
        file.append(row);
        this.items.push({ path: r.path, line: hit.line });
      }
      frag.append(file);
    }

    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = '无匹配结果';
      frag.append(empty);
    }

    this.resultsEl.replaceChildren(frag);
    this.updateSelection();
  }

  private hitLine(line: number): HTMLElement {
    const el = document.createElement('span');
    el.className = 'line-no';
    el.textContent = String(line);
    return el;
  }

  private hitText(text: string, q: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'hit-text';
    const lower = text.toLowerCase();
    const needle = q.toLowerCase();
    let pos = 0;
    let idx = lower.indexOf(needle);
    while (idx >= 0) {
      el.append(text.slice(pos, idx));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(idx, idx + needle.length);
      el.append(mark);
      pos = idx + needle.length;
      idx = lower.indexOf(needle, pos);
    }
    el.append(text.slice(pos));
    return el;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      this.selected = Math.max(0, Math.min(this.items.length - 1, this.selected + delta));
      this.updateSelection();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = this.items[this.selected];
      if (item) this.cb.onOpen(item.path, item.line);
    }
  }

  private updateSelection(): void {
    const rows = this.resultsEl.querySelectorAll('.search-hit');
    rows.forEach((row, i) => row.classList.toggle('selected', i === this.selected));
    rows[this.selected]?.scrollIntoView({ block: 'nearest' });
  }
}
