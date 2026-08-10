/**
 * manager.js — 管理页逻辑（入口 + 编排）
 *
 * 负责：初始化、全局状态持有、事件绑定、storage 实时变更订阅，
 * 以及开关/清空等直接绑定在控件上的处理器。
 *
 * 拆分后的模块：
 *   render.js        列表渲染（createCard / applyTruncationCheck / 分页加载 /
 *                    计数显示 / 删除撤销 / 新记录 prepend / 错误态）
 *   toast.js         单实例 Toast（showToast / dismiss / ICON_* 常量）
 *   modal.js         确认弹窗（showConfirmModal）
 *   import-export.js 导出 / 导入（handleExport / handleImport / downloadBlob）
 *
 * 状态约定：currentOffset / totalCount / isLoading / newRecordsCount /
 * newRecordTimer / ignoreAllOrderChanges 只在本文件内声明与读写；
 * 其他模块通过 listBridge（函数参数/回调）访问，不在模块间共享可变变量。
 *
 * 本文件只处理行为和 DOM 结构，所有视觉样式见 manager.css。
 * 采集记录必须使用 textContent 渲染（内容来自任意网页，禁止 innerHTML）。
 */

// ── 状态 ──
// 当前页已加载的条数；storage 实时新增时同步递增，避免后续分页重复或遗漏
let currentOffset = 0;
let totalCount = 0;
let isLoading = false;
let newRecordsCount = 0;
let newRecordTimer = null;
// 本地修改（删除/清空/导入/撤销）期间置为 true，抑制 onChanged 的重复追加
let ignoreAllOrderChanges = false;

// ── 状态读写通道 ──
// 通过函数参数/回调把状态读写给 render.js 等模块，避免跨文件共享可变变量。
function getListState() {
  return { currentOffset, totalCount, isLoading };
}

function commitListState(patch) {
  if (patch.currentOffset !== undefined) currentOffset = patch.currentOffset;
  if (patch.totalCount !== undefined) totalCount = patch.totalCount;
  if (patch.isLoading !== undefined) isLoading = patch.isLoading;
}

function setIgnoreAllOrderChanges(value) {
  ignoreAllOrderChanges = value;
}

const listBridge = {
  getState: getListState,
  commit: commitListState,
  setIgnoreAllOrderChanges,
};

// ── DOM（事件绑定 / onChanged 需要；渲染相关元素由各模块自持） ──
const $btnLoadMore = document.getElementById('btn-load-more');
const $btnClear = document.getElementById('btn-clear');
const $btnImport = document.getElementById('btn-import');
const $btnExport = document.getElementById('btn-export');
const $exportMenu = document.getElementById('export-menu');
const $collectToggle = document.getElementById('collect-toggle');
const $newRecordsHint = document.getElementById('new-records-hint');
const $fileInput = document.getElementById('file-input');

// ── 初始化 ──
async function init() {
  await adoptOrphanSnippets();
  await renderToggle();
  await loadFirstPage(listBridge);
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

// ── 开关切换 ──
async function handleToggle() {
  const enabled = await getCollectEnabled();
  const newValue = !enabled;
  await setCollectEnabled(newValue);
  updateToggleUI(newValue);
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
        await loadFirstPage(listBridge);
        showToast('已清空', { kind: 'success' });
      } finally {
        ignoreAllOrderChanges = false;
      }
    }
  );
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
      updateRecordInfo(totalCount);

      chrome.storage.local
        .get(newIds.map(id => `snip_${id}`))
        .then(recordsData => {
          const sortedNewIds = newOrder.filter(id => newIds.includes(id));
          // newOrder 中越靠前越新；prependNewCards 内从后往前 prepend，最新在顶部
          prependNewCards(recordsData, sortedNewIds, listBridge, () => { currentOffset++; });
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

// ── 导入（change 事件：选择文件后交给 import-export.js 处理） ──
$fileInput.addEventListener('change', async (e) => {
  await handleImportFileChange(e.target.files[0], {
    onBeforeImport: () => { ignoreAllOrderChanges = true; },
    onAfterImport: () => { ignoreAllOrderChanges = false; },
    onImported: () => loadFirstPage(listBridge),
  });
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
  $btnLoadMore.addEventListener('click', () => loadMore(listBridge));
}

// ── 启动：任何一步抛错都展示错误态，避免白屏 ──
init().catch(err => {
  console.error('[text-collector] init failed:', err);
  renderLoadError();
});
