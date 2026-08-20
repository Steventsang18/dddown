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

/** PDF 专用排版 CSS：分页防断裂 + 出版级细节。
 * 页眉页脚用 @page margin boxes（走 ironpress 完整字体回退管线，中文正常），
 * 不用 Builder API 的 .header()/.footer()（内部写死 Helvetica，中文变 ?）。
 * counter(page)/counter(pages) 由 ironpress 逐页解析 */
function pdfCss(title: string): string {
  // 转义 CSS 字符串字面量中的反斜杠与双引号，标题含路径分隔符无需处理
  const safe = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `
@page {
  margin: 62pt 68pt;
  @top-center {
    content: "${safe}";
    font-size: 9pt;
    color: #999;
  }
  @bottom-center {
    content: "第 " counter(page) " 页 · 共 " counter(pages) " 页";
    font-size: 9pt;
    color: #999;
  }
}
.preview {
  max-width: none;
  padding: 0;
}
/* 标题不孤悬在页底 */
.preview h1, .preview h2, .preview h3, .preview h4 {
  break-after: avoid;
  page-break-after: avoid;
}
/* 标题编号（ironpress 无 CSS counter，JS 预计算） */
.preview h1[data-num]::before { content: attr(data-num) "\\00a0\\00a0"; }
.preview h2[data-num]::before { content: attr(data-num) "\\00a0\\00a0"; }
.preview h3[data-num]::before { content: attr(data-num) "\\00a0\\00a0"; }
/* 块级元素不跨页劈裂 */
.preview blockquote, .preview pre, .preview .table-wrap,
.preview img, .preview .mermaid, .preview .markdown-alert {
  break-inside: avoid;
  page-break-inside: avoid;
}
/* 段落孤行控制：页底至少留 2 行，页顶至少带 2 行 */
.preview p, .preview li {
  orphans: 2;
  widows: 2;
}
/* 代码块横向溢出截断，不撑破页面 */
.preview pre { overflow: hidden; }
/* 链接去下划线动画，PDF 中保留颜色即可 */
.preview a { background-image: none; }
`;
}

/** 标题自动编号：遍历 h1~h3 生成 1 / 1.1 / 1.1.1，写入 data-num 供 CSS ::before 消费 */
function numberHeadings(previewEl: HTMLElement): void {
  const counters = [0, 0, 0];
  previewEl.querySelectorAll('h1, h2, h3').forEach((h) => {
    const lvl = parseInt(h.tagName.slice(1), 10) - 1;
    counters[lvl]++;
    for (let i = lvl + 1; i < 3; i++) counters[i] = 0;
    h.setAttribute('data-num', counters.slice(0, lvl + 1).join('.'));
  });
}

/** 构建自包含 HTML（PDF 导出与 HTML 导出共用）；pdf=true 时注入打印排版 */
export async function buildExportHtml(previewEl: HTMLElement, pdf = false): Promise<string> {
  if (pdf) numberHeadings(previewEl);
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
    pdf ? pdfCss(title) : '',
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

/** PDF 导出：构建 HTML（含打印排版）→ 服务端 ironpress 渲染 → 下载 */
export async function exportPdf(path: string, previewEl: HTMLElement): Promise<void> {
  previewEl.dataset.path = path;
  const html = await buildExportHtml(previewEl, true);
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
