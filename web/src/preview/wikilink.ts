import { fetchTree, type TreeNode } from '../api/client';

/**
 * [[文件名]] → 可点击 wikilink。
 * 在 morphdom 之前的 tmp DOM 上包装：前后保持元素形态，diff 时走元素对比路径
 * （元素 vs 文本节点会被 morphdom 直接丢弃，见其源码 nodeType 分支）。
 */

export interface WikilinkCallbacks {
  onOpen(path: string): void;
  onNotFound(name: string): void;
}

export function wrapWikilinks(root: HTMLElement, cb: WikilinkCallbacks): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.nodeValue && node.nodeValue.includes('[[')) {
      const parent = node.parentElement;
      if (!parent || parent.closest('pre, code, a')) continue;
      nodes.push(node);
    }
  }

  for (const node of nodes) {
    const text = node.nodeValue || '';
    const frag = document.createDocumentFragment();
    const re = /\[\[([^\]]+)\]\]/g;
    let pos = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      frag.append(text.slice(pos, m.index));
      frag.append(makeLink(m[1], cb));
      pos = m.index + m[0].length;
    }
    frag.append(text.slice(pos));
    node.parentNode?.replaceChild(frag, node);
  }
}

function makeLink(name: string, cb: WikilinkCallbacks): HTMLElement {
  const a = document.createElement('a');
  a.className = 'wikilink';
  a.dataset.wiki = `[[${name}]]`;
  a.textContent = name;
  a.title = name;
  a.addEventListener('click', (e) => {
    e.preventDefault();
    void resolve(name).then((path) => {
      if (path) cb.onOpen(path);
      else cb.onNotFound(name);
    });
  });
  return a;
}

async function resolve(name: string): Promise<string | null> {
  const target = name.replace(/\.md$/, '').toLowerCase();
  const found = flatten(await fetchTree()).find(
    (n) => !n.is_dir && n.name.replace(/\.md$/, '').toLowerCase() === target
  );
  return found?.path ?? null;
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) out.push(...flatten(n.children));
  }
  return out;
}
