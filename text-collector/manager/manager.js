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
 *   export.js        导出（handleExport / downloadBlob）
 *
 * 状态约定：currentOffset / totalCount / isLoading / newRecordsCount /
 * newRecordTimer / ignoreAllOrderChanges 只在本文件内声明与读写；
 * 其他模块通过 listBridge（函数参数/回调）访问，不在模块间共享可变变量。
 * 其中 currentOffset / totalCount / isLoading / ignoreAllOrderChanges 的
 * 一切修改都收敛到本文件的命名函数（incrementLoaded / decrementLoaded /
 * resetLoaded / setTotalCount / incrementTotal / decrementTotal /
 * setLoading / setIgnoreOrderChanges），读取走 getLoadedCount /
 * getTotalCount / getLoading / isIgnoreOrderChanges，便于全局检索改动点。
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
// 本地修改（删除/清空/撤销）期间置为 true，抑制 onChanged 的重复追加
let ignoreAllOrderChanges = false;
let currentTab = 'home';

// ── 状态读写通道 ──
// 通过函数参数/回调把状态读写给 render.js 等模块，避免跨文件共享可变变量。
// 对 currentOffset / totalCount / isLoading / ignoreAllOrderChanges 的一切修改
// 都收敛到下面的命名函数里（incrementLoaded / decrementLoaded / resetLoaded /
// setTotalCount / incrementTotal / decrementTotal / setLoading / setIgnoreOrderChanges），
// 需要排查「什么时候会改这几个状态」时直接搜索这些函数名即可；
// 读取统一走 get* / is* 命名 getter。

function getLoadedCount() { return currentOffset; }
function getTotalCount() { return totalCount; }
function getLoading() { return isLoading; }
function isIgnoreOrderChanges() { return ignoreAllOrderChanges; }
function getCurrentTab() { return currentTab; }

/** currentOffset += n（默认 1）：loadMore 翻页、onChanged 每插入一张新卡片 */
function incrementLoaded(n = 1) { currentOffset += n; }
/** currentOffset = max(0, currentOffset - n)（默认 1）：删除后收缩已加载窗口，避免漏条/重条 */
function decrementLoaded(n = 1) { currentOffset = Math.max(0, currentOffset - n); }
/** currentOffset = 0：首屏 / 清空后重新加载 */
function resetLoaded() { currentOffset = 0; }

/** totalCount = n：loadMore / onChanged 拿到新的总数时 */
function setTotalCount(n) { totalCount = n; }
/** totalCount += n（默认 1）：删除撤销恢复记录 */
function incrementTotal(n = 1) { totalCount += n; }
/** totalCount = max(0, totalCount - n)（默认 1）：删除记录 */
function decrementTotal(n = 1) { totalCount = Math.max(0, totalCount - n); }

/** isLoading = bool：loadMore 开始 / 结束 */
function setLoading(bool) { isLoading = bool; }

/** ignoreAllOrderChanges = bool：删除撤销 / 清空的 try-finally 包裹 */
function setIgnoreOrderChanges(bool) { ignoreAllOrderChanges = bool; }

const listBridge = {
  getLoadedCount, getTotalCount, getLoading, getCurrentTab,
  incrementLoaded, decrementLoaded, resetLoaded,
  setTotalCount, incrementTotal, decrementTotal,
  setLoading, setIgnoreOrderChanges,
};

