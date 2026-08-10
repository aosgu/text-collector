/**
 * manager.js — 管理页逻辑
 * 列表渲染 / 复制 / 删除 / 撤销 / 导出 / 导入 / 清空 / 开关 / 实时更新 / 滚动加载
 */

// ── 状态 ──
let currentOffset = 0;
const PAGE_SIZE = CONFIG.PAGE_SIZE;
let totalCount = 0;
let isLoading = false;
let newRecordsCount = 0;
// [L2] 使用模块作用域变量替代 window._newRecordTimer
let newRecordTimer = null;
// 并发及撤销保护：若为 true 则在 onChanged 中忽略 snippets_order 变化
let ignoreAllOrderChanges = false;

// ── DOM ──
const $list = document.getElementById('list');
const $emptyState = document.getElementById('empty-state');
const $recordCount = document.getElementById('record-count');
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
  await adoptOrphanSnippets(); // 自动收领孤儿数据，恢复并发写入可能遗漏的记录
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
    $collectToggle.classList.remove('off');
    $collectToggle.querySelector('.toggle-state').textContent = '开';
  } else {
    $collectToggle.classList.add('off');
    $collectToggle.querySelector('.toggle-state').textContent = '关';
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

      // [Truncation Check] 检查文本行数是否超出 3 行截断。若未超出，则隐藏「展开」按钮
      const textEl = card.querySelector('.card-text');
      const expandEl = card.querySelector('.card-expand');
      if (textEl && expandEl) {
        if (textEl.scrollHeight <= textEl.clientHeight) {
          expandEl.style.display = 'none';
        }
      }
    }
  }

  // 显示/隐藏加载更多
  if (currentOffset < totalCount) {
    $loadMore.classList.remove('hidden');
  } else {
    $loadMore.classList.add('hidden');
  }

  // 更新计数和存储占用
  await updateRecordInfo();

  // 存储警告（使用 CONFIG 常量）
  if (totalCount > CONFIG.STORAGE_WARNING_THRESHOLD) {
    $storageWarning.classList.remove('hidden');
  } else {
    $storageWarning.classList.add('hidden');
  }

  isLoading = false;
}

// ── 更新记录计数 ──
async function updateRecordInfo() {
  const sizeKB = await getStorageEstimate();
  $recordCount.textContent = `共 ${totalCount} 条 · 占用约 ${sizeKB} KB`;
}

// ── 创建卡片 ──
function createCard(record) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = record.id;

  // 文本区域
  const textEl = document.createElement('div');
  textEl.className = 'card-text';
  textEl.textContent = record.text; // 安全规则：textContent

  // 点击复制
  textEl.addEventListener('click', () => {
    copyToClipboard(record.text);
    card.classList.add('card-copied');
    setTimeout(() => card.classList.remove('card-copied'), 400);
    showToast('已复制');
  });

  card.appendChild(textEl);

  // 展开/收起
  const expandEl = document.createElement('span');
  expandEl.className = 'card-expand';
  expandEl.textContent = '展开';
  expandEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (card.classList.contains('expanded')) {
      card.classList.remove('expanded');
      expandEl.textContent = '展开';
    } else {
      card.classList.add('expanded');
      expandEl.textContent = '收起';
    }
  });
  card.appendChild(expandEl);

  // 删除按钮
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'card-delete';
  deleteBtn.title = '删除';
  deleteBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  deleteBtn.addEventListener('click', () => deleteRecord(record, card));
  card.appendChild(deleteBtn);

  return card;
}

