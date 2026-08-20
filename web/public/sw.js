/**
 * dddown Service Worker：L2 秒开 + 后端失联时页面壳仍可打开
 *
 * 策略（与「资源随二进制整体发布」的特性匹配）：
 * - navigate：network-first，失败回退缓存的 index.html（保留原始 query，token 不丢）
 * - 同源静态资源：cache-first，未命中时取网络并缓存（资源带哈希指纹，永不失配）
 * - /api、/ws：不拦截，直达后端
 *
 * 版本号 __SW_VERSION__ 由 vite 构建时注入（dist 全量内容哈希），
 * 每次发版缓存名整体轮换，activate 清旧，不存在新旧二进制混用窗口。
 */
const CACHE = 'dddown-__SW_VERSION__';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dddown-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;

  if (event.request.mode === 'navigate') {
    // 按 pathname 缓存（PWA start_url 为相对路径），回退匹配与 query 无关，token 不丢
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
        }
        return res;
      }).catch(() => caches.match(url.pathname).then((hit) => hit || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
    )
  );
});
