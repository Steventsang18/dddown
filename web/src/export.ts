import previewCss from './styles/preview.css?inline';
import katexCss from 'katex/dist/katex.min.css?inline';
import { exportHtml } from './api/client';

/**
 * HTML 导出：所见即所得。
 * 克隆已渲染的预览 DOM，内联全部 CSS（构建期 ?inline 拿文本 + 运行时字体转 base64），
 * 主题 token 从当前 body 计算值提取，导出文件完全自包含、离线可用。
 */

/** 收集 head 中运行时注入的样式（Shiki CSS variables、Mermaid theme） */
function collectDynamicStyles(): string {
  return Array.from(document.head.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n');
}

/** 提取 body 当前主题的全部 CSS 变量值，写入导出文档 :root */
function collectTokens(): string {
  const computed = getComputedStyle(document.body);
  const lines: string[] = [];
  for (const name of computed as unknown as Iterable<string>) {
    if (name.startsWith('--')) lines.push(`  ${name}: ${computed.getPropertyValue(name)};`);
  }
  return lines.join('\n');
}

/** css 文本中所有 url() 资产 fetch 转 base64，保证导出文件离线自包含 */
async function inlineFonts(css: string): Promise<string> {
  const pending: string[] = [];
  css.replace(/url\((['"]?)(.*?)\1\)/g, (_m, _q, u) => {
    if (!u.startsWith('data:') && !u.startsWith('http') && !pending.includes(u)) pending.push(u);
    return _m;
  });

  const resolved = new Map<string, string>();
  await Promise.all(
    pending.map(async (u) => {
      try {
        const res = await fetch(u);
        const blob = await res.blob();
        resolved.set(u, await blobToDataUrl(blob));
      } catch {
        /* 拉取失败保留原 url */
      }
    })
  );

  if (!resolved.size) return css;
  return css.replace(/url\((['"]?)(.*?)\1\)/g, (m, q, u) => {
    const data = resolved.get(u);
    return data ? `url("${data}")` : m;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 构建自包含 HTML（PDF 导出与 HTML 导出共用） */
export async function buildExportHtml(previewEl: HTMLElement): Promise<string> {
  const path = previewEl.dataset.path || 'export';
  const css = await inlineFonts(`${previewCss}\n${katexCss}\n${collectDynamicStyles()}`);
  const tokens = collectTokens();
  const title = path.replace(/\.md$/, '');
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${title}</title>`,
    '<style>',
    `:root {\n${tokens}\n}`,
    css,
    '</style>',
    '</head>',
    `<body class="${document.body.className}">`,
    `<div class="preview">${previewEl.innerHTML}</div>`,
    '</body>',
    '</html>',
  ].join('\n');
}

export async function exportCurrentFile(path: string, previewEl: HTMLElement): Promise<string> {
  previewEl.dataset.path = path;
  const html = await buildExportHtml(previewEl);
  return exportHtml(path, html);
}

/** PDF 导出：构建 HTML → 服务端 ironpress 渲染 → 下载 */
export async function exportPdf(path: string, previewEl: HTMLElement): Promise<void> {
  previewEl.dataset.path = path;
  const html = await buildExportHtml(previewEl);
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const res = await fetch(`/api/export/pdf?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, html }),
  });
  if (!res.ok) throw new Error(`PDF export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = path.replace(/\.md$/, '.pdf');
  a.click();
  URL.revokeObjectURL(url);
}
