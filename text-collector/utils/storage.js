/**
 * storage.js — 分片存储读写工具（Content Script 与 Manager 共用）
 *
 * 每条采集记录独立存为 snip_<uuid>，snippets_order 保存有序 id 列表，
 * 避免单数组在并发写入时相互覆盖。CONFIG 集中管理阈值常量。
 */

const SCHEMA_VERSION = 1;

// ── 可配置常量 ──
const CONFIG = {
  // 存储
  DEDUP_CHECK_LIMIT: 500,          // 去重/扩选检查的最近记录数
  PAGE_SIZE: 50,                   // 管理页分页大小
  EXPORT_BATCH_SIZE: 100,          // 导出时分批读取的批次大小
  STORAGE_ESTIMATE_SAMPLES: 50,    // 存储占用估算的采样数
  STORAGE_WARNING_THRESHOLD: 5000, // 超过该条数时管理页给出备份提示
  // 采集
  DEBOUNCE_MS: 500,                // selectionchange 防抖延迟
  PAGE_LOAD_GRACE_MS: 2000,        // 页面加载后跳过选区恢复的保护时长
  MAX_TEXT_LENGTH: 5000,           // 单条记录最大字符数（超出截断）
  MIN_CHINESE_CHARS: 5,            // 纯中文最小字数
  MIN_ENGLISH_WORDS: 3,            // 纯英文最小词数
  EXPAND_REPLACE_WINDOW_MS: 5000,  // 同 URL 下扩选替换的时间窗口
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
 * 收领「孤儿」记录：存在 snip_<id> 但不在 snippets_order 中的数据。
 *
 * 产生原因：v0.4 单数组写入竞态、order 写入时的小概率覆盖、历史版本数据残留等。
 * 正常流程下 addSnippet 已经先写 snip_* 再写 order，新数据不会成为孤儿；
 * 这里只做一次启动时的修复扫描，扫描完成后写入 orphanScanV1 时间戳，后续直接跳过。
 * 如需强制重新扫描，递增标记名即可（例如 orphanScanV2）。
 *
 * @returns {Promise<number>} 本次收领的孤儿记录数
 */
async function adoptOrphanSnippets() {
  const ORPHAN_SCAN_FLAG = 'orphanScanV1';

  try {
    const meta = await chrome.storage.local.get(ORPHAN_SCAN_FLAG);
    if (meta[ORPHAN_SCAN_FLAG]) return 0;
  } catch (_) { /* 元信息读取失败时继续扫描，宁可多扫一次也不丢数据 */ }

  const allData = await chrome.storage.local.get(null);
  const order = allData.snippets_order || [];
  const orderSet = new Set(order);

  const orphanRecords = [];
  for (const key of Object.keys(allData)) {
    if (key.startsWith('snip_')) {
      const id = key.slice('snip_'.length);
      const record = allData[key];
      // 必须是带有效 id 的对象；损坏/空值不收领，避免把 undefined 写进 order
      if (!orderSet.has(id) && record && typeof record === 'object') {
        if (!record.id) record.id = id;
        if (typeof record.text === 'string' && record.text.length > 0) {
          orphanRecords.push(record);
        }
      }
    }
  }

  const updates = { [ORPHAN_SCAN_FLAG]: Date.now() };

  if (orphanRecords.length > 0) {
    orphanRecords.sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
    const sortedOrphanIds = orphanRecords.map(r => r.id).filter(Boolean);
    const newOrder = [...sortedOrphanIds, ...order];
    updates.snippets_order = Array.from(new Set(newOrder));
  }

  await chrome.storage.local.set(updates);
  return orphanRecords.length;
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

  // 读取现有 order，只检查最近 N 条，避免每次写入都扫全表
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];

  const checkIds = order.slice(0, CONFIG.DEDUP_CHECK_LIMIT);
  const recentRecords = await chrome.storage.local.get(checkIds.map(id => `snip_${id}`));
  const recentSnippets = checkIds.map(id => recentRecords[`snip_${id}`]).filter(Boolean);

  // 1) 同 URL + 完全相同文本 → 更新时间戳，不新增
  const duplicate = recentSnippets.find(s => s.urlKey === urlKey && s.text === normalizedText);
  if (duplicate) {
    duplicate.lastSelectedAt = now;
    await chrome.storage.local.set({ [`snip_${duplicate.id}`]: duplicate });
    return { action: 'duplicate', record: duplicate };
  }

  // 2) 同 URL + 时间窗口内 + 新文本包含旧文本（扩选）→ 替换旧记录
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

  // 3) 都不命中 → 新增。先写 snip_<id>（不同 key 互不覆盖），再把 id prepend 到 order
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

  // 重新读取最新 order 再 prepend，缩小并发写入时的竞态窗口。
  // 注意：两个标签页几乎同时走到这里时，后写者仍可能覆盖先写者的 order 追加
  // （数据本身不会丢，下次 orphan 扫描可捞回）。单用户场景概率极低，可接受。
  const latestOrderData = await chrome.storage.local.get('snippets_order');
  const latestOrder = latestOrderData.snippets_order || [];
  // 防御：若 id 已在 order 中（极端重入），不重复 prepend
  if (!latestOrder.includes(id)) {
    await chrome.storage.local.set({
      snippets_order: [id, ...latestOrder],
    });
  }

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
 * 清空所有采集记录（snip_* 与 snippets_order）。
 * 不使用 storage.local.clear()，以免误删 schemaVersion / collectEnabled / orphanScanV1 等元数据。
 */
async function clearAllSnippets() {
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
 * 获取全部记录（用于导出）。分批读取，避免一次性 get 大量 key。
 * 返回结果按 capturedAt 升序（最早在前）。
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
 * 获取采集开关状态。未设置时默认开启（true）。
 */
async function getCollectEnabled() {
  const data = await chrome.storage.local.get('collectEnabled');
  return data.collectEnabled !== false;
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

  // order 是最新在前，因此最后一条即最早记录
  const lastId = order[order.length - 1];
  const data = await chrome.storage.local.get(`snip_${lastId}`);
  const record = data[`snip_${lastId}`];
  return record ? record.capturedAt : null;
}

/**
 * 导入记录，与现有数据合并去重。
 * 去重键为 `${urlKey}::${text}`；缺失字段会补齐默认值。
 * 新导入的记录按 capturedAt 降序 prepend 到 order 头部。
 *
 * @param {Array} snippets 待导入的记录数组
 * @returns {Promise<{imported: number, skipped: number}>}
 */
async function importSnippets(snippets) {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];

  // 用现有全量记录构建去重集合
  const existingRecords = await getAllSnippets();
  const existingKeys = new Set(existingRecords.map(r => `${r.urlKey}::${r.text}`));

  let imported = 0;
  let skipped = 0;
  const newEntries = {};

  for (const snip of snippets) {
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
    // 补齐缺失字段，保证导入后记录结构完整
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

  // 新记录 id 按对象插入顺序（即文件中的顺序）。reverse 后 prepend
  // 使导入文件中越靠后的（通常越新）越靠近列表顶部。
  const newIds = Object.keys(newEntries).map(k => k.replace('snip_', ''));
  await chrome.storage.local.set({
    ...newEntries,
    snippets_order: [...newIds.reverse(), ...order],
  });

  return { imported, skipped };
}

/**
 * 估算当前存储占用（KB）。
 * 取最近 N 条记录作为样本，计算平均大小后乘以总数。
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
