/**
 * render.js — 管理页列表渲染（卡片创建、分页加载、计数显示、删除/撤销）
 *
 * 从原 manager.js 拆分而来：
 *   createCard L165-232 / deleteRecord L235-301 / copyToClipboard L304-313
 *   applyTruncationCheck L125-135 / loadFirstPage L66-70 / loadMore L72-107
 *   updateRecordInfo L112-119，另含为 onChanged / init 错误态新增的两个渲染辅助
 *   （prependNewCards / renderLoadError，见下文对应说明）。
 *
 * 状态约定：currentOffset / totalCount / isLoading 等可变状态全部保留在
 * manager.js，本文件通过函数参数传入的 bridge 读写（getLoadedCount /
 * getTotalCount / getLoading 等 getter，incrementLoaded / decrementLoaded /
 * resetLoaded / setTotalCount / incrementTotal / decrementTotal / setLoading /
 * setIgnoreOrderChanges 等 setter），不在文件间共享可变变量。
 * 创建卡片时用 textContent 渲染采集文本（内容来自任意网页，禁止 innerHTML）。
 */

// ── DOM（列表渲染相关） ──
const $list = document.getElementById('list');
const $emptyState = document.getElementById('empty-state');
const $pageSub = document.getElementById('page-sub');
const $toolbarCount = document.getElementById('toolbar-count');
const $loadMore = document.getElementById('load-more');
const $storageWarning = document.getElementById('storage-warning');

// 与 storage.js 的 CONFIG.PAGE_SIZE 保持一致（分页大小）
const PAGE_SIZE = CONFIG.PAGE_SIZE;

// ── 列表加载 ──
async function loadFirstPage(bridge) {
  bridge.resetLoaded();
  $list.innerHTML = '';
  await loadMore(bridge);
}

async function loadMore(bridge) {
  if (bridge.getLoading()) return;
  bridge.setLoading(true);
  try {
    const filter = bridge && typeof bridge.getCurrentTab === 'function' ? bridge.getCurrentTab() : 'home';
    const { records, total } = await getSnippets(bridge.getLoadedCount(), PAGE_SIZE, filter);
    bridge.setTotalCount(total);
    bridge.incrementLoaded(records.length);

    if (records.length === 0 && bridge.getLoadedCount() === 0) {
      const emptyTitle = document.getElementById('empty-title');
      const emptySub = document.getElementById('empty-sub');
      if (emptyTitle && emptySub) {
        if (filter === 'saved') {
          emptyTitle.textContent = '还没有已保存的笔记';
          emptySub.textContent = '点击每条笔记卡片左侧的书签图标 🔖，即可将其保存到这里。';
        } else {
          emptyTitle.textContent = '还没有采集记录';
          emptySub.textContent = '去任意网页上选中一段文字，500ms 后会自动保存到这里。';
        }
      }
      $emptyState.classList.remove('hidden');
      $loadMore.classList.add('hidden');
    } else {
      $emptyState.classList.add('hidden');
      for (const record of records) {
        const card = createCard(record, bridge);
        $list.appendChild(card);
        applyTruncationCheck(card);
      }
    }

    if (bridge.getLoadedCount() < bridge.getTotalCount()) {
      $loadMore.classList.remove('hidden');
    } else {
      $loadMore.classList.add('hidden');
    }

    await updateRecordInfo(bridge.getTotalCount(), filter);

    if (bridge.getTotalCount() > CONFIG.STORAGE_WARNING_THRESHOLD) {
      $storageWarning.classList.remove('hidden');
    } else {
      $storageWarning.classList.add('hidden');
    }
  } catch (err) {
    console.error('[text-collector] loadMore failed:', err);
    showToast('加载失败，请重试', { kind: 'danger' });
    // 保持当前已加载的列表可见，不清空；用户可再次点击“加载更多”重试
  } finally {
    bridge.setLoading(false);
  }
}

