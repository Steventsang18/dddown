/**
 * E2E 环境准备：隔离 HOME 下的配置文件 + 初始笔记。
 * 服务端读 ~/.dddown/config.toml，此处重定向 HOME 保证测试不碰用户真实配置。
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const HOME = '/tmp/dddown-e2e-home';
const CONFIG_DIR = join(HOME, '.dddown');
const NOTES_DIR = join(HOME, 'notes');

// 清理端口残留进程：上次测试失败可能没走到用例清理，webServer 探测又会抢在 prepare 改写配置前通过
try {
  execSync('lsof -ti tcp:60101 | xargs kill -9 2>/dev/null');
} catch {
  // 无残留进程时 lsof 非零退出，忽略
}

rmSync(HOME, { recursive: true, force: true });
mkdirSync(CONFIG_DIR, { recursive: true });
mkdirSync(NOTES_DIR, { recursive: true });

writeFileSync(
  join(CONFIG_DIR, 'config.toml'),
  `[server]
port = 60101
workspace = "/tmp/dddown-e2e-home/notes"
token = "e2e-test-token"
`
);

writeFileSync(
  join(NOTES_DIR, 'welcome.md'),
  `# 欢迎使用 dddown

这是一段用于 E2E 测试的初始内容。

## 列表

- 第一项
- 第二项

## 公式

$E=mc^2$
`
);

console.log('e2e env ready');
