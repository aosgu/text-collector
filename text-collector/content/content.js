/**
 * content.js — Content Script
 *
 * 注入到所有页面，监听 selectionchange，经 500ms 防抖后执行准入规则
 * （长度、纯符号/数字/URL 过滤、编辑区域跳过、扩选替换、去重），
 * 通过 storage.js 写入分片存储，并用 Shadow DOM 注入轻量 toast 反馈。
 *
 * CONFIG 常量定义在 utils/storage.js 中（manifest 中先于本文件加载）。
 */

// ── 开关状态缓存 ──
let collectEnabled = true;
let isInitialized = false;
let pageLoadTime = Date.now();

// ── 防抖计时器 ──
let debounceTimer = null;

// ── Toast 元素 ──
let toastHost = null;

// ── 初始化 ──
chrome.storage.local.get('collectEnabled')
  .then(data => {
    collectEnabled = data.collectEnabled !== false;
    isInitialized = true;
  })
  .catch(err => {
    // storage 不可用时默认开启，避免插件静默失效
    console.warn('[text-collector] storage init failed, defaulting to enabled:', err);
    collectEnabled = true;
    isInitialized = true;
  });

// 监听开关变化
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.collectEnabled) {
    collectEnabled = changes.collectEnabled.newValue !== false;
  }
});

// ── 准入规则检查 ──

/**
 * 判断选中文本是否达到最小长度阈值。
 * 采用加权混合：中文字数 / 中文阈值 + 英文词数 / 英文阈值 >= 1，
 * 因此纯中文需 ≥5 字、纯英文需 ≥3 词，混合按比例计算。
 */
function meetsLengthThreshold(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const score = chineseChars / CONFIG.MIN_CHINESE_CHARS + englishWords / CONFIG.MIN_ENGLISH_WORDS;
  return score >= 1;
}

