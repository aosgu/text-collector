/**
 * manager.js — 管理页逻辑
 *
 * 负责：采集记录的列表渲染、分页、复制、删除（含撤销）、
 * 导出（TXT/JSON）、导入、清空、采集开关、storage 实时变更订阅。
 *
 * 本文件只处理行为和 DOM 结构，所有视觉样式见 manager.css。
 * 采集记录必须使用 textContent 渲染（内容来自任意网页，禁止 innerHTML）。
 */

// ── 状态 ──
// 当前页已加载的条数；storage 实时新增时同步递增，避免后续分页重复或遗漏
let currentOffset = 0;
const PAGE_SIZE = CONFIG.PAGE_SIZE;
let totalCount = 0;
let isLoading = false;
let newRecordsCount = 0;
let newRecordTimer = null;
// 本地修改（删除/清空/导入/撤销）期间置为 true，抑制 onChanged 的重复追加
let ignoreAllOrderChanges = false;

// ── DOM ──
const $list = document.getElementById('list');
const $emptyState = document.getElementById('empty-state');
const $pageSub = document.getElementById('page-sub');
const $toolbarCount = document.getElementById('toolbar-count');
const $loadMore = document.getElementById('load-more');
const $btnLoadMore = document.getElementById('btn-load-more');
const $btnClear = document.getElementById('btn-clear');
const $btnImport = document.getElementById('btn-import');
const $btnExport = document.getElementById('btn-export');
const $exportMenu = document.getElementById('export-menu');
const $collectToggle = document.getElementById('collect-toggle');
const $storageWarning = document.getElementById('storage-warning');
const $newRecordsHint = document.getElementById('new-records-hint');
const $toastContainer = document.getElementById('toast-container');
const $fileInput = document.getElementById('file-input');

// ── 初始化 ──
async function init() {
  await adoptOrphanSnippets();
  await renderToggle();
  await loadFirstPage();
  setupListeners();
}

// ── 开关渲染 ──
async function renderToggle() {
  const enabled = await getCollectEnabled();
  updateToggleUI(enabled);
}

function updateToggleUI(enabled) {
  if (enabled) {
    $collectToggle.classList.add('on');
    $collectToggle.classList.remove('off');
    $collectToggle.setAttribute('aria-checked', 'true');
  } else {
    $collectToggle.classList.remove('on');
    $collectToggle.classList.add('off');
    $collectToggle.setAttribute('aria-checked', 'false');
  }
}

// ── 列表加载 ──
async function loadFirstPage() {
  currentOffset = 0;
  $list.innerHTML = '';
  await loadMore();
}

async function loadMore() {
  if (isLoading) return;
  isLoading = true;

  const { records, total } = await getSnippets(currentOffset, PAGE_SIZE);
  totalCount = total;
  currentOffset += records.length;

  if (records.length === 0 && currentOffset === 0) {
    $emptyState.classList.remove('hidden');
    $loadMore.classList.add('hidden');
  } else {
    $emptyState.classList.add('hidden');
    for (const record of records) {
      const card = createCard(record);
      $list.appendChild(card);
      applyTruncationCheck(card);
    }
  }

  if (currentOffset < totalCount) {
    $loadMore.classList.remove('hidden');
  } else {
    $loadMore.classList.add('hidden');
  }

  await updateRecordInfo();

  if (totalCount > CONFIG.STORAGE_WARNING_THRESHOLD) {
    $storageWarning.classList.remove('hidden');
  } else {
    $storageWarning.classList.add('hidden');
  }

  isLoading = false;
}

// ── 计数显示 ──
// 页面大标题下显示完整描述（条数 / 占用 KB / 排序方式），
// 顶部 brand 旁显示极简等宽条数，滚动列表时也能看到。
async function updateRecordInfo() {
  const sizeKB = await getStorageEstimate();
  // 安全：totalCount / sizeKB 都是 number，不会产生 HTML 注入；sep span 为硬编码静态标签。
  // 若未来重构引入字符串变量，务必改用 DOM 构造或 textContent。
  $pageSub.innerHTML =
    `共 ${totalCount} 条 <span class="sep">/</span> 占用约 ${sizeKB} KB <span class="sep">/</span> 最新在前`;
  $toolbarCount.textContent = totalCount > 0 ? `${totalCount} snippets` : '';
}

/**
 * 判断卡片文本是否被 -webkit-line-clamp 截断，未截断则隐藏「展开」按钮。
 * 必须在卡片插入 DOM 后调用，否则 scrollHeight/clientHeight 均为 0。
 */
