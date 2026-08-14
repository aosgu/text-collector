/**
 * todo-storage 纯函数单元测试
 *
 * todo-storage.js 顶层会执行 `window.TodoStorage = { ... }` 赋值，
 * 但其内部函数全部依赖 chrome.storage.local 与 chrome.runtime.lastError。
 * 为此：
 *  - 先在 Node 环境 stub 出 `globalThis.chrome.storage.local`（get/set/remove）
 *    与 `globalThis.chrome.runtime.lastError`
 *  - 用 new Function 加载源码（在闭包外执行），捕获 window.TodoStorage
 *
 * 测试覆盖：
 *  - 清单 CRUD（loadLists / createList / renameList / deleteList / reorderLists）
 *  - 待办项 CRUD（loadItems / addItem / toggleItem / deleteItem）
 *  - 模板 CRUD（saveAsTemplate / createListFromTemplate / copyTemplateToList / deleteTemplate）
 *  - 首启惰性创建（getOrCreateTodayList 幂等性）
 *  - sortItems / normalizeListName 边界
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.resolve(HERE, '../utils/todo-storage.js');

// ── chrome.storage.local mock ──

/** 简易内存版 chrome.storage.local：get / set / remove / get(null) */
function makeStorageMock() {
  let store = {};
  const get = vi.fn((key, cb) => {
    if (typeof key === 'string') {
      cb({ [key]: store[key] });
    } else {
      cb(Object.assign({}, store));
    }
  });
  const set = vi.fn((obj, cb) => {
    Object.assign(store, obj);
    if (cb) cb();
  });
  const remove = vi.fn((key, cb) => {
    if (typeof key === 'string') {
      delete store[key];
    } else if (Array.isArray(key)) {
      key.forEach(k => delete store[k]);
    }
    if (cb) cb();
  });
  const reset = () => { store = {}; get.mockClear(); set.mockClear(); remove.mockClear(); };
  return { get, set, remove, reset, dump: () => Object.assign({}, store) };
}

let storageMock;
beforeEach(() => {
  storageMock = makeStorageMock();
  globalThis.chrome = {
    storage: { local: storageMock },
    runtime: { lastError: null },
  };
  // crypto.randomUUID（Node 19+ / vitest 4 自带；缺失时降级）
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
    globalThis.crypto = {
      randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2, 10),
    };
  }
  // 加载源码（new Function 不在闭包内执行；window 兜底为 globalThis）
  globalThis.window = globalThis;
  // eslint-disable-next-line no-new-func
  const load = new Function(readFileSync(SOURCE_PATH, 'utf8') + '\n;return window.TodoStorage;');
  // 每次重置让源码顶层重新执行（window 重新赋值）
  // 简化：直接用同一个引用，测试通过 .reset() 清空底层 store
  if (!globalThis.__TodoStorage) {
    globalThis.__TodoStorage = load();
  }
});

// ── 工具 ──
const TS = () => globalThis.__TodoStorage;

async function seedLists(items) {
  // 直接写 storage
  await new Promise((r) => storageMock.set({ todo_lists: items }, r));
}
async function seedItems(listId, items) {
  await new Promise((r) => storageMock.set({ ['todo_items_' + listId]: items }, r));
}
async function getLists() {
  const data = await new Promise((r) => storageMock.get('todo_lists', r));
  return data.todo_lists;
}
async function getItems(listId) {
  const data = await new Promise((r) => storageMock.get('todo_items_' + listId, r));
  return data['todo_items_' + listId];
}

// ── 测试 ──

describe('todo-storage: 基础', () => {
  it('暴露 TodoStorage 接口', () => {
    expect(TS()).toBeTypeOf('object');
    expect(TS().createList).toBeTypeOf('function');
    expect(TS().addItem).toBeTypeOf('function');
    expect(TS().getOrCreateTodayList).toBeTypeOf('function');
  });
});