function isPureSymbol(text) {
  // 仅标点符号和空白
  // 优先使用 \p{} Unicode 属性（ES2018+，支持所有 Unicode 标点）
  // 不支持时 fallback 到 ASCII + 常见全角/特殊符号，避免误判正常文本
  try {
    return /^[\s\p{P}\p{S}]+$/u.test(text);
  } catch (_) {
    // Fallback: ASCII 标点 + 全角中文标点 + 常见符号
    return /^[\s!-/:-@\[-`{-~\u3000-\u303F\uFF00-\uFFEF\u2000-\u206F]+$/.test(text);
  }
}

function isPureNumber(text) {
  // 仅数字（含小数点、逗号）
  return /^[\d.,\s]+$/.test(text);
}

/**
 * 判断整段选区是否就是一个 URL。
 * 仅匹配 http/https/ftp/file 开头、全部为 ASCII 可见字符、长度 > 10 的纯 URL，
 * 避免把包含链接的普通句子误判为 URL。
 */
function isPureURL(text) {
  const trimmed = text.trim();
  // 匹配常见 URL 协议（http, https, ftp, file 等）
  const urlPattern = /^(https?|ftp|file):\/\/[^\s]+$/i;
  if (urlPattern.test(trimmed)) {
    // URL 内只允许 ASCII 可见字符；含中文/emoji/中文标点的一律按普通文本处理
    // （URL 合法范围为 ASCII 可见字符，空格在 URL 中通常编码为 %20）
    const hasNonUrlChars = /[^\x21-\x7E]/.test(trimmed);
    return !hasNonUrlChars && trimmed.length > 10;
  }
  return false;
}

/**
 * 递归获取当前页面真正的 activeElement，穿透 open Shadow DOM。
 * 用于准确判断选区是否发生在嵌套于 Web Component 内的 input/textarea/contenteditable 里。
 */
function getActiveElement(root = document) {
  let el = root.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

function isEditableElement(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (el.isContentEditable) return true;
  return false;
}

// ── 采集检查 ──

function processSelection() {
  if (!isInitialized) return;
  if (!collectEnabled) return;

  // 跳过编辑区域（穿透 Shadow DOM），避免捕获用户在输入框里的文本选择
  if (isEditableElement(getActiveElement())) return;

  // 跳过页面加载初期的 selection 恢复（浏览器会恢复上次的选区）
  if (Date.now() - pageLoadTime < CONFIG.PAGE_LOAD_GRACE_MS) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  let text = selection.toString();
  if (!text) return;

  text = text.trim();
  if (text.length < 1) return;

  if (!meetsLengthThreshold(text)) return;
  if (isPureSymbol(text) || isPureNumber(text) || isPureURL(text)) return;

  // NFC 规范化必须在长度截断之前执行，避免在 Unicode 组合字符中间截断导致乱码
  text = text.normalize('NFC');
  if (text.length > CONFIG.MAX_TEXT_LENGTH) {
    text = text.substring(0, CONFIG.MAX_TEXT_LENGTH);
  }

  const url = location.href;
  const title = document.title || url;

  addSnippet(text, url, title).then(result => {
    if (result.action === 'created' || result.action === 'replaced') {
      showToast('已采集', 'success');
    } else if (result.action === 'duplicate') {
      showToast('已采集过', 'info');
    }
  }).catch(() => {
    showToast('采集失败', 'danger');
  });
}

// ── selectionchange 防抖监听 ──

document.addEventListener('selectionchange', () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(processSelection, CONFIG.DEBOUNCE_MS);
});

// ── Toast（Shadow DOM 隔离，根据页面深浅色自适应） ──

/**
 * 探测当前页面是否为深色环境，决定 toast 使用浅色还是深色版本。
 * 综合考虑系统 prefers-color-scheme 与 <html>/<body> 的计算背景色亮度。
 */
function detectDarkSurrounding() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return true;
    }
  } catch (_) { /* matchMedia 不可用时静默降级 */ }

  try {
    const candidates = [document.documentElement, document.body];
    for (const el of candidates) {
      if (!el) continue;
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg && bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map(s => parseFloat(s.trim()));
        // 透明背景不具参考价值，跳过
        if (parts.length >= 3 && (parts.length === 3 || parts[3] > 0.5)) {
          const [r, g, b] = parts;
          // 感知亮度（YIQ）
          const luminance = (r * 299 + g * 587 + b * 114) / 1000;
          if (luminance < 128) return true;
          if (luminance >= 160) return false;
        }
      }
    }
  } catch (_) { /* getComputedStyle 异常时默认浅色 */ }

  return false;
}

/**
 * 在页面右上角弹出采集反馈 toast。
 *
 * 视觉：近白（浅色页面）或深石墨（深色页面）毛玻璃底 + 状态徽标。
 * 深浅通过 detectDarkSurrounding() 自动判断，逻辑基于系统主题与 <html>/<body> 计算背景亮度。
 *
 * @param {string} message    提示文案
 * @param {'success'|'info'|'danger'} [kind='success'] 状态徽标
 */
function showToast(message, kind = 'success') {
  // 移除旧 toast
  if (toastHost) {
    toastHost.remove();
    toastHost = null;
  }

  const isDark = detectDarkSurrounding();
  const host = document.createElement('div');
  host.id = 'text-collector-toast-host';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host, * { all: initial; }
    .toast {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 9px 14px 9px 9px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                   "Noto Sans CJK SC", "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1;
      letter-spacing: 0.01em;
      white-space: nowrap;
      border-radius: 10px;
      opacity: 0;
      transform: translateY(-6px);
      transition: opacity .2s ease, transform .2s ease;
      pointer-events: none;
      user-select: none;
    }
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
    /* 浅色版（默认） */
    .toast.light {
      background: rgba(255,255,255,0.92);
      color: #1c1d20;
      border: 1px solid rgba(28,29,32,0.08);
      box-shadow:
        0 1px 2px rgba(28,29,32,0.04),
        0 12px 32px rgba(28,29,32,0.12),
        0 0 0 1px rgba(47,111,237,0.06);
      backdrop-filter: saturate(180%) blur(16px);
      -webkit-backdrop-filter: saturate(180%) blur(16px);
    }
    /* 深色版 */
    .toast.dark {
      background: rgba(28,31,38,0.9);
      color: #e7eaf0;
      border: 1px solid rgba(255,255,255,0.08);
      box-shadow:
        0 1px 0 rgba(255,255,255,0.04) inset,
        0 12px 32px rgba(0,0,0,0.5),
        0 0 0 1px rgba(47,111,237,0.12);
      backdrop-filter: saturate(180%) blur(16px);
      -webkit-backdrop-filter: saturate(180%) blur(16px);
    }
    .badge {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .badge svg { display: block; width: 13px; height: 13px; }
    /* success: 品牌蓝 */
    .toast.light .badge.success {
      background: #2f6fed; color: #fff;
      box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 2px 8px rgba(47,111,237,0.4);
    }
    .toast.dark .badge.success {
      background: #2f6fed; color: #fff;
      box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 2px 8px rgba(47,111,237,0.45);
    }
    /* info: 中性灰（去重、已采集过） */
    .toast.light .badge.info {
      background: rgba(28,29,32,0.08); color: #6b6b66;
    }
    .toast.dark .badge.info {
      background: rgba(255,255,255,0.1); color: #b8bcc8;
    }
    /* danger: 红（采集失败） */
    .toast.light .badge.danger {
      background: #d14343; color: #fff;
      box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 2px 8px rgba(209,67,67,0.4);
    }
    .toast.dark .badge.danger {
      background: #ff6b6b; color: #2a0f0f;
      box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 2px 8px rgba(255,107,107,0.45);
    }
  `;

  const toast = document.createElement('div');
  toast.className = 'toast ' + (isDark ? 'dark' : 'light');

  const badge = document.createElement('span');
  badge.className = 'badge ' + kind;

  // 按 kind 选择徽标图标（danger 感叹号 / info 圆圈 i / success 勾选）
  if (kind === 'danger') {
    badge.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none">' +
      '<path d="M8 3.5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<circle cx="8" cy="11.6" r="0.9" fill="currentColor"/></svg>';
  } else if (kind === 'info') {
    badge.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none">' +
      '<circle cx="8" cy="8" r="5.6" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M8 7.2v3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="8" cy="5.5" r="0.9" fill="currentColor"/></svg>';
  } else {
    badge.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none">' +
      '<path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  const label = document.createElement('span');
  label.textContent = message;

  toast.appendChild(badge);
  toast.appendChild(label);

  shadow.appendChild(style);
  shadow.appendChild(toast);
  document.documentElement.appendChild(host);
  toastHost = host;

  // 下一帧再加 .show 以触发入场动画
  requestAnimationFrame(() => toast.classList.add('show'));

  // 1.5s 后淡出移除；只在 host 仍是自己时清空引用，避免覆盖更新 toast 的引用
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (host.parentNode) host.remove();
      if (toastHost === host) toastHost = null;
    }, 200);
  }, 1500);
}