function applyTruncationCheck(card) {
  const textEl = card.querySelector('.card-text');
  const expandEl = card.querySelector('.card-expand');
  if (textEl && expandEl) {
    if (textEl.scrollHeight <= textEl.clientHeight + 1) {
      expandEl.style.display = 'none';
    } else {
      expandEl.style.display = '';
    }
  }
}

// ── 内联 SVG 图标（硬编码常量，唯一允许 innerHTML 的地方） ──
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

/**
 * 创建一张记录卡片。
 * 点击卡片文本 → 复制；点击「展开/收起」→ 切换截断；点击垃圾桶 → 删除。
 * 所有采集文本通过 textContent 渲染，防止 XSS。
 * 卡片本身可键盘聚焦（tabindex=0），Enter/Space 触发复制，保持与鼠标一致。
 */
function createCard(record) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = record.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', '复制这条采集文本');

  const copyText = () => {
    copyToClipboard(record.text);
    card.classList.add('card-copied');
    setTimeout(() => card.classList.remove('card-copied'), 500);
    showToast('已复制', { kind: 'success' });
  };

  const textEl = document.createElement('div');
  textEl.className = 'card-text';
  textEl.textContent = record.text; // 安全：textContent，禁止改为 innerHTML
  textEl.addEventListener('click', (e) => {
    e.stopPropagation();
    copyText();
  });
  card.appendChild(textEl);

  const expandEl = document.createElement('span');
  expandEl.className = 'card-expand';
  expandEl.textContent = '展开 ↓';
  expandEl.setAttribute('role', 'button');
  expandEl.tabIndex = 0;
  expandEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const expanded = card.classList.toggle('expanded');
    expandEl.textContent = expanded ? '收起 ↑' : '展开 ↓';
  });
  expandEl.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      expandEl.click();
    }
  });
  card.appendChild(expandEl);

  // 删除按钮：hover 时出现（移动端 CSS 中常驻）；用垃圾桶图标而非 ×，避免被误认为「关闭」
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'card-delete';
  deleteBtn.title = '删除';
  deleteBtn.setAttribute('aria-label', '删除这条记录');
  deleteBtn.innerHTML = ICON_TRASH;
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteRecord(record, card);
  });
  card.appendChild(deleteBtn);

  // 卡片键盘：Enter/Space 在焦点于卡片本身（非内部按钮）时触发复制
  card.addEventListener('keydown', (e) => {
    const target = e.target;
    const isOnCardItself = target === card;
    if ((e.key === ' ' || e.key === 'Enter') && isOnCardItself) {
      e.preventDefault();
      copyText();
    }
  });

  return card;
}

// ── 删除（带撤销） ──
async function deleteRecord(record, card) {
  const recordCopy = { ...record };
  const nextSibling = card.nextSibling;
  const parent = card.parentNode;

  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  const originalIndex = order.indexOf(record.id);

  card.style.transition = 'opacity .18s ease, transform .18s ease';
  card.style.opacity = '0';
  card.style.transform = 'translateX(-12px)';

  setTimeout(() => {
    card.remove();
    totalCount = Math.max(0, totalCount - 1);
    // 已加载窗口收缩 1，避免后续 loadMore 从错误 offset 起读导致漏条/重条
    currentOffset = Math.max(0, currentOffset - 1);
    updateRecordInfo();
    if (totalCount === 0) {
      $emptyState.classList.remove('hidden');
      $loadMore.classList.add('hidden');
    } else if (currentOffset < totalCount) {
      $loadMore.classList.remove('hidden');
    }
  }, 180);

  await deleteSnippet(record.id);

  showToast('已删除', {
    kind: 'info',
    actionText: '撤销',
    onAction: async () => {
      ignoreAllOrderChanges = true;
      try {
        const id = recordCopy.id;
        await chrome.storage.local.set({ [`snip_${id}`]: recordCopy });

        const currentOrderData = await chrome.storage.local.get('snippets_order');
        let currentOrder = currentOrderData.snippets_order || [];
        if (originalIndex !== -1 && originalIndex <= currentOrder.length) {
          currentOrder.splice(originalIndex, 0, id);
        } else {
          currentOrder = [id, ...currentOrder];
        }
        await chrome.storage.local.set({ snippets_order: currentOrder });

        const restoredCard = createCard(recordCopy);
        if (parent) {
          $emptyState.classList.add('hidden');
          if (nextSibling && nextSibling.parentNode === parent) {
            parent.insertBefore(restoredCard, nextSibling);
          } else {
            parent.appendChild(restoredCard);
          }
          applyTruncationCheck(restoredCard);
        }
        totalCount++;
        await updateRecordInfo();
        showToast('已恢复', { kind: 'success' });
      } finally {
        ignoreAllOrderChanges = false;
      }
    },
    duration: 5000,
  });
}

