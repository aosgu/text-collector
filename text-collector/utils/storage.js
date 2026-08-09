/**
 * storage.js — 分片存储读写工具
 * Content Script 和 Manager Page 共用
 */

const SCHEMA_VERSION = 1;

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

  // 批量读取最近 50 条记录做去重和扩选检查
  const recentIds = order.slice(0, 50);
  const recentRecords = await chrome.storage.local.get(recentIds.map(id => `snip_${id}`));
  const recentSnippets = recentIds.map(id => recentRecords[`snip_${id}`]).filter(Boolean);

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
    (now - s.lastSelectedAt) < 5000 &&
    normalizedText.includes(s.text)
  );

  if (replaceable) {
    replaceable.text = normalizedText;
    replaceable.lastSelectedAt = now;
    await chrome.storage.local.set({ [`snip_${replaceable.id}`]: replaceable });
    return { action: 'replaced', record: replaceable };
  }

  // 3. 新增记录
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

  await chrome.storage.local.set({
    [`snip_${id}`]: record,
    snippets_order: [id, ...order],
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
 */
async function clearAllSnippets() {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  const keysToRemove = order.map(id => `snip_${id}`);
  keysToRemove.push('snippets_order');
  await chrome.storage.local.remove(keysToRemove);
}

/**
 * 获取记录列表（分批）
 * @param {number} offset - 起始位置
 * @param {number} limit - 每批数量
 * @returns {Promise<{records: Array, total: number}>}
 */
async function getSnippets(offset = 0, limit = 50) {
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
 * @returns {Promise<Array>}
 */
async function getAllSnippets() {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  const allData = await chrome.storage.local.get(order.map(id => `snip_${id}`));
  const records = order.map(id => allData[`snip_${id}`]).filter(Boolean);
  // 按时间正序排列（最早在前）
  records.sort((a, b) => a.capturedAt - b.capturedAt);
  return records;
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
 * @returns {Promise<{imported: number, skipped: number}>}
 */
async function importSnippets(snippets) {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];

  // 读取现有记录用于去重
  const existingData = await chrome.storage.local.get(order.map(id => `snip_${id}`));
  const existingRecords = order.map(id => existingData[`snip_${id}`]).filter(Boolean);

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
    newEntries[`snip_${id}`] = { ...snip, id };
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
 */
async function getStorageEstimate() {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  if (order.length === 0) return 0;

  // 抽样前 10 条估算平均大小
  const sampleIds = order.slice(0, Math.min(10, order.length));
  const sampleData = await chrome.storage.local.get(sampleIds.map(id => `snip_${id}`));
  let totalSize = 0;
  for (const id of sampleIds) {
    const record = sampleData[`snip_${id}`];
    if (record) {
      totalSize += JSON.stringify(record).length;
    }
  }
  const avgSize = totalSize / sampleIds.length;
  return Math.round((avgSize * order.length) / 1024);
}
