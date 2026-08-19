/** TOC 大纲：从预览 DOM 提取标题树，点击双向跳转，预览滚动高亮 */

export interface TocCallbacks {
  /** 跳编辑器对应标题行（预览已滚动） */
  onJump(text: string): void;
}

export class TocPanel {
  private listEl: HTMLElement;
  private cb: TocCallbacks;
  private items: { level: number; text: string; el: HTMLElement }[] = [];
  private rafId = 0;

  constructor(listEl: HTMLElement, cb: TocCallbacks) {
    this.listEl = listEl;
    this.cb = cb;
  }

  /** 渲染完成后从预览 DOM 提取标题 */
  update(container: HTMLElement): void {
    const headings = Array.from(
      container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
    );
    this.items = headings.map((el) => ({
      level: Number(el.tagName[1]),
      text: el.textContent || '',
      el,
    }));

    const frag = document.createDocumentFragment();
    for (const item of this.items) {
      const row = document.createElement('div');
      row.className = 'toc-item';
      row.style.paddingLeft = `${(item.level - 1) * 14}px`;
      row.textContent = item.text;
      row.addEventListener('click', () => {
        item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this.cb.onJump(item.text);
      });
      frag.append(row);
    }
    this.listEl.replaceChildren(frag);
  }

  /** 预览滚动 → 高亮当前标题（rAF 节流） */
  onScroll(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.highlight();
    });
  }

  private highlight(): void {
    const top = 48; // 视口顶部阈值
    let activeIdx = -1;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].el.getBoundingClientRect().top <= top) activeIdx = i;
    }
    const rows = this.listEl.children;
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('active', i === activeIdx);
    }
    if (activeIdx >= 0) {
      (rows[activeIdx] as HTMLElement)?.scrollIntoView({ block: 'nearest' });
    }
  }
}