// ── 复制到剪贴板（带 execCommand 兜底） ──
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

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

// ── 清空全部 ──
async function handleClearAll() {
  const earliestDate = await getEarliestDate();
  const dateStr = earliestDate
    ? new Date(earliestDate).toLocaleDateString('zh-CN')
    : '';

  showConfirmModal(
    '清空全部记录',
    `确定清空全部 ${totalCount} 条记录？` +
      (dateStr ? `最早记录于 ${dateStr}。` : '') +
      '此操作不可撤销。',
    async () => {
      ignoreAllOrderChanges = true;
      try {
        await clearAllSnippets();
        await loadFirstPage();
        showToast('已清空', { kind: 'success' });
      } finally {
        ignoreAllOrderChanges = false;
      }
    }
  );
}

// ── 确认弹窗（Esc 取消 / Enter 触发焦点按钮 / 点遮罩关闭） ──
function showConfirmModal(title, body, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  let lastFocused = null;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocusIn);
    // 把焦点还给触发前的元素
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // 简易焦点陷阱：Shift+Tab 从取消按钮绕回确定，Tab 从确定绕回取消
      const focusables = modal.querySelectorAll('button');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // 尊重当前焦点：若焦点在某个按钮上，交给浏览器默认激活行为；
      // 仅在焦点在弹窗内非按钮元素（如 body 文本）时，才兜底触发「取消」。
      // 破坏性操作（清空）绝不应在 Enter 下默认触发确认。
      const active = document.activeElement;
      if (active && (active === cancelBtn || active === confirmBtn)) {
        return; // 让 click 事件自然派发
      }
      e.preventDefault();
      close();
    }
  };

  // 若 Tab 把焦点移出弹窗（焦点陷阱兜底），拉回取消按钮
  const onFocusIn = (e) => {
    if (!modal.contains(e.target)) {
      e.stopPropagation();
      cancelBtn.focus();
    }
  };

  const modal = document.createElement('div');
  modal.className = 'modal';

  const titleEl = document.createElement('div');
  titleEl.className = 'modal-title';
  titleEl.id = 'modal-title-' + Math.random().toString(36).slice(2, 8);
  titleEl.textContent = title;
  modal.setAttribute('aria-labelledby', titleEl.id);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal-body';
  bodyEl.textContent = body;

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', close);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.textContent = '确定';
  confirmBtn.addEventListener('click', () => {
    close();
    if (onConfirm) onConfirm();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  modal.appendChild(titleEl);
  modal.appendChild(bodyEl);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // 点遮罩关闭（点 modal 内部不关闭）
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // 记录打开弹窗前的焦点，关闭时恢复
  lastFocused = document.activeElement;
  // 破坏性操作默认焦点给「取消」，避免误按 Enter 直接执行不可撤销操作
  setTimeout(() => cancelBtn.focus(), 0);
  document.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocusIn);
}

// ── 导出为 TXT（UTF-8 BOM）或 JSON ──
async function handleExport(format) {
  const records = await getAllSnippets();
  const dateStr = new Date().toISOString().slice(0, 10);

  if (format === 'txt') {
    const texts = records.map(r => r.text);
    const content = texts.join('\n\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + content], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `snippets_${dateStr}.txt`);
  } else if (format === 'json') {
    const data = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      count: records.length,
      snippets: records,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `snippets_${dateStr}.json`);
  }

  showToast(`已导出 ${records.length} 条`, { kind: 'success' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── 导入 ──
function handleImport() {
  $fileInput.click();
}

$fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.schemaVersion || !Array.isArray(data.snippets)) {
      showToast('文件格式不正确', { kind: 'danger' });
      return;
    }
    if (data.schemaVersion > SCHEMA_VERSION) {
      showToast(
        `文件版本 (v${data.schemaVersion}) 高于当前支持版本 (v${SCHEMA_VERSION})`,
        { kind: 'danger' }
      );
      return;
    }

    ignoreAllOrderChanges = true;
    try {
      const result = await importSnippets(data.snippets);
      await loadFirstPage();
      showToast(
        `导入了 ${result.imported} 条，跳过 ${result.skipped} 条`,
        { kind: result.imported > 0 ? 'success' : 'info' }
      );
    } finally {
      ignoreAllOrderChanges = false;
    }
  } catch (err) {
    showToast('导入失败：文件解析错误', { kind: 'danger' });
  } finally {
    $fileInput.value = '';
  }
});

// ── 开关切换 ──
async function handleToggle() {
  const enabled = await getCollectEnabled();
  const newValue = !enabled;
  await setCollectEnabled(newValue);
  updateToggleUI(newValue);
}

