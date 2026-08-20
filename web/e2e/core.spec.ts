import { test, expect, type Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 核心流程 E2E：单 worker 串行，共享一个服务端与 workspace。
 * 每条用例自包含：打开页面 → 操作 → 断言 → 恢复现场。
 */

const EDITOR = '.cm-content';
const PREVIEW = '#preview';
const SAVE_TEXT = '#saveText';
const FILE_NAME = '#fileName';
const API = 'http://127.0.0.1:60101';
const TOKEN = 'e2e-test-token';

async function readDisk(page: Page, path = 'welcome.md'): Promise<string> {
  return (await page.request.get(`${API}/api/file/read?path=${path}&token=${TOKEN}`)).text();
}

async function writeDisk(page: Page, content: string, path = 'welcome.md') {
  const res = await page.request.post(`${API}/api/file/write?token=${TOKEN}`, {
    data: { path, content },
  });
  expect(res.ok()).toBeTruthy();
}

/** FNV-1a 64，与前后端实现一致，用于构造带基线的保存请求 */
function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(text)) {
    h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString();
}

/** CM6 的 Mod 键：macOS 是 Cmd，其余平台是 Ctrl */
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** CM6 的 Mod 键在 macOS 是 Cmd；循环 undo 直到内容恢复（history 可能按事务拆分） */
async function undoTo(page: Page, before: string | null) {
  for (let i = 0; i < 10; i++) {
    if ((await page.locator(EDITOR).textContent()) === before) return;
    await page.keyboard.press(`${MOD}+z`);
  }
}

async function openApp(page: Page) {
  // 不等 load：编辑器可用性由下方断言保障，避免历史字体等资源拖慢导航
  await page.goto('/?token=e2e-test-token', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cm-editor');
  // 等待初始文件加载完成
  await expect(page.locator(FILE_NAME)).toHaveText(/\.md$/);
}

test.describe.configure({ mode: 'serial' });

test('1. 启动加载文件并渲染预览', async ({ page }) => {
  await openApp(page);
  await expect(page.locator(FILE_NAME)).toHaveText('welcome.md');
  await expect(page.locator(`${PREVIEW} h1`)).toHaveText('欢迎使用 dddown');
  await expect(page.locator(SAVE_TEXT)).toHaveText('已保存');
});

test('2. 输入后预览防抖更新', async ({ page }) => {
  await openApp(page);
  const before = await page.locator(EDITOR).textContent();
  await page.locator(EDITOR).click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press('Enter');
  await page.keyboard.type('# E2E 标题');
  // 预览更新
  await expect(page.locator(`${PREVIEW} h1`).last()).toHaveText('E2E 标题', { timeout: 5000 });
  // 恢复
  await undoTo(page, before);
  await page.waitForTimeout(1200);
  expect(await page.locator(EDITOR).textContent()).toBe(before);
});

test('3. 单回车硬换行（hardbreaks）', async ({ page }) => {
  await openApp(page);
  const before = await page.locator(EDITOR).textContent();
  await page.locator(EDITOR).click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press('Enter');
  await page.keyboard.type('换行测试第一行');
  await page.keyboard.press('Enter');
  await page.keyboard.type('换行测试第二行');
  // 单回车即换行：两行同段落，以 <br> 分隔
  const lastP = page.locator(`${PREVIEW} p`).last();
  await expect(lastP).toContainText('换行测试第一行', { timeout: 5000 });
  expect(await lastP.innerHTML()).toContain('<br>');
  // 恢复
  await undoTo(page, before);
  await page.waitForTimeout(1200);
});

test('4. 自动保存落盘', async ({ page }) => {
  await openApp(page);
  const before = await page.locator(EDITOR).textContent();
  await page.locator(EDITOR).click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press('Enter');
  await page.keyboard.type('自动保存验证');
  await expect(page.locator(SAVE_TEXT)).toHaveText('已保存', { timeout: 5000 });
  // 直接读磁盘比对
  const disk = await page.request.get('http://127.0.0.1:60101/api/file/read?path=welcome.md&token=e2e-test-token');
  expect((await disk.text()).trim().endsWith('自动保存验证')).toBeTruthy();
  // 恢复
  await undoTo(page, before);
  await page.waitForTimeout(1200);
  await expect(page.locator(SAVE_TEXT)).toHaveText('已保存');
  expect(await page.locator(EDITOR).textContent()).toBe(before);
});

test('5. 新建文件出现在文件树', async ({ page }) => {
  await openApp(page);
  const input = page.locator('#newFileInput');
  await input.fill('e2e-new.md');
  await input.press('Enter');
  await expect(page.locator(FILE_NAME)).toHaveText('e2e-new.md');
  await expect(page.locator('#fileTree')).toContainText('e2e-new.md');
  // 清理：切回 welcome 并删除（file-item 内含 ✕ 按钮，不能用 exact 匹配）
  await page.locator('#fileTree').getByText('welcome.md').click();
  await expect(page.locator(FILE_NAME)).toHaveText('welcome.md');
  const del = await page.request.delete('http://127.0.0.1:60101/api/file?path=e2e-new.md&token=e2e-test-token');
  expect(del.ok()).toBeTruthy();
});

test('6. 片段补全（tab → 表格）', async ({ page }) => {
  await openApp(page);
  const before = await page.locator(EDITOR).textContent();
  await page.locator(EDITOR).click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press('Enter');
  await page.keyboard.type('tbl');
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
  // 弹层打开后 75ms 内 acceptCompletion 拒绝接受（interactionDelay 防误触）
  await page.waitForTimeout(120);
  await page.keyboard.press('Tab');
  await expect(page.locator(EDITOR)).toContainText('| 列一 | 列二 |');
  // 恢复
  await undoTo(page, before);
  await page.waitForTimeout(1200);
  expect(await page.locator(EDITOR).textContent()).toBe(before);
});

test('7. 搜索面板跳转（⌘P）', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press(`${MOD}+p`);
  await expect(page.locator('#searchPanel')).toBeVisible();
  await page.locator('#searchInput').fill('公式');
  await page.waitForTimeout(600);
  await expect(page.locator('#searchResults')).toContainText('welcome.md');
  // 选中第一条命中行并跳转
  await page.locator('#searchResults .search-hit').first().click();
  await expect(page.locator('#searchPanel')).toBeHidden();
  await expect(page.locator('#fileName')).toHaveText('welcome.md');
});

