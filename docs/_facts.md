# 代码事实清单 — text-collector

> 生成方式：对当前代码快照（commit `1c1f9ee`，2026-08-12）的源码逐文件扫描，仅记录代码中可证明存在的内容。
> 扫描范围：`text-collector/` 全部源码、`manifest.json`、`package.json`、`vitest.config.js`、`tests/`、`design/`（图标生成工具）。
> 排除范围：`docs/archive/`（按要求禁止参考）、`node_modules/`、`.git/`、二进制产物（PNG）。
> 置信度：**高** = 代码直接证明；**中** = 代码 + 注释推断；**低** = 推测。无法判断处标注「待确认」。

---

## 1. 页面 / 路由清单

本项目为 **Chrome MV3 扩展**，无传统路由、无多页面应用框架（无任何 router 代码）。唯一可打开的页面：

| 页面 | 路径 | 用途 | 打开方式 | 置信度 |
|------|------|------|----------|--------|
| 管理页 | `text-collector/manager/manager.html` | 查看/管理采集记录（列表、复制、删除、导出、收藏、编辑、开关） | 点击工具栏图标由 SW 创建或聚焦（`background/service-worker.js` → `chrome.tabs.create` / `tabs.query`+`tabs.update`）；URL 由 `chrome.runtime.getURL('manager/manager.html')` 生成 | 高 |
| （无）工具栏 popup | — | `manifest.json` 中 `"action": {}` 为空对象、无 `default_popup` 字段 | — | 高 |
| （无）background 页面 | — | MV3 使用 service worker（`"background": { "service_worker": "background/service-worker.js" }`），无 background 页面 | — | 高 |

内容脚本（非页面）：`content/content.js` + `content/content.css` 由 `manifest.json` 声明注入到 `<all_urls>` 匹配的所有页面（`run_at: document_idle`，`all_frames: false`），在宿主页面内渲染 toast（closed Shadow DOM）。

---

## 2. 功能模块清单