// ── DOM（事件绑定 / onChanged 需要；渲染相关元素由各模块自持） ──
const $btnLoadMore = document.getElementById('btn-load-more');
const $btnClear = document.getElementById('btn-clear');
const $btnExport = document.getElementById('btn-export');
const $exportMenu = document.getElementById('export-menu');
const $collectToggle = document.getElementById('collect-toggle');
const $newRecordsHint = document.getElementById('new-records-hint');

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
  const earliestDate = await getEarliestDate(currentTab);
  const dateStr = earliestDate
    ? new Date(earliestDate).toLocaleDateString('zh-CN')
    : '';

  showConfirmModal(
    '清空全部记录',
    `确定清空全部 ${getTotalCount()} 条记录？` +
      (dateStr ? `最早记录于 ${dateStr}。` : '') +
      '此操作不可撤销。',
    async () => {
      setIgnoreOrderChanges(true);
      try {
        await clearAllSnippets();
        await loadFirstPage(listBridge);
        showToast('已清空', { kind: 'success' });
      } finally {
        setIgnoreOrderChanges(false);
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
    if (isIgnoreOrderChanges()) return;

    const newOrder = changes.snippets_order.newValue || [];
    const oldOrder = changes.snippets_order.oldValue || [];

    if (newOrder.length > oldOrder.length) {
      const newIds = newOrder.filter(id => !oldOrder.includes(id));
      if (newIds.length === 0) return;

      chrome.storage.local
        .get(newIds.map(id => `snip_${id}`))
        .then(async recordsData => {
          const sortedNewIds = newOrder.filter(id => newIds.includes(id));
          // 审计修复 P1-1：实时追加时，按当前 active 标签页 (currentTab) 筛选，防止在「已保存」页签中误入未收藏的新记录
          const matchingIds = filterOrderRecords(sortedNewIds, recordsData, currentTab);
          if (matchingIds.length > 0) {
            newRecordsCount += matchingIds.length;
            const filteredOrder = await getFilteredOrder(currentTab);
            setTotalCount(filteredOrder.length);
            updateRecordInfo(getTotalCount(), currentTab);

            prependNewCards(recordsData, matchingIds, listBridge, () => { incrementLoaded(); });

            $newRecordsHint.textContent = `新增了 ${newRecordsCount} 条记录`;
            $newRecordsHint.classList.remove('hidden');

            clearTimeout(newRecordTimer);
            newRecordTimer = setTimeout(() => {
              $newRecordsHint.classList.add('hidden');
              newRecordsCount = 0;
            }, 3000);
          }
        });
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

  const $tabHome = document.getElementById('tab-home');
  const $tabSaved = document.getElementById('tab-saved');

  const handleTabSwitch = async (tabName) => {
    if (currentTab === tabName) return;
    currentTab = tabName;
    if ($tabHome) {
      $tabHome.classList.toggle('active', tabName === 'home');
      $tabHome.setAttribute('aria-selected', tabName === 'home' ? 'true' : 'false');
    }
    if ($tabSaved) {
      $tabSaved.classList.toggle('active', tabName === 'saved');
      $tabSaved.setAttribute('aria-selected', tabName === 'saved' ? 'true' : 'false');
    }
    if ($btnClear) {
      $btnClear.classList.toggle('hidden', tabName === 'saved');
    }
    await loadFirstPage(listBridge);
  };

  if ($tabHome) $tabHome.addEventListener('click', () => handleTabSwitch('home'));
  if ($tabSaved) $tabSaved.addEventListener('click', () => handleTabSwitch('saved'));

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

  $btnLoadMore.addEventListener('click', () => loadMore(listBridge));
}

// ── 待办 Tab 桥接（v1.0.0） ──
// 把管理页的 showToast / showConfirmModal / showEditModal 暴露给 todo.js 使用，
// 避免 todo.js 直接依赖 manager.js 的内部变量 / 重复实现。
window.__managerBridge = {
  showToast: showToast,
  showConfirm: showConfirmModal,
  showEdit: showEditModal,
};

// ── 采集 tab 下的 toolbar 额外按钮（导出 / 清空）：仅采集 tab 可见 ──
const $collectExtras = document.getElementById('collect-toolbar-extras');
function setCollectExtrasVisible(visible) {
  if (!$collectExtras) return;
  $collectExtras.classList.toggle('hidden', !visible);
}

// ── 顶 Tab 路由：#collect（默认）/ #todo ──
function applyRouteFromHash() {
  const h = (location.hash || '').replace(/^#/, '');
  const isTodo = h.indexOf('todo') === 0;
  const viewCollect = document.getElementById('view-collect');
  const viewTodo = document.getElementById('view-todo');
  const collectToggle = document.getElementById('collect-toggle');
  const toolbarCount = document.getElementById('toolbar-count');

  if (viewCollect) viewCollect.classList.toggle('hidden', isTodo);
  if (viewTodo) viewTodo.classList.toggle('hidden', !isTodo);
  if (collectToggle) {
    // 待办 tab 下置灰，避免误操作影响采集状态
    collectToggle.classList.toggle('is-disabled', isTodo);
    collectToggle.setAttribute('aria-disabled', isTodo ? 'true' : 'false');
  }
  // 采集数据条数仅在采集 tab 下展示；待办 tab 下的总览在侧边栏的徽标
  if (toolbarCount) toolbarCount.classList.toggle('hidden', isTodo);
  setCollectExtrasVisible(!isTodo);
}

window.addEventListener('hashchange', applyRouteFromHash);

// 启动：任何一步抛错都展示错误态，避免白屏
init().catch(err => {
  console.error('[text-collector] init failed:', err);
  renderLoadError();
}).then(() => {
  // 默认进采集 tab（URL hash 不强制写入，保留 history 干净；
  // applyRouteFromHash 自带默认逻辑：hash 为空视为 #collect）
  applyRouteFromHash();
  // 启动待办模块
  if (window.TodoApp && typeof window.TodoApp.init === 'function') {
    window.TodoApp.init().catch(err => {
      console.error('[text-collector] todo init failed:', err);
    });
  }
});