test('8. 专注模式（⌘⇧D）', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press(`${MOD}+Shift+d`);
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focus-mode/);
  await expect(page.locator('#focusBtn')).toHaveClass(/active/);
  await page.keyboard.press(`${MOD}+Shift+d`);
  await expect(page.locator('.cm-editor')).not.toHaveClass(/cm-focus-mode/);
});

test('9. 外部修改同步到编辑器', async ({ page }) => {
  await openApp(page);
  const original = await (
    await page.request.get('http://127.0.0.1:60101/api/file/read?path=welcome.md&token=e2e-test-token')
  ).text();
  // 外部写入（模拟其他程序修改）
  const res = await page.request.post('http://127.0.0.1:60101/api/file/write?token=e2e-test-token', {
    data: { path: 'welcome.md', content: original + '\n外部修改行' },
  });
  expect(res.ok()).toBeTruthy();
  // 编辑器应在数秒内同步（watcher 防抖 300ms + 读盘）
  await expect(page.locator(EDITOR)).toContainText('外部修改行', { timeout: 8000 });
  await expect(page.locator(SAVE_TEXT)).toHaveText('已保存');
  // 无循环：等待 3 秒后编辑器内容稳定且非空
  await page.waitForTimeout(3000);
  expect((await page.locator(EDITOR).textContent())!.length).toBeGreaterThan(10);
  // 恢复原文件
  await writeDisk(page, original);
});

test('10. 草稿恢复：未落盘内容崩溃后不丢', async ({ page }) => {
  await openApp(page);
  const original = await readDisk(page);
  // 模拟崩溃现场：内容只在草稿里，磁盘还是旧的
  await page.evaluate((d) => {
    localStorage.setItem('dddown:draft:welcome.md', d + '\n草稿恢复行');
  }, original);
  await page.reload();
  await page.waitForSelector('.cm-editor');
  // 草稿被恢复到编辑器，并自动重存落盘
  await expect(page.locator(EDITOR)).toContainText('草稿恢复行', { timeout: 8000 });
  await expect(page.locator(SAVE_TEXT)).toHaveText('已保存', { timeout: 5000 });
  expect(await readDisk(page)).toContain('草稿恢复行');
  expect(await page.evaluate(() => localStorage.getItem('dddown:draft:welcome.md'))).toBeNull();
  // 现场恢复
  await writeDisk(page, original);
  await page.reload();
});

