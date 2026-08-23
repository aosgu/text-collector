/**
 * service-worker.js — Background Service Worker (MV3)
 *
 * 职责：
 *  - 首次安装时初始化 schemaVersion / collectEnabled，并注册右键菜单「Arena 对话导出」
 *  - 点击工具栏图标：打开或聚焦管理页（manifest 未设 default_popup，故 onClicked 会触发）；
 *    管理页默认 hash #collect（采集 tab），待办 tab 在页面内通过顶 Tab 切换
 *  - Ctrl+Shift+S 切换采集开关
 *  - 开关变化时同步工具栏 badge（关闭时显示 OFF）
 *  - 右键菜单「Arena 对话导出」：通知 arena 对话页内的内容脚本导出 Markdown，
 *    脚本未就绪（SPA 从非 /c/ 页进入对话页）时先经 chrome.scripting 补注入
 *
 * 采集逻辑在 content script 里直接读写 storage，本文件不做中转。
 */

const MANAGER_URL = chrome.runtime.getURL('manager/manager.html');

// 仅对话页（/c/ 路径）允许导出；菜单经 documentUrlPatterns 也只在对话页显示
const ARENA_PAGE_URL = /^https:\/\/(lm)?arena\.ai\/c\//i;

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

  // 注册右键菜单：先清空再创建，避免扩展更新/重载后残留同名菜单项
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'export-arena-md',
      title: 'Arena 对话导出',
      contexts: ['all'],
      documentUrlPatterns: ['https://arena.ai/c/*', 'https://lmarena.ai/c/*'],
    });
  });
});

// ── 右键菜单「Arena 对话导出」 → 内容脚本导出 ──
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'export-arena-md') return;
  if (typeof tab.id !== 'number') return;
  // 双重校验（documentUrlPatterns 已限制显示范围，这里再拦一次点击来源）
  if (!ARENA_PAGE_URL.test(info.pageUrl || tab.url || '')) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'EXPORT_ARENA_MD' });
  } catch {
    // 内容脚本未就绪（SPA 导航进入对话页）：补注入后重发消息
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/arena-exporter.js'],
      });
      await chrome.tabs.sendMessage(tab.id, { type: 'EXPORT_ARENA_MD' });
    } catch (_) {
      // 页面尚未加载完成等异常，静默忽略
    }
  }
});

// Service Worker 冷启动（浏览器重启后）时同步 badge，否则关闭状态会丢 badge
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get('collectEnabled');
  await updateBadge(data.collectEnabled !== false);
});

// ── SW 唤醒时兜底同步 badge ──
// onInstalled/onStartup 在某些唤醒场景（SW 被事件唤醒但不是浏览器重启）不会触发，
// 这里在脚本顶层直接读一次 storage 对齐 badge，保证用户每次都能看到正确状态。
chrome.storage.local.get('collectEnabled')
  .then(data => updateBadge(data.collectEnabled !== false))
  .catch(() => { /* storage 不可用时忽略 */ });

// 点击工具栏图标 → 打开或聚焦 manager.html（默认 #collect 采集页）。
// 待办 tab 通过 manager.html 顶 Tab 切换，不再有独立 todo 页面。
chrome.action.onClicked.addListener(async () => {
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
