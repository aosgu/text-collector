/**
 * 待办功能数据操作层
 * 管理清单、待办事项、模板的 CRUD 操作
 */

(function(global) {
  'use strict';

  // ============= 常量 =============
  var STORAGE_KEYS = {
    LISTS: 'todo_lists',
    ITEMS: 'todo_items',  // Map 结构：{ id: TodoItem }
    TEMPLATES: 'todo_templates'
  };

  // ============= 工具函数 =============
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ============= 清单操作 =============

  /**
   * 获取所有清单
   * @returns {Promise<TodoList[]>}
   */
  async function getLists() {
    return new Promise(function(resolve) {
      chrome.storage.local.get(STORAGE_KEYS.LISTS, function(result) {
        var lists = result[STORAGE_KEYS.LISTS] || [];
        // 按 order 排序
        lists.sort(function(a, b) { return a.order - b.order; });
        resolve(lists);
      });
    });
  }

  /**
   * 创建新清单
   * @param {string} name - 清单名称
   * @returns {Promise<TodoList>}
   */
  async function createList(name) {
    var lists = await getLists();
    var newList = {
      id: generateUUID(),
      name: name || '未命名清单',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: lists.length > 0 ? Math.max.apply(null, lists.map(function(l) { return l.order; })) + 1 : 0,
      itemCount: 0,
      completedCount: 0
    };
    lists.push(newList);
    
    return new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.LISTS] = lists;
      chrome.storage.local.set(data, function() {
        resolve(newList);
      });
    });
  }

  /**
   * 更新清单
   * @param {string} id - 清单 ID
   * @param {Object} updates - 要更新的字段
   * @returns {Promise<TodoList|null>}
   */
  async function updateList(id, updates) {
    var lists = await getLists();
    var list = lists.find(function(l) { return l.id === id; });
    if (!list) return null;
    
    Object.assign(list, updates, { updatedAt: Date.now() });
    
    return new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.LISTS] = lists;
      chrome.storage.local.set(data, function() {
        resolve(list);
      });
    });
  }

  /**
   * 删除清单及其所有待办事项
   * @param {string} id - 清单 ID
   * @returns {Promise<boolean>}
   */
  async function deleteList(id) {
    var lists = await getLists();
    var items = await getAllItems();
    var templates = await getTemplates();
    
    // 过滤掉要删除的清单
    var filteredLists = lists.filter(function(l) { return l.id !== id; });
    // 删除该清单的所有事项
    var filteredItems = {};
    Object.keys(items).forEach(function(key) {
      if (items[key].listId !== id) {
        filteredItems[key] = items[key];
      }
    });
    
    return new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.LISTS] = filteredLists;
      data[STORAGE_KEYS.ITEMS] = filteredItems;
      chrome.storage.local.set(data, function() {
        resolve(true);
      });
    });
  }

  /**
   * 重新排序清单
   * @param {string[]} orderedIds - 排序后的 ID 数组
   */
  async function reorderLists(orderedIds) {
    var lists = await getLists();
    orderedIds.forEach(function(id, index) {
      var list = lists.find(function(l) { return l.id === id; });
      if (list) list.order = index;
    });
    
    return new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.LISTS] = lists;
      chrome.storage.local.set(data, resolve);
    });
  }

  // ============= 待办事项操作 =============

  /**
   * 获取所有待办事项
   * @returns {Promise<Object>} - items Map
   */
  async function getAllItems() {
    return new Promise(function(resolve) {
      chrome.storage.local.get(STORAGE_KEYS.ITEMS, function(result) {
        resolve(result[STORAGE_KEYS.ITEMS] || {});
      });
    });
  }

  /**
   * 获取指定清单的所有待办事项
   * @param {string} listId - 清单 ID
   * @returns {Promise<TodoItem[]>}
   */
  async function getItemsByList(listId) {
    var itemsMap = await getAllItems();
    var items = Object.values(itemsMap).filter(function(item) {
      return item.listId === listId;
    });
    // 先按完成状态分组，再按 order 排序
    items.sort(function(a, b) {
      // 未完成的在前
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      return a.order - b.order;
    });
    return items;
  }

  /**
   * 获取所有未完成事项（跨清单）
   * @returns {Promise<TodoItem[]>}
   */
  async function getAllIncompleteItems() {
    var itemsMap = await getAllItems();
    var items = Object.values(itemsMap).filter(function(item) {
      return !item.completed;
    });
    // 按创建时间排序
    items.sort(function(a, b) { return b.createdAt - a.createdAt; });
    return items;
  }

  /**
   * 获取所有已完成事项（跨清单）
   * @returns {Promise<TodoItem[]>}
   */
  async function getAllCompletedItems() {
    var itemsMap = await getAllItems();
    var items = Object.values(itemsMap).filter(function(item) {
      return item.completed;
    });
    // 按完成时间排序
    items.sort(function(a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
    return items;
  }

  /**
   * 创建待办事项
   * @param {string} listId - 清单 ID
   * @param {string} content - 内容
   * @returns {Promise<TodoItem>}
   */
  async function createItem(listId, content) {
    var itemsMap = await getAllItems();
    var listItems = await getItemsByList(listId);
    var maxOrder = listItems.length > 0 ? Math.max.apply(null, listItems.map(function(i) { return i.order; })) : -1;
    
    var newItem = {
      id: generateUUID(),
      listId: listId,
      content: content,
      completed: false,
      order: maxOrder + 1,
      createdAt: Date.now(),
      completedAt: null
    };
    itemsMap[newItem.id] = newItem;
    
    await new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.ITEMS] = itemsMap;
      chrome.storage.local.set(data, resolve);
    });
    
    // 更新清单计数
    await updateListCounts(listId);
    
    return newItem;
  }

  /**
   * 更新待办事项
   * @param {string} id - 事项 ID
   * @param {Object} updates - 要更新的字段
   * @returns {Promise<TodoItem|null>}
   */
  async function updateItem(id, updates) {
    var itemsMap = await getAllItems();
    var item = itemsMap[id];
    if (!item) return null;
    
    Object.assign(item, updates);
    itemsMap[id] = item;
    
    await new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.ITEMS] = itemsMap;
      chrome.storage.local.set(data, resolve);
    });
    
    // 更新清单计数
    await updateListCounts(item.listId);
    
    return item;
  }

  /**
   * 删除待办事项
   * @param {string} id - 事项 ID
   * @returns {Promise<boolean>}
   */
  async function deleteItem(id) {
    var itemsMap = await getAllItems();
    var item = itemsMap[id];
    if (!item) return false;
    
    var listId = item.listId;
    delete itemsMap[id];
    
    await new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.ITEMS] = itemsMap;
      chrome.storage.local.set(data, resolve);
    });
    
    // 更新清单计数
    await updateListCounts(listId);
    
    return true;
  }

  /**
   * 切换待办事项完成状态
   * @param {string} id - 事项 ID
   * @returns {Promise<TodoItem|null>}
   */
  async function toggleItemComplete(id) {
    var itemsMap = await getAllItems();
    var item = itemsMap[id];
    if (!item) return null;
    
    item.completed = !item.completed;
    item.completedAt = item.completed ? Date.now() : null;
    itemsMap[id] = item;
    
    await new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.ITEMS] = itemsMap;
      chrome.storage.local.set(data, resolve);
    });
    
    // 更新清单计数
    await updateListCounts(item.listId);
    
    return item;
  }

  /**
   * 批量创建待办事项
   * @param {string} listId - 清单 ID
   * @param {string[]} contents - 内容数组
   * @returns {Promise<TodoItem[]>}
   */
  async function createItems(listId, contents) {
    var itemsMap = await getAllItems();
    var listItems = await getItemsByList(listId);
    var maxOrder = listItems.length > 0 ? Math.max.apply(null, listItems.map(function(i) { return i.order; })) : -1;
    
    var newItems = [];
    contents.forEach(function(content, index) {
      var newItem = {
        id: generateUUID(),
        listId: listId,
        content: content,
        completed: false,
        order: maxOrder + 1 + index,
        createdAt: Date.now(),
        completedAt: null
      };
      itemsMap[newItem.id] = newItem;
      newItems.push(newItem);
    });
    
    await new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.ITEMS] = itemsMap;
      chrome.storage.local.set(data, resolve);
    });
    
    // 更新清单计数
    await updateListCounts(listId);
    
    return newItems;
  }

  /**
   * 重新排序清单内事项
   * @param {string} listId - 清单 ID
   * @param {string[]} orderedIds - 排序后的 ID 数组
   */
  async function reorderItems(listId, orderedIds) {
    var itemsMap = await getAllItems();
    orderedIds.forEach(function(id, index) {
      if (itemsMap[id] && itemsMap[id].listId === listId) {
        itemsMap[id].order = index;
      }
    });
    
    return new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.ITEMS] = itemsMap;
      chrome.storage.local.set(data, resolve);
    });
  }

  /**
   * 更新清单的计数缓存
   * @param {string} listId - 清单 ID
   */
  async function updateListCounts(listId) {
    var itemsMap = await getAllItems();
    var listItems = Object.values(itemsMap).filter(function(item) {
      return item.listId === listId;
    });
    var itemCount = listItems.length;
    var completedCount = listItems.filter(function(item) { return item.completed; }).length;
    
    await updateList(listId, { itemCount: itemCount, completedCount: completedCount });
  }

  // ============= 模板操作 =============

  /**
   * 获取所有模板
   * @returns {Promise<Template[]>}
   */
  async function getTemplates() {
    return new Promise(function(resolve) {
      chrome.storage.local.get(STORAGE_KEYS.TEMPLATES, function(result) {
        var templates = result[STORAGE_KEYS.TEMPLATES] || [];
        // 按更新时间倒序
        templates.sort(function(a, b) { return b.updatedAt - a.updatedAt; });
        resolve(templates);
      });
    });
  }

  /**
   * 创建模板
   * @param {string} name - 模板名称
   * @param {string[]} items - 事项内容数组
   * @returns {Promise<Template>}
   */
  async function createTemplate(name, items) {
    var templates = await getTemplates();
    var newTemplate = {
      id: generateUUID(),
      name: name,
      items: items || [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    templates.unshift(newTemplate);
    
    return new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.TEMPLATES] = templates;
      chrome.storage.local.set(data, function() {
        resolve(newTemplate);
      });
    });
  }

  /**
   * 更新模板
   * @param {string} id - 模板 ID
   * @param {Object} updates - 要更新的字段
   * @returns {Promise<Template|null>}
   */
  async function updateTemplate(id, updates) {
    var templates = await getTemplates();
    var template = templates.find(function(t) { return t.id === id; });
    if (!template) return null;
    
    Object.assign(template, updates, { updatedAt: Date.now() });
    
    return new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.TEMPLATES] = templates;
      chrome.storage.local.set(data, function() {
        resolve(template);
      });
    });
  }

  /**
   * 删除模板
   * @param {string} id - 模板 ID
   * @returns {Promise<boolean>}
   */
  async function deleteTemplate(id) {
    var templates = await getTemplates();
    var filtered = templates.filter(function(t) { return t.id !== id; });
    
    return new Promise(function(resolve) {
      var data = {};
      data[STORAGE_KEYS.TEMPLATES] = filtered;
      chrome.storage.local.set(data, function() {
        resolve(true);
      });
    });
  }

  /**
   * 复制模板
   * @param {string} id - 模板 ID
   * @returns {Promise<Template|null>}
   */
  async function duplicateTemplate(id) {
    var templates = await getTemplates();
    var template = templates.find(function(t) { return t.id === id; });
    if (!template) return null;
    
    return createTemplate(template.name + '（副本）', template.items.slice());
  }

  /**
   * 使用模板创建清单
   * @param {string} templateId - 模板 ID
   * @returns {Promise<TodoList>}
   */
  async function createListFromTemplate(templateId) {
    var templates = await getTemplates();
    var template = templates.find(function(t) { return t.id === templateId; });
    if (!template) return null;
    
    // 创建新清单
    var newList = await createList(template.name);
    
    // 复制事项到清单
    await createItems(newList.id, template.items);
    
    return newList;
  }

  /**
   * 从清单创建模板
   * @param {string} listId - 清单 ID
   * @returns {Promise<Template|null>}
   */
  async function createTemplateFromList(listId) {
    var lists = await getLists();
    var list = lists.find(function(l) { return l.id === listId; });
    if (!list) return null;
    
    var items = await getItemsByList(listId);
    var contents = items.map(function(item) { return item.content; });
    
    return createTemplate(list.name, contents);
  }

  // ============= 初始化 =============

  /**
   * 确保存储键存在
   */
  function init() {
    chrome.storage.local.get([STORAGE_KEYS.LISTS, STORAGE_KEYS.ITEMS, STORAGE_KEYS.TEMPLATES], function(result) {
      var data = {};
      if (!result[STORAGE_KEYS.LISTS]) {
        data[STORAGE_KEYS.LISTS] = [];
      }
      if (!result[STORAGE_KEYS.ITEMS]) {
        data[STORAGE_KEYS.ITEMS] = {};
      }
      if (!result[STORAGE_KEYS.TEMPLATES]) {
        data[STORAGE_KEYS.TEMPLATES] = [];
      }
      if (Object.keys(data).length > 0) {
        chrome.storage.local.set(data);
      }
    });
  }

  // 导出到全局
  global.TodoStorage = {
    // 清单
    getLists: getLists,
    createList: createList,
    updateList: updateList,
    deleteList: deleteList,
    reorderLists: reorderLists,
    // 待办事项
    getAllItems: getAllItems,
    getItemsByList: getItemsByList,
    getAllIncompleteItems: getAllIncompleteItems,
    getAllCompletedItems: getAllCompletedItems,
    createItem: createItem,
    updateItem: updateItem,
    deleteItem: deleteItem,
    toggleItemComplete: toggleItemComplete,
    createItems: createItems,
    reorderItems: reorderItems,
    // 模板
    getTemplates: getTemplates,
    createTemplate: createTemplate,
    updateTemplate: updateTemplate,
    deleteTemplate: deleteTemplate,
    duplicateTemplate: duplicateTemplate,
    createListFromTemplate: createListFromTemplate,
    createTemplateFromList: createTemplateFromList,
    // 初始化
    init: init
  };

})(window);