| 模块 | 位置 | 对外提供的能力（函数/常量） | 被谁调用 |
|------|------|------------------------------|----------|
| 存储工具层 | `utils/storage.js` | `CONFIG` 常量、`SCHEMA_VERSION=1`、`generateUUID`、`getUrlKey`、`getDomain`、`adoptOrphanSnippets`、`addSnippet`、`deleteSnippet`、`filterOrderRecords`、`getFilteredOrder`、`clearAllSnippets`、`getSnippets`、`getAllSnippets`、`toggleFavoriteSnippet`、`updateSnippetText`、`getCollectEnabled`、`setCollectEnabled`、`getEarliestDate`、`getStorageEstimate` | content.js（addSnippet）、manager.js（adoptOrphanSnippets/getCollectEnabled/setCollectEnabled/getEarliestDate/clearAllSnippets/filterOrderRecords/getFilteredOrder）、render.js（getSnippets/getStorageEstimate/deleteSnippet/toggleFavoriteSnippet/updateSnippetText）、export.js（getAllSnippets）、service-worker.js（get/set collectEnabled）、tests（getUrlKey/getDomain/filterOrderRecords/CONFIG） |
| 后台 Service Worker | `background/service-worker.js` | `updateBadge`；监听 `onInstalled`（初始化 `schemaVersion`/`collectEnabled`）、`onStartup`、顶层读 storage 兜底同步 badge、`action.onClicked`（打开/聚焦管理页）、`commands.onCommand('toggle-collect')`、`storage.onChanged` | 由浏览器事件驱动；管理页/内容脚本不直接调用 |
| 采集（内容脚本） | `content/content.js` | `processSelection`（准入规则→写库→toast）、`meetsLengthThreshold`、`isPureSymbol`、`isPureNumber`、`isPureURL`、`getActiveElement`、`isEditableElement`、`isSelectionInEditable`、`truncateText`、`detectDarkSurrounding`、`showToast`、`removeToastHost`；监听 `selectionchange`（500ms 防抖）与 `chrome.storage.onChanged` | 由页面事件驱动；`addSnippet` 来自 storage.js |
| 内容脚本样式 | `content/content.css` | 钉死 toast 宿主 `#text-collector-toast-host` 的几何/层级/伪元素 | 由 manifest 注入所有页面 |
| 管理页入口/编排 | `manager/manager.js` | `init`（adoptOrphanSnippets→renderToggle→loadFirstPage→setupListeners）、开关渲染/切换、清空确认、页签切换、导出菜单、storage 实时订阅（新记录 prepend + 提示条）、`listBridge` 状态通道 | manager.html `<script>` 引入 |
| 列表渲染 | `manager/render.js` | `loadFirstPage`、`loadMore`、`updateRecordInfo`、`applyTruncationCheck`、`createCard`（收藏/复制/展开/删除/编辑按钮）、`deleteRecord`（含撤销）、`performDeleteRecord`、`copyToClipboard`、`prependNewCards`、`renderLoadError` | manager.js（init/onChanged/handleClearAll）；卡片事件自触发 |
| 确认/编辑弹窗 | `manager/modal.js` | `showConfirmModal`（Esc/Tab 陷阱/遮罩关闭）、`showEditModal`（textarea、Ctrl+Enter 保存） | manager.js（清空确认）、render.js（删除确认、编辑笔记） |
| 管理页 Toast | `manager/toast.js` | `showToast`（单实例，kind: success/info/danger，可带操作按钮）、`dismiss`；`ICON_BOOKMARK_OUTLINE`/`ICON_BOOKMARK_SOLID`/`ICON_TRASH`/`ICON_CHECK`/`ICON_INFO`/`ICON_ALERT` 常量 | render.js、export.js、manager.js |
| 导出 | `manager/export.js` | `handleExport(format)`（TXT 带 UTF-8 BOM / JSON 含 schemaVersion）、`downloadBlob` | manager.js（导出菜单项点击） |
| 管理页样式 | `manager/manager.css` | 全部视觉样式 + `:root` CSS 变量（主题色板） | manager.html `<link>` 引入 |
| 单元测试 | `tests/storage.test.js`、`tests/content.test.js`、`tests/helpers/load-source.js` | 用语法提取纯函数（`extractFunction`/`extractObjectLiteral`）在 Node 环境运行 vitest；16 + 39 个用例 | `npm test`（vitest，见 `package.json`/`vitest.config.js`，environment: node） |
| 图标生成工具（开发期，非运行时） | `design/`（`make-icons.js`、`icon-spec.js`、`preview.js`、`build-icon.js` 等） | 参数化生成 `icons/icon16/48/128.png`（依赖 sharp） | `design/package.json` 脚本 `npm run icons` / `npm run preview`；产物被 manifest 引用，工具本身不进扩展包 |

---

## 3. 用户可执行的操作清单

### 3.1 管理页（manager.html）

