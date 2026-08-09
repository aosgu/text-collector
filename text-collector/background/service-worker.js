/**
 * service-worker.js — Background Service Worker
 * 安装初始化 + 点击图标打开管理页 + badge 状态管理 + 快捷键响应
 */

const MANAGER_URL = chrome.runtime.getURL('manager/manager.html');

// ── 安装初始化 ──
chrome.runtime.onInstalled.addListener(async () => {
  // 初始化 schemaVersion
  const data = await chrome.storage.local.get(['schemaVersion', 'collectEnabled']);
  const updates = {};

  if (data.schemaVersion === undefined) {
    updates.schemaVersion = 1;
  }
  if (data.collectEnabled === undefined) {
    updates.collectEnabled = true;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  // 更新 badge
  await updateBadge(data.collectEnabled !== false);
});

// ── 点击图标打开管理页 ──
chrome.action.onClicked.addListener(async () => {
  // 检查是否已有管理页打开
  const tabs = await chrome.tabs.query({ url: MANAGER_URL });
  if (tabs.length > 0) {
    // 切换到已打开的管理页
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: MANAGER_URL });
  }
});

// ── 快捷键：切换采集开关 ──
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-collect') return;

  const data = await chrome.storage.local.get('collectEnabled');
  const current = data.collectEnabled !== false;
  const newValue = !current;

  await chrome.storage.local.set({ collectEnabled: newValue });
  await updateBadge(newValue);
});

// ── 监听开关变化，更新 badge ──
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.collectEnabled) {
    const enabled = changes.collectEnabled.newValue !== false;
    updateBadge(enabled);
  }
});

// ── Badge 更新 ──
async function updateBadge(enabled) {
  if (enabled) {
    await chrome.action.setBadgeText({ text: '' });
  } else {
    await chrome.action.setBadgeText({ text: 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ color: '#888888' });
  }
}