// ── 删除（带撤销） ──
async function deleteRecord(record, card) {
  // 保存记录副本用于撤销
  const recordCopy = { ...record };

  // 记录其原先在 DOM 中的位置，用于原位恢复，防止刷新页面导致滚动丢失
  const nextSibling = card.nextSibling;
  const parent = card.parentNode;

  // 记录删除前在 snippets_order 中的索引位置
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  const originalIndex = order.indexOf(record.id);

  // 立即从界面移除
  card.style.transition = 'opacity 0.2s, transform 0.2s';
  card.style.opacity = '0';
  card.style.transform = 'translateX(-20px)';

  setTimeout(() => {
    card.remove();
    totalCount--;
    updateRecordInfo();
    // [Bug Fix] 若全部记录删除完毕，则显示空状态提示
    if (totalCount === 0) {
      $emptyState.classList.remove('hidden');
      $loadMore.classList.add('hidden');
    }
  }, 200);

  // 从 storage 删除
  await deleteSnippet(record.id);

  // 显示撤销 toast
  showToast('已删除', '撤销', async () => {
    ignoreAllOrderChanges = true; // 开启保护，防止 onChanged 监听器触发重复追加

    // 1. 恢复记录内容
    const id = recordCopy.id;
    await chrome.storage.local.set({
      [`snip_${id}`]: recordCopy,
    });

    // 2. 恢复其在 snippets_order 中的原始索引
    const currentOrderData = await chrome.storage.local.get('snippets_order');
    let currentOrder = currentOrderData.snippets_order || [];
    if (originalIndex !== -1 && originalIndex <= currentOrder.length) {
      currentOrder.splice(originalIndex, 0, id);
    } else {
      currentOrder = [id, ...currentOrder];
    }
    await chrome.storage.local.set({ snippets_order: currentOrder });

    // 3. 在原 DOM 位置平滑恢复 card
    const restoredCard = createCard(recordCopy);
    if (parent) {
      $emptyState.classList.add('hidden'); // 恢复时必定非空，隐藏空状态
      if (nextSibling && nextSibling.parentNode === parent) {
        parent.insertBefore(restoredCard, nextSibling);
      } else {
        parent.appendChild(restoredCard);
      }

      // 4. 对恢复的 card 执行截断检查
      const textEl = restoredCard.querySelector('.card-text');
      const expandEl = restoredCard.querySelector('.card-expand');
      if (textEl && expandEl) {
        if (textEl.scrollHeight <= textEl.clientHeight) {
          expandEl.style.display = 'none';
        }
      }
    }

    totalCount++;
    await updateRecordInfo();
    ignoreAllOrderChanges = false; // 关闭保护
    showToast('已恢复');
  });
}

// ── 复制到剪贴板 ──
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    // 降级方案
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  });
}

// ── Toast ──
function showToast(message, actionText, actionCallback) {
  const toast = document.createElement('div');
  toast.className = 'toast';

  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  if (actionText) {
    const action = document.createElement('span');
    action.className = 'toast-action';
    action.textContent = actionText;
    action.addEventListener('click', () => {
      if (actionCallback) actionCallback();
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 200);
    });
    toast.appendChild(action);
  }

  $toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // 5 秒（有操作按钮）或 1.5 秒（无按钮）后消失
  const duration = actionText ? 5000 : 1500;
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// ── 清空全部 ──
async function handleClearAll() {
  const earliestDate = await getEarliestDate();
  const dateStr = earliestDate
    ? new Date(earliestDate).toLocaleDateString('zh-CN')
    : '';

  showConfirmModal(
    '清空全部记录',
    `确定清空全部 ${totalCount} 条记录？${dateStr ? `最早记录于 ${dateStr}。` : ''}此操作不可撤销。`,
    async () => {
      ignoreAllOrderChanges = true;
      try {
        await clearAllSnippets();
        await loadFirstPage();
        showToast('已清空');
      } finally {
        ignoreAllOrderChanges = false;
      }
    }
  );
}

