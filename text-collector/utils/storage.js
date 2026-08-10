/**
 * storage.js — 分片存储读写工具
 * Content Script 和 Manager Page 共用
 */

const SCHEMA_VERSION = 1;

// ── 可配置常量 ──
const CONFIG = {
  // 存储相关
  DEDUP_CHECK_LIMIT: 500,        // 去重/扩选检查的最近记录数
  PAGE_SIZE: 50,                 // 管理页分页大小
  EXPORT_BATCH_SIZE: 100,        // 导出分批读取大小
  STORAGE_ESTIMATE_SAMPLES: 50,  // 存储估算采样数
  STORAGE_WARNING_THRESHOLD: 5000, // 存储警告阈值
  // 采集相关
  DEBOUNCE_MS: 500,             // 防抖延迟
  PAGE_LOAD_GRACE_MS: 2000,     // 页面加载初期保护（跳过 selection 恢复）
  MAX_TEXT_LENGTH: 5000,        // 最大文本长度
  MIN_CHINESE_CHARS: 5,         // 最小中文字数
  MIN_ENGLISH_WORDS: 3,         // 最小英文词数
  EXPAND_REPLACE_WINDOW_MS: 5000, // 扩选替换时间窗口
};

/** 生成 UUID v4 */
function generateUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 从 URL 提取 urlKey（origin + pathname，忽略 query 和 hash） */
function getUrlKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url || 'unknown';
  }
}

/** 从 URL 提取域名 */
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * 自动寻找并收领孤儿数据（存在 snip_* 但不在 snippets_order 中的记录），
 * 将它们合并回 snippets_order 中（按 capturedAt 降序），防止因并发写入导致的数据丢失。
 * @returns {Promise<number>} 收领的孤儿记录数
 */
async function adoptOrphanSnippets() {
  const allData = await chrome.storage.local.get(null);
  const order = allData.snippets_order || [];
  const orderSet = new Set(order);

  const orphanIds = [];
  const orphanRecords = [];
  for (const key of Object.keys(allData)) {
    if (key.startsWith('snip_')) {
      const id = key.replace('snip_', '');
      if (!orderSet.has(id)) {
        orphanIds.push(id);
        if (allData[key]) {
          orphanRecords.push(allData[key]);
        }
      }
    }
  }

  if (orphanIds.length === 0) {
    return 0;
  }

  // 按照 capturedAt 降序排序（最新在前），因为 order 是最新在前
  orphanRecords.sort((a, b) => b.capturedAt - a.capturedAt);
  const sortedOrphanIds = orphanRecords.map(r => r.id);

  // 合并并去重，重置 order
  const newOrder = [...sortedOrphanIds, ...order];
  const uniqueOrder = Array.from(new Set(newOrder));
  await chrome.storage.local.set({ snippets_order: uniqueOrder });

  return sortedOrphanIds.length;
}

/**
 * 写入一条新采集记录
 * @returns {Promise<{action: 'created'|'duplicate'|'replaced', record?: Object}>}
 */
async function addSnippet(text, url, title) {
  const urlKey = getUrlKey(url);
  const domain = getDomain(url);
  const now = Date.now();
  const normalizedText = text.normalize('NFC');

  // 读取现有记录列表
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];

  // [M3] 扩大检查范围，从 50 改为 DEDUP_CHECK_LIMIT
  const checkIds = order.slice(0, CONFIG.DEDUP_CHECK_LIMIT);
  const recentRecords = await chrome.storage.local.get(checkIds.map(id => `snip_${id}`));
  const recentSnippets = checkIds.map(id => recentRecords[`snip_${id}`]).filter(Boolean);

  // 1. 去重检查：同 urlKey + 完全相同文本
  const duplicate = recentSnippets.find(s => s.urlKey === urlKey && s.text === normalizedText);
  if (duplicate) {
    duplicate.lastSelectedAt = now;
    await chrome.storage.local.set({ [`snip_${duplicate.id}`]: duplicate });
    return { action: 'duplicate', record: duplicate };
  }

  // 2. 扩选替换检查：同 urlKey + 5秒内 + 新文本包含旧文本
  const replaceable = recentSnippets.find(s =>
    s.urlKey === urlKey &&
    (now - s.lastSelectedAt) < CONFIG.EXPAND_REPLACE_WINDOW_MS &&
    normalizedText.includes(s.text)
  );

  if (replaceable) {
    replaceable.text = normalizedText;
    replaceable.lastSelectedAt = now;
    await chrome.storage.local.set({ [`snip_${replaceable.id}`]: replaceable });
    return { action: 'replaced', record: replaceable };
  }

  // 3. 新增记录
  // [M1] 先单独写入 snip_* 数据（不同 snippet 的 key 互不冲突，解决并发覆盖问题）
  const id = generateUUID();
  const record = {
    id,
    text: normalizedText,
    url,
    urlKey,
    title: title || url,
    domain,
    capturedAt: now,
    lastSelectedAt: now,
  };

  await chrome.storage.local.set({ [`snip_${id}`]: record });

  // [M1] 重新读取最新 order 后再追加，缩小竞态窗口
  const latestOrderData = await chrome.storage.local.get('snippets_order');
  const latestOrder = latestOrderData.snippets_order || [];
  await chrome.storage.local.set({
    snippets_order: [id, ...latestOrder],
  });

  return { action: 'created', record };
}

