import { defineConfig } from '@playwright/test';
import { homedir } from 'node:os';

const realHome = homedir();

/**
 * E2E：spawn 服务端进程（隔离 HOME + 固定端口），浏览器访问后走核心流程。
 * 服务端无 token 校验（前端从 URL 读 token 仅为透传），测试无需 token。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:60101',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    // HOME 隔离；RUSTUP_HOME/CARGO_HOME 显式指向真实目录，避免 rustup 因 HOME 变化找不到工具链
    // E2E_BIN=release 时跑发布二进制（验证单二进制嵌入）
    command: process.env.E2E_BIN === 'release' ? './target/release/dddown' : 'cargo run -p dddown-server',
    env: {
      HOME: '/tmp/dddown-e2e-home',
      RUSTUP_HOME: `${realHome}/.rustup`,
      CARGO_HOME: `${realHome}/.cargo`,
      PATH: process.env.PATH || '',
    },
    url: 'http://127.0.0.1:60101',
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    cwd: '..',
  },
});
