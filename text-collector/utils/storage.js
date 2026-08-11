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
 * 产生原因：v0.4 单数组写入竞态、order 写入时的小概率覆盖、历史版本数据残留、
 * clearAll 与并发写入的竞态等。正常流程下 addSnippet 已经先写 snip_* 再写 order，
 * 新数据不会成为孤儿；但为兜底，这里做带节流的定期扫描。
 *
 * 扫描策略（P1 修复）：
 *  - 24h 内仅扫描一次（避免每次打开管理页全量读 5MB），超过 24h 自动重扫
 *  - 若 order 为空但仍有 snip_*（clearAll 竞态典型），即使在节流期内也强制扫描
 *  - 扫描时若发现缺 id 的孤儿，会批量写回 snip_* 修复损坏
 *
 * @returns {Promise<number>} 本次收领的孤儿记录数
 */
async function adoptOrphanSnippets() {
  const ORPHAN_SCAN_FLAG = 'orphanScanV1';
  const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

  let shouldScan = true;
  let flagTime = 0;
  try {
    const meta = await chrome.storage.local.get(ORPHAN_SCAN_FLAG);
    flagTime = meta[ORPHAN_SCAN_FLAG] || 0;
    if (flagTime && (Date.now() - flagTime < SCAN_INTERVAL_MS)) {
      // 节流期内：先做轻量检查，若 order 非空则跳过全量扫描
      const orderCheck = await chrome.storage.local.get('snippets_order');
      const order = orderCheck.snippets_order || [];
      if (order.length > 0) {
        shouldScan = false;
      } else {
        // order 为空但可能仍有 snip_*（clearAll 竞态残留），需强制扫描
        shouldScan = true;
      }
    }
  } catch (_) { /* 元信息读取失败时继续扫描，宁可多扫一次也不丢数据 */ }

  if (!shouldScan) return 0;

  const allData = await chrome.storage.local.get(null);
  const order = allData.snippets_order || [];
  const orderSet = new Set(order);

  const orphanRecords = [];
  const dirtyFixes = {}; // 缺 id 的孤儿需写回 snip_*（P1-2）
  for (const key of Object.keys(allData)) {
    if (key.startsWith('snip_')) {
      const id = key.slice('snip_'.length);
      const record = allData[key];
      if (!orderSet.has(id) && record && typeof record === 'object') {
        if (!record.id) {
          record.id = id;
          dirtyFixes[key] = record;
        }
        if (typeof record.text === 'string' && record.text.length > 0) {
          orphanRecords.push(record);
        }
      }
    }
  }

  const updates = { [ORPHAN_SCAN_FLAG]: Date.now() };

  // 先写回缺 id 的孤儿修复（避免 order 有 id 但 snip_* 仍缺 id）
  const dirtyKeys = Object.keys(dirtyFixes);
  if (dirtyKeys.length > 0) {
    // 分批写回，避免单次 set 过大
    for (let i = 0; i < dirtyKeys.length; i += 100) {
      const batch = {};
      for (const k of dirtyKeys.slice(i, i + 100)) batch[k] = dirtyFixes[k];
      await chrome.storage.local.set(batch);
    }
  }

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

  // 重新读取最新 order 再 prepend，并带最多 3 次校验重试，缩小并发写入时的竞态窗口。
  // 两个标签页几乎同时走到这里时，后写者可能覆盖先写者；通过“写后校验 + 重试”把孤儿概率再降一个数量级
  // （数据本身不会丢，即使仍有极小概率成为孤儿，下次 orphan 扫描也会捞回）。
  let attempts = 0;
  while (attempts < 3) {
    const latestOrderData = await chrome.storage.local.get('snippets_order');
    const latestOrder = latestOrderData.snippets_order || [];
    if (latestOrder.includes(id)) break;
    const deduped = Array.from(new Set([id, ...latestOrder]));
    await chrome.storage.local.set({ snippets_order: deduped });
    // 写后校验：若仍不在 order 中说明又被并发覆盖，重试
    const verifyData = await chrome.storage.local.get('snippets_order');
    const verifyOrder = verifyData.snippets_order || [];
    if (verifyOrder.includes(id)) break;
    attempts++;
    // 微小退避，避免活锁
    if (attempts < 3) await new Promise(r => setTimeout(r, 20 * attempts));
  }

  return { action: 'created', record };
}

/**
 * 删除一条记录。
 * 流程与 addSnippet 一致：先 remove snip_<id>，再重新读取最新 order 再 filter-set，
 * 缩小与其他标签页并发写入时的竞态窗口（与 addSnippet 同等级的可接受概率）。
 */
