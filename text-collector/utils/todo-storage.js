/**
 * utils/todo-storage.js — 待办数据层（纯 CRUD，不触碰 DOM）
 *
 * 设计要点：
 *  - 全部走 chrome.storage.local，存储键前缀 todo_，与采集记录完全隔离
 *  - 不引用任何全局 UI 状态；调用方（todo.js）负责渲染、toast、弹窗
 *  - 不监听 storage.onChanged（写入端自管；跨 tab 协调由 todo.js 统一处理）
 *  - 错误全部 throw；UI 形态（toast / 弹窗）由调用方决定
 *
 * 存储键：
 *   todo_lists             -> TodoList[]          清单索引
 *   todo_items_<listId>    -> TodoItem[]          单个清单的待办项
 *   todo_templates         -> Template[]          模板库
 *   todo_today_list_id     -> string              「今日待办」清单 ID（惰性创建）
 *
 * 数据模型：
 *   TodoList  { id, name, order, createdAt, updatedAt }
 *   TodoItem  { id, listId, content, completed, order, createdAt, completedAt }
 *   Template  { id, name, items: string[], createdAt, updatedAt }
 *
 * 约定：
 *  - itemCount / completedCount 不持久化，渲染时由 todo.js 现算
 *  - 排序：list 读时按 order asc；item 读时 completed 在下，未完成按 order asc
 *  - 任何对 items 的整存走 saveItems；addItem/toggleItem/deleteItem 仅改对应字段
 *  - 重复创建同名「今日待办」由 getOrCreateTodayList 内部幂等处理
 */

// ── 存储键 ──
const KEY_LISTS = 'todo_lists';
const KEY_TEMPLATES = 'todo_templates';
const KEY_TODAY_LIST_ID = 'todo_today_list_id';
const ITEM_KEY_PREFIX = 'todo_items_'; // + listId

// ── 工具 ──

/** 生成 UUID v4（chrome.runtime 上下文可放心用 crypto.randomUUID） */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 兜底：极少触发的旧环境
  return 't_' + Date.now().toString(36) + '_' +
    Math.random().toString(36).slice(2, 10);
}

/** 读取清单所有 items 的存储键 */
function itemKey(listId) { return ITEM_KEY_PREFIX + listId; }

/** 读取 storage.local 单个键；不存在返回 undefined */
function getLocal(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (data) => {
      if (chrome.runtime.lastError) {
        reject(new Error('[todo-storage] get ' + key + ' failed: ' +
          chrome.runtime.lastError.message));
        return;
      }
      resolve(data[key]);
    });
  });
}

