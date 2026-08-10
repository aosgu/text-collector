/**
 * content.js — Content Script
 * selectionchange 监听 + 500ms 防抖 + 准入规则 + toast + 开关联动
 * 注意：CONFIG 常量定义在 utils/storage.js 中（先于本文件加载）
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
chrome.storage.local.get('collectEnabled', (data) => {
  collectEnabled = data.collectEnabled !== false;
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
 * [L1] 混合语言加权阈值判断
 * 使用加权计算：中文字数/5 + 英文词数/3 >= 1
 * 纯中文需要 ≥5 字，纯英文需要 ≥3 词，混合文本按比例加权
 */
function meetsLengthThreshold(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  const score = chineseChars / CONFIG.MIN_CHINESE_CHARS + englishWords / CONFIG.MIN_ENGLISH_WORDS;
  return score >= 1;
}

function isPureSymbol(text) {
  // 仅标点符号和空白
  return /^[\s\p{P}\p{S}]+$/u.test(text);
}

function isPureNumber(text) {
  // 仅数字（含小数点、逗号）
  return /^[\d.,\s]+$/.test(text);
}

/**
 * [L8] 改进 URL 检测逻辑
 * 更全面的非 URL 字符检测，支持多种协议，使用 URL 模式全匹配
 */
function isPureURL(text) {
  const trimmed = text.trim();
  // 匹配常见 URL 协议（http, https, ftp, file 等）
  const urlPattern = /^(https?|ftp|file):\/\/[^\s]+$/i;
  if (urlPattern.test(trimmed)) {
    // 检查是否包含非 URL 合法字符（中文、emoji、中文标点等）
    // URL 合法字符范围：ASCII 可见字符（不含空格，但 URL 中可能编码为 %20）
    const hasNonUrlChars = /[^\x21-\x7E]/.test(trimmed);
    return !hasNonUrlChars && trimmed.length > 10;
  }
  return false;
}

/**
 * 递归地获取当前页面的 activeElement，支持穿透 Shadow DOM，
 * 从而准确判断嵌套在 Shadow DOM 内的 input/textarea 等编辑区域。
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

  // 跳过编辑区域（穿透 Shadow DOM）
  if (isEditableElement(getActiveElement())) return;

  // 跳过页面加载初期的 selection 恢复
  if (Date.now() - pageLoadTime < CONFIG.PAGE_LOAD_GRACE_MS) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  let text = selection.toString();
  if (!text) return;

  text = text.trim();
  if (text.length < 1) return;

  // 最小长度阈值
  if (!meetsLengthThreshold(text)) return;

  // 内容类型过滤
  if (isPureSymbol(text) || isPureNumber(text) || isPureURL(text)) return;

  // 最大长度截断
  if (text.length > CONFIG.MAX_TEXT_LENGTH) {
    text = text.substring(0, CONFIG.MAX_TEXT_LENGTH);
  }

  // NFC 归一化
  text = text.normalize('NFC');

  // 获取页面信息
  const url = location.href;
  const title = document.title || url;

  // 写入存储
  addSnippet(text, url, title).then(result => {
    if (result.action === 'created') {
      showToast('已采集 ✓');
    } else if (result.action === 'replaced') {
      showToast('已采集 ✓');
    } else if (result.action === 'duplicate') {
      showToast('已采集过');
    }
  }).catch(() => {
    showToast('采集失败');
  });
}

// ── selectionchange 防抖监听 ──

document.addEventListener('selectionchange', () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(processSelection, CONFIG.DEBOUNCE_MS);
});

// ── Toast 实现（Shadow DOM 隔离） ──

/**
 * [M2] 修复 Toast 竞态：清理回调中只清理自己的引用，避免覆盖新 toast
 */
function showToast(message) {
  // 移除旧 toast
  if (toastHost) {
    toastHost.remove();
    toastHost = null;
  }

  const host = document.createElement('div');
  host.id = 'text-collector-toast-host';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .toast {
      background: rgba(30, 30, 30, 0.92);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif;
      font-size: 14px;
      padding: 8px 16px;
      border-radius: 6px;
      opacity: 0;
      transform: translateY(-8px);
      transition: opacity 0.2s ease, transform 0.2s ease;
      pointer-events: none;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  `;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;

  shadow.appendChild(style);
  shadow.appendChild(toast);
  document.documentElement.appendChild(host);
  toastHost = host;

  // 入场动画
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // [M2] 1.5 秒后淡出移除，清理回调只清理自己的引用
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (host.parentNode) {
        host.remove();
      }
      // 只在当前引用还是这个 host 时才置空，避免覆盖新 toast 的引用
      if (toastHost === host) {
        toastHost = null;
      }
    }, 200);
  }, 1500);
}