async function deleteSnippet(id) {
  await chrome.storage.local.remove(`snip_${id}`);
  // 重新读取最新 order 再删，避免把另一个标签页刚 prepend 的新 id 一起覆盖掉
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  const newOrder = order.filter(oid => oid !== id);
  await chrome.storage.local.set({ snippets_order: newOrder });
}

/**
 * 纯函数：根据页面筛选条件过滤 ID 顺序列表
 * @param {Array} order ID 顺序列表
 * @param {Object} recordsMap 映射表 { 'snip_xxx': { id, saved, clearedFromHome, ... } }
 * @param {string} filter 筛选条件：'home' | 'saved' | 'all'
 * @returns {Array} 经过筛选后的 ID 列表
 */
function filterOrderRecords(order, recordsMap, filter = 'home') {
  if (!Array.isArray(order)) return [];
  if (filter === 'all') return order;
  return order.filter(id => {
    const r = recordsMap['snip_' + id];
    if (!r) return false;
    if (filter === 'saved') {
      return r.saved === true;
    } else if (filter === 'home') {
      return !r.clearedFromHome;
    }
    return true;
  });
}

/**
 * 获取过滤后的排序 ID 列表
 * @param {string} filter 'home' | 'saved' | 'all'
 */
async function getFilteredOrder(filter = 'home') {
  const orderData = await chrome.storage.local.get('snippets_order');
  const order = orderData.snippets_order || [];
  if (order.length === 0 || filter === 'all') return order;

  const recordsData = await chrome.storage.local.get(order.map(id => `snip_${id}`));
  return filterOrderRecords(order, recordsData, filter);
}

/**
 * 清空所有采集记录（首页）。
 * 清空首页时，未保存记录彻底删除；已保存（saved === true）记录保留并设 clearedFromHome=true，
 * 仅在其后显式出现在“已保存”页签中。
 */
async function clearAllSnippets() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const allData = await chrome.storage.local.get(null);
    const keysToRemove = [];
    const savedOrder = [];
    const updates = {};

    for (const key of Object.keys(allData)) {
      if (key.startsWith('snip_')) {
        const record = allData[key];
        if (record && record.saved === true) {
          record.clearedFromHome = true;
          updates[key] = record;
          savedOrder.push(record.id);
        } else {
          keysToRemove.push(key);
        }
      }
    }

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }

    const order = allData.snippets_order || [];
    const savedIdSet = new Set(savedOrder);
    const newOrder = order.filter(id => savedIdSet.has(id));

    updates.snippets_order = newOrder;
    await chrome.storage.local.set(updates);

    // 校验是否仍有未保存的残留记录
    const check = await chrome.storage.local.get(null);
    const remainingUnsaved = Object.keys(check).filter(k => {
      if (!k.startsWith('snip_')) return false;
      const rec = check[k];
      return !rec || rec.saved !== true;
    });
    if (remainingUnsaved.length === 0) {
      break;
    }
    await new Promise(r => setTimeout(r, 20));
  }
}

/**
 * 获取记录列表（分批）
 * @param {number} offset - 起始位置
 * @param {number} limit - 每批数量
 * @param {string} filter - 筛选类型 ('home' | 'saved' | 'all')
 * @returns {Promise<{records: Array, total: number}>}
 */
async function getSnippets(offset = 0, limit = CONFIG.PAGE_SIZE, filter = 'home') {
  const order = await getFilteredOrder(filter);
  const total = order.length;

  const pageIds = order.slice(offset, offset + limit);
  const recordsData = await chrome.storage.local.get(pageIds.map(id => `snip_${id}`));
  const records = pageIds.map(id => recordsData[`snip_${id}`]).filter(Boolean);

  return { records, total };
}

/**
 * 获取记录（用于导出）。分批读取，避免一次性 get 大量 key。
 * 返回结果按 capturedAt 升序（最早在前）。
 * @param {string} filter - 筛选类型 ('home' | 'saved' | 'all')
 * @returns {Promise<Array>}
 */