// ── 计数显示 ──
// 页面大标题下显示完整描述（条数 / 占用 KB / 排序方式），
// 顶部 brand 旁显示极简等宽条数，滚动列表时也能看到。
async function updateRecordInfo(totalCount, filter = 'home') {
  const sizeKB = await getStorageEstimate(filter);
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

/**
 * 创建一张记录卡片。
 * 点击卡片文本 → 复制；点击「展开/收起」→ 切换截断；点击垃圾桶 → 删除。
 * 所有采集文本通过 textContent 渲染，防止 XSS。
 * 卡片本身可键盘聚焦（tabindex=0），Enter/Space 触发复制，保持与鼠标一致。
 * P2 修复：卡片不再使用 role=button（避免 button 内嵌 button 的 a11y 嵌套违规），
 * 改为 role=group（语义为“一条记录分组”），内含的文本/展开/删除仍为可交互元素。
 * @param {object} record
 * @param {object} bridge - manager.js 传入的状态读写回调（透传给 deleteRecord）
 */
function createCard(record, bridge) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = record.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', '采集记录：' + record.text.slice(0, 30) + (record.text.length > 30 ? '…' : ''));

  const copyText = () => {
    copyToClipboard(record.text);
    card.classList.add('card-copied');
    setTimeout(() => card.classList.remove('card-copied'), 500);
    showToast('已复制', { kind: 'success' });
  };

  // 1. 左侧收藏按钮（位于卡片左侧品牌缩进位置）
  const favoriteBtn = document.createElement('button');
  favoriteBtn.type = 'button';
  favoriteBtn.className = 'card-favorite' + (record.saved ? ' active' : '');
  favoriteBtn.title = record.saved ? '已保存（点击取消收藏）' : '收藏到“已保存”';
  favoriteBtn.setAttribute('aria-label', record.saved ? '取消收藏' : '收藏这条笔记');
  favoriteBtn.innerHTML = record.saved ? ICON_BOOKMARK_SOLID : ICON_BOOKMARK_OUTLINE;
  favoriteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const res = await toggleFavoriteSnippet(record.id);
    if (res && res.record) {
      record.saved = res.record.saved;
    } else {
      record.saved = false;
    }
    const isSaved = !!record.saved;
    favoriteBtn.classList.toggle('active', isSaved);
    favoriteBtn.title = isSaved ? '已保存（点击取消收藏）' : '收藏到“已保存”';
    favoriteBtn.setAttribute('aria-label', isSaved ? '取消收藏' : '收藏这条笔记');
    favoriteBtn.innerHTML = isSaved ? ICON_BOOKMARK_SOLID : ICON_BOOKMARK_OUTLINE;
    showToast(isSaved ? '已添加到“已保存”' : '已取消收藏', { kind: isSaved ? 'success' : 'info' });

    const currentTab = bridge && typeof bridge.getCurrentTab === 'function' ? bridge.getCurrentTab() : 'home';
    if (currentTab === 'saved' && !isSaved) {
      card.style.transition = 'opacity .18s ease, transform .18s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateX(-12px)';
      setTimeout(() => {
        card.remove();
        bridge.decrementTotal();
        bridge.decrementLoaded();
        updateRecordInfo(bridge.getTotalCount(), currentTab);
        if (bridge.getTotalCount() === 0) {
          const emptyTitle = document.getElementById('empty-title');
          const emptySub = document.getElementById('empty-sub');
          if (emptyTitle && emptySub) {
            emptyTitle.textContent = '还没有已保存的笔记';
            emptySub.textContent = '点击每条笔记卡片左侧的书签图标 🔖，即可将其保存到这里。';
          }
          $emptyState.classList.remove('hidden');
          $loadMore.classList.add('hidden');
        }
      }, 180);
    }
  });
  card.appendChild(favoriteBtn);

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
    deleteRecord(record, card, bridge);
  });
  card.appendChild(deleteBtn);

  // 2. 针对已保存的笔记（或“已保存”页面中），新增“复制”与“编辑”按钮（需求 5）
  const isSavedTab = bridge && typeof bridge.getCurrentTab === 'function' && bridge.getCurrentTab() === 'saved';
  if (record.saved || isSavedTab) {
    const actionsEl = document.createElement('div');
    actionsEl.className = 'card-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-card-action btn-copy';
    copyBtn.title = '复制笔记内容到剪贴板';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyText();
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-card-action btn-edit';
    editBtn.title = '编辑已保存的笔记';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showEditModal('编辑已保存的笔记', record.text, async (newText) => {
        const trimmed = newText.trim();
        if (!trimmed) {
          showToast('笔记内容不能为空', { kind: 'danger' });
          return;
        }
        if (trimmed === record.text) return;

        record.text = trimmed;
        record.updatedAt = Date.now();
        await updateSnippetText(record.id, trimmed);

        textEl.textContent = trimmed;
        applyTruncationCheck(card);
        showToast('已保存修改', { kind: 'success' });
      });
    });

    actionsEl.appendChild(copyBtn);
    actionsEl.appendChild(editBtn);
    card.appendChild(actionsEl);
  }

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
async function deleteRecord(record, card, bridge) {
  const isSavedTab = bridge && typeof bridge.getCurrentTab === 'function' && bridge.getCurrentTab() === 'saved';
  // 需求 4：保存的笔记删除时增加一步确认
  if (record.saved || isSavedTab) {
    showConfirmModal(
      '确认删除',
      '确定要彻底删除这条已保存的笔记吗？此操作将永久删除该笔记。',
      () => {
        performDeleteRecord(record, card, bridge);
      }
    );
    return;
  }
  await performDeleteRecord(record, card, bridge);
}

