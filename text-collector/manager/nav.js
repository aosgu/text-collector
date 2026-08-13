/**
 * nav.js — 管理页网站导航（快捷方式面板）
 *
 * 管理页被当作「新标签页」使用；本模块提供类似 Chrome 新标签页固定网站快捷方式的能力：
 * hover 头部导航图标展开分栏面板（交互参考 zed.dev 顶部 Resources），
 * 点击快捷方式在新标签页打开对应网站。
 *
 * 数据源为扩展包内配置文件 config/nav.json（无前端编辑功能，通过后台文件配置）：
 *   { "columns": [ { "title": "常用", "links": [ { "name": "GitHub", "url": "https://github.com" } ] } ] }
 * 兼容糖：顶层 "links" 数组视为单个无标题栏。修改配置文件后刷新管理页即生效。
 * 配置文件缺失 / 解析失败 / 无有效链接时，导航图标整体隐藏，不影响其他功能。
 *
 * 交互：
 *  - hover 展开；鼠标离开导航区域 200ms 宽限后收起（宽限期内可移入面板）
 *  - 点击图标切换开合（触摸设备）；点击导航区域外自动收起
 *  - 键盘：图标上 Enter/Space/ArrowDown 展开并聚焦首个链接；Esc 收起并归还焦点；
 *    Tab 在链接间自然移动，焦点离开导航区域时自动收起
 *
 * 本文件不读写 manager.js 的任何全局状态；纯函数 normalizeNavConfig 有单测覆盖。
 * 零外部网络请求：唯一的 fetch 读取扩展包内同源资源（chrome-extension:// URL）。
 */

// ── 配置规范化（纯函数，无闭包依赖，可单测） ──

/**
 * 规范化并校验原始导航配置，返回可渲染结构；无有效内容时返回 null。
 *
 * 规则：
 *  - 仅保留 name 为非空字符串、url 为合法 http/https URL 的条目
 *    （new URL 解析失败或 javascript:/data:/chrome: 等协议一律过滤，防 XSS）
 *  - name / url / title 均 trim；栏标题可选（缺失或非字符串 → ''）
 *  - 无有效链接的栏整体移除；全部栏为空 → null
 *
 * @param {*} raw 解析后的 JSON 对象
 * @returns {{columns: Array<{title: string, links: Array<{name: string, url: string}>}>}|null}
 */
function normalizeNavConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  let rawColumns;
  if (Array.isArray(raw.columns)) {
    rawColumns = raw.columns;
  } else if (Array.isArray(raw.links)) {
    // 兼容糖：顶层 links 视为单个无标题栏
    rawColumns = [{ title: '', links: raw.links }];
  } else {
    return null;
  }

  const columns = [];
  for (const col of rawColumns) {
    if (!col || typeof col !== 'object' || Array.isArray(col)) continue;
    const title = typeof col.title === 'string' ? col.title.trim() : '';
    const links = [];
    if (Array.isArray(col.links)) {
      for (const item of col.links) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const url = typeof item.url === 'string' ? item.url.trim() : '';
        if (!name || !url) continue;
        let parsed;
        try {
          parsed = new URL(url);
        } catch (_) {
          continue;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
        links.push({ name, url });
      }
    }
    if (links.length > 0) columns.push({ title, links });
  }

  return columns.length > 0 ? { columns } : null;
}

// ── 配置读取 ──

/**
 * 读取扩展包内 config/nav.json 并规范化。
 * 任何失败（文件缺失 / 非 JSON / 无有效内容）都返回 null，调用方据此隐藏导航。
 * @returns {Promise<ReturnType<typeof normalizeNavConfig>>}
 */
async function loadNavConfig() {
  try {
    const res = await fetch(chrome.runtime.getURL('config/nav.json'));
    if (!res.ok) {
      console.warn('[text-collector] nav config load failed: http', res.status);
      return null;
    }
    return normalizeNavConfig(await res.json());
  } catch (err) {
    console.warn('[text-collector] nav config load failed:', err);
    return null;
  }
}

// ── DOM 与交互 ──

