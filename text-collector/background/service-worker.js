/**
 * service-worker.js — Background Service Worker (MV3)
 *
 * 职责：
 *  - 首次安装时初始化 schemaVersion / collectEnabled
 *  - 点击工具栏图标：打开或聚焦管理页（manifest 未设 default_popup，故 onClicked 会触发）
 *  - Ctrl+Shift+S 切换采集开关
 *  - 开关变化时同步工具栏 badge（关闭时显示 OFF）
 *
 * 采集逻辑在 content script 里直接读写 storage，本文件不做中转。
 */

const MANAGER_URL = chrome.runtime.getURL('manager/manager.html');

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['schemaVersion', 'collectEnabled']);
  const updates = {};

  if (data.schemaVersion === undefined) updates.schemaVersion = 1;
  if (data.collectEnabled === undefined) updates.collectEnabled = true;

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  // 安装/更新后立刻根据当前开关状态刷新一次 badge
  // 注意：updates 可能刚把 collectEnabled 写成 true，要以最终值为准
  const enabled = updates.collectEnabled !== undefined
    ? updates.collectEnabled
    : data.collectEnabled !== false;
  await updateBadge(enabled);
});

// Service Worker 冷启动（浏览器重启后）时同步 badge，否则关闭状态会丢 badge
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get('collectEnabled');
  await updateBadge(data.collectEnabled !== false);
});

// SW 每次被唤醒时也尽量对齐一次（onStartup 在部分场景不触发）
chrome.storage.local.get('collectEnabled')
  .then(data => updateBadge(data.collectEnabled !== false))
  .catch(() => { /* storage 不可用时忽略 */ });

chrome.action.onClicked.addListener(async () => {
  // 若管理页已经打开，直接切过去，避免重复开 tab
  const tabs = await chrome.tabs.query({ url: MANAGER_URL });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: MANAGER_URL });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-collect') return;

  const data = await chrome.storage.local.get('collectEnabled');
  const current = data.collectEnabled !== false; // 未设置视为开启
  const newValue = !current;
  await chrome.storage.local.set({ collectEnabled: newValue });
  await updateBadge(newValue);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.collectEnabled) {
    updateBadge(changes.collectEnabled.newValue !== false);
  }
});

/**
 * 更新工具栏 badge。
 * 开启 → 不显示 badge（图标本身足够辨识）；关闭 → 灰色「OFF」提醒用户当前不采集。
 */
async function updateBadge(enabled) {
  if (enabled) {
    await chrome.action.setBadgeText({ text: '' });
  } else {
    await chrome.action.setBadgeText({ text: 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ color: '#9a9890' });
    await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  }
}