async function getAllSnippets(filter = 'all') {
  const order = await getFilteredOrder(filter);

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
 * 切换记录的收藏状态
 * @param {string} id 记录 ID
 * @returns {Promise<{action: string, record?: object, id?: string}|null>}
 */
async function toggleFavoriteSnippet(id) {
  const key = `snip_${id}`;
  const data = await chrome.storage.local.get(key);
  const record = data[key];
  if (!record) return null;

  record.saved = !record.saved;
  // 如果取消收藏，且该记录之前已被清空过（clearedFromHome=true），则将其彻底清理避免孤儿残留
  if (!record.saved && record.clearedFromHome) {
    await deleteSnippet(id);
    return { action: 'deleted', id };
  } else {
    await chrome.storage.local.set({ [key]: record });
    return { action: 'updated', record };
  }
}

/**
 * 编辑笔记的主体内容
 * @param {string} id 记录 ID
 * @param {string} newText 修改后的文本
 * @returns {Promise<object|null>}
 */
async function updateSnippetText(id, newText) {
  const key = `snip_${id}`;
  const data = await chrome.storage.local.get(key);
  const record = data[key];
  if (!record) return null;

  record.text = newText.trim();
  record.updatedAt = Date.now();
  await chrome.storage.local.set({ [key]: record });
  return record;
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
async function getEarliestDate(filter = 'home') {
  const order = await getFilteredOrder(filter);
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
    // 防御：跳过非对象 / null / 缺字段 / 字段类型错误的损坏项，
    // 避免一条坏记录让整批导入抛 TypeError 全部失败
    if (!snip || typeof snip !== 'object') { skipped++; continue; }
    if (typeof snip.text !== 'string' || snip.text.length === 0) { skipped++; continue; }
    if (typeof snip.urlKey !== 'string' || snip.urlKey.length === 0) { skipped++; continue; }
    if (typeof snip.capturedAt !== 'number' || !Number.isFinite(snip.capturedAt)) { skipped++; continue; }

    const key = `${snip.urlKey}::${snip.text}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    const id = (typeof snip.id === 'string' && snip.id.length > 0) ? snip.id : generateUUID();
    const url = typeof snip.url === 'string' ? snip.url : '';
    const title = typeof snip.title === 'string' ? snip.title : '';
    const domain = (typeof snip.domain === 'string' && snip.domain.length > 0)
      ? snip.domain
      : getDomain(url);
    const lastSelectedAt = (typeof snip.lastSelectedAt === 'number' && Number.isFinite(snip.lastSelectedAt))
      ? snip.lastSelectedAt
      : snip.capturedAt;

    // 补齐缺失字段，保证导入后记录结构完整
    newEntries[`snip_${id}`] = {
      id,
      text: snip.text,
      url,
      urlKey: snip.urlKey,
      title,
      domain,
      capturedAt: snip.capturedAt,
      lastSelectedAt,
      saved: snip.saved === true ? true : undefined,
      clearedFromHome: snip.clearedFromHome === true ? true : undefined,
      updatedAt: (typeof snip.updatedAt === 'number' && Number.isFinite(snip.updatedAt))
        ? snip.updatedAt
        : undefined,
    };
    existingKeys.add(key);
    imported++;
  }

  // 新记录 id 按对象插入顺序（即文件中的顺序）。reverse 后 prepend
  // 使导入文件中越靠后的（通常越新）越靠近列表顶部。
  const newIds = Object.keys(newEntries).map(k => k.replace('snip_', ''));

  // 分批写入：避免单次 set 携带 5000+ key 触发配额/序列化限流（P2-1）
  const entries = Object.entries(newEntries);
  const IMPORT_BATCH = 100;
  for (let i = 0; i < entries.length; i += IMPORT_BATCH) {
    const batch = Object.fromEntries(entries.slice(i, i + IMPORT_BATCH));
    await chrome.storage.local.set(batch);
  }
  // order 单独写入，保证即使中途失败，已写入的 snip_* 也能被下次 orphan 扫描捞回
  if (newIds.length > 0) {
    // 读取最新 order 再合并，避免与并发 addSnippet 的覆写；用拷贝避免 reverse 污染原数组
    const reversedIds = [...newIds].reverse();
    const latestOrderData = await chrome.storage.local.get('snippets_order');
    const latestOrder = latestOrderData.snippets_order || order;
    const finalOrder = Array.from(new Set([...reversedIds, ...latestOrder]));
    await chrome.storage.local.set({ snippets_order: finalOrder });
  }

  return { imported, skipped };
}

/**
 * 估算当前存储占用（KB）。
 * 均匀采样（P2）：当记录数远大于采样数时，不再只取前 50 条（可能全为短/长文本导致偏差），
 * 而是按步长均匀抽取，使平均值更接近全量。
 */
async function getStorageEstimate(filter = 'home') {
  const order = await getFilteredOrder(filter);
  if (order.length === 0) return 0;

  const sampleSize = Math.min(CONFIG.STORAGE_ESTIMATE_SAMPLES, order.length);
  let sampleIds;
  if (order.length <= CONFIG.STORAGE_ESTIMATE_SAMPLES) {
    sampleIds = order.slice(0, sampleSize);
  } else {
    // 均匀采样：步长 = 总数/采样数，避免头部偏差
    sampleIds = [];
    const step = order.length / sampleSize;
    for (let i = 0; i < sampleSize; i++) {
      sampleIds.push(order[Math.floor(i * step)]);
    }
  }
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