// ── storage 实时变更：开关同步 + 新记录实时追加到列表头部 ──
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.collectEnabled) {
    updateToggleUI(changes.collectEnabled.newValue !== false);
  }

  if (changes.snippets_order) {
    if (ignoreAllOrderChanges) return;

    const newOrder = changes.snippets_order.newValue || [];
    const oldOrder = changes.snippets_order.oldValue || [];

    if (newOrder.length > oldOrder.length) {
      const newIds = newOrder.filter(id => !oldOrder.includes(id));
      if (newIds.length === 0) return;

      newRecordsCount += newIds.length;
      totalCount = newOrder.length;
      updateRecordInfo();

      chrome.storage.local
        .get(newIds.map(id => `snip_${id}`))
        .then(recordsData => {
          $emptyState.classList.add('hidden');
          const sortedNewIds = newOrder.filter(id => newIds.includes(id));
          // newOrder 中越靠前越新；从后往前 prepend，保证最终顺序最新在顶部
          for (let i = sortedNewIds.length - 1; i >= 0; i--) {
            const id = sortedNewIds[i];
            const record = recordsData[`snip_${id}`];
            if (record) {
              const newCard = createCard(record);
              $list.insertBefore(newCard, $list.firstChild);
              applyTruncationCheck(newCard);
              currentOffset++;
            }
          }
        });

      $newRecordsHint.textContent = `新增了 ${newRecordsCount} 条记录`;
      $newRecordsHint.classList.remove('hidden');

      clearTimeout(newRecordTimer);
      newRecordTimer = setTimeout(() => {
        $newRecordsHint.classList.add('hidden');
        newRecordsCount = 0;
      }, 3000);
    }
  }
});

// ── 事件绑定 ──
function setupListeners() {
  $collectToggle.addEventListener('click', handleToggle);
  $collectToggle.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleToggle();
    }
  });

  $btnClear.addEventListener('click', handleClearAll);

  const setExportMenuOpen = (open) => {
    $exportMenu.classList.toggle('hidden', !open);
    $btnExport.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const focusExportItem = (dir) => {
    const items = Array.from($exportMenu.querySelectorAll('button'));
    if (items.length === 0) return;
    const current = document.activeElement;
    const idx = items.indexOf(current);
    let next = 0;
    if (idx >= 0) {
      next = (idx + dir + items.length) % items.length;
    } else {
      next = dir > 0 ? 0 : items.length - 1;
    }
    items[next].focus();
  };
  $btnExport.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = $exportMenu.classList.contains('hidden');
    setExportMenuOpen(isHidden);
    if (isHidden) {
      // 打开后把焦点交给第一项，方便键盘用户
      const first = $exportMenu.querySelector('button');
      if (first) first.focus();
    }
  });
  $exportMenu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const format = btn.dataset.format;
      setExportMenuOpen(false);
      handleExport(format);
      $btnExport.focus(); // 菜单操作后把焦点还给触发按钮
    });
  });
  $exportMenu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setExportMenuOpen(false);
      $btnExport.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusExportItem(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusExportItem(-1);
    }
  });
  $btnExport.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$exportMenu.classList.contains('hidden')) {
      e.preventDefault();
      setExportMenuOpen(false);
    } else if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') &&
               $exportMenu.classList.contains('hidden')) {
      e.preventDefault();
      setExportMenuOpen(true);
      const first = $exportMenu.querySelector('button');
      if (first) first.focus();
    }
  });
  document.addEventListener('click', (e) => {
    // 若点击发生在 dropdown 外则关闭；点击 $btnExport 由它自己 toggle
    if (!e.target.closest('.dropdown')) {
      setExportMenuOpen(false);
    }
  });
  document.addEventListener('focusin', (e) => {
    // Tab 到菜单外时自动关闭
    if (!e.target.closest('.dropdown')) {
      setExportMenuOpen(false);
    }
  });

  $btnImport.addEventListener('click', handleImport);
  $btnLoadMore.addEventListener('click', loadMore);
}

// ── 启动：任何一步抛错都展示错误态，避免白屏 ──
init().catch(err => {
  console.error('[text-collector] init failed:', err);
  $list.innerHTML = '';
  $emptyState.classList.remove('hidden');
  const titleEl = $emptyState.querySelector('.empty-title');
  const subEl = $emptyState.querySelector('.empty-sub');
  if (titleEl) titleEl.textContent = '加载失败';
  if (subEl) {
    subEl.textContent = '本地存储读取异常。请尝试重启浏览器；如持续出现，可在 chrome://extensions 重新加载扩展。';
  }
});
