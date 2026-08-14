/**
 * todo.js — 待办模块主逻辑（v1.0.0）
 *
 * 在 manager.html 顶部 Tab 切换至「待办」时显示；与采集模块共用同一页面。
 *
 * 职责：
 *  - 初始化：挂载 DOM、加载数据、绑事件、响应 hashchange
 *  - 视图路由：list / all / done / templates 四视图
 *  - 渲染：侧边栏（清单列表 + 导航）+ 主内容区
 *  - 操作：清单 CRUD（创建/重命名/删除）、待办项 CRUD（添加/勾选/删除/编辑/拖拽）、
 *          模板操作（存为模板/使用模板/复制到清单/删除）
 *  - 实时同步：监听 chrome.storage.onChanged（todo_ 前缀键）重新渲染
 *
 * 边界（严格遵守）：
 *  - 不直接读写 chrome.storage.local，全部经 window.TodoStorage
 *  - 不直接操作 toast / 弹窗 DOM，全部经 window.__managerBridge
 *    （manager.js 在自己的 init 末尾挂载）
 *  - 所有用户内容（清单名、待办内容、模板名）必须 textContent 渲染，禁止 innerHTML
 *
 * 状态：state 对象持有当前视图、当前清单、缓存数据；模块内私有。
 */

(function () {
  'use strict';

  // ── 状态 ──
  const state = {
    currentView: 'list',         // 'list' | 'all' | 'done' | 'templates'
    currentListId: null,         // currentView === 'list' 时有效
    lists: [],                   // TodoList[]
    itemsByList: new Map(),      // listId -> TodoItem[]
    templates: [],               // Template[]
    showCompleted: true,         // 工作台"已完成"区是否折叠
    isReady: false,
    storageListenerBound: false,
  };

  // ── 工具 ──

  function genId() {
    return window.TodoStorage.generateId();
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/"/g, '&quot;');
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() &&
                    d.getMonth() === now.getMonth() &&
                    d.getDate() === now.getDate();
    if (sameDay) {
      return '今天 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const yest = y.getFullYear() === d.getFullYear() &&
                 y.getMonth() === d.getMonth() &&
                 y.getDate() === d.getDate();
    if (yest) {
      return '昨天 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function debounce(fn, delay) {
    let timer = null;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(ctx, args), delay);
    };
  }

  function $(id) { return document.getElementById(id); }

  /** bridge：访问 manager.js 暴露的 toast/confirm/edit；不存在时降级为 noop */
  function bridge() {
    return window.__managerBridge || {
      showToast: function (m, opts) { console.log('[toast]', m, opts || {}); },
      showConfirm: function (t, b, onOk) { if (window.confirm(t + '\n' + b)) onOk(); },
      showEdit: function (t, init, onSave) {
        const v = window.prompt(t, init || '');
        if (v != null) onSave(v);
      },
    };
  }

  // ── 渲染：侧边栏 ──

  function renderSidebar() {
    const container = $('todo-list-container');
    if (!container) return;
    container.textContent = '';

    // 列表项
    state.lists.forEach(list => {
      const items = state.itemsByList.get(list.id) || [];
      const uncompleted = items.filter(it => !it.completed).length;

      const li = document.createElement('div');
      li.className = 'todo-list-item';
      li.dataset.listId = list.id;
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      if (state.currentView === 'list' && state.currentListId === list.id) {
        li.classList.add('active');
      }
      li.setAttribute('aria-current',
        state.currentView === 'list' && state.currentListId === list.id ? 'true' : 'false');

      const name = document.createElement('span');
      name.className = 'todo-list-item-name';
      name.textContent = list.name;
      name.title = list.name;
      name.dataset.role = 'list-name';
      li.appendChild(name);

      const count = document.createElement('span');
      count.className = 'todo-list-item-count';
      count.textContent = String(uncompleted);
      li.appendChild(count);

      // 删除按钮（hover 显示）
      const del = document.createElement('button');
      del.className = 'todo-list-item-delete';
      del.type = 'button';
      del.setAttribute('aria-label', '删除清单 ' + list.name);
      del.dataset.role = 'list-delete';
      del.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
        '<path d="M3 4h10M6.5 4V2.5h3V4M5 6.5v5m6-5v5M4 4l.6 8.5a1 1 0 001 .9h4.8a1 1 0 001-.9L12 4"' +
        ' stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      li.appendChild(del);

      container.appendChild(li);
    });

    // 导航项激活态
    setNavActive('todo-nav-all', state.currentView === 'all');
    setNavActive('todo-nav-done', state.currentView === 'done');
    setNavActive('todo-nav-templates', state.currentView === 'templates');

    // 徽标
    const totals = computeTotals();
    setBadge('todo-badge-all', totals.uncompleted);
    setBadge('todo-badge-done', totals.completed);
    setBadge('todo-badge-templates', state.templates.length);
  }

  function setNavActive(id, active) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle('active', active);
    el.setAttribute('aria-current', active ? 'true' : 'false');
  }
  function setBadge(id, n) {
    const el = $(id);
    if (!el) return;
    el.textContent = n > 0 ? String(n) : '';
  }

  function computeTotals() {
    let uncompleted = 0, completed = 0;
    state.itemsByList.forEach(items => {
      items.forEach(it => { it.completed ? completed++ : uncompleted++; });
    });
    return { uncompleted, completed };
  }

  // ── 渲染：主内容区 ──

  function renderContent() {
    const main = $('todo-content-inner');
    if (!main) return;
    main.textContent = '';

    if (state.currentView === 'list') {
      renderListView(main);
    } else if (state.currentView === 'all') {
      renderAllView(main);
    } else if (state.currentView === 'done') {
      renderDoneView(main);
    } else if (state.currentView === 'templates') {
      renderTemplatesView(main);
    }
  }

  function renderListView(main) {
    const list = currentList();
    if (!list) {
      main.appendChild(renderEmptyListState());
      return;
    }
    const items = state.itemsByList.get(list.id) || [];
    const uncompleted = items.filter(it => !it.completed);
    const completed = items.filter(it => it.completed);

    // 标题区
    const head = document.createElement('div');
    head.className = 'todo-view-head';

    const titleRow = document.createElement('div');
    titleRow.className = 'todo-view-title';
    const titleEl = document.createElement('span');
    titleEl.textContent = list.name;
    titleEl.dataset.role = 'list-title';
    titleEl.setAttribute('tabindex', '0');
    titleEl.setAttribute('aria-label', '清单名称，双击编辑');
    titleRow.appendChild(titleEl);
    if (items.length > 0) {
      const prog = document.createElement('span');
      prog.className = 'todo-progress' + (completed.length === items.length ? ' is-done' : '');
      prog.textContent = completed.length + ' / ' + items.length;
      titleRow.appendChild(prog);
    }
    head.appendChild(titleRow);

    const sub = document.createElement('p');
    sub.className = 'todo-view-sub';
    sub.textContent = '共 ' + items.length + ' 条 · 完成后自动沉底';
    head.appendChild(sub);

    // 操作按钮
    const actions = document.createElement('div');
    actions.className = 'todo-view-actions';
    actions.appendChild(makeBtn('存为模板', 'btn', () => onSaveAsTemplate(list)));
    actions.appendChild(makeBtn('删除清单', 'btn btn-danger', () => onDeleteList(list)));
    head.appendChild(actions);
    main.appendChild(head);

    // 添加项
    const addForm = document.createElement('form');
    addForm.className = 'todo-add-form';
    addForm.dataset.listId = list.id;
    addForm.setAttribute('aria-label', '添加待办');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '添加一条待办，回车保存';
    input.maxLength = 500;
    input.dataset.role = 'add-item-input';
    addForm.appendChild(input);
    const addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.disabled = true;
    addBtn.setAttribute('aria-label', '添加');
    addBtn.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    addForm.appendChild(addBtn);
    main.appendChild(addForm);

    // 未完成区
    if (uncompleted.length > 0) {
      main.appendChild(makeSectionLabel('未完成 ' + uncompleted.length, null));
      const ul = makeItemList(list.id, uncompleted, /*draggable*/ true);
      main.appendChild(ul);
    }

    // 已完成区（可折叠）
    if (completed.length > 0) {
      const doneHead = makeSectionLabel(
        '已完成 ' + completed.length,
        state.showCompleted ? 'collapse' : 'expand'
      );
      main.appendChild(doneHead);
      const doneList = makeItemList(list.id, completed, /*draggable*/ false);
      doneList.classList.add('todo-section-done-list');
      if (!state.showCompleted) doneList.style.display = 'none';
      main.appendChild(doneList);
    }

    // 空状态
    if (uncompleted.length === 0 && completed.length === 0) {
      const tip = document.createElement('p');
      tip.className = 'todo-view-sub';
      tip.style.marginTop = '8px';
      tip.style.color = 'var(--text-dim)';
      tip.textContent = '还没有待办，从上面的输入框开始添加吧';
      main.appendChild(tip);
    }

    // 自动聚焦到输入框
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 0);
  }

  function makeSectionLabel(text, toggleKind) {
    const wrap = document.createElement('div');
    wrap.className = 'todo-section-label';
    if (toggleKind) {
      const btn = document.createElement('button');
      btn.className = 'todo-section-toggle';
      btn.type = 'button';
      btn.setAttribute('aria-expanded', toggleKind === 'collapse' ? 'true' : 'false');
      const arrow = toggleKind === 'collapse' ? '▾' : '▸';
      btn.textContent = text + '  ' + arrow;
      btn.addEventListener('click', () => {
        state.showCompleted = !state.showCompleted;
        renderContent();
      });
      wrap.appendChild(btn);
    } else {
      wrap.textContent = text;
    }
    return wrap;
  }

  function makeItemList(listId, items, draggable) {
    const ul = document.createElement('ul');
    ul.className = 'todo-items';
    ul.dataset.listId = listId;
    items.forEach(it => ul.appendChild(makeItemEl(it, draggable)));
    return ul;
  }

  function makeItemEl(item, draggable) {
    const li = document.createElement('li');
    li.className = 'todo-item' + (item.completed ? ' is-done' : '');
    li.dataset.itemId = item.id;
    li.setAttribute('role', 'listitem');

    // 复选框
    const check = document.createElement('div');
    check.className = 'todo-check' + (item.completed ? ' is-checked' : '');
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', item.completed ? 'true' : 'false');
    check.setAttribute('aria-label', item.completed ? '标记为未完成' : '标记为已完成');
    check.tabIndex = 0;
    li.appendChild(check);

    // 内容
    const text = document.createElement('div');
    text.className = 'todo-item-text';
    text.textContent = item.content;
    text.setAttribute('tabindex', '0');
    text.dataset.role = 'item-text';
    text.setAttribute('aria-label', '双击编辑');
    li.appendChild(text);

    // 拖拽手柄（仅未完成项）
    if (draggable && !item.completed) {
      const handle = document.createElement('div');
      handle.className = 'todo-item-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.title = '拖动排序';
      handle.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none">' +
        '<circle cx="5" cy="4" r="1.1" fill="currentColor"/>' +
        '<circle cx="11" cy="4" r="1.1" fill="currentColor"/>' +
        '<circle cx="5" cy="8" r="1.1" fill="currentColor"/>' +
        '<circle cx="11" cy="8" r="1.1" fill="currentColor"/>' +
        '<circle cx="5" cy="12" r="1.1" fill="currentColor"/>' +
        '<circle cx="11" cy="12" r="1.1" fill="currentColor"/></svg>';
      handle.draggable = true;
      handle.dataset.role = 'item-handle';
      li.appendChild(handle);
    }

    // 删除按钮
    const del = document.createElement('button');
    del.className = 'todo-item-delete';
    del.type = 'button';
    del.setAttribute('aria-label', '删除待办');
    del.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M3 4h10M6.5 4V2.5h3V4M5 6.5v5m6-5v5M4 4l.6 8.5a1 1 0 001 .9h4.8a1 1 0 001-.9L12 4"' +
      ' stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    li.appendChild(del);

    return li;
  }

  function makeBtn(text, cls, onClick) {
    const b = document.createElement('button');
    b.className = cls;
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderEmptyListState() {
    const wrap = document.createElement('div');
    wrap.className = 'todo-empty';
    const t = document.createElement('p');
    t.className = 'todo-empty-title';
    t.textContent = '还没有清单';
    const s = document.createElement('p');
    s.className = 'todo-empty-sub';
    s.textContent = '点击左侧「+ 新建清单」开始；或先在侧边栏选一个现有清单。';
    wrap.appendChild(t);
    wrap.appendChild(s);
    return wrap;
  }

  // ── 全部待办 ──
  function renderAllView(main) {
    const head = makeViewHead('全部待办', '汇总所有清单下的未完成事项');
    main.appendChild(head);

    const groups = state.lists.map(l => {
      const items = (state.itemsByList.get(l.id) || []).filter(it => !it.completed);
      return { list: l, items: items };
    }).filter(g => g.items.length > 0);

    if (groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'todo-empty';
      empty.innerHTML = '<p class="todo-empty-title">暂无未完成事项</p>' +
        '<p class="todo-empty-sub">所有清单都已清空，回工作台添加新待办吧。</p>';
      main.appendChild(empty);
      return;
    }

    const total = groups.reduce((s, g) => s + g.items.length, 0);
    head.querySelector('.todo-view-sub').textContent = '共 ' + total + ' 条未完成事项';
    groups.forEach(g => main.appendChild(renderSummaryGroup(g, /*showDoneTime*/ false)));
  }

  // ── 已完成 ──
  function renderDoneView(main) {
    const head = makeViewHead('已完成', '汇总所有清单下的已完成事项，点击可恢复为未完成');
    main.appendChild(head);

    const groups = state.lists.map(l => {
      const items = (state.itemsByList.get(l.id) || []).filter(it => it.completed);
      return { list: l, items: items };
    }).filter(g => g.items.length > 0);

    if (groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'todo-empty';
      empty.innerHTML = '<p class="todo-empty-title">还没有已完成事项</p>' +
        '<p class="todo-empty-sub">勾选任意待办后会自动归到这里。</p>';
      main.appendChild(empty);
      return;
    }

    const total = groups.reduce((s, g) => s + g.items.length, 0);
    head.querySelector('.todo-view-sub').textContent = '共 ' + total + ' 条已完成事项';
    groups.forEach(g => main.appendChild(renderSummaryGroup(g, /*showDoneTime*/ true)));
  }

  function makeViewHead(title, sub) {
    const head = document.createElement('div');
    head.className = 'todo-view-head';
    const t = document.createElement('h2');
    t.className = 'todo-view-title';
    t.textContent = title;
    head.appendChild(t);
    const s = document.createElement('p');
    s.className = 'todo-view-sub';
    s.textContent = sub;
    head.appendChild(s);
    return head;
  }

  function renderSummaryGroup(group, showDoneTime) {
    const wrap = document.createElement('div');
    wrap.className = 'todo-summary-group';

    const head = document.createElement('div');
    head.className = 'todo-summary-group-head';
    const nm = document.createElement('span');
    nm.className = 'todo-summary-group-name';
    nm.textContent = group.list.name;
    head.appendChild(nm);
    const ct = document.createElement('span');
    ct.className = 'todo-summary-group-count';
    ct.textContent = String(group.items.length);
    head.appendChild(ct);
    wrap.appendChild(head);

    const ul = document.createElement('ul');
    ul.className = 'todo-items';
    ul.dataset.listId = group.list.id;
    group.items.forEach(it => {
      const li = makeItemEl(it, /*draggable*/ false);
      // 已完成视图：在文本后追加完成时间
      if (showDoneTime && it.completedAt) {
        const ts = document.createElement('span');
        ts.style.marginLeft = '8px';
        ts.style.fontFamily = 'var(--mono)';
        ts.style.fontSize = '11px';
        ts.style.color = 'var(--text-dim)';
        ts.textContent = '(' + formatTime(it.completedAt) + ')';
        // 插到 text 后面、handle 之前
        const textEl = li.querySelector('.todo-item-text');
        textEl.parentNode.insertBefore(ts, textEl.nextSibling);
      }
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  // ── 模板库 ──
  function renderTemplatesView(main) {
    const head = makeViewHead('模板库',
      state.templates.length > 0
        ? '点击「使用该模板」可基于模板创建新清单'
        : '把任意清单存为模板，就能反复使用');
    main.appendChild(head);

    if (state.templates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'todo-empty';
      empty.innerHTML = '<p class="todo-empty-title">还没有模板</p>' +
        '<p class="todo-empty-sub">从任意清单顶部点「存为模板」开始。</p>';
      main.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'todo-template-grid';
    state.templates.forEach(t => grid.appendChild(makeTemplateCard(t)));
    main.appendChild(grid);
  }

  function makeTemplateCard(t) {
    const card = document.createElement('div');
    card.className = 'todo-template-card';
    card.dataset.templateId = t.id;

    const name = document.createElement('div');
    name.className = 'todo-template-card-name';
    name.textContent = t.name;
    name.title = t.name;
    card.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'todo-template-card-meta';
    const n = t.items.length;
    meta.textContent = n + ' 个待办 · 更新于 ' + formatTime(t.updatedAt);
    card.appendChild(meta);

    if (t.items.length > 0) {
      const preview = document.createElement('ul');
      preview.className = 'todo-template-card-preview';
      t.items.slice(0, 5).forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        preview.appendChild(li);
      });
      card.appendChild(preview);
    }

    const del = document.createElement('button');
    del.className = 'todo-template-card-delete';
    del.type = 'button';
    del.setAttribute('aria-label', '删除模板 ' + t.name);
    del.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M3 4h10M6.5 4V2.5h3V4M5 6.5v5m6-5v5M4 4l.6 8.5a1 1 0 001 .9h4.8a1 1 0 001-.9L12 4"' +
      ' stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    card.appendChild(del);

    const actions = document.createElement('div');
    actions.className = 'todo-template-card-actions';
    const useBtn = makeBtn('使用该模板', 'btn btn-primary', () => onUseTemplate(t));
    const copyBtn = makeBtn('复制到当前清单', 'btn',
      () => onCopyTemplateToCurrentList(t));
    actions.appendChild(useBtn);
    actions.appendChild(copyBtn);
    card.appendChild(actions);

    return card;
  }

  // ── 操作：清单 ──

  function currentList() {
    if (!state.currentListId) return null;
    return state.lists.find(l => l.id === state.currentListId) || null;
  }

  async function onCreateList() {
    try {
      const list = await window.TodoStorage.createList('未命名清单');
      await refreshAll();
      state.currentListId = list.id;
      writeHash();
      renderSidebar();
      renderContent();
      // 自动进入重命名态
      setTimeout(() => startRenameList(list.id), 30);
    } catch (err) {
      console.error('[todo] createList failed:', err);
      bridge().showToast('创建清单失败：' + (err.message || err), { kind: 'danger' });
    }
  }

  function startRenameList(listId) {
    const el = document.querySelector(
      '.todo-list-item[data-list-id="' + cssEscape(listId) + '"] ' +
      '.todo-list-item-name');
    if (!el) return;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    // 全选
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = async (commit) => {
      el.removeAttribute('contenteditable');
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      if (!commit) {
        // 取消：恢复显示
        const lst = state.lists.find(l => l.id === listId);
        if (lst) el.textContent = lst.name;
        return;
      }
      const newName = (el.textContent || '').trim();
      if (!newName) {
        const lst = state.lists.find(l => l.id === listId);
        if (lst) el.textContent = lst.name;
        return;
      }
      try {
        await window.TodoStorage.renameList(listId, newName);
        await refreshAll();
        // 若当前在工作台视图，标题也要更新
        if (state.currentView === 'list' && state.currentListId === listId) {
          renderContent();
        } else {
          renderSidebar();
        }
      } catch (err) {
        console.error('[todo] renameList failed:', err);
        bridge().showToast('重命名失败：' + (err.message || err), { kind: 'danger' });
      }
    };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
  }

  function onDeleteList(list) {
    bridge().showConfirm(
      '删除清单',
      '确定删除「' + list.name + '」及其下所有待办？此操作不可撤销。',
      async () => {
        try {
          await window.TodoStorage.deleteList(list.id);
          // 若删除的是当前工作台清单，切到"全部待办"
          if (state.currentListId === list.id) {
            state.currentListId = null;
            state.currentView = 'all';
          }
          await refreshAll();
          writeHash();
          renderSidebar();
          renderContent();
          bridge().showToast('已删除清单', { kind: 'success' });
        } catch (err) {
          console.error('[todo] deleteList failed:', err);
          bridge().showToast('删除失败：' + (err.message || err), { kind: 'danger' });
        }
      }
    );
  }

  // ── 操作：待办项 ──

  async function onAddItem(listId, text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    try {
      await window.TodoStorage.addItem(listId, trimmed);
      await refreshAll();
      renderSidebar();
      renderContent();
    } catch (err) {
      console.error('[todo] addItem failed:', err);
      bridge().showToast('添加失败：' + (err.message || err), { kind: 'danger' });
    }
  }

  async function onToggleItem(listId, itemId) {
    try {
      await window.TodoStorage.toggleItem(listId, itemId);
      await refreshAll();
      renderSidebar();
      renderContent();
    } catch (err) {
      console.error('[todo] toggleItem failed:', err);
      bridge().showToast('操作失败：' + (err.message || err), { kind: 'danger' });
    }
  }

  async function onDeleteItem(listId, itemId) {
    try {
      await window.TodoStorage.deleteItem(listId, itemId);
      await refreshAll();
      renderSidebar();
      renderContent();
    } catch (err) {
      console.error('[todo] deleteItem failed:', err);
      bridge().showToast('删除失败：' + (err.message || err), { kind: 'danger' });
    }
  }

  function startEditItem(listId, itemId) {
    const li = document.querySelector(
      '.todo-item[data-item-id="' + cssEscape(itemId) + '"]');
    if (!li) return;
    const text = li.querySelector('.todo-item-text');
    if (!text) return;
    text.setAttribute('contenteditable', 'true');
    text.focus();
    const range = document.createRange();
    range.selectNodeContents(text);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = async (commit) => {
      text.removeAttribute('contenteditable');
      text.removeEventListener('keydown', onKey);
      text.removeEventListener('blur', onBlur);
      if (!commit) {
        // 取消：从 state 拿原文
        const items = state.itemsByList.get(listId) || [];
        const it = items.find(x => x.id === itemId);
        if (it) text.textContent = it.content;
        return;
      }
      const newText = (text.textContent || '').trim();
      const items = state.itemsByList.get(listId) || [];
      const it = items.find(x => x.id === itemId);
      if (!it) return;
      if (!newText) {
        // 空：当作删除
        try {
          await window.TodoStorage.deleteItem(listId, itemId);
          await refreshAll();
          renderSidebar();
          renderContent();
        } catch (err) { /* swallow */ }
        return;
      }
      if (newText === it.content) return; // 无变化
      try {
        // 直接整存改一条，避免在 storage 层加 updateItem
        const updated = items.map(x => x.id === itemId
          ? Object.assign({}, x, { content: newText })
          : x);
        await window.TodoStorage.saveItems(listId, updated);
        await refreshAll();
        renderSidebar();
        renderContent();
      } catch (err) {
        console.error('[todo] updateItem failed:', err);
        bridge().showToast('保存失败：' + (err.message || err), { kind: 'danger' });
      }
    };
    const onKey = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    text.addEventListener('keydown', onKey);
    text.addEventListener('blur', onBlur);
  }

  // ── 拖拽排序（仅未完成项） ──

  let dragSrcId = null;
  let dragListId = null;

  function onDragStart(e) {
    const li = e.target.closest('.todo-item');
    if (!li) return;
    const handle = e.target.closest('.todo-item-handle');
    if (!handle) {
      // 防止误拖：仅手柄可拖
      e.preventDefault();
      return;
    }
    dragSrcId = li.dataset.itemId;
    dragListId = li.closest('.todo-items').dataset.listId;
    li.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragSrcId); } catch (_) {}
  }
  function onDragOver(e) {
    if (!dragSrcId) return;
    const li = e.target.closest('.todo-item');
    if (!li) return;
    const ul = li.closest('.todo-items');
    if (!ul || ul.dataset.listId !== dragListId) return;
    if (li.dataset.itemId === dragSrcId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // 视觉提示
    document.querySelectorAll('.todo-item-drop-above')
      .forEach(el => el.classList.remove('todo-item-drop-above'));
    li.classList.add('todo-item-drop-above');
  }
  function onDragLeave(e) {
    const li = e.target.closest('.todo-item');
    if (li) li.classList.remove('todo-item-drop-above');
  }
  async function onDrop(e) {
    e.preventDefault();
    document.querySelectorAll('.todo-item-drop-above')
      .forEach(el => el.classList.remove('todo-item-drop-above'));
    if (!dragSrcId) return;
    const li = e.target.closest('.todo-item');
    if (!li || li.dataset.itemId === dragSrcId) {
      dragSrcId = null; dragListId = null;
      return;
    }
    const targetId = li.dataset.itemId;
    const listId = dragListId;
    const items = (state.itemsByList.get(listId) || []).slice();
    const srcIdx = items.findIndex(x => x.id === dragSrcId);
    const dstIdx = items.findIndex(x => x.id === targetId);
    if (srcIdx < 0 || dstIdx < 0) { dragSrcId = null; dragListId = null; return; }
    // 仅未完成项参与排序
    if (items[srcIdx].completed || items[dstIdx].completed) {
      dragSrcId = null; dragListId = null; return;
    }
    // 把 src 移到 dst 之前
    const [moved] = items.splice(srcIdx, 1);
    items.splice(dstIdx, 0, moved);
    // 重新分配 order：仅未完成项
    let n = 1;
    const rewritten = items.map(x => {
      if (x.completed) return x;
      return Object.assign({}, x, { order: n++ });
    });
    try {
      await window.TodoStorage.saveItems(listId, rewritten);
      await refreshAll();
      renderSidebar();
      renderContent();
    } catch (err) {
      console.error('[todo] reorder failed:', err);
    }
    dragSrcId = null; dragListId = null;
  }
  function onDragEnd() {
    document.querySelectorAll('.todo-item.is-dragging')
      .forEach(el => el.classList.remove('is-dragging'));
    document.querySelectorAll('.todo-item-drop-above')
      .forEach(el => el.classList.remove('todo-item-drop-above'));
    dragSrcId = null; dragListId = null;
  }

  // ── 操作：模板 ──

  async function onSaveAsTemplate(list) {
    const items = state.itemsByList.get(list.id) || [];
    if (items.length === 0) {
      bridge().showToast('当前清单是空的，无法存为模板', { kind: 'info' });
      return;
    }
    bridge().showEdit('把「' + list.name + '」存为模板', list.name, async (name) => {
      try {
        await window.TodoStorage.saveAsTemplate(list.id, name || list.name);
        await refreshAll();
        renderSidebar();
        bridge().showToast('已存为模板', { kind: 'success' });
      } catch (err) {
        console.error('[todo] saveAsTemplate failed:', err);
        bridge().showToast('保存失败：' + (err.message || err), { kind: 'danger' });
      }
    });
  }

  async function onUseTemplate(t) {
    try {
      const list = await window.TodoStorage.createListFromTemplate(t.id);
      await refreshAll();
      // 切到该清单的工作台
      state.currentListId = list.id;
      state.currentView = 'list';
      writeHash();
      renderSidebar();
      renderContent();
      bridge().showToast('已基于模板创建「' + list.name + '」', { kind: 'success' });
    } catch (err) {
      console.error('[todo] useTemplate failed:', err);
      bridge().showToast('创建失败：' + (err.message || err), { kind: 'danger' });
    }
  }

  async function onCopyTemplateToCurrentList(t) {
    const list = currentList();
    if (!list) {
      bridge().showToast('请先在侧边栏选一个清单', { kind: 'info' });
      return;
    }
    if (t.items.length === 0) {
      bridge().showToast('模板为空，无可复制内容', { kind: 'info' });
      return;
    }
    try {
      const r = await window.TodoStorage.copyTemplateToList(t.id, list.id);
      await refreshAll();
      renderSidebar();
      renderContent();
      bridge().showToast('已复制 ' + r.added + ' 条到「' + list.name + '」',
        { kind: 'success' });
    } catch (err) {
      console.error('[todo] copyTemplateToList failed:', err);
      bridge().showToast('复制失败：' + (err.message || err), { kind: 'danger' });
    }
  }

  function onDeleteTemplate(t) {
    bridge().showConfirm(
      '删除模板',
      '确定删除模板「' + t.name + '」？已有清单不受影响。',
      async () => {
        try {
          await window.TodoStorage.deleteTemplate(t.id);
          await refreshAll();
          renderSidebar();
          renderContent();
          bridge().showToast('已删除模板', { kind: 'success' });
        } catch (err) {
          console.error('[todo] deleteTemplate failed:', err);
          bridge().showToast('删除失败：' + (err.message || err), { kind: 'danger' });
        }
      }
    );
  }

  // ── 视图切换 / 路由 ──

  function switchTo(view, listId) {
    state.currentView = view;
    state.currentListId = listId || null;
    writeHash();
    renderSidebar();
    renderContent();
  }

  function writeHash() {
    if (state.currentView === 'list') {
      const id = state.currentListId || '';
      if (id) {
        location.hash = '#todo/list/' + id;
      } else {
        location.hash = '#todo';
      }
    } else {
      location.hash = '#todo/' + state.currentView;
    }
  }

  function handleHashChange() {
    if (!state.isReady) return;
    const h = location.hash.replace(/^#/, '');
    if (h.indexOf('todo') !== 0) {
      // 切回采集 tab：manager.js 的 applyRouteFromHash 会处理 Tab/视图/采集开关置灰；
      // todo.js 不再重复设置，避免双重 toggle 抖动。
      return;
    }
    // #todo / #todo/all / #todo/done / #todo/templates / #todo/list/<id>
    const parts = h.split('/');
    let nextView = 'list';
    let nextListId = state.currentListId;
    if (parts.length === 1) {
      // #todo → 工作台（取当前列表或今日待办）
      nextView = 'list';
      if (!nextListId) nextListId = state.lists.length > 0 ? state.lists[0].id : null;
    } else if (parts[1] === 'all') {
      nextView = 'all'; nextListId = null;
    } else if (parts[1] === 'done') {
      nextView = 'done'; nextListId = null;
    } else if (parts[1] === 'templates') {
      nextView = 'templates'; nextListId = null;
    } else if (parts[1] === 'list' && parts[2]) {
      nextView = 'list';
      nextListId = state.lists.some(l => l.id === parts[2]) ? parts[2] : null;
      if (!nextListId && state.lists.length > 0) nextListId = state.lists[0].id;
    }

    if (state.currentView !== nextView || state.currentListId !== nextListId) {
      state.currentView = nextView;
      state.currentListId = nextListId;
      renderSidebar();
      renderContent();
    }
  }

  // ── 数据加载 ──

  async function refreshAll() {
    state.lists = await window.TodoStorage.loadLists();
    state.itemsByList = await window.TodoStorage.getAllItemBuckets();
    state.templates = await window.TodoStorage.loadTemplates();
  }

  // ── 初始化 ──

  async function init() {
    // 首启惰性创建「今日待办」
    try { await window.TodoStorage.getOrCreateTodayList(); } catch (_) {}

    // 绑定顶 Tab 按钮（在 manager.js 里以 .brand-tab / #brand-tabbar 形式存在）
    const tCollect = $('tab-collect');
    const tTodo = $('tab-todo');
    if (tCollect) tCollect.addEventListener('click', () => {
      location.hash = '#collect';
    });
    if (tTodo) tTodo.addEventListener('click', () => {
      location.hash = '#todo';
    });

    // 键盘：在顶 Tab 上左右切换
    const tabbar = $('brand-tabbar');
    if (tabbar) {
      tabbar.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          if (e.key === 'ArrowRight') {
            if (tTodo) {
              tTodo.focus();
              location.hash = '#todo';
            }
          } else {
            if (tCollect) {
              tCollect.focus();
              location.hash = '#collect';
            }
          }
        }
      });
    }

    // 侧边栏：新建清单
    const newBtn = $('todo-new-list-btn');
    if (newBtn) newBtn.addEventListener('click', onCreateList);

    // 侧边栏：清单项点击 / 删除 / 重命名
    const listContainer = $('todo-list-container');
    if (listContainer) {
      listContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.todo-list-item');
        if (!item) return;
        const listId = item.dataset.listId;
        // 删除按钮优先
        if (e.target.closest('[data-role="list-delete"]')) {
          e.stopPropagation();
          const lst = state.lists.find(l => l.id === listId);
          if (lst) onDeleteList(lst);
          return;
        }
        // 双击重命名
        if (e.detail >= 2 && e.target.closest('[data-role="list-name"]')) {
          e.preventDefault();
          startRenameList(listId);
          return;
        }
        // 单击切换
        switchTo('list', listId);
      });
      // 键盘：Enter 切换
      listContainer.addEventListener('keydown', (e) => {
        const item = e.target.closest('.todo-list-item');
        if (!item) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          switchTo('list', item.dataset.listId);
        } else if (e.key === 'F2') {
          e.preventDefault();
          startRenameList(item.dataset.listId);
        }
      });
    }

    // 侧边栏：导航项
    [
      ['todo-nav-all', 'all'],
      ['todo-nav-done', 'done'],
      ['todo-nav-templates', 'templates'],
    ].forEach(([id, view]) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('click', () => switchTo(view, null));
    });

    // 主内容区：事件代理
    const contentInner = $('todo-content-inner');
    if (contentInner) {
      // 添加项
      contentInner.addEventListener('submit', (e) => {
        const form = e.target.closest('.todo-add-form');
        if (!form) return;
        e.preventDefault();
        const input = form.querySelector('input');
        if (!input) return;
        const text = input.value;
        input.value = '';
        // 同步按钮 disabled
        const btn = form.querySelector('button');
        if (btn) btn.disabled = true;
        onAddItem(form.dataset.listId, text);
      });
      contentInner.addEventListener('input', (e) => {
        if (e.target.matches('.todo-add-form input')) {
          const btn = e.target.closest('.todo-add-form').querySelector('button');
          if (btn) btn.disabled = !e.target.value.trim();
        }
      });
      // 复选框点击 / 键盘
      contentInner.addEventListener('click', (e) => {
        const check = e.target.closest('.todo-check');
        if (check) {
          const li = check.closest('.todo-item');
          if (!li) return;
          const listId = li.closest('.todo-items').dataset.listId;
          onToggleItem(listId, li.dataset.itemId);
          return;
        }
        // 删除按钮
        const del = e.target.closest('.todo-item-delete');
        if (del) {
          const li = del.closest('.todo-item');
          if (!li) return;
          const listId = li.closest('.todo-items').dataset.listId;
          onDeleteItem(listId, li.dataset.itemId);
          return;
        }
        // 模板卡片删除
        const tplDel = e.target.closest('.todo-template-card-delete');
        if (tplDel) {
          const card = tplDel.closest('.todo-template-card');
          const tpl = state.templates.find(t => t.id === card.dataset.templateId);
          if (tpl) onDeleteTemplate(tpl);
          return;
        }
      });
      // 键盘：复选框 / 双击编辑
      contentInner.addEventListener('keydown', (e) => {
        const check = e.target.closest('.todo-check');
        if (check && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault();
          const li = check.closest('.todo-item');
          const listId = li.closest('.todo-items').dataset.listId;
          onToggleItem(listId, li.dataset.itemId);
          return;
        }
        const text = e.target.closest('.todo-item-text');
        if (text && e.key === 'Enter' && e.detail >= 2 /* 浏览器通常不触发，留作占位 */) {
          e.preventDefault();
          const li = text.closest('.todo-item');
          const listId = li.closest('.todo-items').dataset.listId;
          startEditItem(listId, li.dataset.itemId);
        }
      });
      contentInner.addEventListener('dblclick', (e) => {
        const text = e.target.closest('.todo-item-text');
        if (!text) return;
        const li = text.closest('.todo-item');
        const listId = li.closest('.todo-items').dataset.listId;
        startEditItem(listId, li.dataset.itemId);
      });
      // 工作台标题双击重命名（仅 list 视图）
      contentInner.addEventListener('dblclick', (e) => {
        const t = e.target.closest('[data-role="list-title"]');
        if (!t) return;
        e.preventDefault();
        if (state.currentListId) startRenameListFromTitle(state.currentListId);
      });
      // 拖拽
      contentInner.addEventListener('dragstart', onDragStart);
      contentInner.addEventListener('dragover', onDragOver);
      contentInner.addEventListener('dragleave', onDragLeave);
      contentInner.addEventListener('drop', onDrop);
      contentInner.addEventListener('dragend', onDragEnd);
    }

    // 监听 storage.onChanged（仅 todo_ 前缀）
    if (!state.storageListenerBound) {
      chrome.storage.onChanged.addListener(handleStorageChange);
      state.storageListenerBound = true;
    }

    // 加载数据 → 渲染 → 应用 hash
    await refreshAll();
    state.isReady = true;
    handleHashChange();
  }

  // 工作台标题（content 区）的重命名入口
  function startRenameListFromTitle(listId) {
    const t = document.querySelector(
      '[data-role="list-title"]');
    if (!t) return;
    t.setAttribute('contenteditable', 'true');
    t.focus();
    const range = document.createRange();
    range.selectNodeContents(t);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const finish = async (commit) => {
      t.removeAttribute('contenteditable');
      t.removeEventListener('keydown', onKey);
      t.removeEventListener('blur', onBlur);
      if (!commit) {
        const lst = state.lists.find(l => l.id === listId);
        if (lst) t.textContent = lst.name;
        return;
      }
      const newName = (t.textContent || '').trim();
      const lst = state.lists.find(l => l.id === listId);
      if (!newName || !lst || newName === lst.name) {
        if (lst) t.textContent = lst.name;
        return;
      }
      try {
        await window.TodoStorage.renameList(listId, newName);
        await refreshAll();
        renderSidebar();
        renderContent();
      } catch (err) {
        console.error('[todo] renameList failed:', err);
        bridge().showToast('重命名失败：' + (err.message || err), { kind: 'danger' });
      }
    };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    t.addEventListener('keydown', onKey);
    t.addEventListener('blur', onBlur);
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== 'local') return;
    let dirty = false;
    for (const k of Object.keys(changes)) {
      if (k === window.TodoStorage.KEY_LISTS ||
          k === window.TodoStorage.KEY_TEMPLATES ||
          k === window.TodoStorage.KEY_TODAY_LIST_ID ||
          k.startsWith(window.TodoStorage.ITEM_KEY_PREFIX)) {
        dirty = true; break;
      }
    }
    if (!dirty) return;
    // 静默重载（不打断编辑中的 contenteditable）
    const editing = document.querySelector('[contenteditable="true"]');
    if (editing) return;
    refreshAll().then(() => {
      renderSidebar();
      renderContent();
    }).catch(err => console.error('[todo] refresh failed:', err));
  }

  // ── 工具：CSS escape（id 含字符时安全拼选择器） ──
  function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(s);
    }
    return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  }

  // ── 暴露给 manager.js 的最小接口 ──
  // manager.js 在 init 末尾把 showToast / showConfirm / showEdit 挂到 __managerBridge，
  // todo.js 通过 window.__managerBridge 访问（带降级）。
  // todo.js 不需要被 manager.js 调用，但暴露 init / handleHashChange 方便协调。
  window.TodoApp = {
    init: init,
    handleHashChange: handleHashChange,
    isActive: function () {
      return (location.hash || '').indexOf('todo') === 1; // '#todo...'
    },
  };
})();