/** 写入 storage.local 单个键 */
function setLocal(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error('[todo-storage] set ' + key + ' failed: ' +
          chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

/** 删除 storage.local 单个键 */
function removeLocal(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      if (chrome.runtime.lastError) {
        reject(new Error('[todo-storage] remove ' + key + ' failed: ' +
          chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

/** 读取所有 todo_items_<id> 的内容，组装为 Map<listId, items[]> */
async function getAllItemBuckets() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(null, (data) => {
      if (chrome.runtime.lastError) {
        reject(new Error('[todo-storage] getAll failed: ' +
          chrome.runtime.lastError.message));
        return;
      }
      const out = new Map();
      for (const k of Object.keys(data)) {
        if (k.startsWith(ITEM_KEY_PREFIX)) {
          const listId = k.slice(ITEM_KEY_PREFIX.length);
          out.set(listId, Array.isArray(data[k]) ? data[k] : []);
        }
      }
      resolve(out);
    });
  });
}

/** 规范化清单名：trim + 限长 1..60 */
function normalizeListName(name) {
  if (typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (trimmed.length === 0) return '';
  return trimmed.slice(0, 60);
}

// ── 清单 CRUD ──

/**
 * 读取所有清单（按 order asc、createdAt asc 稳定排序）。
 * @returns {Promise<TodoList[]>}
 */
async function loadLists() {
  const raw = await getLocal(KEY_LISTS);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(l => l && typeof l.id === 'string' && typeof l.name === 'string')
    .slice()
    .sort((a, b) => {
      const oa = typeof a.order === 'number' ? a.order : 0;
      const ob = typeof b.order === 'number' ? b.order : 0;
      if (oa !== ob) return oa - ob;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
}

/** 直接写回清单索引（无业务校验，供 reorderLists 等内部场景使用） */
async function saveLists(lists) {
  if (!Array.isArray(lists)) {
    throw new Error('[todo-storage] saveLists: lists must be array');
  }
  await setLocal(KEY_LISTS, lists);
}

/**
 * 创建清单。name 缺省或空 → "未命名清单"；自动分配 order = max(order)+1。
 * @returns {Promise<TodoList>}
 */
async function createList(name) {
  const lists = await loadLists();
  const finalName = normalizeListName(name) || '未命名清单';
  const maxOrder = lists.reduce((m, l) =>
    Math.max(m, typeof l.order === 'number' ? l.order : 0), 0);
  const now = Date.now();
  const list = {
    id: generateId(),
    name: finalName,
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };
  lists.push(list);
  await saveLists(lists);
  // 同步初始化一个空的 items 桶（便于外部 getItems 永远返回 []）
  await setLocal(itemKey(list.id), []);
  return list;
}

/** 重命名清单；不存在或名称空时 throw */
async function renameList(id, name) {
  const finalName = normalizeListName(name);
  if (!finalName) {
    throw new Error('[todo-storage] renameList: name cannot be empty');
  }
  const lists = await loadLists();
  const idx = lists.findIndex(l => l.id === id);
  if (idx === -1) {
    throw new Error('[todo-storage] renameList: list not found: ' + id);
  }
  lists[idx] = Object.assign({}, lists[idx], {
    name: finalName,
    updatedAt: Date.now(),
  });
  await saveLists(lists);
}

/**
 * 删除清单（同时删除其 items 桶）。**不删除**任何引用该清单的 template。
 * 模板是"待办内容快照"，对原清单的生命周期无依赖（设计稿 8.边界：删除清单由用户决定后果）。
 * @returns {Promise<void>}
 */
async function deleteList(id) {
  const lists = await loadLists();
  const filtered = lists.filter(l => l.id !== id);
  if (filtered.length === lists.length) {
    throw new Error('[todo-storage] deleteList: list not found: ' + id);
  }
  await saveLists(filtered);
  await removeLocal(itemKey(id));
  // 若删除的是「今日待办」，清掉 today_list_id 标记
  const todayId = await getLocal(KEY_TODAY_LIST_ID);
  if (todayId === id) {
    await removeLocal(KEY_TODAY_LIST_ID);
  }
}

/**
 * 按 orderedIds 顺序重写清单的 order 字段。
 * 当前产品决定：清单不在 UI 暴露拖拽入口，本函数主要为后续扩展预留 + 内部使用。
 * @param {string[]} orderedIds
 */
async function reorderLists(orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new Error('[todo-storage] reorderLists: orderedIds must be non-empty array');
  }
  const lists = await loadLists();
  const map = new Map(lists.map(l => [l.id, l]));
  let i = 1;
  for (const id of orderedIds) {
    const l = map.get(id);
    if (!l) continue;
    l.order = i++;
  }
  await saveLists(lists);
}

// ── 待办项 CRUD ──

/**
 * 读取指定清单的待办项。已完成的自动沉底（completed=false 在前，按 order asc）。
 * @param {string} listId
 * @returns {Promise<TodoItem[]>}
 */
async function loadItems(listId) {
  const raw = await getLocal(itemKey(listId));
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(it => it && typeof it.id === 'string' && typeof it.content === 'string')
    .slice()
    .sort(sortItems);
}

/** 整存整取 items（一般仅供内部使用） */
async function saveItems(listId, items) {
  if (!Array.isArray(items)) {
    throw new Error('[todo-storage] saveItems: items must be array');
  }
  await setLocal(itemKey(listId), items);
}

/** 排序：未完成在前（按 order asc），完成后置（按 order asc） */
function sortItems(a, b) {
  if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
  const oa = typeof a.order === 'number' ? a.order : 0;
  const ob = typeof b.order === 'number' ? b.order : 0;
  if (oa !== ob) return oa - ob;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

/**
 * 添加一条待办。content 空（trim 后）拒绝并 throw。
 * @param {string} listId
 * @param {string} content
 * @returns {Promise<TodoItem>}
 */
async function addItem(listId, content) {
  if (typeof content !== 'string') {
    throw new Error('[todo-storage] addItem: content must be string');
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error('[todo-storage] addItem: content cannot be empty');
  }
  const items = await loadItems(listId);
  // order 取所有未完成的 max+1（完成的 item.order 不参与，避免完成项被推到前面）
  const uncompleted = items.filter(it => !it.completed);
  const maxOrder = uncompleted.reduce((m, it) =>
    Math.max(m, typeof it.order === 'number' ? it.order : 0), 0);
  const now = Date.now();
  const item = {
    id: generateId(),
    listId: listId,
    content: trimmed,
    completed: false,
    order: maxOrder + 1,
    createdAt: now,
    completedAt: null,
  };
  items.push(item);
  await saveItems(listId, items);
  // 顺手 touch 一下清单 updatedAt
  await touchListUpdatedAt(listId);
  return item;
}

/** 切换完成状态；写 completedAt / 取消时清 null */
async function toggleItem(listId, itemId) {
  const items = await loadItems(listId);
  const idx = items.findIndex(it => it.id === itemId);
  if (idx === -1) {
    throw new Error('[todo-storage] toggleItem: item not found: ' + itemId);
  }
  const now = Date.now();
  const wasCompleted = !!items[idx].completed;
  items[idx] = Object.assign({}, items[idx], {
    completed: !wasCompleted,
    completedAt: wasCompleted ? null : now,
  });
  await saveItems(listId, items);
  await touchListUpdatedAt(listId);
}

/** 删除一条待办 */
async function deleteItem(listId, itemId) {
  const items = await loadItems(listId);
  const filtered = items.filter(it => it.id !== itemId);
  if (filtered.length === items.length) {
    throw new Error('[todo-storage] deleteItem: item not found: ' + itemId);
  }
  await saveItems(listId, filtered);
  await touchListUpdatedAt(listId);
}

/** 更新清单 updatedAt 字段（内部辅助） */
async function touchListUpdatedAt(listId) {
  try {
    const lists = await loadLists();
    const idx = lists.findIndex(l => l.id === listId);
    if (idx === -1) return;
    lists[idx] = Object.assign({}, lists[idx], { updatedAt: Date.now() });
    await saveLists(lists);
  } catch (_) {
    // 静默失败：不阻塞主流程
  }
}

// ── 模板 CRUD ──

/**
 * 读取所有模板（按 updatedAt desc）。
 * @returns {Promise<Template[]>}
 */
async function loadTemplates() {
  const raw = await getLocal(KEY_TEMPLATES);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(t => t && typeof t.id === 'string' && typeof t.name === 'string' &&
                 Array.isArray(t.items))
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** 整存模板数组 */
async function saveTemplates(templates) {
  if (!Array.isArray(templates)) {
    throw new Error('[todo-storage] saveTemplates: must be array');
  }
  await setLocal(KEY_TEMPLATES, templates);
}

/**
 * 把当前清单的待办内容快照为模板。**不含状态/时间戳**，仅 items.content 文本列表。
 * @param {string} listId
 * @param {string} [templateName] 缺省取清单名
 * @returns {Promise<Template>}
 */
async function saveAsTemplate(listId, templateName) {
  const lists = await loadLists();
  const list = lists.find(l => l.id === listId);
  if (!list) {
    throw new Error('[todo-storage] saveAsTemplate: list not found: ' + listId);
  }
  const items = await loadItems(listId);
  const name = normalizeListName(templateName) || list.name;
  const now = Date.now();
  const template = {
    id: generateId(),
    name: name,
    items: items
      .map(it => it.content)
      .filter(s => typeof s === 'string' && s.trim().length > 0),
    createdAt: now,
    updatedAt: now,
  };
  const templates = await loadTemplates();
  templates.push(template);
  await saveTemplates(templates);
  return template;
}

/** 删除模板 */
async function deleteTemplate(templateId) {
  const templates = await loadTemplates();
  const filtered = templates.filter(t => t.id !== templateId);
  if (filtered.length === templates.length) {
    throw new Error('[todo-storage] deleteTemplate: not found: ' + templateId);
  }
  await saveTemplates(filtered);
}

/**
 * 用模板创建新清单（清单名缺省=模板名），并把模板 items 全部添加为未完成待办。
 * @param {string} templateId
 * @param {string} [listName]
 * @returns {Promise<TodoList>}
 */
async function createListFromTemplate(templateId, listName) {
  const templates = await loadTemplates();
  const tpl = templates.find(t => t.id === templateId);
  if (!tpl) {
    throw new Error('[todo-storage] createListFromTemplate: not found: ' + templateId);
  }
  const list = await createList(listName || tpl.name);
  // 顺序插入，保持模板原顺序
  for (const text of tpl.items) {
    await addItem(list.id, text);
  }
  return list;
}

/**
 * 把模板内容追加到现有清单末尾。
 * @param {string} templateId
 * @param {string} listId
 * @returns {Promise<{added: number}>} 本次实际添加条数（过滤空字符串后）
 */
async function copyTemplateToList(templateId, listId) {
  const templates = await loadTemplates();
  const tpl = templates.find(t => t.id === templateId);
  if (!tpl) {
    throw new Error('[todo-storage] copyTemplateToList: not found: ' + templateId);
  }
  const lists = await loadLists();
  if (!lists.some(l => l.id === listId)) {
    throw new Error('[todo-storage] copyTemplateToList: list not found: ' + listId);
  }
  let added = 0;
  for (const text of tpl.items) {
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    await addItem(listId, text);
    added++;
  }
  return { added: added };
}

// ── 首启惰性创建 ──

/**
 * 惰性创建「今日待办」清单：
 *  - 若 todo_today_list_id 已存在且对应清单仍在 → 直接返回该清单
 *  - 否则创建新清单（名称"今日待办"），写入 todo_today_list_id，返回
 *
 * 幂等：连续调用不会重复创建。
 * @returns {Promise<TodoList>}
 */
async function getOrCreateTodayList() {
  const todayId = await getLocal(KEY_TODAY_LIST_ID);
  if (typeof todayId === 'string' && todayId.length > 0) {
    const lists = await loadLists();
    const exist = lists.find(l => l.id === todayId);
    if (exist) return exist;
    // id 已失效（清单被删了）→ 清理标记后继续创建
    await removeLocal(KEY_TODAY_LIST_ID);
  }
  const list = await createList('今日待办');
  await setLocal(KEY_TODAY_LIST_ID, list.id);
  return list;
}

// ── 导出（作为全局函数，供 todo.js / 测试用） ──
window.TodoStorage = {
  // keys（暴露给 todo.js 监听 storage.onChanged 时过滤用）
  KEY_LISTS,
  KEY_TEMPLATES,
  KEY_TODAY_LIST_ID,
  ITEM_KEY_PREFIX,
  // lists
  loadLists,
  saveLists,
  createList,
  renameList,
  deleteList,
  reorderLists,
  // items
  loadItems,
  saveItems,
  addItem,
  toggleItem,
  deleteItem,
  sortItems, // 暴露以便测试
  // templates
  loadTemplates,
  saveTemplates,
  saveAsTemplate,
  deleteTemplate,
  createListFromTemplate,
  copyTemplateToList,
  // misc
  getOrCreateTodayList,
  // 工具（供测试覆盖时 mock）
  getLocal,
  setLocal,
  removeLocal,
  getAllItemBuckets,
  generateId,
  itemKey,
  normalizeListName,
};
