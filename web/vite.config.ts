import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEV_PORT = process.env.MD_PORT || '41937';

/** dist 全量内容哈希注入 sw.js 缓存版本号，与 release 二进制嵌入资源原子一致 */
function swVersion() {
  return {
    name: 'sw-version',
    apply: 'build' as const,
    closeBundle() {
      const dist = 'dist';
      const hash = createHash('sha256');
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir).sort()) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) {
            walk(full);
          } else if (name !== 'sw.js') {
            hash.update(full);
            hash.update(readFileSync(full));
          }
        }
      };
      walk(dist);
      const version = hash.digest('hex').slice(0, 12);
      const sw = join(dist, 'sw.js');
      // /g 全局替换：占位符在注释与 CACHE 常量各出现一次
      writeFileSync(sw, readFileSync(sw, 'utf8').replace(/__SW_VERSION__/g, version));
    },
  };
}

export default defineConfig({
  plugins: [wasm(), swVersion()],
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${DEV_PORT}`,
      '/ws': { target: `ws://127.0.0.1:${DEV_PORT}`, ws: true },
    },
  },
});