// ── 确认弹窗 ──
function showConfirmModal(title, body, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const titleEl = document.createElement('div');
  titleEl.className = 'modal-title';
  titleEl.textContent = title;

  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal-body';
  bodyEl.textContent = body;

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'modal-btn modal-btn-cancel';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', () => {
    overlay.remove();
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'modal-btn modal-btn-confirm';
  confirmBtn.textContent = '确定';
  confirmBtn.addEventListener('click', () => {
    overlay.remove();
    if (onConfirm) onConfirm();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  modal.appendChild(titleEl);
  modal.appendChild(bodyEl);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ── 导出 ──
async function handleExport(format) {
  const records = await getAllSnippets();
  const dateStr = new Date().toISOString().slice(0, 10);

  if (format === 'txt') {
    // 纯文本导出：仅文本内容，每条之间一个空行
    const texts = records.map(r => r.text);
    const content = texts.join('\n\n');

    // UTF-8 with BOM
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

  showToast(`已导出 ${records.length} 条`);
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
      showToast('文件格式不正确');
      return;
    }

    if (data.schemaVersion > SCHEMA_VERSION) {
      showToast(`文件版本(v${data.schemaVersion})高于当前支持版本(v${SCHEMA_VERSION})`);
      return;
    }

    ignoreAllOrderChanges = true;
    const result = await importSnippets(data.snippets);
    await loadFirstPage();
    showToast(`导入了 ${result.imported} 条，跳过 ${result.skipped} 条`);
  } catch (err) {
    showToast('导入失败：文件解析错误');
  } finally {
    ignoreAllOrderChanges = false;
  }

  $fileInput.value = '';
});

// ── 开关切换 ──
async function handleToggle() {
  const enabled = await getCollectEnabled();
  const newValue = !enabled;
  await setCollectEnabled(newValue);
  updateToggleUI(newValue);
}

// ── 实时更新：监听 storage 变化 ──
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  // 开关变化
  if (changes.collectEnabled) {
    updateToggleUI(changes.collectEnabled.newValue !== false);
  }

  // 新记录
  if (changes.snippets_order) {
    // 若开启了本地变更忽略保护，直接跳过处理
    if (ignoreAllOrderChanges) return;

    const newOrder = changes.snippets_order.newValue || [];
    const oldOrder = changes.snippets_order.oldValue || [];

    if (newOrder.length > oldOrder.length) {
      // 有新记录
      const newIds = newOrder.filter(id => !oldOrder.includes(id));
      if (newIds.length === 0) return;

      newRecordsCount += newIds.length;

      // 更新计数
      totalCount = newOrder.length;
      updateRecordInfo();

      // [PRD 自动追加 + 提示] 获取新记录的详细信息并追加到头部
      chrome.storage.local.get(newIds.map(id => `snip_${id}`)).then(recordsData => {
        $emptyState.classList.add('hidden'); // 新增时必定非空，隐藏空状态

        // 保持新记录的相对时间顺序（newOrder 中最新在前，所以我们要按 newOrder 中的顺序把它们 prepend 到 DOM 中）
        const sortedNewIds = newOrder.filter(id => newIds.includes(id));

        // 从后往前 prepend，保证最新的一条在最顶部
        for (let i = sortedNewIds.length - 1; i >= 0; i--) {
          const id = sortedNewIds[i];
          const record = recordsData[`snip_${id}`];
          if (record) {
            const newCard = createCard(record);
            $list.insertBefore(newCard, $list.firstChild);

            // 对新追加的 card 执行截断检查
            const textEl = newCard.querySelector('.card-text');
            const expandEl = newCard.querySelector('.card-expand');
            if (textEl && expandEl) {
              if (textEl.scrollHeight <= textEl.clientHeight) {
                expandEl.style.display = 'none';
              }
            }

            // [Important] 每次向 DOM 中 prepend 一条，currentOffset 均加 1，防止后续滚动加载重复或错乱
            currentOffset++;
          }
        }
      });

      // 显示提示
      $newRecordsHint.textContent = `🆕 新增了 ${newRecordsCount} 条记录`;
      $newRecordsHint.classList.remove('hidden');

      // [L2] 使用模块作用域定时器替代 window._newRecordTimer
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
  // 开关
  $collectToggle.addEventListener('click', handleToggle);

  // 清空
  $btnClear.addEventListener('click', handleClearAll);

  // 导出下拉
  $btnExport.addEventListener('click', (e) => {
    e.stopPropagation();
    $exportMenu.classList.toggle('hidden');
  });

  // 导出菜单项
  $exportMenu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const format = btn.dataset.format;
      $exportMenu.classList.add('hidden');
      handleExport(format);
    });
  });

  // 点击外部关闭下拉
  document.addEventListener('click', () => {
    $exportMenu.classList.add('hidden');
  });

  // 导入
  $btnImport.addEventListener('click', handleImport);

  // 加载更多
  $btnLoadMore.addEventListener('click', loadMore);
}

// ── 启动 ──
init();
