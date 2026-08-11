/**
 * toast.js — 管理页 Toast（单实例，新 toast 会顶掉上一条）
 *
 * 原 manager.js L317-L378 迁移而来：ICON_* 常量 + showToast + dismiss。
 * 本文件不读写 manager.js 的任何全局状态，仅持有自己的 DOM 引用
 * （$toastContainer）与模块内 UI 状态（currentToastEl）。
 */

// ── Toast 容器 ──
const $toastContainer = document.getElementById('toast-container');

// ── 内联 SVG 图标（硬编码常量，唯一允许 innerHTML 的地方） ──
const ICON_BOOKMARK_OUTLINE =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M3 2.5C3 1.67157 3.67157 1 4.5 1H11.5C12.3284 1 13 1.67157 13 2.5V14.2C13 14.88 12.18 15.23 11.68 14.78L8 11.5L4.32 14.78C3.82 15.23 3 14.88 3 14.2V2.5Z" ' +
  'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICON_BOOKMARK_SOLID =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M3 2.5C3 1.67157 3.67157 1 4.5 1H11.5C12.3284 1 13 1.67157 13 2.5V14.2C13 14.88 12.18 15.23 11.68 14.78L8 11.5L4.32 14.78C3.82 15.23 3 14.88 3 14.2V2.5Z" ' +
  'fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICON_TRASH =
  '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M3 4h10M6.5 4V2.5h3V4M5 6.5v5m6-5v5M4 4l.6 8.5a1 1 0 001 .9h4.8a1 1 0 001-.9L12 4" ' +
  'stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICON_CHECK =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ICON_INFO =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.6"/>' +
  '<path d="M8 7.2v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
  '<circle cx="8" cy="5.4" r="0.9" fill="currentColor"/></svg>';

const ICON_ALERT =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M8 3.2v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
  '<circle cx="8" cy="11.4" r="0.9" fill="currentColor"/></svg>';

// ── Toast：单实例，新 toast 会顶掉上一条 ──
let currentToastEl = null;

/**
 * 显示一条 toast。
 * @param {string} message
 * @param {object} [opts]
 * @param {'success'|'info'|'danger'} [opts.kind='info']
 * @param {string} [opts.actionText]     右侧操作按钮文案（如「撤销」）
 * @param {Function} [opts.onAction]     操作按钮回调
 * @param {number} [opts.duration]       自动消失时长（ms），有操作按钮默认 5s，否则 1.6s
 */
function showToast(message, opts = {}) {
  const {
    kind = 'info',
    actionText = null,
    onAction = null,
    duration = actionText ? 5000 : 1600,
  } = opts;

  if (currentToastEl && currentToastEl.parentNode) {
    currentToastEl.parentNode.removeChild(currentToastEl);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';

  const badge = document.createElement('span');
  badge.className = `toast-badge is-${kind}`;
  if (kind === 'success') badge.innerHTML = ICON_CHECK;
  else if (kind === 'danger') badge.innerHTML = ICON_ALERT;
  else badge.innerHTML = ICON_INFO;
  toast.appendChild(badge);

  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  if (actionText && typeof onAction === 'function') {
    const action = document.createElement('span');
    action.className = 'toast-action';
    action.textContent = actionText;
    action.addEventListener('click', () => {
      onAction();
      dismiss(toast);
    });
    toast.appendChild(action);
  }

  $toastContainer.appendChild(toast);
  currentToastEl = toast;
  requestAnimationFrame(() => toast.classList.add('show'));

  const timer = setTimeout(() => dismiss(toast), duration);
  toast._dismissTimer = timer;
}

function dismiss(toast) {
  if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
  if (currentToastEl === toast) currentToastEl = null;
  toast.classList.remove('show');
  setTimeout(() => toast.remove(), 200);
}
