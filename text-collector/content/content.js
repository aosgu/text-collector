/**
 * content.js — Content Script
 * selectionchange 监听 + 500ms 防抖 + 准入规则 + toast + 开关联动
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

function meetsLengthThreshold(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars >= 5 || englishWords >= 3;
}

function isPureSymbol(text) {
  // 仅标点符号和空白
  return /^[\s\p{P}\p{S}]+$/u.test(text);
}

function isPureNumber(text) {
  // 仅数字（含小数点、逗号）
  return /^[\d.,\s]+$/.test(text);
}

function isPureURL(text) {
  const trimmed = text.trim();
  if (/^https?:\/\//.test(trimmed) && trimmed.length > 10) {
    const urlPart = trimmed.replace(/^https?:\/\//, '');
    const totalLen = trimmed.length;
    const nonUrlChars = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
    return nonUrlChars === 0 && urlPart.length > 5;
  }
  return false;
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

  // 跳过编辑区域
  if (isEditableElement(document.activeElement)) return;

  // 跳过页面加载初期的 selection 恢复
  if (Date.now() - pageLoadTime < 2000) return;

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
  if (text.length > 5000) {
    text = text.substring(0, 5000);
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
  debounceTimer = setTimeout(processSelection, 500);
});

// ── Toast 实现（Shadow DOM 隔离） ──

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

  // 1.5 秒后淡出移除
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (host.parentNode) {
        host.remove();
      }
      toastHost = null;
    }, 200);
  }, 1500);
}