/**
 * 删除一条记录
 */
async function deleteSnippet(id) {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  const newOrder = order.filter(oid => oid !== id);
  await chrome.storage.local.remove(`snip_${id}`);
  await chrome.storage.local.set({ snippets_order: newOrder });
}

/**
 * 清空所有记录
 * [L6] 使用 chrome.storage.local.clear() 避免并发写入竞态
 */
async function clearAllSnippets() {
  // 先获取需要删除的 keys，再用 remove 精确清理
  const allData = await chrome.storage.local.get(null);
  const keysToRemove = [];
  for (const key of Object.keys(allData)) {
    if (key.startsWith('snip_') || key === 'snippets_order') {
      keysToRemove.push(key);
    }
  }
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}

/**
 * 获取记录列表（分批）
 * @param {number} offset - 起始位置
 * @param {number} limit - 每批数量
 * @returns {Promise<{records: Array, total: number}>}
 */
async function getSnippets(offset = 0, limit = CONFIG.PAGE_SIZE) {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  const total = order.length;

  const pageIds = order.slice(offset, offset + limit);
  const recordsData = await chrome.storage.local.get(pageIds.map(id => `snip_${id}`));
  const records = pageIds.map(id => recordsData[`snip_${id}`]).filter(Boolean);

  return { records, total };
}

/**
 * 获取所有记录（用于导出）
 * [L4] 分批读取，避免大量 keys 一次性 get 的性能问题
 * @returns {Promise<Array>}
 */
async function getAllSnippets() {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];

  const allRecords = [];
  for (let i = 0; i < order.length; i += CONFIG.EXPORT_BATCH_SIZE) {
    const batchIds = order.slice(i, i + CONFIG.EXPORT_BATCH_SIZE);
    const batchData = await chrome.storage.local.get(batchIds.map(id => `snip_${id}`));
    const batchRecords = batchIds.map(id => batchData[`snip_${id}`]).filter(Boolean);
    allRecords.push(...batchRecords);
  }

  // 按时间正序排列（最早在前）
  allRecords.sort((a, b) => a.capturedAt - b.capturedAt);
  return allRecords;
}

/**
 * 获取采集开关状态
 */
async function getCollectEnabled() {
  const data = await chrome.storage.local.get('collectEnabled');
  return data.collectEnabled !== false; // 默认 true
}

/**
 * 设置采集开关状态
 */
async function setCollectEnabled(enabled) {
  await chrome.storage.local.set({ collectEnabled: enabled });
}

/**
 * 获取最早记录时间（用于清空确认提示）
 */
async function getEarliestDate() {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  if (order.length === 0) return null;

  // 读取最后一条（order 是最新在前，最后一条是最早的）
  const lastId = order[order.length - 1];
  const data = await chrome.storage.local.get(`snip_${lastId}`);
  const record = data[`snip_${lastId}`];
  return record ? record.capturedAt : null;
}

/**
 * 导入记录（合并去重）
 * [L3] 补充缺失字段的默认值
 * @returns {Promise<{imported: number, skipped: number}>}
 */
async function importSnippets(snippets) {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];

  // [Performance Optimization] 使用分批读取的 getAllSnippets()，避免一次性 get 大量 keys 的性能问题
  const existingRecords = await getAllSnippets();
  const existingKeys = new Set(existingRecords.map(r => `${r.urlKey}::${r.text}`));

  let imported = 0;
  let skipped = 0;
  const newEntries = {};

  for (const snip of snippets) {
    // 校验必填字段
    if (!snip.text || !snip.urlKey || !snip.capturedAt) {
      skipped++;
      continue;
    }

    const key = `${snip.urlKey}::${snip.text}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    const id = snip.id || generateUUID();
    // [L3] 补充缺失字段的默认值，确保导入记录结构完整
    newEntries[`snip_${id}`] = {
      id,
      text: snip.text,
      url: snip.url || '',
      urlKey: snip.urlKey,
      title: snip.title || '',
      domain: snip.domain || getDomain(snip.url || ''),
      capturedAt: snip.capturedAt,
      lastSelectedAt: snip.lastSelectedAt || snip.capturedAt,
    };
    existingKeys.add(key);
    imported++;
  }

  // 导入的记录按时间正序追加到 order 末尾（最早的在最后）
  const newIds = Object.keys(newEntries).map(k => k.replace('snip_', ''));
  await chrome.storage.local.set({
    ...newEntries,
    snippets_order: [...newIds.reverse(), ...order], // 新导入的放前面
  });

  return { imported, skipped };
}

/**
 * 估算存储占用（KB）
 * [L5] 增加采样数量以提高精度
 */
async function getStorageEstimate() {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  if (order.length === 0) return 0;

  const sampleSize = Math.min(CONFIG.STORAGE_ESTIMATE_SAMPLES, order.length);
  const sampleIds = order.slice(0, sampleSize);
  const sampleData = await chrome.storage.local.get(sampleIds.map(id => `snip_${id}`));
  let totalSize = 0;
  let validSamples = 0;
  for (const id of sampleIds) {
    const record = sampleData[`snip_${id}`];
    if (record) {
      totalSize += JSON.stringify(record).length;
      validSamples++;
    }
  }
  if (validSamples === 0) return 0;
  const avgSize = totalSize / validSamples;
  return Math.round((avgSize * order.length) / 1024);
}
