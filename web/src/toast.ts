/** Toast 通知：成功/警告/错误的用户可见提示，替代静默 console。
 * 容器运行时创建（index.html 保持零冗余），token 驱动自动适配全部主题组合 */

type ToastType = 'ok' | 'warn' | 'error';

const DURATION: Record<ToastType, number> = { ok: 2200, warn: 4000, error: 4000 };
const MAX_VISIBLE = 3;

let wrapEl: HTMLElement | null = null;

export function toast(message: string, type: ToastType = 'ok'): void {
  if (!wrapEl) {
    wrapEl = document.createElement('div');
    wrapEl.className = 'toast-wrap';
    document.body.append(wrapEl);
  }

  // 超额时移除最旧的，避免错误风暴堆满屏幕
  while (wrapEl.childElementCount >= MAX_VISIBLE) {
    wrapEl.firstElementChild?.remove();
  }

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  el.addEventListener('click', () => dismiss(el));
  wrapEl.append(el);
  // 下一帧加 show 类触发入场过渡
  requestAnimationFrame(() => el.classList.add('show'));

  setTimeout(() => dismiss(el), DURATION[type]);
}

function dismiss(el: HTMLElement): void {
  el.classList.remove('show');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  // transitionend 丢帧兜底
  setTimeout(() => el.remove(), 500);
}