| 操作（元素） | 触发的行为 | 成功反馈 | 失败反馈 | 来源 |
|------|------|------|------|------|
| 点击「导出」按钮 `#btn-export` | 开/关导出菜单（含 `aria-expanded`），打开后焦点移至第一项 | 菜单展开 | — | manager.js `setupListeners` |
| 菜单项「导出为 TXT」`[data-format="txt"]` | `handleExport('txt')`：读取当前页签全部记录，文本以 `\n\n` 连接，UTF-8 BOM，文件名 `snippets[_saved_]_<日期>.txt` 下载 | toast「已导出 N 条」（success） | toast「导出失败：存储读取异常」；未知格式 toast「未知导出格式」（danger） | export.js |
| 菜单项「导出为 JSON」`[data-format="json"]` | `handleExport('json')`：导出 `{schemaVersion, exportedAt, count, snippets}`，文件名 `snippets[_saved_]_<日期>.json` | 同上 | 同上 | export.js |
| 点击「清空全部」`#btn-clear` | `showConfirmModal` 二次确认（含最早记录日期提示）→ `clearAllSnippets()`：未收藏记录彻底删除，已收藏记录保留并标记 `clearedFromHome=true` | toast「已清空」（success） | **无显式失败反馈**（`handleClearAll` 无 catch 分支；出错将冒泡为未处理 rejection） | manager.js |
| 采集开关 `#collect-toggle`（role=switch，点击或 Enter/Space） | `handleToggle` → `setCollectEnabled(!enabled)` → 更新 UI（aria-checked/ON/OFF） | 开关视觉切换；badge 同步（SW 监听 storage.onChanged） | **无显式失败反馈**（无 catch） | manager.js；service-worker.js |
| 页签「首页」/「已保存」`#tab-home`/`#tab-saved` | 切换 `currentTab`，切到「已保存」时隐藏清空按钮，重载首屏列表 | 列表/计数/空态文案切换 | 加载失败走 loadMore 的失败分支 | manager.js |
| 点击卡片文本区 `.card-text` | `copyToClipboard(record.text)`（`navigator.clipboard.writeText`，失败 fallback `execCommand('copy')`） | toast「已复制」（success）+ 卡片 `card-copied` 动画 500ms | —（clipboard API 失败 fallback 无反馈） | render.js |
| 卡片键盘 Enter/Space（焦点在卡片本身） | 同上复制 | 同上 | — | render.js |
| 点击收藏按钮 `.card-favorite`（书签图标） | `toggleFavoriteSnippet(id)` 切换 `saved`；若在「已保存」页签取消收藏，卡片淡出并移除，计数同步 | toast「已添加到"已保存"」（success）/「已取消收藏」（info） | —（`toggleFavoriteSnippet` 返回 null 时静默置为未收藏，无提示） | render.js |
| 点击「展开 ↓ / 收起 ↑」`.card-expand`（可键盘操作） | 切换卡片 `.expanded` 类与文案 | 文本截断切换 | — | render.js |
| 点击删除按钮 `.card-delete`（垃圾桶） | `deleteRecord`：已保存记录（或已保存页签）先弹确认框「确认删除」；随后 `deleteSnippet(id)` + 卡片淡出 | toast「已删除」（info，带「撤销」按钮，5s） | — | render.js |
| 点击删除 toast 的「撤销」 | 恢复 `snip_<id>` 及原 order 位置，重建卡片 | toast「已恢复」（success） | — | render.js |
| 「复制」按钮（已保存卡片 `.btn-copy`） | 同卡片文本复制 | toast「已复制」 | — | render.js |
| 「编辑」按钮（已保存卡片 `.btn-edit`） | `showEditModal`（textarea 预填，焦点/光标在末尾，Ctrl+Enter 或点「保存」提交）→ `updateSnippetText(id, newText)` | toast「已保存修改」（success）；文本相同则不写入 | 空内容：toast「笔记内容不能为空」（danger），不写入 | render.js、modal.js |
| 点击「加载更多」`#btn-load-more` | `loadMore`：按 `PAGE_SIZE=50` 分页追加卡片；超过 `STORAGE_WARNING_THRESHOLD=5000` 条时显示存储警告条 | 追加卡片 | toast「加载失败，请重试」（danger），保留已加载列表 | render.js |
| 键盘：Esc（导出菜单/弹窗打开时） | 关闭菜单/弹窗，焦点还给触发按钮 | — | — | manager.js、modal.js |
| 键盘：导出菜单 ↑/↓ | 菜单内移动焦点 | — | — | manager.js |
| 键盘：确认弹窗 Tab/Shift+Tab、Enter | 焦点陷阱循环；Enter 仅在焦点在按钮上时触发点击，否则默认「取消」关闭 | — | — | modal.js |

### 3.2 浏览器 / 全局（非页面内）

| 操作 | 触发的行为 | 成功反馈 | 失败反馈 | 来源 |
|------|------|------|------|------|
| 点击工具栏插件图标 | `chrome.action.onClicked`：管理页已打开则 `tabs.update` 激活 + `windows.update` 聚焦，否则 `tabs.create` 新开 | 管理页打开/聚焦 | — | service-worker.js |
| 快捷键 `Ctrl+Shift+S`（manifest `commands.toggle-collect`） | 切换 `collectEnabled` 并刷新 badge | badge 变化（开启无 badge；关闭显示灰色 `OFF`） | — | manifest.json；service-worker.js |

### 3.3 宿主网页内（内容脚本）

