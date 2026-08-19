import { renderNow } from './preview/render';

/**
 * 100K 字性能基准：URL 带 ?bench 时由 main.ts 动态加载（不进生产主路径）。
 * 交替渲染两份文档模拟打字稳态（morphdom 实际 diff + 富文本块缓存命中）。
 */

const TARGET_BUDGET = 120; // p95 预算（ms）
const ITERATIONS = 50;

export async function runBench(): Promise<void> {
  const container = document.getElementById('preview')!;
  const mdA = generateDoc('甲');
  const mdB = generateDoc('乙');

  // 预热：排除 WASM 初始化、Shiki 加载、字体解析等一次性开销
  await renderNow(mdA, container);
  await nextFrame();

  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const md = i % 2 === 0 ? mdA : mdB;
    const t0 = performance.now();
    await renderNow(md, container);
    samples.push(performance.now() - t0);
    await nextFrame();
  }

  showPanel(samples);
}

/** 生成约 100K 字混合文档：段落 + 表格 + 代码块 + 公式，h2 分节触发 section 分组 */
function generateDoc(tail: string): string {
  const parts: string[] = [];
  // 34 字 × 74 ≈ 2500 字/段 × 40 段 ≈ 100K 字
  const sentence = '这是一段用于性能测试的中文文本，用于模拟真实写作场景中的长文档。';
  const para = sentence.repeat(74);

  for (let s = 1; s <= 40; s++) {
    parts.push(`## 章节 ${s}`);
    parts.push(s % 5 === 0 ? `${para}【版本 ${tail}】` : para);

    if (s % 2 === 0) {
      parts.push('| 项目 | 数值 | 备注 |\n| --- | --- | --- |\n| A | 100 | 正常 |\n| B | 200 | 正常 |\n| C | 300 | 正常 |');
    }
    if (s % 3 === 0) {
      parts.push('```rust\nfn main() {\n    let x = 42;\n    println!("{x}");\n}\n```');
    }
    if (s % 4 === 0) {
      parts.push('$$\nE = mc^2\n$$');
    }
  }
  return parts.join('\n\n');
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[idx];
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** 左上角浮层：p95 达标绿色 / 超标红色 */
function showPanel(samples: number[]): void {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const max = sorted[sorted.length - 1];
  const pass = p95 <= TARGET_BUDGET;

  const panel = document.createElement('div');
  panel.style.cssText = [
    'position: fixed', 'top: 16px', 'left: 16px', 'z-index: 9999',
    'padding: 14px 18px', 'border-radius: 10px',
    'font: 12px/1.7 "JetBrains Mono", monospace',
    'background: #1E1D1A', 'color: #E8E6E1',
    'box-shadow: 0 4px 20px rgba(0,0,0,.35)',
  ].join(';');

  const status = pass ? '#6BC98A' : '#E07A72';
  panel.innerHTML = [
    `<strong style="color:${status};font-size:13px">${pass ? 'PASS' : 'FAIL'} · 100K 字渲染基准</strong>`,
    `迭代：${ITERATIONS} 次（双文档交替）`,
    `p50：<strong>${p50.toFixed(1)} ms</strong>`,
    `p95：<strong style="color:${status}">${p95.toFixed(1)} ms</strong>（预算 ${TARGET_BUDGET} ms）`,
    `max：${max.toFixed(1)} ms`,
  ].join('<br>');

  document.body.appendChild(panel);
}