describe('todo-storage: sortItems', () => {
  it('未完成在前（按 order asc），完成后置（按 order asc）', () => {
    const items = [
      { id: 'a', order: 3, completed: false },
      { id: 'b', order: 1, completed: true },
      { id: 'c', order: 2, completed: false },
      { id: 'd', order: 0, completed: true },
    ];
    const sorted = [...items].sort(TS().sortItems);
    // 未完成：c(2) < a(3)
    // 已完成：d(0) < b(1)
    expect(sorted.map(x => x.id)).toEqual(['c', 'a', 'd', 'b']);
  });
  it('同 completed + 同 order：按 createdAt 决胜', () => {
    const items = [
      { id: 'a', order: 1, completed: false, createdAt: 2 },
      { id: 'b', order: 1, completed: false, createdAt: 1 },
    ];
    const sorted = [...items].sort(TS().sortItems);
    expect(sorted.map(x => x.id)).toEqual(['b', 'a']);
  });
});

describe('todo-storage: normalizeListName', () => {
  it('trim + 限长 60', () => {
    expect(TS().normalizeListName('  hello  ')).toBe('hello');
    expect(TS().normalizeListName('')).toBe('');
    expect(TS().normalizeListName('   ')).toBe('');
    expect(TS().normalizeListName(null)).toBe('');
    expect(TS().normalizeListName(42)).toBe('');
    const long = 'x'.repeat(100);
    expect(TS().normalizeListName(long).length).toBe(60);
  });
});

describe('todo-storage: loadLists', () => {
  it('无数据 → []', async () => {
    const lists = await TS().loadLists();
    expect(lists).toEqual([]);
  });
  it('脏数据过滤 + 按 order 排序', async () => {
    await seedLists([
      { id: '1', name: 'B', order: 2, createdAt: 2 },
      { id: '2', name: 'A', order: 1, createdAt: 1 },
      null,
      { id: '3' /* 缺 name */ },
      { id: '4', name: 'C', order: 1, createdAt: 0 }, // 同 order 用 createdAt 决胜
    ]);
    const lists = await TS().loadLists();
    expect(lists.map(l => l.id)).toEqual(['4', '2', '1']);
  });
});

describe('todo-storage: createList', () => {
  it('name 缺省 → "未命名清单"；自动 order 递增', async () => {
    const a = await TS().createList();
    expect(a.name).toBe('未命名清单');
    expect(a.order).toBe(1);

    const b = await TS().createList('我的清单');
    expect(b.name).toBe('我的清单');
    expect(b.order).toBe(2);
  });
  it('创建后立即存在 items 空桶', async () => {
    const a = await TS().createList('X');
    const items = await TS().loadItems(a.id);
    expect(items).toEqual([]);
  });
  it('name trim 后为空 → "未命名清单"', async () => {
    const a = await TS().createList('   ');
    expect(a.name).toBe('未命名清单');
  });
});

describe('todo-storage: renameList', () => {
  it('成功改名 + 写 updatedAt', async () => {
    const a = await TS().createList('old');
    await new Promise(r => setTimeout(r, 5));
    await TS().renameList(a.id, '  new name  ');
    const lists = await getLists();
    expect(lists[0].name).toBe('new name');
    expect(lists[0].updatedAt).toBeGreaterThanOrEqual(a.createdAt);
  });
  it('空名 throw', async () => {
    const a = await TS().createList('x');
    await expect(TS().renameList(a.id, '   ')).rejects.toThrow(/cannot be empty/);
  });
  it('不存在的 id throw', async () => {
    await expect(TS().renameList('nope', 'x')).rejects.toThrow(/list not found/);
  });
});

describe('todo-storage: deleteList', () => {
  it('同时清掉 items 桶 + today_list_id 标记', async () => {
    const a = await TS().createList('to-delete');
    await seedItems(a.id, [{ id: 'i1', listId: a.id, content: 'x' }]);
    await new Promise(r => storageMock.set({ todo_today_list_id: a.id }, r));

    await TS().deleteList(a.id);

    const lists = await getLists();
    expect(lists).toEqual([]);
    const items = await getItems(a.id);
    expect(items).toBeUndefined();
    const today = await new Promise(r => storageMock.get('todo_today_list_id', r));
    expect(today.todo_today_list_id).toBeUndefined();
  });
  it('删除不存在的 id throw', async () => {
    await expect(TS().deleteList('nope')).rejects.toThrow(/list not found/);
  });
});