test('11. 并发冲突：基线过期拒绝写入不静默覆盖', async ({ page }) => {
  await openApp(page);
  const original = await readDisk(page);

  // API 层确定性验证：基线过期 → 409 且磁盘不被碰
  const stale = await page.request.post(`${API}/api/file/write?token=${TOKEN}`, {
    data: { path: 'welcome.md', content: original + '\n旧基线写入', base_hash: fnv1a64('不存在的内容') },
  });
  expect(stale.status()).toBe(409);
  expect(await readDisk(page)).toBe(original);

  // 基线匹配则放行
  const fresh = await page.request.post(`${API}/api/file/write?token=${TOKEN}`, {
    data: { path: 'welcome.md', content: original, base_hash: fnv1a64(original) },
  });
  expect(fresh.ok()).toBeTruthy();

  // UI 层验证：先输入使窗口 dirty（watcher 补偿重载被确定性阻断，基线无法推进），
  // 再做外部写入，最后 autosave 携带过期基线落盘 → 必然 409。
  // 输入→外部写入耗时 ≪ 500ms autosave 防抖，无时序竞争
  await page.locator(EDITOR).click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press('Enter');
  await page.keyboard.type('本窗口输入');
  await writeDisk(page, original + '\n其他窗口写入');
  // 冲突提示（状态栏 + Toast 双通道）
  await expect(page.locator(SAVE_TEXT)).toContainText('冲突', { timeout: 8000 });
  await expect(page.locator('.toast.warn')).toContainText('保存冲突');
  // 冲突时外部内容仍在磁盘，未被静默覆盖
  expect(await readDisk(page)).toContain('其他窗口写入');

  // 现场恢复：清草稿，显式写回 original（不带基线，跳过校验）
  await page.evaluate(() => localStorage.removeItem('dddown:draft:welcome.md'));
  await writeDisk(page, original);
});

test('12. 界面设置固定访问密码', async ({ page }) => {
  await openApp(page);
  await page.locator('#settingsBtn').click();
  await page.locator('#menuCredentials').click();
  await expect(page.locator('#tokenModal')).toBeVisible();

  // 格式校验：非法输入被拒绝且不落盘
  await page.locator('#tokenInput').fill('bad token!');
  await page.locator('#tokenSaveBtn').click();
  await expect(page.locator('#tokenHint')).toContainText('格式不符');

  // 合法密码：保存成功，地址栏同步更新
  await page.locator('#tokenInput').fill('new-pass-123');
  await page.locator('#tokenSaveBtn').click();
  await expect(page.locator('#tokenModal')).toBeHidden();
  expect(page.url()).toContain('token=new-pass-123');

  // 新密码立即热生效（服务未重启）：旧密码失效，新密码可用
  const stale = await page.request.get(`${API}/api/file/read?path=welcome.md&token=${TOKEN}`);
  expect(stale.status()).toBe(401);
  const res = await page.request.get(`${API}/api/file/read?path=welcome.md&token=new-pass-123`);
  expect(res.ok()).toBeTruthy();

  // 现场恢复：用新密码把 token 设回 e2e 固定值
  const restore = await page.request.post(`${API}/api/settings/token?token=new-pass-123`, {
    data: { token: TOKEN },
  });
  expect(restore.ok()).toBeTruthy();
});

test('13. 工作空间热切换：API 切换后读写与 UI 跟随', async ({ page }) => {
  // canonicalize 会把 /tmp 解析成 /private/tmp，断言用规范化后的路径
  const ALT = '/tmp/dddown-e2e-home/notes-alt';
  const ALT_CANON = '/private/tmp/dddown-e2e-home/notes-alt';
  mkdirSync(ALT, { recursive: true });
  writeFileSync(join(ALT, 'alt-note.md'), '# 备用空间\n\n切换验证内容');
  try {
    await openApp(page);
    const res = await page.request.post(`${API}/api/settings/workspace?token=${TOKEN}`, {
      data: { workspace: ALT },
    });
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toBe(ALT_CANON);

    // 读写跟随新空间
    const alt = await page.request.get(`${API}/api/file/read?path=alt-note.md&token=${TOKEN}`);
    expect(await alt.text()).toContain('切换验证内容');
    const gone = await page.request.get(`${API}/api/file/read?path=welcome.md&token=${TOKEN}`);
    expect(gone.ok()).toBeFalsy();

    // UI 跟随：重载后加载新空间文件与文件树
    await page.evaluate(() => localStorage.setItem('dddown:lastFile', 'alt-note.md'));
    await page.reload();
    await page.waitForSelector('.cm-editor');
    await expect(page.locator(FILE_NAME)).toHaveText('alt-note.md');
    await expect(page.locator(`${PREVIEW} h1`)).toHaveText('备用空间');
    await expect(page.locator('#fileTree')).toContainText('alt-note.md');
  } finally {
    // 现场恢复：切回原空间（同样用规范化路径），后续用例依赖 welcome.md
    const back = await page.request.post(`${API}/api/settings/workspace?token=${TOKEN}`, {
      data: { workspace: '/private/tmp/dddown-e2e-home/notes' },
    });
    expect(back.ok()).toBeTruthy();
    rmSync(ALT, { recursive: true, force: true });
  }
});

