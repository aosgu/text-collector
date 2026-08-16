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
let toastHideTimer = null;
let toastRemoveTimer = null;

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

/**
 * 检查选区是否落在可编辑区域内（P2：补充 anchorNode 校验）。
 * 原先仅检查 activeElement，对“未聚焦的 contenteditable 内划词”会漏判；
 * 这里追加对 selection.anchorNode / focusNode 向上查找最近的可编辑祖先。
 */
function isSelectionInEditable(selection) {
  try {
    const node = selection.anchorNode || selection.focusNode;
    if (!node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    // closest 支持 Shadow DOM 内的普通 DOM；若找不到则回退到手动向上遍历
    if (typeof el.closest === 'function') {
      const hit = el.closest('input, textarea, [contenteditable]');
      if (hit) return true;
      // 兜底：isContentEditable 会继承，closest 可能漏掉 contenteditable="" 的情况
      let cur = el;
      while (cur) {
        if (cur.isContentEditable) return true;
        cur = cur.parentElement;
      }
      return false;
    }
    // 无 closest（如极旧环境）则手动遍历
    let cur = el;
    while (cur) {
      const tag = cur.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || cur.isContentEditable) return true;
      cur = cur.parentElement;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * 按 UTF-16 code unit 上限截断，但绝不在代理对（emoji / 生僻字）中间切断，
 * 否则会产生孤立高位代理，显示为 � 乱码。
 */
function truncateText(text, maxLength) {
  if (maxLength <= 0) return '';
  if (text.length <= maxLength) return text;
  let end = maxLength;
  // 若截断点落在高位代理上，回退 1 个 code unit，丢掉半个字符
  const code = text.charCodeAt(end - 1);
  if (code >= 0xD800 && code <= 0xDBFF) {
    end -= 1;
  }
  return end > 0 ? text.substring(0, end) : '';
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

  // P2：补充对选区锚点所在元素的可编辑校验，覆盖未聚焦 contenteditable 场景
  if (isSelectionInEditable(selection)) return;

  let text = selection.toString();
  if (!text) return;

  text = text.trim();
  if (text.length < 1) return;

  if (!meetsLengthThreshold(text)) return;
  if (isPureSymbol(text) || isPureNumber(text) || isPureURL(text)) return;

  // NFC 规范化必须在长度截断之前执行，避免在 Unicode 组合字符中间截断导致乱码
  text = text.normalize('NFC');
  if (text.length > CONFIG.MAX_TEXT_LENGTH) {
    text = truncateText(text, CONFIG.MAX_TEXT_LENGTH);
  }

  const url = location.href;
  const title = document.title || url;

  addSnippet(text, url, title).then(result => {
    if (result.action === 'created' || result.action === 'replaced') {
      showToast('已采集', 'success');
    } else if (result.action === 'duplicate') {
      showToast('已采集过', 'info');
    }
  }).catch(err => {
    // 扩展上下文失效（热重载后旧 content script 仍存活）时不再弹 toast，避免误导
    if (err && /Extension context invalidated/i.test(String(err.message || err))) {
      return;
    }
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
      if (!bg) continue;
      // 支持 rgb/rgba/hsl/hsla/lab 等；对非 rgb 的回退：用临时元素归一到 rgb
      let r, g, b, a = 1;
      let m = bg.match(/rgba?\(\s*([^)]+)\)/i);
      if (m) {
        const parts = m[1].split(',').map(s => parseFloat(s.trim()));
        if (parts.length >= 3 && (parts.length === 3 || parts[3] > 0.5)) {
          [r, g, b] = parts;
        } else {
          continue; // 透明背景不具参考价值
        }
      } else if (/^hsla?\(/i.test(bg)) {
        // hsl/hsla：直接取 lightness 判断（<50% 视为深色）
        const hm = bg.match(/hsla?\(\s*[^,]+,\s*[^,]+,\s*([0-9.]+)%/i);
        if (hm) {
          const l = parseFloat(hm[1]);
          if (l < 45) return true;
          if (l > 65) return false;
          continue;
        }
        // 解析失败则尝试用临时元素归一化为 rgb
        try {
          const tmp = document.createElement('div');
          tmp.style.color = bg;
          document.body.appendChild(tmp);
          const rgb = getComputedStyle(tmp).color;
          document.body.removeChild(tmp);
          m = rgb && rgb.match(/rgba?\(\s*([^)]+)\)/i);
          if (!m) continue;
          const parts = m[1].split(',').map(s => parseFloat(s.trim()));
          if (parts.length >= 3 && (parts.length === 3 || parts[3] > 0.5)) [r, g, b] = parts;
          else continue;
        } catch (_) { continue; }
      } else {
        // 其他颜色函数（lab, color-mix 等）暂按浅色处理，避免误判为深色
        continue;
      }
      // 感知亮度（YIQ）
      const luminance = (r * 299 + g * 587 + b * 114) / 1000;
      if (luminance < 128) return true;
      if (luminance >= 160) return false;
    }
  } catch (_) { /* getComputedStyle 异常时默认浅色 */ }

  return false;
}

/** 移除当前 toast，并清理可能残留的定时器 */
function removeToastHost() {
  if (toastHideTimer) {
    clearTimeout(toastHideTimer);
    toastHideTimer = null;
  }
  if (toastRemoveTimer) {
    clearTimeout(toastRemoveTimer);
    toastRemoveTimer = null;
  }
  if (toastHost) {
    try { toastHost.remove(); } catch (_) { /* 节点可能已被页面移除 */ }
    toastHost = null;
  }
}

/**
 * 在页面右上角弹出采集反馈 toast。
 *
 * 关键实现要点（修复「选中文字后全屏乱码」）：
 * 1. 宿主位于 light DOM，必须用 inline !important + content.css 双重钉死几何与伪元素；
 * 2. 所有可见 UI 放进 closed Shadow DOM，样式绝不泄漏到页面，也不被页面污染；
 * 3. 禁止使用 `* { all: initial }`——会切断继承并清掉 SVG stroke，导致图标消失/文字异常。
 * 4. 宿主绝不能裁剪子元素（overflow:hidden / contain 含 paint）：toast 的 box-shadow
 *    会画出自身 border-box，一旦被宿主裁掉，圆角外的角落会残留灰色阴影块。
 *
 * @param {string} message    提示文案
 * @param {'success'|'info'|'danger'} [kind='success'] 状态徽标
 */
function showToast(message, kind = 'success') {
  removeToastHost();

  const isDark = detectDarkSurrounding();
  const host = document.createElement('div');
  host.id = 'text-collector-toast-host';
  // 内联 !important：即使 content.css 未注入（或被 CSP/站点剥离）也能自保
  host.style.cssText = [
    'all: initial',
    'position: fixed !important',
    'top: 16px !important',
    'right: 16px !important',
    'left: auto !important',
    'bottom: auto !important',
    'width: max-content !important',
    'height: max-content !important',
    'max-width: min(90vw, 360px) !important',
    'max-height: 40vh !important',
    'margin: 0 !important',
    'padding: 0 !important',
    'border: none !important',
    'background: transparent !important',
    'box-shadow: none !important',
    'z-index: 2147483647 !important',
    'display: block !important',
    'pointer-events: none !important',
    'user-select: none !important',
    'font-size: 0 !important',
    'line-height: 0 !important',
    'color: transparent !important',
    // 仅做 layout/style 隔离。绝不能加 paint（或 overflow:hidden）：
    // paint 包含会把 toast 的 box-shadow 裁剪到宿主盒内，圆角外的角落会残留
    // 灰色阴影，看起来像圆角矩形外面套了一层灰色直角矩形（见 content.test.js 回归用例）。
    'contain: layout style !important',
    'isolation: isolate !important',
    'transform: none !important',
    'opacity: 1 !important',
    'filter: none !important',
    'clip: auto !important',
    'clip-path: none !important',
  ].join(';');
  // 注：此处属性集必须与 content.css 中 #text-collector-toast-host 规则保持一致，
  // 防止 content.css 因 CSP/扩展加载异常未生效时出现属性漂移。
  // 另注意：宿主不得裁剪子元素（overflow:hidden / contain 含 paint 都会裁掉
  // toast 的 box-shadow，圆角外出现灰色直角块），回归用例见 content.test.js。

  let shadow;
  try {
    shadow = host.attachShadow({ mode: 'closed' });
  } catch (err) {
    // 极少数页面若禁止 attachShadow，直接放弃 toast，绝不能把样式泄到 light DOM
    console.warn('[text-collector] attachShadow failed, skip toast:', err);
    return;
  }

  const style = document.createElement('style');
  // Shadow DOM 已隔离宿主页样式。只在 :host 设继承源，不要 `* { all: initial }`。
  style.textContent = `
    :host {
      all: initial;
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                   "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC",
                   "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.2;
      color: #1c1d20;
      pointer-events: none;
    }
    .toast {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 9px 14px 9px 9px;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.2;
      letter-spacing: 0.01em;
      white-space: nowrap;
      border-radius: 10px;
      opacity: 0;
      transform: translateY(-6px);
      transition: opacity .2s ease, transform .2s ease;
      pointer-events: none;
      user-select: none;
      box-sizing: border-box;
      max-width: min(90vw, 360px);
      overflow: hidden;
    }
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
    .toast .label {
      font-family: inherit;
      font-size: 13px;
      line-height: 1.2;
      color: inherit;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
      box-sizing: border-box;
    }
    .badge svg {
      display: block;
      width: 13px;
      height: 13px;
      overflow: visible;
    }
    /* 显式恢复 SVG 描边/填充 */
    .badge svg [stroke] {
      stroke: currentColor;
      fill: none;
    }
    .badge svg [fill]:not([fill="none"]) {
      fill: currentColor;
      stroke: none;
    }
    /* success: 品牌蓝 */
    .toast.light .badge.success,
    .toast.dark .badge.success {
      background: #2f6fed;
      color: #fff;
      box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 2px 8px rgba(47,111,237,0.4);
    }
    /* info: 中性灰（去重、已采集过） */
    .toast.light .badge.info {
      background: rgba(28,29,32,0.08);
      color: #6b6b66;
    }
    .toast.dark .badge.info {
      background: rgba(255,255,255,0.1);
      color: #b8bcc8;
    }
    /* danger: 红（采集失败） */
    .toast.light .badge.danger {
      background: #d14343;
      color: #fff;
      box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 2px 8px rgba(209,67,67,0.4);
    }
    .toast.dark .badge.danger {
      background: #ff6b6b;
      color: #2a0f0f;
      box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 2px 8px rgba(255,107,107,0.45);
    }
  `;

  const toast = document.createElement('div');
  toast.className = 'toast ' + (isDark ? 'dark' : 'light');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const badge = document.createElement('span');
  badge.className = 'badge ' + kind;

  // 按 kind 选择徽标图标（硬编码 SVG，无用户输入）
  if (kind === 'danger') {
    badge.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M8 3.5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<circle cx="8" cy="11.6" r="0.9" fill="currentColor"/></svg>';
  } else if (kind === 'info') {
    badge.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="5.6" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M8 7.2v3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="8" cy="5.5" r="0.9" fill="currentColor"/></svg>';
  } else {
    badge.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = message;

  toast.appendChild(badge);
  toast.appendChild(label);

  shadow.appendChild(style);
  shadow.appendChild(toast);

  // 挂到 <html>，避免部分站点 body { overflow/transform } 影响 fixed 定位
  const mountRoot = document.documentElement || document.body;
  if (!mountRoot) return;
  mountRoot.appendChild(host);
  toastHost = host;

  // 下一帧再加 .show 以触发入场动画
  requestAnimationFrame(() => {
    // 可能在 rAF 前已被新 toast 顶掉
    if (toastHost === host) toast.classList.add('show');
  });

  // 1.5s 后淡出移除；只在 host 仍是自己时清空引用
  toastHideTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastRemoveTimer = setTimeout(() => {
      if (host.parentNode) {
        try { host.remove(); } catch (_) { /* ignore */ }
      }
      if (toastHost === host) toastHost = null;
      toastHideTimer = null;
      toastRemoveTimer = null;
    }, 200);
  }, 1500);
}