async function performDeleteRecord(record, card, bridge) {
  const { getTotalCount, getLoadedCount, incrementTotal, decrementTotal, decrementLoaded, incrementLoaded, setIgnoreOrderChanges } = bridge;
  const recordCopy = { ...record };
  const nextSibling = card.nextSibling;
  const parent = card.parentNode;

  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  const originalIndex = order.indexOf(record.id);

  const filter = bridge && typeof bridge.getCurrentTab === 'function' ? bridge.getCurrentTab() : 'home';

  card.style.transition = 'opacity .18s ease, transform .18s ease';
  card.style.opacity = '0';
  card.style.transform = 'translateX(-12px)';

  setTimeout(() => {
    card.remove();
    decrementTotal();  // totalCount = max(0, totalCount - 1)
    decrementLoaded(); // 已加载窗口收缩 1，避免后续 loadMore 从错误 offset 起读导致漏条/重条
    updateRecordInfo(getTotalCount(), filter);
    if (getTotalCount() === 0) {
      $emptyState.classList.remove('hidden');
      $loadMore.classList.add('hidden');
    } else if (getLoadedCount() < getTotalCount()) {
      $loadMore.classList.remove('hidden');
    }
  }, 180);

  await deleteSnippet(record.id);

  showToast('已删除', {
    kind: 'info',
    actionText: '撤销',
    onAction: async () => {
      setIgnoreOrderChanges(true);
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

        const restoredCard = createCard(recordCopy, bridge);
        if (parent) {
          $emptyState.classList.add('hidden');
          if (nextSibling && nextSibling.parentNode === parent) {
            parent.insertBefore(restoredCard, nextSibling);
          } else {
            parent.appendChild(restoredCard);
          }
          applyTruncationCheck(restoredCard);
        }
        incrementTotal(); // totalCount + 1
        // P1 修复：撤销后已加载数也要同步递增，否则下次 loadMore 会以错误 offset 起读导致重复/漏条
        incrementLoaded();
        // 若撤销前是空状态，撤销后需隐藏空状态并根据总数决定是否显示“加载更多”
        if (getLoadedCount() < getTotalCount()) {
          $loadMore.classList.remove('hidden');
        }
        await updateRecordInfo(getTotalCount(), filter);
        showToast('已恢复', { kind: 'success' });
      } finally {
        setIgnoreOrderChanges(false);
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

/**
 * 把 storage 实时新增的记录按序 prepend 到列表头部（onChanged 使用）。
 * 原 onChanged 中的内联 DOM 操作迁移到此，使列表 DOM 只在本文件内被修改。
 * @param {object} recordsData chrome.storage.local.get 的返回（snip_<id> → record）
 * @param {string[]} sortedNewIds 按新 order 排序的新增 id 列表
 * @param {object} bridge 状态读写回调（透传给 createCard）
 * @param {Function} [onInserted] 每成功插入一张卡片后回调（manager.js 用它递增 currentOffset）
 */
function prependNewCards(recordsData, sortedNewIds, bridge, onInserted) {
  $emptyState.classList.add('hidden');
  // newOrder 中越靠前越新；从后往前 prepend，保证最终顺序最新在顶部
  for (let i = sortedNewIds.length - 1; i >= 0; i--) {
    const id = sortedNewIds[i];
    const record = recordsData[`snip_${id}`];
    if (record) {
      const newCard = createCard(record, bridge);
      $list.insertBefore(newCard, $list.firstChild);
      applyTruncationCheck(newCard);
      if (onInserted) onInserted();
    }
  }
}

/**
 * 启动失败时的错误态渲染（init().catch 使用）。
 * 原 init().catch 中的内联 DOM 操作迁移到此。
 */
function renderLoadError() {
  $list.innerHTML = '';
  $emptyState.classList.remove('hidden');
  const titleEl = $emptyState.querySelector('.empty-title');
  const subEl = $emptyState.querySelector('.empty-sub');
  if (titleEl) titleEl.textContent = '加载失败';
  if (subEl) {
    subEl.textContent = '本地存储读取异常。请尝试重启浏览器；如持续出现，可在 chrome://extensions 重新加载扩展。';
  }
}
