/**
 * 待办页面主逻辑
 */

(function() {
  'use strict';

  // ============= 状态 =============
  var state = {
    currentView: 'all',      // 'list' | 'all' | 'done' | 'templates'
    currentListId: null,
    lists: [],
    currentListItems: [],
    allIncompleteItems: [],
    allCompletedItems: [],
    templates: [],
    showCompletedSection: true,
    isAddingItem: false,
    draggedItem: null
  };

  // ============= DOM 引用 =============
  var dom = {};

  // ============= 工具函数 =============

  function formatTime(timestamp) {
    var date = new Date(timestamp);
    var now = new Date();
    var diff = now - date;
    
    // 今天内显示时间
    if (diff < 86400000 && date.getDate() === now.getDate()) {
      return '今天 ' + date.getHours().toString().padStart(2, '0') + ':' + 
             date.getMinutes().toString().padStart(2, '0');
    }
    // 昨天
    var yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.getDate() === yesterday.getDate()) {
      return '昨天 ' + date.getHours().toString().padStart(2, '0') + ':' + 
             date.getMinutes().toString().padStart(2, '0');
    }
    // 其他显示日期
    return (date.getMonth() + 1) + '月' + date.getDate() + '日';
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function debounce(fn, delay) {
    var timer;
    return function() {
      var args = arguments;
      var context = this;
      clearTimeout(timer);
      timer = setTimeout(function() {
        fn.apply(context, args);
      }, delay);
    };
  }

  // ============= Toast 通知 =============

  var showToast = window.showToast || function(message, kind, actionText, onAction) {
    var container = dom.toastContainer;
    var toast = document.createElement('div');
    toast.className = 'toast';
    
    var badge = document.createElement('span');
    badge.className = 'toast-badge';
    if (kind === 'success') badge.classList.add('is-success');
    else if (kind === 'danger') badge.classList.add('is-danger');
    else badge.classList.add('is-info');
    
    var iconSvg = '';
    if (kind === 'success') {
      iconSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    } else if (kind === 'danger') {
      iconSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    } else {
      iconSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.3"/><path d="M6 4v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    }
    badge.innerHTML = iconSvg;
    
    toast.appendChild(badge);
    toast.appendChild(document.createTextNode(message));
    
    if (actionText && onAction) {
      var action = document.createElement('span');
      action.className = 'toast-action';
      action.textContent = actionText;
      action.addEventListener('click', function() {
        onAction();
        dismiss();
      });
      toast.appendChild(action);
    }
    
    container.appendChild(toast);
    
    // 动画显示
    requestAnimationFrame(function() {
      toast.classList.add('show');
    });
    
    function dismiss() {
      toast.classList.remove('show');
      setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }
    
    if (actionText) {
      setTimeout(dismiss, 5000);
    } else {
      setTimeout(dismiss, 2000);
    }
    
    return { dismiss: dismiss };
  };

  // ============= 确认弹窗 =============

  function showConfirmModal(title, body, onConfirm, confirmText) {
    var template = document.getElementById('modal-confirm-template');
    var clone = template.content.cloneNode(true);
    var overlay = clone.querySelector('.modal-overlay');
    var modal = clone.querySelector('.modal');
    
    modal.querySelector('.modal-title').textContent = title;
    modal.querySelector('.modal-body').textContent = body;
    modal.querySelector('.btn-cancel').textContent = '取消';
    modal.querySelector('.btn-confirm').textContent = confirmText || '确认删除';
    
    var cancelBtn = modal.querySelector('.btn-cancel');
    var confirmBtn = modal.querySelector('.btn-confirm');
    
    function close() {
      document.body.removeChild(overlay);
    }
    
    cancelBtn.addEventListener('click', close);
    confirmBtn.addEventListener('click', function() {
      close();
      onConfirm();
    });
    
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) close();
    });
    
    function handleKeydown(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', handleKeydown);
      }
    }
    document.addEventListener('keydown', handleKeydown);
    
    document.body.appendChild(overlay);
    cancelBtn.focus();
  }

  // ============= 初始化 =============

  function initDoms() {
    dom.toastContainer = document.getElementById('toast-container');
    dom.sidebar = document.getElementById('sidebar');
    dom.listContainer = document.getElementById('list-container');
    dom.content = document.getElementById('content');
    dom.btnNewList = document.getElementById('btn-new-list');
    dom.navAll = document.getElementById('nav-all');
    dom.navDone = document.getElementById('nav-done');
    dom.navTemplates = document.getElementById('nav-templates');
    dom.badgeAll = document.getElementById('badge-all');
    dom.badgeDone = document.getElementById('badge-done');
    dom.badgeTemplates = document.getElementById('badge-templates');
    dom.collectToggle = document.getElementById('collect-toggle');
  }

  function parseUrlParams() {
    var params = new URLSearchParams(window.location.search);
    var view = params.get('view') || 'all';
    var listId = params.get('id') || null;
    
    if (view === 'list' && listId) {
      state.currentView = 'list';
      state.currentListId = listId;
    } else {
      state.currentView = view;
      state.currentListId = null;
    }
  }

  function updateUrl() {
    var params = new URLSearchParams();
    if (state.currentView === 'list' && state.currentListId) {
      params.set('view', 'list');
      params.set('id', state.currentListId);
    } else {
      params.set('view', state.currentView);
    }
    var newUrl = window.location.pathname + '?' + params.toString();
    window.history.replaceState({}, '', newUrl);
  }

  async function init() {
    initDoms();
    parseUrlParams();
    
    // 初始化采集开关
    initCollectToggle();
    
    // 加载数据
    await loadAllData();
    
    // 渲染
    renderSidebar();
    renderContent();
    updateBadges();
    
    // 绑定事件
    bindEvents();
    
    // 初始化导航
    if (typeof initNav === 'function') {
      initNav();
    }
  }

  async function loadAllData() {
    state.lists = await TodoStorage.getLists();
    state.templates = await TodoStorage.getTemplates();
    
    if (state.currentView === 'list' && state.currentListId) {
      state.currentListItems = await TodoStorage.getItemsByList(state.currentListId);
    }
    
    state.allIncompleteItems = await TodoStorage.getAllIncompleteItems();
    state.allCompletedItems = await TodoStorage.getAllCompletedItems();
  }

  // ============= 采集开关 =============

  function initCollectToggle() {
    var toggle = dom.collectToggle;
    
    function updateToggleUI(enabled) {
      if (enabled) {
        toggle.classList.add('on');
        toggle.classList.remove('off');
        toggle.setAttribute('aria-checked', 'true');
      } else {
        toggle.classList.remove('on');
        toggle.classList.add('off');
        toggle.setAttribute('aria-checked', 'false');
      }
    }
    
    TodoStorage.getCollectEnabled().then(function(enabled) {
      updateToggleUI(enabled !== false);
    });
    
    toggle.addEventListener('click', function() {
      var isOn = toggle.classList.contains('on');
      TodoStorage.setCollectEnabled(!isOn).then(function() {
        updateToggleUI(!isOn);
      });
    });
    
    toggle.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle.click();
      }
    });
    
    // 监听变化
    chrome.storage.onChanged.addListener(function(changes) {
      if (changes.collectEnabled !== undefined) {
        updateToggleUI(changes.collectEnabled.newValue !== false);
      }
    });
  }

  // ============= 侧边栏渲染 =============

  function renderSidebar() {
    // 更新导航激活状态
    dom.navAll.classList.toggle('active', state.currentView === 'all');
    dom.navDone.classList.toggle('active', state.currentView === 'done');
    dom.navTemplates.classList.toggle('active', state.currentView === 'templates');
    
    // 渲染清单列表
    var html = '';
    state.lists.forEach(function(list) {
      var isActive = state.currentView === 'list' && state.currentListId === list.id;
      var remaining = list.itemCount - list.completedCount;
      html += '<div class="list-item' + (isActive ? ' active' : '') + '" data-list-id="' + escapeHtml(list.id) + '">';
      html += '<svg class="list-icon" width="18" height="18" viewBox="0 0 18 18" fill="none">';
      html += '<rect x="2" y="2" width="14" height="14" rx="3" stroke="currentColor" stroke-width="1.3"/>';
      html += '<path d="M5.5 9l2.5 2.5 4-5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>';
      html += '</svg>';
      html += '<span class="list-name">' + escapeHtml(list.name) + '</span>';
      html += '<span class="list-badge">' + (remaining > 0 ? remaining : '') + '</span>';
      html += '<button class="list-delete" title="删除清单" aria-label="删除清单">';
      html += '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
      html += '</button>';
      html += '</div>';
    });
    dom.listContainer.innerHTML = html;
  }

  function updateBadges() {
    var totalIncomplete = state.allIncompleteItems.length;
    var totalCompleted = state.allCompletedItems.length;
    var totalTemplates = state.templates.length;
    
    dom.badgeAll.textContent = totalIncomplete > 0 ? totalIncomplete : '';
    dom.badgeDone.textContent = totalCompleted > 0 ? totalCompleted : '';
    dom.badgeTemplates.textContent = totalTemplates > 0 ? totalTemplates : '';
  }

  // ============= 内容区渲染 =============

  function renderContent() {
    switch (state.currentView) {
      case 'list':
        renderListView();
        break;
      case 'all':
        renderAllView();
        break;
      case 'done':
        renderDoneView();
        break;
      case 'templates':
        renderTemplatesView();
        break;
    }
  }

  function renderListView() {
    var list = state.lists.find(function(l) { return l.id === state.currentListId; });
    if (!list) {
      // 清单不存在，切换到全部待办
      state.currentView = 'all';
      state.currentListId = null;
      updateUrl();
      renderContent();
      return;
    }
    
    var incompleteItems = state.currentListItems.filter(function(i) { return !i.completed; });
    var completedItems = state.currentListItems.filter(function(i) { return i.completed; });
    var progress = list.itemCount > 0 ? Math.round(list.completedCount / list.itemCount * 100) : 0;
    
    var html = '<div class="list-view">';
    
    // 头部
    html += '<div class="list-header">';
    html += '<div class="list-header-top">';
    html += '<h1 class="list-title" data-list-id="' + escapeHtml(list.id) + '">' + escapeHtml(list.name) + '</h1>';
    html += '<div class="list-actions">';
    html += '<button class="btn btn-text" id="btn-save-template">存为模板</button>';
    html += '<button class="btn btn-text btn-danger" id="btn-delete-list">删除清单</button>';
    html += '</div>';
    html += '</div>';
    html += '<div class="list-stats">';
    html += '<span>' + list.completedCount + '/' + list.itemCount + ' 已完成</span>';
    html += '<span class="progress-text">' + progress + '%</span>';
    html += '</div>';
    html += '<div class="progress-bar"><div class="progress-fill" style="width:' + progress + '%"></div></div>';
    html += '</div>';
    
    // 待办事项
    html += '<div class="items-section" id="items-section">';
    html += '<div class="items-list" id="items-list">';
    
    if (incompleteItems.length === 0 && completedItems.length === 0) {
      html += '<div class="empty-state">';
      html += '<svg class="empty-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/><path d="M16 24l6 6 10-12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      html += '<p class="empty-title">暂无待办事项</p>';
      html += '<p class="empty-sub">点击下方按钮添加第一条待办</p>';
      html += '</div>';
    } else {
      incompleteItems.forEach(function(item) {
        html += renderItemRow(item);
      });
    }
    
    html += '</div>';
    
    // 添加待办
    if (state.isAddingItem) {
      html += '<div class="add-item-input-row" id="add-item-form">';
      html += '<input type="text" class="add-item-input" id="add-item-input" placeholder="输入待办内容，回车保存" autocomplete="off">';
      html += '<button class="add-item-submit" id="add-item-submit">';
      html += '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      html += '</button>';
      html += '</div>';
    } else {
      html += '<div class="add-item-row" id="add-item-row">';
      html += '<span class="add-item-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>';
      html += '<span>添加待办</span>';
      html += '</div>';
    }
    
    html += '</div>';
    
    // 已完成区域
    if (completedItems.length > 0) {
      html += '<div class="completed-section">';
      html += '<button class="completed-toggle" id="completed-toggle">';
      html += '<svg class="completed-toggle-icon' + (state.showCompletedSection ? '' : ' collapsed') + '" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l3 3 5-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      html += '<span>已完成 ' + completedItems.length + ' 项</span>';
      html += '</button>';
      html += '<div class="completed-list' + (state.showCompletedSection ? '' : ' hidden') + '" id="completed-list">';
      completedItems.forEach(function(item) {
        html += renderItemRow(item, true);
      });
      html += '</div>';
      html += '</div>';
    }
    
    html += '</div>';
    
    dom.content.innerHTML = html;
    
    // 聚焦输入框
    if (state.isAddingItem) {
      var input = document.getElementById('add-item-input');
      if (input) {
        input.focus();
        setupAddItemForm();
      }
    }
  }

  function renderItemRow(item, isCompleted) {
    var html = '<div class="item-row' + (isCompleted ? ' completed' : '') + '" data-item-id="' + escapeHtml(item.id) + '" draggable="true">';
    
    // 复选框
    html += '<div class="item-checkbox' + (isCompleted ? ' checked' : '') + '" role="checkbox" aria-checked="' + (isCompleted ? 'true' : 'false') + '" tabindex="0">';
    html += '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    html += '</div>';
    
    // 内容
    html += '<span class="item-text" data-item-id="' + escapeHtml(item.id) + '">' + escapeHtml(item.content) + '</span>';
    
    // 完成时间
    if (isCompleted && item.completedAt) {
      html += '<span class="completed-time">' + formatTime(item.completedAt) + '</span>';
    }
    
    // 删除按钮
    html += '<button class="item-delete" title="删除" aria-label="删除待办">';
    html += '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    html += '</button>';
    
    html += '</div>';
    return html;
  }

  function renderAllView() {
    // 按清单分组
    var grouped = {};
    state.allIncompleteItems.forEach(function(item) {
      if (!grouped[item.listId]) {
        grouped[item.listId] = {
          list: state.lists.find(function(l) { return l.id === item.listId; }),
          items: []
        };
      }
      grouped[item.listId].items.push(item);
    });
    
    var html = '<div class="all-view">';
    html += '<div class="view-header">';
    html += '<h1 class="view-title">全部待办</h1>';
    html += '<p class="view-subtitle">共 ' + state.allIncompleteItems.length + ' 条未完成事项</p>';
    html += '</div>';
    
    if (state.allIncompleteItems.length === 0) {
      html += '<div class="empty-state">';
      html += '<svg class="empty-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/><path d="M16 24l6 6 10-12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      html += '<p class="empty-title">所有事项已完成</p>';
      html += '<p class="empty-sub">太棒了！去创建新的待办吧</p>';
      html += '</div>';
    } else {
      Object.values(grouped).forEach(function(group) {
        if (!group.list) return;
        html += '<div class="group-section">';
        html += '<div class="group-header">';
        html += '<span class="group-title">' + escapeHtml(group.list.name) + '</span>';
        html += '<span class="group-badge">' + group.items.length + ' 项</span>';
        html += '</div>';
        html += '<div class="items-list">';
        group.items.forEach(function(item) {
          html += '<div class="item-row" data-item-id="' + escapeHtml(item.id) + '">';
          html += '<div class="item-checkbox" role="checkbox" aria-checked="false" tabindex="0">';
          html += '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          html += '</div>';
          html += '<span class="item-text" data-item-id="' + escapeHtml(item.id) + '">' + escapeHtml(item.content) + '</span>';
          html += '<button class="item-delete" title="删除" aria-label="删除待办">';
          html += '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
          html += '</button>';
          html += '</div>';
        });
        html += '</div>';
        html += '</div>';
      });
    }
    
    html += '</div>';
    dom.content.innerHTML = html;
  }

  function renderDoneView() {
    // 按清单分组
    var grouped = {};
    state.allCompletedItems.forEach(function(item) {
      if (!grouped[item.listId]) {
        grouped[item.listId] = {
          list: state.lists.find(function(l) { return l.id === item.listId; }),
          items: []
        };
      }
      grouped[item.listId].items.push(item);
    });
    
    var html = '<div class="done-view">';
    html += '<div class="view-header">';
    html += '<h1 class="view-title">已完成</h1>';
    html += '<p class="view-subtitle">共 ' + state.allCompletedItems.length + ' 条已完成事项</p>';
    html += '</div>';
    
    if (state.allCompletedItems.length === 0) {
      html += '<div class="empty-state">';
      html += '<svg class="empty-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/><path d="M16 24l6 6 10-12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      html += '<p class="empty-title">还没有完成的事项</p>';
      html += '<p class="empty-sub">勾选待办即可标记为完成</p>';
      html += '</div>';
    } else {
      Object.values(grouped).forEach(function(group) {
        if (!group.list) return;
        html += '<div class="group-section">';
        html += '<div class="group-header">';
        html += '<span class="group-title">' + escapeHtml(group.list.name) + '</span>';
        html += '<span class="group-badge">' + group.items.length + ' 项</span>';
        html += '</div>';
        html += '<div class="items-list">';
        group.items.forEach(function(item) {
          html += '<div class="item-row completed" data-item-id="' + escapeHtml(item.id) + '">';
          html += '<div class="item-checkbox checked" role="checkbox" aria-checked="true" tabindex="0">';
          html += '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          html += '</div>';
          html += '<span class="item-text" data-item-id="' + escapeHtml(item.id) + '">' + escapeHtml(item.content) + '</span>';
          html += '<span class="completed-time">' + formatTime(item.completedAt) + '</span>';
          html += '<button class="item-delete" title="删除" aria-label="删除待办">';
          html += '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
          html += '</button>';
          html += '</div>';
        });
        html += '</div>';
        html += '</div>';
      });
    }
    
    html += '</div>';
    dom.content.innerHTML = html;
  }

  function renderTemplatesView() {
    var html = '<div class="templates-view">';
    html += '<div class="templates-header">';
    html += '<div>';
    html += '<h1 class="templates-title">模板库</h1>';
    html += '<p class="templates-subtitle">共 ' + state.templates.length + ' 个模板</p>';
    html += '</div>';
    html += '</div>';
    
    if (state.templates.length === 0) {
      html += '<div class="empty-state">';
      html += '<svg class="empty-icon" viewBox="0 0 48 48" fill="none"><rect x="4" y="2" width="40" height="44" rx="4" stroke="currentColor" stroke-width="2"/><path d="M12 14h24M12 22h24M12 30h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      html += '<p class="empty-title">还没有模板</p>';
      html += '<p class="empty-sub">在清单工作台中，点击「存为模板」将清单保存为可复用的模板</p>';
      html += '</div>';
    } else {
      html += '<div class="templates-grid">';
      state.templates.forEach(function(template) {
        html += '<div class="template-card" data-template-id="' + escapeHtml(template.id) + '">';
        html += '<button class="template-delete" title="删除模板" aria-label="删除模板">';
        html += '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
        html += '</button>';
        html += '<h3 class="template-name">' + escapeHtml(template.name) + '</h3>';
        html += '<p class="template-count">' + template.items.length + ' 个待办</p>';
        html += '<div class="template-preview">';
        template.items.slice(0, 3).forEach(function(item) {
          html += '<span class="template-preview-item">' + escapeHtml(item) + '</span>';
        });
        if (template.items.length > 3) {
          html += '<span class="template-preview-item">...' + (template.items.length - 3) + ' more</span>';
        }
        html += '</div>';
        html += '<div class="template-footer">';
        html += '<span class="template-time">更新于' + formatTime(template.updatedAt) + '</span>';
        html += '<button class="template-use-btn">使用该模板</button>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    
    html += '</div>';
    dom.content.innerHTML = html;
  }

  // ============= 事件绑定 =============

  function bindEvents() {
    // 新建清单
    dom.btnNewList.addEventListener('click', handleNewList);
    
    // 侧边栏清单点击
    dom.listContainer.addEventListener('click', handleListClick);
    
    // 导航点击
    dom.navAll.addEventListener('click', function() {
      navigateTo('all');
    });
    dom.navDone.addEventListener('click', function() {
      navigateTo('done');
    });
    dom.navTemplates.addEventListener('click', function() {
      navigateTo('templates');
    });
    
    // 内容区事件委托
    dom.content.addEventListener('click', handleContentClick);
    dom.content.addEventListener('dblclick', handleContentDblClick);
    dom.content.addEventListener('keydown', handleContentKeydown);
    
    // 拖拽排序
    dom.content.addEventListener('dragstart', handleDragStart);
    dom.content.addEventListener('dragover', handleDragOver);
    dom.content.addEventListener('dragleave', handleDragLeave);
    dom.content.addEventListener('drop', handleDrop);
    dom.content.addEventListener('dragend', handleDragEnd);
  }

  async function handleNewList() {
    var newList = await TodoStorage.createList();
    state.lists = await TodoStorage.getLists();
    state.currentView = 'list';
    state.currentListId = newList.id;
    state.isAddingItem = false;
    updateUrl();
    renderSidebar();
    renderContent();
  }

  async function handleListClick(e) {
    var listItem = e.target.closest('.list-item');
    if (!listItem) return;
    
    var listId = listItem.dataset.listId;
    
    // 删除按钮
    if (e.target.closest('.list-delete')) {
      e.stopPropagation();
      var list = state.lists.find(function(l) { return l.id === listId; });
      showConfirmModal(
        '删除清单',
        '确定要删除「' + list.name + '」吗？该清单下的所有待办事项也会被删除。',
        async function() {
          await TodoStorage.deleteList(listId);
          state.lists = await TodoStorage.getLists();
          if (state.currentView === 'list' && state.currentListId === listId) {
            state.currentView = 'all';
            state.currentListId = null;
          }
          updateUrl();
          renderSidebar();
          renderContent();
          showToast('清单已删除', 'info');
        }
      );
      return;
    }
    
    // 切换到该清单
    if (state.currentView !== 'list' || state.currentListId !== listId) {
      state.currentView = 'list';
      state.currentListId = listId;
      state.currentListItems = await TodoStorage.getItemsByList(listId);
      state.isAddingItem = false;
      updateUrl();
      renderSidebar();
      renderContent();
    }
  }

  async function navigateTo(view) {
    state.currentView = view;
    state.currentListId = null;
    state.isAddingItem = false;
    updateUrl();
    await loadAllData();
    renderSidebar();
    renderContent();
  }

  async function handleContentClick(e) {
    // 复选框点击
    var checkbox = e.target.closest('.item-checkbox');
    if (checkbox) {
      var itemRow = checkbox.closest('.item-row');
      var itemId = itemRow.dataset.itemId;
      await toggleItemComplete(itemId);
      return;
    }
    
    // 添加待办按钮
    if (e.target.closest('#add-item-row')) {
      state.isAddingItem = true;
      renderListView();
      return;
    }
    
    // 删除按钮
    var deleteBtn = e.target.closest('.item-delete');
    if (deleteBtn) {
      var itemRow = deleteBtn.closest('.item-row');
      var itemId = itemRow.dataset.itemId;
      var item = await deleteItemWithUndo(itemId);
      return;
    }
    
    // 已完成区域折叠
    var completedToggle = e.target.closest('#completed-toggle');
    if (completedToggle) {
      state.showCompletedSection = !state.showCompletedSection;
      var icon = completedToggle.querySelector('.completed-toggle-icon');
      var list = document.getElementById('completed-list');
      icon.classList.toggle('collapsed', !state.showCompletedSection);
      list.classList.toggle('hidden', !state.showCompletedSection);
      return;
    }
    
    // 存为模板
    if (e.target.closest('#btn-save-template')) {
      await saveAsTemplate();
      return;
    }
    
    // 删除清单
    if (e.target.closest('#btn-delete-list')) {
      var list = state.lists.find(function(l) { return l.id === state.currentListId; });
      showConfirmModal(
        '删除清单',
        '确定要删除「' + list.name + '」吗？该清单下的所有待办事项也会被删除。',
        async function() {
          await TodoStorage.deleteList(state.currentListId);
          state.lists = await TodoStorage.getLists();
          state.currentView = 'all';
          state.currentListId = null;
          updateUrl();
          renderSidebar();
          renderContent();
          showToast('清单已删除', 'info');
        }
      );
      return;
    }
    
    // 模板使用按钮
    var useBtn = e.target.closest('.template-use-btn');
    if (useBtn) {
      var card = useBtn.closest('.template-card');
      var templateId = card.dataset.templateId;
      await useTemplate(templateId);
      return;
    }
    
    // 模板删除按钮
    var templateDeleteBtn = e.target.closest('.template-delete');
    if (templateDeleteBtn) {
      var card = templateDeleteBtn.closest('.template-card');
      var templateId = card.dataset.templateId;
      var template = state.templates.find(function(t) { return t.id === templateId; });
      showConfirmModal(
        '删除模板',
        '确定要删除「' + template.name + '」模板吗？该操作不会影响已创建的清单。',
        async function() {
          await TodoStorage.deleteTemplate(templateId);
          state.templates = await TodoStorage.getTemplates();
          updateBadges();
          renderTemplatesView();
          showToast('模板已删除', 'info');
        }
      );
      return;
    }
  }

  function handleContentDblClick(e) {
    // 清单标题编辑
    var listTitle = e.target.closest('.list-title');
    if (listTitle) {
      startEditListTitle(listTitle);
      return;
    }
    
    // 待办内容编辑
    var itemText = e.target.closest('.item-text');
    if (itemText && !itemText.classList.contains('editing')) {
      startEditItem(itemText);
      return;
    }
  }

  function handleContentKeydown(e) {
    // 输入框回车保存
    var addInput = e.target.closest('#add-item-input');
    if (addInput && e.key === 'Enter') {
      submitNewItem();
      return;
    }
    
    var listTitleInput = e.target.closest('.list-title-input');
    if (listTitleInput && e.key === 'Enter') {
      saveListTitle(listTitleInput);
      return;
    }
    
    var itemTextInput = e.target.closest('.item-text-input');
    if (itemTextInput && e.key === 'Enter') {
      saveItemText(itemTextInput);
      return;
    }
    
    // ESC 取消编辑
    if (e.key === 'Escape') {
      if (state.isAddingItem) {
        state.isAddingItem = false;
        renderListView();
      }
    }
    
    // 复选框键盘支持
    var checkbox = e.target.closest('.item-checkbox');
    if (checkbox && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      var itemRow = checkbox.closest('.item-row');
      toggleItemComplete(itemRow.dataset.itemId);
    }
  }

  // ============= 添加待办 =============

  function setupAddItemForm() {
    var input = document.getElementById('add-item-input');
    var submitBtn = document.getElementById('add-item-submit');
    
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          submitNewItem();
        } else if (e.key === 'Escape') {
          state.isAddingItem = false;
          renderListView();
        }
      });
    }
    
    if (submitBtn) {
      submitBtn.addEventListener('click', submitNewItem);
    }
  }

  async function submitNewItem() {
    var input = document.getElementById('add-item-input');
    if (!input) return;
    
    var content = input.value.trim();
    if (!content) {
      state.isAddingItem = false;
      renderListView();
      return;
    }
    
    await TodoStorage.createItem(state.currentListId, content);
    state.currentListItems = await TodoStorage.getItemsByList(state.currentListId);
    state.lists = await TodoStorage.getLists();
    state.isAddingItem = false;
    updateBadges();
    renderSidebar();
    renderListView();
    showToast('已添加', 'success');
  }

  // ============= 待办操作 =============

  async function toggleItemComplete(itemId) {
    var item = await TodoStorage.toggleItemComplete(itemId);
    
    if (state.currentView === 'list') {
      state.currentListItems = await TodoStorage.getItemsByList(state.currentListId);
      state.lists = await TodoStorage.getLists();
    } else if (state.currentView === 'all' || state.currentView === 'done') {
      await loadAllData();
    }
    
    updateBadges();
    renderSidebar();
    renderContent();
    
    if (item.completed) {
      showToast('已完成', 'success');
    } else {
      showToast('已恢复', 'info');
    }
  }

  async function deleteItemWithUndo(itemId) {
    var itemsMap = await TodoStorage.getAllItems();
    var item = itemsMap[itemId];
    if (!item) return;
    
    var listId = item.listId;
    var deletedItem = Object.assign({}, item);
    
    await TodoStorage.deleteItem(itemId);
    
    if (state.currentView === 'list') {
      state.currentListItems = await TodoStorage.getItemsByList(state.currentListId);
      state.lists = await TodoStorage.getLists();
    } else if (state.currentView === 'all' || state.currentView === 'done') {
      await loadAllData();
    }
    
    updateBadges();
    renderSidebar();
    renderContent();
    
    showToast('已删除', 'info', '撤销', async function() {
      // 恢复事项
      await TodoStorage.createItem(listId, deletedItem.content);
      // 保持原有完成状态
      if (deletedItem.completed) {
        var newItems = await TodoStorage.getAllItems();
        var newItemId = Object.keys(newItems).find(function(id) {
          return newItems[id].listId === listId && 
                 newItems[id].content === deletedItem.content &&
                 !newItems[id].completed;
        });
        if (newItemId) {
          await TodoStorage.toggleItemComplete(newItemId);
        }
      }
      
      if (state.currentView === 'list') {
        state.currentListItems = await TodoStorage.getItemsByList(state.currentListId);
        state.lists = await TodoStorage.getLists();
      } else if (state.currentView === 'all' || state.currentView === 'done') {
        await loadAllData();
      }
      
      updateBadges();
      renderSidebar();
      renderContent();
      showToast('已恢复', 'success');
    });
  }

  // ============= 编辑功能 =============

  function startEditListTitle(titleEl) {
    var listId = titleEl.dataset.listId;
    var list = state.lists.find(function(l) { return l.id === listId; });
    if (!list) return;
    
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'list-title-input';
    input.value = list.name;
    
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    
    input.addEventListener('blur', function() {
      saveListTitle(input);
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        saveListTitle(input);
      } else if (e.key === 'Escape') {
        renderListView();
      }
    });
  }

  async function saveListTitle(input) {
    var titleEl = document.querySelector('.list-title');
    var listId = titleEl ? titleEl.dataset.listId : state.currentListId;
    var newName = input.value.trim() || '未命名清单';
    
    await TodoStorage.updateList(listId, { name: newName });
    state.lists = await TodoStorage.getLists();
    renderSidebar();
    renderListView();
    showToast('已保存', 'success');
  }

  function startEditItem(textEl) {
    var itemId = textEl.dataset.itemId;
    var itemsMap = {};
    state.currentListItems.forEach(function(i) { itemsMap[i.id] = i; });
    var item = itemsMap[itemId];
    if (!item) return;
    
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'item-text-input';
    input.value = item.content;
    
    textEl.replaceWith(input);
    input.focus();
    input.select();
    
    input.addEventListener('blur', function() {
      saveItemText(input);
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        saveItemText(input);
      } else if (e.key === 'Escape') {
        renderListView();
      }
    });
  }

  async function saveItemText(input) {
    var textEl = document.querySelector('.item-text');
    var itemId = textEl ? textEl.dataset.itemId : null;
    var newContent = input.value.trim();
    
    if (!newContent) {
      // 空内容，删除事项
      if (itemId) {
        await TodoStorage.deleteItem(itemId);
        state.currentListItems = await TodoStorage.getItemsByList(state.currentListId);
        state.lists = await TodoStorage.getLists();
        updateBadges();
        renderSidebar();
        renderListView();
      }
      return;
    }
    
    await TodoStorage.updateItem(itemId, { content: newContent });
    state.currentListItems = await TodoStorage.getItemsByList(state.currentListId);
    renderListView();
    showToast('已保存', 'success');
  }

  // ============= 模板功能 =============

  async function saveAsTemplate() {
    var list = state.lists.find(function(l) { return l.id === state.currentListId; });
    if (!list) return;
    
    // 检查是否已存在同名模板
    var existing = state.templates.find(function(t) { return t.name === list.name; });
    if (existing) {
      showConfirmModal(
        '模板已存在',
        '模板「' + list.name + '」已存在，是否覆盖？',
        async function() {
          await TodoStorage.updateTemplate(existing.id, {
            items: state.currentListItems.map(function(i) { return i.content; })
          });
          state.templates = await TodoStorage.getTemplates();
          updateBadges();
          showToast('模板已更新', 'success');
        },
        '确认覆盖'
      );
    } else {
      await TodoStorage.createTemplateFromList(state.currentListId);
      state.templates = await TodoStorage.getTemplates();
      updateBadges();
      showToast('已存为模板', 'success');
    }
  }

  async function useTemplate(templateId) {
    var newList = await TodoStorage.createListFromTemplate(templateId);
    state.lists = await TodoStorage.getLists();
    state.templates = await TodoStorage.getTemplates();
    
    state.currentView = 'list';
    state.currentListId = newList.id;
    state.currentListItems = await TodoStorage.getItemsByList(newList.id);
    state.isAddingItem = false;
    
    updateUrl();
    updateBadges();
    renderSidebar();
    renderContent();
    
    showToast('已创建清单「' + newList.name + '」', 'success');
  }

  // ============= 拖拽排序 =============

  function handleDragStart(e) {
    var itemRow = e.target.closest('.item-row');
    if (!itemRow || itemRow.classList.contains('completed')) return;
    
    state.draggedItem = itemRow;
    itemRow.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemRow.dataset.itemId);
  }

  function handleDragOver(e) {
    var itemRow = e.target.closest('.item-row');
    if (!itemRow || itemRow.classList.contains('completed') || itemRow === state.draggedItem) {
      return;
    }
    
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    itemRow.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    var itemRow = e.target.closest('.item-row');
    if (itemRow) {
      itemRow.classList.remove('drag-over');
    }
  }

  async function handleDrop(e) {
    e.preventDefault();
    var targetRow = e.target.closest('.item-row');
    if (!targetRow || targetRow.classList.contains('completed')) return;
    
    var draggedId = state.draggedItem ? state.draggedItem.dataset.itemId : e.dataTransfer.getData('text/plain');
    var targetId = targetRow.dataset.itemId;
    
    if (draggedId === targetId) return;
    
    // 获取所有未完成事项并重新排序
    var incompleteItems = state.currentListItems
      .filter(function(i) { return !i.completed; })
      .sort(function(a, b) { return a.order - b.order; });
    
    var draggedIndex = incompleteItems.findIndex(function(i) { return i.id === draggedId; });
    var targetIndex = incompleteItems.findIndex(function(i) { return i.id === targetId; });
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    // 移动元素
    var [draggedItem] = incompleteItems.splice(draggedIndex, 1);
    incompleteItems.splice(targetIndex, 0, draggedItem);
    
    // 更新顺序
    var orderedIds = incompleteItems.map(function(i) { return i.id; });
    await TodoStorage.reorderItems(state.currentListId, orderedIds);
    state.currentListItems = await TodoStorage.getItemsByList(state.currentListId);
    
    renderListView();
  }

  function handleDragEnd(e) {
    var itemRow = e.target.closest('.item-row');
    if (itemRow) {
      itemRow.classList.remove('dragging');
    }
    
    // 移除所有 drag-over
    document.querySelectorAll('.drag-over').forEach(function(el) {
      el.classList.remove('drag-over');
    });
    
    state.draggedItem = null;
  }

  // ============= 启动 =============

  document.addEventListener('DOMContentLoaded', init);

})();