| 操作 | 触发的行为 | 成功反馈 | 失败反馈 | 来源 |
|------|------|------|------|------|
| 在任意网页选中文本（selectionchange，500ms 防抖） | `processSelection`：长度阈值（中≥5 字/英≥3 词加权）、纯符号/数字/URL 过滤、编辑区域跳过、`NFC` 规范化、5000 字截断 → `addSnippet`（去重/扩选替换/新增） | 新增或替换：toast「已采集」（success）；去重：toast「已采集过」（info） | `addSnippet` reject：toast「采集失败」（danger）；`Extension context invalidated` 错误静默不提示 | content.js |

---

## 4. 数据模型

**存储介质**：`chrome.storage.local`（扩展本地存储，非 localStorage/DB/cookie —— 全库 grep 无 localStorage/sessionStorage/document.cookie 使用）。无数据库表。无独立类型定义文件（纯 JS，无 TS 类型；字段形状由代码写入点与注释定义）。

### 4.1 storage.local 键结构

| 键 | 类型 | 写入点 | 说明 |
|----|------|--------|------|
| `snip_<uuid>` | object | `addSnippet` / `updateSnippetText` / `toggleFavoriteSnippet` / `clearAllSnippets` / 撤销恢复 / `adoptOrphanSnippets`（补写缺失 id） | 单条采集记录，见 4.2 |
| `snippets_order` | string[] | `addSnippet`（prepend + 校验重试≤3 次）、`deleteSnippet`、`clearAllSnippets`、撤销恢复、`adoptOrphanSnippets` | 有序 id 列表，最新在前 |
| `collectEnabled` | boolean | `setCollectEnabled`；`onInstalled` 初始化为 `true` | 未设置时所有读取方按 `true` 处理（`!== false`） |
| `schemaVersion` | number | `onInstalled` 初始化为 `1`；与 `SCHEMA_VERSION=1` 常量对应，导出 JSON 时写入 | 版本标记 |
| `orphanScanV1` | number | `adoptOrphanSnippets`（每次扫描后写 `Date.now()`） | 孤儿扫描节流时间戳（24h 间隔） |

### 4.2 记录对象字段（`snip_<id>`）

| 字段 | 类型 | 写入点 | 说明 |
|------|------|--------|------|
| `id` | string（UUID v4） | addSnippet | `crypto.randomUUID()`，fallback 手写 UUID |
| `text` | string | addSnippet（NFC 规范化、≤5000 截断）；updateSnippetText（trim 后写入） | 采集/编辑后的文本 |
| `url` | string | addSnippet | `location.href` |
| `urlKey` | string | addSnippet | `origin + pathname`（忽略 query/hash），去重/扩选匹配键 |
| `title` | string | addSnippet | `document.title \|\| url` |
| `domain` | string | addSnippet | `new URL(url).hostname` |
| `capturedAt` | number（epoch ms） | addSnippet | 采集时间 |
| `lastSelectedAt` | number（epoch ms） | addSnippet；去重/扩选时更新 | 最近选中时间，扩选窗口/去重依据 |
| `saved` | boolean | toggleFavoriteSnippet（`!record.saved`） | 收藏标记；仅收藏/取消收藏时写入，未写入即 undefined |
| `clearedFromHome` | boolean | clearAllSnippets（对 `saved===true` 记录置 true）；toggleFavoriteSnippet 取消收藏且曾清空时删除记录 | 首页清空标记 |
| `updatedAt` | number（epoch ms） | updateSnippetText | 编辑时间 |

### 4.3 JSON 导出结构（export.js）

```json
{ "schemaVersion": 1, "exportedAt": "<ISO 时间>", "count": <number>, "snippets": [<记录对象>] }
```

> 代码中**不存在**导入功能（grep 无 import 相关实现；README 新文档亦未声称有导入）。导出 JSON 无对应解析器 —— 不可逆导入待确认（当前代码无证据支持恢复）。

---

## 5. 接口清单

### 5.1 后端 / 第三方 API
**无**。全库 grep 无 `fetch(`、`XMLHttpRequest`、`WebSocket`、`importScripts`、`chrome.runtime.sendMessage`/`onMessage`。扩展不发起任何网络请求（高置信度）。