describe('todo-storage: reorderLists', () => {
  it('按入参顺序重写 order', async () => {
    const a = await TS().createList('A');
    const b = await TS().createList('B');
    const c = await TS().createList('C');
    await TS().reorderLists([c.id, a.id, b.id]);
    const lists = await TS().loadLists();
    expect(lists.map(l => l.id)).toEqual([c.id, a.id, b.id]);
    expect(lists.map(l => l.order)).toEqual([1, 2, 3]);
  });
  it('空数组 throw', async () => {
    await expect(TS().reorderLists([])).rejects.toThrow();
    await expect(TS().reorderLists(null)).rejects.toThrow();
  });
});

describe('todo-storage: addItem', () => {
  it('添加并按 sortItems 规则排（未完成按 order asc）', async () => {
    const a = await TS().createList('L');
    await TS().addItem(a.id, 'first');
    await TS().addItem(a.id, 'second');
    const items = await TS().loadItems(a.id);
    expect(items.map(it => it.content)).toEqual(['first', 'second']);
    expect(items.every(it => it.completed === false)).toBe(true);
  });
  it('空内容 throw', async () => {
    const a = await TS().createList('L');
    await expect(TS().addItem(a.id, '   ')).rejects.toThrow(/cannot be empty/);
  });
  it('order 不会与已完成项冲突', async () => {
    const a = await TS().createList('L');
    const i1 = await TS().addItem(a.id, 'x');
    await TS().toggleItem(a.id, i1.id); // 完成
    await TS().addItem(a.id, 'y');
    const items = await TS().loadItems(a.id);
    // 排序后：未完成 'y' 在前，'x' 完成后置
    expect(items[0].content).toBe('y');
    expect(items[1].content).toBe('x');
  });
});

describe('todo-storage: toggleItem / deleteItem', () => {
  it('toggle 写 completedAt；再次 toggle 清 null', async () => {
    const a = await TS().createList('L');
    const it = await TS().addItem(a.id, 'x');
    await TS().toggleItem(a.id, it.id);
    let items = await getItems(a.id);
    expect(items[0].completed).toBe(true);
    expect(items[0].completedAt).toBeTypeOf('number');
    await TS().toggleItem(a.id, it.id);
    items = await getItems(a.id);
    expect(items[0].completed).toBe(false);
    expect(items[0].completedAt).toBeNull();
  });
  it('toggle 不存在 id throw', async () => {
    const a = await TS().createList('L');
    await expect(TS().toggleItem(a.id, 'nope')).rejects.toThrow(/item not found/);
  });
  it('delete 移除单项', async () => {
    const a = await TS().createList('L');
    const i1 = await TS().addItem(a.id, 'x');
    await TS().addItem(a.id, 'y');
    await TS().deleteItem(a.id, i1.id);
    const items = await TS().loadItems(a.id);
    expect(items.map(it => it.content)).toEqual(['y']);
  });
  it('delete 不存在 id throw', async () => {
    const a = await TS().createList('L');
    await expect(TS().deleteItem(a.id, 'nope')).rejects.toThrow(/item not found/);
  });
});