const $navRoot = document.getElementById('nav-root');
const $btnNav = document.getElementById('btn-nav');
const $navPanel = document.getElementById('nav-panel');

const NAV_CLOSE_GRACE_MS = 200; // 鼠标离开后收起的宽限时长（便于移入面板）
let navOpen = false;
let navCloseTimer = null;

function setNavOpen(open) {
  navOpen = open;
  if (navCloseTimer) {
    clearTimeout(navCloseTimer);
    navCloseTimer = null;
  }
  $navRoot.classList.toggle('open', open);
  $navPanel.classList.toggle('hidden', !open);
  $btnNav.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function openNav() {
  if (!navOpen) setNavOpen(true);
  else if (navCloseTimer) { clearTimeout(navCloseTimer); navCloseTimer = null; }
}

function scheduleNavClose() {
  if (navCloseTimer) clearTimeout(navCloseTimer);
  navCloseTimer = setTimeout(() => setNavOpen(false), NAV_CLOSE_GRACE_MS);
}

function closeNav(refocusButton) {
  setNavOpen(false);
  if (refocusButton) $btnNav.focus();
}

/** 按规范化后的配置构建面板栏目与链接（全部 textContent，无 innerHTML） */
function renderNavPanel(config) {
  $navPanel.textContent = '';
  for (const col of config.columns) {
    const colEl = document.createElement('div');
    colEl.className = 'nav-col';
    if (col.title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'nav-col-title';
      titleEl.textContent = col.title;
      colEl.appendChild(titleEl);
    }
    for (const link of col.links) {
      const a = document.createElement('a');
      a.className = 'nav-link';
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = link.name;
      colEl.appendChild(a);
    }
    $navPanel.appendChild(colEl);
  }
}

function focusFirstNavLink() {
  const first = $navPanel.querySelector('a');
  if (first) first.focus();
}

async function initNav() {
  const config = await loadNavConfig();
  if (!config) {
    // 无有效配置：整体隐藏导航入口，管理页其余功能不受影响
    $navRoot.classList.add('hidden');
    return;
  }
  renderNavPanel(config);
  $navRoot.classList.remove('hidden');

  // hover 展开/宽限收起（面板为 $navRoot 的 DOM 后代，命中测试天然包含）
  $navRoot.addEventListener('mouseenter', openNav);
  $navRoot.addEventListener('mouseleave', scheduleNavClose);

  // 点击切换（触摸设备无 hover）。不 stopPropagation：让点击冒泡到 document，
  // 使 manager.js 的「点击外部关闭导出菜单」逻辑对导航区域同样生效。
  $btnNav.addEventListener('click', () => {
    if (navOpen) closeNav(false);
    else setNavOpen(true);
  });

  // 键盘：图标上 Enter/Space/ArrowDown 展开并聚焦首链；Esc 收起
  $btnNav.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowDown' && !navOpen)) {
      e.preventDefault();
      if (navOpen && (e.key === 'Enter' || e.key === ' ')) {
        closeNav(false);
      } else {
        setNavOpen(true);
        focusFirstNavLink();
      }
    } else if (e.key === 'Escape' && navOpen) {
      e.preventDefault();
      closeNav(false);
    }
  });

  // 面板内 Esc 收起并归还焦点到图标
  $navPanel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeNav(true);
    }
  });

  // 点击链接（新标签页打开）后收起面板
  $navPanel.addEventListener('click', (e) => {
    if (e.target.closest('a')) setNavOpen(false);
  });

  // 焦点离开导航区域时收起（键盘可达性兜底）
  document.addEventListener('focusin', (e) => {
    if (navOpen && !$navRoot.contains(e.target)) setNavOpen(false);
  });

  // 点击导航区域外收起
  document.addEventListener('click', (e) => {
    if (navOpen && !$navRoot.contains(e.target)) setNavOpen(false);
  });
}

// 导航初始化失败绝不影响管理页主功能
initNav().catch(err => {
  console.error('[text-collector] nav init failed:', err);
  if ($navRoot) $navRoot.classList.add('hidden');
});