/** 解压 PDF 全部内容流（zlib），用于字节级断言 */
function pdfContentStreams(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  for (const m of buf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      out.push(inflateSync(Buffer.from(m[1], 'latin1')));
    } catch {
      /* 非 zlib 流（如图片）跳过 */
    }
  }
  return out;
}

test('14. PDF 导出：中文页眉页脚不走 Helvetica 回退防线', async ({ page }) => {
  await openApp(page);
  // UI 全链路：菜单触发 → 浏览器下载
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#settingsBtn').click();
  await page.locator('#exportToggle').click();
  await page.locator('#menuExportPDF').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('welcome.pdf');
  const buf = readFileSync(await download.path());
  expect(buf.subarray(0, 8).toString()).toBe('%PDF-1.4');

  // 防线一：必须嵌入 Unicode 回退字体（页眉页脚中文不再写死 Helvetica）
  const fonts = [...buf.toString('latin1').matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/g)].map((m) => m[1]);
  expect(fonts.some((f) => f.includes('ArialUnicodeMS'))).toBeTruthy();

  // 防线二：内容流文本指令零个 '?'（旧 bug 的 WinAnsi 编码失败特征）
  let qMarks = 0;
  for (const s of pdfContentStreams(buf)) {
    for (const t of s.toString('latin1').matchAll(/\((.*?)\)\s*Tj/g)) qMarks += (t[1].match(/\?/g) ?? []).length;
  }
  expect(qMarks).toBe(0);

  await expect(page.locator('.toast')).toContainText('已导出 PDF');
});

test('15. Markdown 导入：写入工作区并打开', async ({ page }) => {
  await openApp(page);
  const src = '/tmp/dddown-e2e-home/import-src.md';
  writeFileSync(src, '# 导入测试\n\n外部文件内容');

  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#settingsBtn').click();
  await page.locator('#menuImport').click();
  await (await chooserPromise).setFiles(src);

  await expect(page.locator(FILE_NAME)).toHaveText('import-src.md');
  await expect(page.locator(EDITOR)).toContainText('外部文件内容');
  expect(await readDisk(page, 'import-src.md')).toContain('外部文件内容');
  await expect(page.locator('.toast')).toContainText('已导入');

  // 清理
  const del = await page.request.delete(`${API}/api/file?path=import-src.md&token=${TOKEN}`);
  expect(del.ok()).toBeTruthy();
});

test('16. PWA manifest：合法且图标齐全', async ({ page }) => {
  await openApp(page);
  const res = await page.request.get(`${API}/manifest.webmanifest`);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  const m = await res.json();
  expect(m.name).toBe('dddown');
  expect(m.display).toBe('standalone');
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBeTruthy();
  // 图标真实可访问
  for (const icon of m.icons) {
    expect((await page.request.get(`${API}${icon.src}`)).ok()).toBeTruthy();
  }
});

test('17. Service Worker：生产构建注册并接管页面', async ({ page }) => {
  await openApp(page);
  // install 里 skipWaiting + activate 里 clients.claim，controller 非空即接管完成
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10000 });
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration('/');
    return r ? { scope: r.scope, script: r.active?.scriptURL ?? '' } : null;
  });
  expect(reg).not.toBeNull();
  expect(reg!.script).toContain('/sw.js');
  // 缓存名含构建注入的版本号，非占位符
  const cacheOk = await page.evaluate(async () => {
    const keys = await caches.keys();
    return keys.some((k) => /^dddown-[a-f0-9]{12}$/.test(k));
  });
  expect(cacheOk).toBeTruthy();
});

test('18. 凭证记忆：PWA 冷启动（裸地址无 token）仍可访问', async ({ page }) => {
  // 首次带 token 进入：凭证写入 localStorage
  await openApp(page);
  await expect(page.locator(EDITOR)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('dddown-token'))).toBe(TOKEN);

  // 模拟 PWA 经 start_url 冷启动：同 origin 裸地址，URL 不带查询串
  await page.goto(`${API}/`);
  await expect(page.locator(EDITOR)).toBeVisible();
  // 文件树与预览正常加载，未落入「凭证失效」分支
  await expect(page.locator(PREVIEW)).not.toContainText('访问凭证已失效');
  await expect(page.locator(SAVE_TEXT)).not.toHaveText('凭证失效');
});
