import { test, expect, type Page } from '@playwright/test';

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

  // UI 层验证：外部修改后本窗口继续编辑，保存被拒时给出冲突提示。
  // dirty 状态下 watcher 同步被阻断，基线不会推进，冲突必然发生
  await writeDisk(page, original + '\n其他窗口写入');
  await page.locator(EDITOR).click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press('Enter');
  await page.keyboard.type('本窗口输入');
  await expect(page.locator(SAVE_TEXT)).toContainText('冲突', { timeout: 5000 });
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
