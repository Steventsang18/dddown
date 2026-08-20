import { fetchTree, createFile, deleteFile, type TreeNode } from './api/client';
import { toast } from './toast';

/** 文件树侧栏：渲染、切换文件、新建、删除、外部变更刷新 */

export interface SidebarCallbacks {
  /** 切换文件：返回加载后的文件内容 */
  onOpenFile(path: string): Promise<void>;
  /** 当前打开的文件路径 */
  getCurrentFile(): string;
  /** 当前是否有未保存修改 */
  isDirty(): boolean;
  /** 立即保存当前文件 */
  saveNow(): void;
  /** 文件已删除（主流程清理状态） */
  onFileDeleted(path: string): void;
}

export class Sidebar {
  private treeEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private cb: SidebarCallbacks;

  constructor(treeEl: HTMLElement, inputEl: HTMLInputElement, cb: SidebarCallbacks) {
    this.treeEl = treeEl;
    this.inputEl = inputEl;
    this.cb = cb;
    this.bindNewFileInput();
  }

  async refresh(): Promise<void> {
    try {
      const tree = await fetchTree();
      this.render(tree);
    } catch (err) {
      console.warn('[sidebar] tree load failed:', err);
      this.treeEl.textContent = '加载失败';
    }
  }

  private render(nodes: TreeNode[]): void {
    this.treeEl.replaceChildren(...nodes.map((n) => this.renderNode(n)));
    this.highlightCurrent();
  }

  private renderNode(node: TreeNode): HTMLElement {
    if (node.is_dir) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = node.name;
      details.append(summary);
      const children = document.createElement('div');
      children.className = 'tree-children';
      children.append(...(node.children ?? []).map((c) => this.renderNode(c)));
      details.append(children);
      return details;
    }

    const item = document.createElement('div');
    item.className = 'file-item';
    item.dataset.path = node.path;
    item.textContent = node.name;

    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '✕';
    del.title = '删除文件';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`删除 ${node.path}？`)) return;
      try {
        await deleteFile(node.path);
        this.cb.onFileDeleted(node.path);
        await this.refresh();
      } catch (err) {
        console.error('[sidebar] delete failed:', err);
        toast(`删除失败：${node.name}`, 'error');
      }
    });

    item.append(del);
    item.addEventListener('click', () => this.openFile(node.path));
    return item;
  }

  private async openFile(path: string): Promise<void> {
    if (path === this.cb.getCurrentFile()) return;
    if (this.cb.isDirty()) this.cb.saveNow();
    await this.cb.onOpenFile(path);
    this.highlightCurrent();
  }

  private highlightCurrent(): void {
    const current = this.cb.getCurrentFile();
    this.treeEl.querySelectorAll('.file-item').forEach((el) => {
      el.classList.toggle('current', (el as HTMLElement).dataset.path === current);
    });
  }

  private bindNewFileInput(): void {
    this.inputEl.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const raw = this.inputEl.value.trim();
      this.inputEl.value = '';
      if (!raw) return;
      const path = raw.endsWith('.md') ? raw : `${raw}.md`;
      try {
        await createFile(path);
        await this.refresh();
        await this.openFile(path);
      } catch (err) {
        console.error('[sidebar] create failed:', err);
        toast(`新建失败：${path}`, 'error');
      }
    });
  }
}