describe('todo-storage: 模板', () => {
  it('saveAsTemplate 仅快照 content（不含状态/时间戳）', async () => {
    const a = await TS().createList('L');
    const i1 = await TS().addItem(a.id, 'one');
    await TS().addItem(a.id, 'two');
    await TS().toggleItem(a.id, i1.id); // 'one' 已完成
    const tpl = await TS().saveAsTemplate(a.id, '模板名');
    expect(tpl.name).toBe('模板名');
    // 完成后'one'已沉底，loadItems 返回顺序为 ['two', 'one']；
    // saveAsTemplate 取的是 loadItems 的顺序（"完成后置"的展示顺序），不是创建顺序
    expect(tpl.items).toEqual(['two', 'one']);
    // 仅快照 content 文本，无 id / completed / 时间戳
    tpl.items.forEach(x => expect(typeof x).toBe('string'));
    const list = await getLists();
    expect(list.find(l => l.id === a.id)).toBeTruthy();
  });
  it('saveAsTemplate 取未完成项的展示顺序（与工作台一致）', async () => {
    const a = await TS().createList('L');
    await TS().addItem(a.id, 'a');
    await TS().addItem(a.id, 'b');
    await TS().addItem(a.id, 'c');
    const tpl = await TS().saveAsTemplate(a.id);
    expect(tpl.items).toEqual(['a', 'b', 'c']);
  });
  it('createListFromTemplate 用模板建新清单并按顺序插入所有项', async () => {
    const a = await TS().createList('L');
    await TS().addItem(a.id, 'one');
    await TS().addItem(a.id, 'two');
    const tpl = await TS().saveAsTemplate(a.id);

    const newList = await TS().createListFromTemplate(tpl.id, '复刻');
    expect(newList.name).toBe('复刻');
    const items = await TS().loadItems(newList.id);
    expect(items.map(it => it.content)).toEqual(['one', 'two']);
    expect(items.every(it => it.completed === false)).toBe(true);
  });
  it('copyTemplateToList 追加到现有清单', async () => {
    const a = await TS().createList('L');
    await TS().addItem(a.id, 'one');
    const tpl = await TS().saveAsTemplate(a.id);

    const b = await TS().createList('B');
    await TS().addItem(b.id, 'pre-existing');
    const r = await TS().copyTemplateToList(tpl.id, b.id);
    expect(r.added).toBe(1);
    const items = await TS().loadItems(b.id);
    expect(items.map(it => it.content)).toEqual(['pre-existing', 'one']);
  });
  it('copyTemplateToList 过滤空字符串后返回实际 added 数', async () => {
    const a = await TS().createList('L');
    const tpl = {
      id: 't1', name: 'tpl', items: ['a', '', '  ', 'b'],
      createdAt: 1, updatedAt: 1,
    };
    await new Promise(r => storageMock.set({ todo_templates: [tpl] }, r));
    const b = await TS().createList('B');
    const r2 = await TS().copyTemplateToList('t1', b.id);
    expect(r2.added).toBe(2);
  });
  it('deleteTemplate 移除模板', async () => {
    const tpl = {
      id: 't1', name: 'tpl', items: ['x'],
      createdAt: 1, updatedAt: 1,
    };
    await new Promise(r => storageMock.set({ todo_templates: [tpl] }, r));
    await TS().deleteTemplate('t1');
    const all = await TS().loadTemplates();
    expect(all).toEqual([]);
  });
  it('deleteTemplate 不存在 id throw', async () => {
    await expect(TS().deleteTemplate('nope')).rejects.toThrow(/not found/);
  });
});

describe('todo-storage: getOrCreateTodayList', () => {
  it('首次调用：创建「今日待办」并写 today_list_id', async () => {
    const list = await TS().getOrCreateTodayList();
    expect(list.name).toBe('今日待办');
    const today = await new Promise(r => storageMock.get('todo_today_list_id', r));
    expect(today.todo_today_list_id).toBe(list.id);
  });
  it('幂等：再次调用返回同一清单，不创建新的', async () => {
    const a = await TS().getOrCreateTodayList();
    const b = await TS().getOrCreateTodayList();
    expect(b.id).toBe(a.id);
    const lists = await getLists();
    expect(lists).toHaveLength(1);
  });
  it('清单被删后再次调用会重新创建并更新 today_list_id', async () => {
    const a = await TS().getOrCreateTodayList();
    await TS().deleteList(a.id);
    const b = await TS().getOrCreateTodayList();
    expect(b.id).not.toBe(a.id);
    expect(b.name).toBe('今日待办');
    const today = await new Promise(r => storageMock.get('todo_today_list_id', r));
    expect(today.todo_today_list_id).toBe(b.id);
  });
});

describe('todo-storage: getAllItemBuckets', () => {
  it('汇总所有 todo_items_<id> 键为 Map', async () => {
    const a = await TS().createList('A');
    const b = await TS().createList('B');
    await seedItems(a.id, [{ id: 'x', listId: a.id, content: '1' }]);
    await seedItems(b.id, [{ id: 'y', listId: b.id, content: '2' }]);
    const map = await TS().getAllItemBuckets();
    expect(map.size).toBe(2);
    expect(map.get(a.id)).toHaveLength(1);
    expect(map.get(b.id)).toHaveLength(1);
  });
  it('无清单时返回空 Map', async () => {
    const map = await TS().getAllItemBuckets();
    expect(map.size).toBe(0);
  });
  it('createList 后会预创建空 items 桶（getAllItemBuckets 看到 1）', async () => {
    await TS().createList('A');
    const map = await TS().getAllItemBuckets();
    expect(map.size).toBe(1);
    expect(map.get((await getLists())[0].id)).toEqual([]);
  });
});