### 5.2 浏览器扩展 API（chrome.*）

| API | 用途 | 来源 |
|-----|------|------|
| `chrome.storage.local.get/set/remove` | 全部数据读写 | storage.js 等 |
| `chrome.storage.onChanged` | 开关/列表实时同步（SW、content、manager 三方订阅） | service-worker.js、content.js、manager.js |
| `chrome.runtime.getURL` | 管理页 URL | service-worker.js |
| `chrome.runtime.onInstalled` / `onStartup` | 初始化、badge 同步 | service-worker.js |
| `chrome.action.onClicked` / `setBadgeText` / `setBadgeBackgroundColor` / `setBadgeTextColor` | 图标点击、badge | service-worker.js |
| `chrome.commands.onCommand` | 快捷键 toggle-collect | service-worker.js |
| `chrome.tabs.query` / `create` / `update` | 打开/聚焦管理页 | service-worker.js |
| `chrome.windows.update` | 聚焦管理页所在窗口 | service-worker.js |

### 5.3 Web 平台 API（宿主页面/管理页内）

| API | 用途 | 来源 |
|-----|------|------|
| `window.getSelection()` | 读取选区文本 | content.js |
| `document.execCommand('copy')` | 剪贴板兜底 | render.js |
| `navigator.clipboard.writeText` | 剪贴板主路径 | render.js |
| `URL.createObjectURL` / `revokeObjectURL` | 导出文件下载 | export.js |
| `crypto.randomUUID` | 生成记录 id | storage.js |
| `HTMLElement.attachShadow({mode:'closed'})` | toast 隔离 | content.js |
| `window.matchMedia` / `getComputedStyle` | 深色环境探测 | content.js |

---

## 6. 状态管理

### 6.1 持久化状态（chrome.storage.local）

| 状态 | 键 | 读写方 |
|------|-----|--------|
| 采集开关 | `collectEnabled` | content.js（缓存+订阅）、manager.js、service-worker.js |
| 记录有序列表 | `snippets_order` | storage.js 全部写函数、manager.js（订阅）、render.js（撤销时读取） |
| 单条记录 | `snip_<id>` | storage.js 全部写函数、render.js（撤销/读取）、manager.js（onChanged 读取） |
| 数据版本 | `schemaVersion` | service-worker.js（初始化）、export.js（写入导出文件） |
| 孤儿扫描节流戳 | `orphanScanV1` | storage.js `adoptOrphanSnippets` |

> 不使用 localStorage / sessionStorage / cookie（grep 证实）。

### 6.2 内存状态（模块级变量，非持久化）

| 状态 | 变量 | 位置 | 说明 |
|------|------|------|------|
| 开关缓存/初始化标志/页面加载时间 | `collectEnabled`、`isInitialized`、`pageLoadTime` | content.js 顶部 | 页面级生命周期 |
| 防抖计时器 | `debounceTimer` | content.js | — |
| toast 引用与定时器 | `toastHost`、`toastHideTimer`、`toastRemoveTimer` | content.js | 单实例 |
| 分页/计数/页签状态 | `currentOffset`、`totalCount`、`isLoading`、`newRecordsCount`、`newRecordTimer`、`ignoreAllOrderChanges`、`currentTab` | manager.js（经 `listBridge` 只读 getter/只写命名函数暴露给 render.js） | 管理页生命周期 |
| 管理页 toast 当前实例 | `currentToastEl` | toast.js | 单实例 |

### 6.3 状态同步机制
- `chrome.storage.onChanged`：SW（badge）、content（开关缓存）、manager（开关 UI + 新记录实时 prepend，3s 后隐藏「新增了 N 条记录」提示条）。
- 本地修改（删除/撤销/清空）期间 `ignoreAllOrderChanges=true` 抑制 onChanged 重复追加（manager.js）。

---

## 7. 权限与角色

- **无用户系统、无账号、无角色/权限分级**（代码无任何用户/登录/角色概念）。
- 扩展权限（manifest.json `permissions`）：`storage`、`unlimitedStorage`、`tabs`；`host_permissions`: `<all_urls>`。
- 快捷键命令：`commands.toggle-collect`（`Ctrl+Shift+S`，非全局）。
- CSP（manifest）：`script-src 'self'; object-src 'self'`。
- 内容脚本注入范围：`matches: ["<all_urls>"]`，`all_frames: false`，`run_at: document_idle`。
- 未申请 `scripting` / `webRequest` / `cookies` 等权限（manifest 原文可证）。

---

## 8. 配置项与环境变量

### 8.1 运行时常量 CONFIG（utils/storage.js 顶部，唯一集中配置点）

| 常量 | 值 | 用途 |
|------|----|------|
| `DEDUP_CHECK_LIMIT` | 500 | 去重/扩选检查的最近记录数 |
| `PAGE_SIZE` | 50 | 管理页分页大小（render.js 引用） |
| `EXPORT_BATCH_SIZE` | 100 | 导出的分批读取大小 |
| `STORAGE_ESTIMATE_SAMPLES` | 50 | 存储占用估算采样数 |
| `STORAGE_WARNING_THRESHOLD` | 5000 | 超过该条数显示备份警告条 |
| `DEBOUNCE_MS` | 500 | selectionchange 防抖延迟 |
| `PAGE_LOAD_GRACE_MS` | 2000 | 页面加载后跳过选区恢复的保护时长 |
| `MAX_TEXT_LENGTH` | 5000 | 单条记录最大字符数（截断） |
| `MIN_CHINESE_CHARS` | 5 | 纯中文最小字数 |
| `MIN_ENGLISH_WORDS` | 3 | 纯英文最小词数 |
| `EXPAND_REPLACE_WINDOW_MS` | 5000 | 同 URL 扩选替换时间窗口 |

### 8.2 其他硬编码常量（非 CONFIG）

| 常量 | 值 | 位置 |
|------|----|------|
| `SCHEMA_VERSION` | 1 | storage.js |
| `ORPHAN_SCAN_FLAG` / `SCAN_INTERVAL_MS` | `'orphanScanV1'` / 24h | storage.js `adoptOrphanSnippets` 内 |
| toast 显示时长 | 内容页：1500ms 淡出 + 200ms 移除；管理页：默认 1600ms、带操作按钮 5000ms | content.js；toast.js；render.js（撤销按钮 duration: 5000） |
| 卡片删除动画延迟 | 180ms | render.js |
| `MANAGER_URL` | `chrome.runtime.getURL('manager/manager.html')` | service-worker.js |
| badge OFF 配色 | 背景 `#9a9890`、文字 `#ffffff` | service-worker.js `updateBadge` |

### 8.3 样式主题变量（manager.css `:root`，非代码配置）

`--bg:#f5f3ee`、`--surface:#ffffff`、`--surface-2:#f0eee8`、`--border:#e2ddd2`、`--border-strong:#d0c9b8`、`--text:#1c1d20`、`--text-muted:#6b6b66`、`--text-dim:#9a9890`、`--blue:#2f6fed`、`--blue-hover:#245fd4`、`--blue-soft:#eaf1ff`、`--blue-text:#1d4ed8`、`--danger:#d14343`、`--danger-soft:#fdecec`、`--warn-*`、`--info-*`、`--new-*`、`--radius*`、`--shadow-*`、`--serif`/`--mono`/`--sans` 字体栈。

### 8.4 环境变量 / 构建配置

- **无环境变量**：全库 grep 无 `process.env`（高置信度）。
- 无构建步骤：扩展直接以源码加载（manifest 直接引用 js/css）。
- `package.json` scripts：`test`（`vitest run`）、`test:watch`；devDependencies 仅 `vitest ^4.1.10`。
- `design/package.json` scripts：`icons`（`node make-icons.js`）、`preview`；依赖 `sharp ^0.35.3`（仅图标生成用，不在扩展运行时）。

---

## 附：明确的「无」

- 无后端、无网络请求、无第三方 API。
- 无登录/账号/角色/权限体系。
- 无导入功能（无任何 import 相关实现代码）。
- 无 localStorage / sessionStorage / cookie 使用。
- 无环境变量、无构建/打包脚本（扩展以源码形式加载）。
- 无路由框架、无前端框架（原生 DOM 操作）。
