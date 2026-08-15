# 代码事实清单 — text-collector

> 生成方式：对当前代码快照（v1.0.1，2026-08-15）的源码逐文件扫描，仅记录代码中可证明存在的内容。
> 修订记录：
> - 2026-08-15（v1.0.1）— 待办工作台布局微调及修复：`manager/todo.css` 将 `.todo-sidebar` 桌面宽度调整为 300px；`.todo-content` 使用 `flex: 1 1 0` + `min-width: 0`，`.todo-content-inner` 的最大宽度为 960px，以提供输入框可见扩展空间；`.todo-add-form input` 采用 `flex: 0 1 480px` + `width: 480px`，在窄容器中可收缩、在可用空间充足时不因剩余空间继续拉伸。添加按钮固定为 `flex: 0 0 28px`，并以 `margin-left: auto` 锚定至整行表单最右端，不被挤压变形。`manager/todo.js` 的 `resizeAddItemInput` 输入和提交清空后按文本测量结果**同步更新 `width` 与 `flex-basis`**，仅当内容所需宽度超过 480px 时扩展。
> - 2026-08-12 — 根据用户确认，将「导入功能」状态由「待确认（无证据）」更正为「已删除」（见 §4.3）。
> - 2026-08-13（v0.8.0）— 新增网站导航模块（`manager/nav.js` + `config/nav.json`）相关事实：§2 模块表、§3.1 操作表、§5.1/5.3 接口、§6.2 内存状态、§8.5 配置文件；并记录导航面板分栏与 tooltip 的样式修复。
> - 2026-08-14（v0.8.1）— 顶部记录数与导航快捷方式名称统一使用品牌副标题 `manager` 的无衬线字体栈（§9）。
> - 2026-08-15（v1.0.0 待办功能）— **重大重写**：旧版独立 `todo.html` 整页替换设计被回退，v1.0.0 实际为**同页 Tab 切换**（`manager.html` 内 hash 路由 `#collect` / `#todo[/...]`）。本版事实重写：§1 页面/路由、§2 模块表、§3.4 待办操作表、§4.4 待办存储键、§4.5 待办对象字段、§5.4 待办接口、§6.4 待办内存状态、§8.6 包管理脚本、§9 版本与变更。`todo/` 子目录与 `todo.html` **已被删除**（commit `2b681d3`）；当前实现位于 `manager/todo.js` + `manager/todo.css` + `utils/todo-storage.js`。
> 扫描范围：`text-collector/` 全部源码、`manifest.json`、`package.json`、`vitest.config.js`、`tests/`、`design/`（图标生成工具）。
> 排除范围：`docs/archive/`（按要求禁止参考）、`node_modules/`、`.git/`、二进制产物（PNG）、`todo/`（已删除）。
> 置信度：**高** = 代码直接证明；**中** = 代码 + 注释推断；**低** = 推测。无法判断处标注「待确认」。

---

## 1. 页面 / 路由清单

本项目为 **Chrome MV3 扩展**，无传统路由、无多页面应用框架（无任何 router 代码）。v1.0.0 实际打开的扩展页面：

| 页面 | 路径 | 用途 | 打开方式 | 置信度 |
|------|------|------|----------|--------|
| 管理页（采集 + 待办同页 Tab） | `text-collector/manager/manager.html` | 单一管理页，hash 路由切换两个 tab：<br>· `#collect`（默认）= 采集 tab（列表、复制、删除、导出、收藏、编辑、开关）<br>· `#todo` = 待办工作台；`#todo/all` / `#todo/done` / `#todo/templates` / `#todo/list/<id>` = 待办内 4 视图 | 点击工具栏图标由 SW 创建或聚焦（`background/service-worker.js` → `chrome.tabs.create` / `tabs.query`+`tabs.update`），URL 由 `chrome.runtime.getURL('manager/manager.html')` 生成；管理页 init 时 `applyRouteFromHash` 读取 hash 切到对应 tab | 高 |
| ~~（已删除）独立待办页面~~ | ~~`text-collector/todo/todo.html`~~ | ~~清单管理、待办事项 CRUD、模板管理、视图切换~~ | **v1.0.0 已被移除**（commit `2b681d3` 整段重写后）；当前不存在此文件 | — |
| （无）工具栏 popup | — | `manifest.json` 中 `"action": {}` 为空对象、无 `default_popup` 字段 | — | 高 |
| （无）background 页面 | — | MV3 使用 service worker（`"background": { "service_worker": "background/service-worker.js" }`），无 background 页面 | — | 高 |

**Hash 路由协议**（`manager.js applyRouteFromHash` + `todo.js handleHashChange`）：

| Hash | 主视图 | 待办内视图 |
|------|--------|------------|
| 空 / `#collect` | 采集 tab | — |
| `#todo` | 待办 tab | 当前清单的工作台（fallback：第一个清单或今日待办） |
| `#todo/all` | 待办 tab | 全部待办（跨清单未完成汇总） |
| `#todo/done` | 待办 tab | 已完成（跨清单已完成汇总） |
| `#todo/templates` | 待办 tab | 模板库卡片网格 |
| `#todo/list/<id>` | 待办 tab | 指定清单的工作台 |
| 陌生 hash | 视为空 hash = 采集 | — |

> 采集 tab 与待办 tab 由 manager.js 切主视图（`.hidden` 切换 `#view-collect` / `#view-todo`、置灰采集开关、隐藏/显示 toolbar 计数与导出按钮）；待办内 4 视图由 todo.js 根据 `location.hash` 段切 `state.currentView` 与 `state.currentListId`，URL 与 `state` 双向同步（`writeHash`）。

内容脚本（非页面）：`content/content.js` + `content/content.css` 由 `manifest.json` 声明注入到 `<all_urls>` 匹配的所有页面（`run_at: document_idle`，`all_frames: false`），在宿主页面内渲染 toast（closed Shadow DOM）。

---

## 2. 功能模块清单

| 模块 | 位置 | 对外提供的能力（函数/常量） | 被谁调用 |
|------|------|------------------------------|----------|
| 存储工具层 | `utils/storage.js` | `CONFIG` 常量、`SCHEMA_VERSION=1`、`generateUUID`、`getUrlKey`、`getDomain`、`adoptOrphanSnippets`、`addSnippet`、`deleteSnippet`、`filterOrderRecords`、`getFilteredOrder`、`clearAllSnippets`、`getSnippets`、`getAllSnippets`、`toggleFavoriteSnippet`、`updateSnippetText`、`getCollectEnabled`、`setCollectEnabled`、`getEarliestDate`、`getStorageEstimate` | content.js（addSnippet）、manager.js（adoptOrphanSnippets/getCollectEnabled/setCollectEnabled/getEarliestDate/clearAllSnippets/filterOrderRecords/getFilteredOrder）、render.js（getSnippets/getStorageEstimate/deleteSnippet/toggleFavoriteSnippet/updateSnippetText）、export.js（getAllSnippets）、service-worker.js（get/set collectEnabled）、tests（getUrlKey/getDomain/filterOrderRecords/CONFIG） |
| 后台 Service Worker | `background/service-worker.js` | `updateBadge`；监听 `onInstalled`（初始化 `schemaVersion`/`collectEnabled`）、`onStartup`、顶层读 storage 兜底同步 badge、`action.onClicked`（打开/聚焦待办页面）、`commands.onCommand('toggle-collect')`、`storage.onChanged` | 由浏览器事件驱动；管理页/内容脚本不直接调用 |
| 采集（内容脚本） | `content/content.js` | `processSelection`（准入规则→写库→toast）、`meetsLengthThreshold`、`isPureSymbol`、`isPureNumber`、`isPureURL`、`getActiveElement`、`isEditableElement`、`isSelectionInEditable`、`truncateText`、`detectDarkSurrounding`、`showToast`、`removeToastHost`；监听 `selectionchange`（500ms 防抖）与 `chrome.storage.onChanged` | 由页面事件驱动；`addSnippet` 来自 storage.js |
| 内容脚本样式 | `content/content.css` | 钉死 toast 宿主 `#text-collector-toast-host` 的几何/层级/伪元素 | 由 manifest 注入所有页面 |
| 管理页入口/编排 | `manager/manager.js` | `init`（adoptOrphanSnippets→renderToggle→loadFirstPage→setupListeners）、开关渲染/切换、清空确认、页签切换、导出菜单、storage 实时订阅（新记录 prepend + 提示条）、`listBridge` 状态通道 | manager.html `<script>` 引入 |
| 网站导航 | `manager/nav.js` + `config/nav.json` | `normalizeNavConfig`（纯函数：配置校验/规范化，单测覆盖）、`loadNavConfig`（`fetch(chrome.runtime.getURL('config/nav.json'))` 读取包内配置）、`renderNavPanel`、`initNav`（hover 展开/200ms 宽限收起、点击切换、Esc/Enter/Space/ArrowDown 键盘可达、新标签页打开链接；无有效配置时隐藏 `#nav-root`） | manager.html `<script>` 引入（先于 manager.js），自初始化，不读写 manager.js 全局状态 |
| 列表渲染 | `manager/render.js` | `loadFirstPage`、`loadMore`、`updateRecordInfo`、`applyTruncationCheck`、`createCard`（收藏/复制/展开/删除/编辑按钮）、`deleteRecord`（含撤销）、`performDeleteRecord`、`copyToClipboard`、`prependNewCards`、`renderLoadError` | manager.js（init/onChanged/handleClearAll）；卡片事件自触发 |
| 确认/编辑弹窗 | `manager/modal.js` | `showConfirmModal`（Esc/Tab 陷阱/遮罩关闭）、`showEditModal`（textarea、Ctrl+Enter 保存） | manager.js（清空确认）、render.js（删除确认、编辑笔记） |
| 管理页 Toast | `manager/toast.js` | `showToast`（单实例，kind: success/info/danger，可带操作按钮）、`dismiss`；`ICON_BOOKMARK_OUTLINE`/`ICON_BOOKMARK_SOLID`/`ICON_TRASH`/`ICON_CHECK`/`ICON_INFO`/`ICON_ALERT` 常量 | render.js、export.js、manager.js |
| 导出 | `manager/export.js` | `handleExport(format)`（TXT 带 UTF-8 BOM / JSON 含 schemaVersion）、`downloadBlob` | manager.js（导出菜单项点击） |
| 管理页样式 | `manager/manager.css` | 全部视觉样式 + `:root` CSS 变量（主题色板） | manager.html `<link>` 引入 |
| 单元测试 | `tests/storage.test.js`、`tests/content.test.js`、`tests/nav.test.js`、`tests/todo-storage.test.js`、`tests/helpers/load-source.js` | 用语法提取纯函数（`extractFunction`/`extractObjectLiteral`）在 Node 环境运行 vitest；storage 16 + content 39 + nav 9 + todo-storage 36 = **100** 个用例 | `npm test`（vitest，见 `package.json`/`vitest.config.js`，environment: node） |
| 图标生成工具（开发期，非运行时） | `design/`（`make-icons.js`、`icon-spec.js`、`preview.js`、`build-icon.js` 等） | 参数化生成 `icons/icon16/48/128.png`（依赖 sharp） | `design/package.json` 脚本 `npm run icons` / `npm run preview`；产物被 manifest 引用，工具本身不进扩展包 |
| 待办 tab 入口（v1.0.0，v1.0.1 调整） | `manager/todo.js` | `init`（加载数据、设置监听、绑定事件、首启惰性创建今日待办）、4 视图路由（`handleHashChange` / `switchTo` / `writeHash`）、`renderSidebar`、`renderListView`、`renderAllView`、`renderDoneView`、`renderTemplatesView`、`onCreateList` / `startRenameList` / `onDeleteList`、`onAddItem` / `onToggleItem` / `onDeleteItem` / `startEditItem` / 拖拽事件、`resizeAddItemInput`（测量添加事项输入框文本宽度，仅超出 480px 基准时同步扩展 `width` 与 `flex-basis`）、`onSaveAsTemplate` / `onUseTemplate` / `onCopyTemplateToCurrentList` / `onDeleteTemplate` / `makeTemplateCard` | manager.html `<script>` 引入（位于 manager.js 之前）；通过 `window.__managerBridge` 复用 manager 的 toast / confirm / edit 弹窗 |
| 待办数据层（v1.0.0） | `utils/todo-storage.js` | 纯函数 + storage Promise：`generateUUID`、`normalizeListName`、`getOrCreateList`、`getOrCreateTodayList`、`getLists`、`createList`、`renameList`、`deleteList`、`getItems`、`saveItems`、`addItem`、`toggleItem`、`deleteItem`、`sortItems`、`loadTemplates`、`saveAsTemplate`、`createListFromTemplate`、`copyTemplateToList`、`deleteTemplate` | manager/todo.js（全部 CRUD 调用）；tests/todo-storage.test.js（36 例） |
| 待办样式（v1.0.0，v1.0.1 调整） | `manager/todo.css` | 同页 Tab 切换下的待办视图样式；**不**重定义 `:root` 变量，直接复用 `manager.css` 已加载的 `--bg` / `--surface` / `--text` / `--blue` 等；自定义类以 `.todo-*` 前缀命名避免与采集模块冲突。v1.0.1：`.todo-sidebar` 固定桌面宽度为 300px 且不收缩；`.todo-content` 可收缩且内容内层最大 960px；`.todo-add-form input` 使用 `flex: 0 1 480px` + `width: 480px` + `min-width: 0`，默认不增长但可在窄容器内收缩；添加按钮为固定 `28px` 弹性项，并以 `margin-left: auto` 固定在表单最右端，不会被挤压 | manager.html `<link>` 引入（与 manager.css 并列） |

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
| hover 导航图标 `#btn-nav` | 展开网站快捷方式分栏面板（`config/nav.json` 驱动）；鼠标离开导航区域 200ms 宽限后收起 | 面板展开（`aria-expanded=true`、`.nav.open`） | 配置缺失/解析失败/无有效链接 → `#nav-root` 整体隐藏（console.warn） | nav.js |
| 点击导航图标（触摸）/ 点击区域外 / 焦点离开导航区域 | 切换或收起面板 | 面板收起 | — | nav.js |
| 点击快捷方式 `.nav-link` | 新标签页打开网站（`target="_blank" rel="noopener"`），面板收起 | 新标签页 | — | nav.js |
| 键盘：图标上 Enter/Space/↓ 展开并聚焦首链；面板内 Esc 收起并归还焦点 | 键盘可达导航面板 | — | — | nav.js |
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
| 点击工具栏插件图标 | `chrome.action.onClicked`：待办页面已打开则 `tabs.update` 激活 + `windows.update` 聚焦，否则 `tabs.create` 新开 | 待办页面打开/聚焦 | — | service-worker.js |
| 快捷键 `Ctrl+Shift+S`（manifest `commands.toggle-collect`） | 切换 `collectEnabled` 并刷新 badge | badge 变化（开启无 badge；关闭显示灰色 `OFF`） | — | manifest.json；service-worker.js |

### 3.3 宿主网页内（内容脚本）

| 操作 | 触发的行为 | 成功反馈 | 失败反馈 | 来源 |
|------|------|------|------|------|
| 在任意网页选中文本（selectionchange，500ms 防抖） | `processSelection`：长度阈值（中≥5 字/英≥3 词加权）、纯符号/数字/URL 过滤、编辑区域跳过、`NFC` 规范化、5000 字截断 → `addSnippet`（去重/扩选替换/新增） | 新增或替换：toast「已采集」（success）；去重：toast「已采集过」（info） | `addSnippet` reject：toast「采集失败」（danger）；`Extension context invalidated` 错误静默不提示 | content.js |

### 3.4 待办 tab（manager.html 的 `#view-todo` 区，由 `manager/todo.js` 渲染）

> v1.0.0 没有独立 `todo.html`；待办是管理页 `#view-todo` 区，通过 hash `#todo[/...]` 路由进入。

| 操作（元素） | 触发的行为 | 成功反馈 | 失败反馈 | 来源 |
|------|------|------|------|------|------|
| 点击管理页顶部「待办」`<a href="#todo">#brand-todo-link` | `location.hash = '#todo'` → 触发 `hashchange` → `applyRouteFromHash` 切到 `#view-todo` → `todo.js handleHashChange` 解析待办内视图 | 待办 tab 激活；采集开关置灰；toolbar 计数与导出/清空按钮隐藏 | — | manager.js、todo.js |
| 点击管理页顶部「采集」`<a href="#collect">#brand-collect-link`（或浏览器无 hash） | `location.hash = '#collect'` → 切到 `#view-collect` | 采集 tab 激活；toolbar 完整 | — | manager.js |
| 点侧边栏「+ 新建清单」`#todo-new-list-btn` | `onCreateList` → `createList('未命名清单')` → 跳到新清单工作台 → 自动进入重命名态 | 新清单出现在侧边栏（按 `order = max+1`）；自动 focus 工作台输入框 | — | todo.js、utils/todo-storage.js |
| 点击侧边栏清单项 `.todo-list-item` | `switchTo('list', listId)` → `writeHash` → 工作台切换 | 右侧切到该清单工作台；侧边栏高亮 | — | todo.js |
| 侧边栏清单项 `.todo-list-item-name` 双击 / F2 | `startRenameList(listId)` → `contenteditable=true` 全选 | 可编辑态 | — | todo.js |
| 重命名 Enter / blur | `renameList(id, newName)` → 同步写 `updatedAt` | 侧边栏 + 工作台标题更新 | 空名 → 静默恢复原值 | utils/todo-storage.js |
| 重命名 Esc | 取消编辑 | 恢复原值 | — | todo.js |
| 工作台顶部「删除清单」按钮 `#todo-delete-list-btn`（**仅**此入口） | `showConfirmModal` 二次确认 → `deleteList(id)` | toast「已删除清单」；被删是今日清单 → 重建（下次 init） | — | todo.js、utils/todo-storage.js |
| 工作台顶部「存为模板」按钮 `#todo-save-template-btn` | 空清单 → toast 拒绝；否则 `showEditModal` 输入模板名（默认取清单名）→ `saveAsTemplate` | 模板库新增卡片 | 空清单 → toast「清单为空，无法存为模板」 | todo.js、utils/todo-storage.js |
| 工作台输入框 `[data-role="add-item-input"]` + Enter | `addItem(listId, text)` → 新事项 `order = max(未完成)+1`、`completed=false`；v1.0.1 输入过程中由 `resizeAddItemInput` 测量文本并同步调整 `width` 与 `flex-basis` | 侧边栏计数 +1；事项插入未完成区；输入框清空后回到 480px 基准，添加按钮始终保持 28px 方形并贴齐表单右端 | 空内容 → 静默忽略；可用空间不足时输入框按 flex 收缩 | todo.js、todo.css、utils/todo-storage.js |
| 复选框 `.todo-check`（`role=checkbox`）/ Space / Enter | `toggleItem(listId, itemId)` → 翻 `completed` + 写/清 `completedAt` | 勾选变绿、文本划线、沉底已完成区 | — | todo.js、utils/todo-storage.js |
| 待办项文本双击 | `startEditItem(itemId)` → `contenteditable=true` 全选 | 可编辑态 | — | todo.js |
| 待办项编辑 Enter / blur | `saveItems` 整桶重写 | 文本更新 | 空内容 = 视为删除；与原文相同 = noop | todo.js、utils/todo-storage.js |
| 待办项编辑 Esc | 取消编辑 | 恢复原值 | — | todo.js |
| 悬停待办项 → 删除按钮 `.todo-item-delete` | `deleteItem(listId, itemId)`（**无确认、无撤销**） | 待办项移除 | — | todo.js、utils/todo-storage.js |
| 拖拽未完成项（`.todo-item-handle` 拖到目标项） | HTML5 dragstart/dragover/drop；drop 后整段重写未完成项 `order`；已完成项 `order` 保持不变 | 视觉：`todo-item-drop-above` 提示；顺序更新 | 跨清单、跨「已完成」边界 → 拒绝 | todo.js、utils/todo-storage.js |
| 侧边栏「全部待办」`#todo-nav-all` | `switchTo('all', null)` → `writeHash` → hash `#todo/all` | 跨清单分组显示未完成事项 | — | todo.js |
| 侧边栏「已完成」`#todo-nav-done` | `switchTo('done', null)` → hash `#todo/done` | 跨清单分组显示已完成；附「今天/昨天/X 月 X 日」时间 | — | todo.js |
| 侧边栏「模板库」`#todo-nav-templates` | `switchTo('templates', null)` → hash `#todo/templates` | 卡片网格（`auto-fill minmax(220px, 1fr)`） | — | todo.js |
| 模板卡「使用该模板」`#todo-template-use` | `onUseTemplate(t)` → `createListFromTemplate` → 跳到新清单工作台 | toast「已基于模板创建「X」」 | — | todo.js、utils/todo-storage.js |
| 模板卡「复制到当前清单」`#todo-template-copy` | `onCopyTemplateToCurrentList(t)` → `copyTemplateToList` | toast「已复制 N 条到「X」」 | 不在工作台视图 → toast 拒绝；空模板 → toast 拒绝 | todo.js、utils/todo-storage.js |
| 模板卡删除按钮 | `showConfirmModal` 二次确认 → `deleteTemplate(id)` | toast「已删除模板」 | — | todo.js、utils/todo-storage.js |
| 浏览器后退 / 前进 | `hashchange` → 路由切回 | 视图切换 | — | 浏览器原生 + manager.js / todo.js |

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

> 导入功能**已删除**（用户确认：该功能已整体下线，当前代码中无任何导入实现，grep 无 importSnippets / handleImport / 导入 相关代码）。导出 JSON 无对应解析器，导出的数据不可重新导入 —— 置信度：高。

### 4.4 待办存储键（`utils/todo-storage.js`，v1.0.0 新增）

| 键 | 类型 | 写入点 | 说明 |
|----|------|--------|------|
| `todo_lists` | TodoList[] | `createList`（push）、`renameList`（name / updatedAt）、`deleteList`（filter）、`getOrCreateTodayList` | 清单索引列表（**单键**），按 `TodoList.order` 升序展示 |
| `todo_items_<listId>` | TodoItem[] | `createList`（预创建 `[]`）、`addItem`（push）、`toggleItem`（map 翻转）、`deleteItem`（filter）、`saveItems`（整桶重写）、`deleteList`（同步 `remove` 整桶） | 每个清单一个独立桶，**始终数组**（空清单 = `[]`，**不删键**） |
| `todo_templates` | Template[] | `saveAsTemplate`（push）、`deleteTemplate`（filter） | 模板列表（**单键**） |
| `todo_today_list_id` | string \| null | `getOrCreateTodayList`（写）；`deleteList`（若是今日清单 → 清） | 「今日待办」清单 id 指针；引用清单被删时由 `getOrCreateTodayList` 幂等恢复 |

> `todo_*` 键与 `snip_*` / `snippets_order` / `collectEnabled` 等采集键**完全互不读写**；`utils/todo-storage.js` 与 `utils/storage.js` 互不依赖（两份独立的 `generateUUID`）。

### 4.5 待办对象字段

**清单对象**（存储在 `todo_lists`）：

| 字段 | 类型 | 必填 | 写入点 | 说明 |
|------|------|------|--------|------|
| `id` | string（UUID v4） | 是 | `createList`、`getOrCreateTodayList` | `crypto.randomUUID()`；同时是 `todo_items_<id>` 桶名后缀 |
| `name` | string | 是 | `createList`（默认「未命名清单」/「今日待办」）；`renameList`（trim + 60 字符上限） | UI 显示名 |
| `order` | number | 是 | `createList`（`max+1`） | 侧边栏排序键；**不暴露拖拽/↑↓ UI 入口**，仅按此字段排序 |
| `createdAt` | number（epoch ms） | 是 | `createList`、`getOrCreateTodayList` | 创建时间；UI 不展示 |
| `updatedAt` | number（epoch ms） | 是 | `createList` / `renameList` / 任何 items 桶写入 | 最近更新时间；UI「更新于 X」 |

**待办项对象**（存储在 `todo_items_<listId>`）：

| 字段 | 类型 | 必填 | 写入点 | 说明 |
|------|------|------|--------|------|
| `id` | string（UUID v4） | 是 | `addItem` | `crypto.randomUUID()` |
| `listId` | string | 是 | `addItem` | 所属清单 id（冗余字段，便于跨清单汇总） |
| `content` | string | 是 | `addItem`（trim + 5000 上限）；编辑回调（trim） | 待办内容 |
| `order` | number | 是 | `addItem`（`max(未完成)+1`）；拖拽重排后整段重写 | 同清单未完成项排序键；已完成项 `order` 保持不变 |
| `completed` | boolean | 是 | `addItem`（默认 false）；`toggleItem` | 完成标记 |
| `completedAt` | number \| null | 是（null） | `toggleItem`（翻转时同步写/清） | 完成时间；「今天/昨天/X 月 X 日」展示 |
| `createdAt` | number（epoch ms） | 是 | `addItem` | UI 不展示；`sortItems` 同序决胜 |

**模板对象**（存储在 `todo_templates`）：

| 字段 | 类型 | 必填 | 写入点 | 说明 |
|------|------|------|--------|------|
| `id` | string（UUID v4） | 是 | `saveAsTemplate` | `crypto.randomUUID()` |
| `name` | string | 是 | `saveAsTemplate`（trim + 默认取清单名） | 模板名；模板库卡片标题 |
| `items` | string[] | 是 | `saveAsTemplate`（`items.map(content)` 文本快照） | 待办文本列表；**不含** id / completed / completedAt / listId |
| `createdAt` | number（epoch ms） | 是 | `saveAsTemplate` | UI「更新于 X」展示 |
| `updatedAt` | number（epoch ms） | 是 | `saveAsTemplate` | 同上（v1.0 写入时两者均取 `Date.now()`） |

---

## 5. 接口清单

### 5.1 后端 / 第三方 API
**无**。全库 grep 无 `XMLHttpRequest`、`WebSocket`、`importScripts`、`chrome.runtime.sendMessage`/`onMessage`；唯一的 `fetch(` 调用位于 `manager/nav.js`，仅读取扩展包内同源资源 `config/nav.json`（`chrome.runtime.getURL`，chrome-extension:// 协议），**不发起任何外部网络请求**（高置信度）。

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
| `fetch(chrome.runtime.getURL(...))` | 读取包内导航配置 `config/nav.json`（同源资源，非外部网络） | nav.js |

### 5.4 待办数据层接口（`utils/todo-storage.js` → `chrome.storage.local`，v1.0.0 新增）

| API | 入参 | 返回值 | 错误约定 | 说明 |
|-----|------|--------|----------|------|
| `generateUUID()` | — | string（UUID v4） | — | 与 storage.js 同实现（复制版），保证 v1.0 待办模块独立可测试 |
| `normalizeListName(name, fallback)` | string?, string | string | — | trim + 60 字符；空/超长 → `fallback`（默认「未命名清单」） |
| `getOrCreateList(key, fallbackName)` | string, string | `Promise<{id,…} \| null>` | storage 失败 → null | 工具：key 命中且对应清单在 → 返回；否则 `createList` |
| `getOrCreateTodayList()` | — | `Promise<TodoList>` | — | 见 §4.4；幂等；引用清单被删时清指针后重建 |
| `getLists()` | — | `Promise<TodoList[]>` | — | 仅读 `todo_lists`，按 `order` 升序 |
| `createList(name?)` | string? | `Promise<TodoList>` | 无效输入（空/超长）→ throw | name 缺省/空 → 「未命名清单」；`order = max+1`；预创建 `todo_items_<id> = []`；写 `updatedAt` |
| `renameList(id, newName)` | string, string | `Promise<TodoList \| null>` | trim 后空 → throw；不存在 → null | 同步写 `updatedAt` |
| `deleteList(id)` | string | `Promise<{deleted, removedItems} \| null>` | 不存在 → null | 同步清 `todo_items_<id>` 桶；若是「今日待办」→ 清 `todo_today_list_id` |
| `getItems(listId)` | string | `Promise<TodoItem[]>` | — | 缺键视为 `[]` |
| `saveItems(listId, items)` | string, TodoItem[] | `Promise<void>` | — | 整桶重写；过滤非数组项；空数组保留键 |
| `addItem(listId, content)` | string, string | `Promise<TodoItem>` | 空内容 → throw | trim + 5000；`order = max(未完成)+1`；写 TodoList.updatedAt |
| `toggleItem(listId, itemId)` | string, string | `Promise<TodoItem \| null>` | 不存在 → null | 翻 `completed` + 写/清 `completedAt` |
| `deleteItem(listId, itemId)` | string, string | `Promise<boolean>` | 不存在 → false | 过滤该 id |
| `sortItems(items)` | TodoItem[] | `TodoItem[]`（副本） | — | 未完成在前（按 `order` 升序）→ 已完成在后（按 `completedAt` 降序）；同 completed+order 按 `createdAt` 决胜 |
| `loadTemplates()` | — | `Promise<Template[]>` | — | 读 `todo_templates`，缺键视为 `[]` |
| `saveAsTemplate(listId, templateName?)` | string, string? | `Promise<Template>` | 空清单 → throw | 仅 `items.map(content)` 文本快照 |
| `createListFromTemplate(templateId, listName?)` | string, string? | `Promise<TodoList>` | — | 建新清单 + 按序 `addItem` 全部未完成态 |
| `copyTemplateToList(templateId, listId)` | string, string | `Promise<{added} \| null>` | 不存在 → null | 过滤空串；按序追加到目标清单末尾 |
| `deleteTemplate(id)` | string | `Promise<boolean>` | 不存在 → false | filter 该 id |

**错误约定小结**：参数校验失败 → `throw`；资源不存在 → `null` / `false`；写操作基于 `chrome.storage.local` Promise 串行，无并发竞态。

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
| 导航面板开合状态/收起宽限计时器 | `navOpen`、`navCloseTimer` | nav.js | 管理页生命周期 |

### 6.3 状态同步机制
- `chrome.storage.onChanged`：SW（badge）、content（开关缓存）、manager（开关 UI + 新记录实时 prepend，3s 后隐藏「新增了 N 条记录」提示条）。
- 本地修改（删除/撤销/清空）期间 `ignoreAllOrderChanges=true` 抑制 onChanged 重复追加（manager.js）。

### 6.4 待办内存状态（`manager/todo.js` 顶部 `state` 对象，非持久化）

| 状态 | 变量 | 说明 |
|------|------|------|
| 清单列表 | `state.lists` | 当前所有清单（按 `order` 升序） |
| 待办项映射 | `state.itemsByList` | `{ [listId]: TodoItem[] }` |
| 模板列表 | `state.templates` | 当前所有模板（按 `createdAt` 降序） |
| 当前清单 | `state.currentList` | 正在显示工作台的清单对象（null = 无） |
| 当前清单 id | `state.currentListId` | 同上的 id；与 `location.hash` 同步 |
| 当前视图 | `state.currentView` | `'list'` / `'all'` / `'done'` / `'templates'` |
| 显示已完成折叠态 | `state.showCompleted` | 当前清单的「已完成 N」区折叠/展开 |
| 本地修改抑制标志 | `state.isApplyingLocalChange` | 与 manager.js 的 `ignoreAllOrderChanges` 同模式；本地写期间 set true，期间忽略 `onChanged` 回响 |
| 模板按钮 hover 状态 | `state.hoveredTemplateId` | 当前 hover 的模板卡 id（用于显示「使用该模板」/「复制到当前清单」） |
| 当前待办项编辑中的 id | `state.editingItemId` | `contenteditable` 态下的事项 id（用于 Enter / Esc / blur 处理） |

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

### 8.5 导航配置文件（唯一用户可配置文件，v0.8.0 新增）

- 路径：`text-collector/config/nav.json`；管理页初始化时 `nav.js loadNavConfig` 经 `fetch(chrome.runtime.getURL(...))` 读取，`normalizeNavConfig` 校验规范化。
- Schema：`{ "columns": [ { "title": string（可选）, "links": [ { "name": string, "url": string } ] } ] }`；兼容糖：顶层 `links` 数组视为单个无标题栏。
- 校验：仅放行 `http:`/`https:` 协议（`javascript:`/`data:`/`chrome:`/相对路径一律过滤）；name/url trim；空条目与无有效链接的栏移除；全部无效 → `#nav-root` 隐藏。
- 修改文件后刷新管理页即生效（unpacked 扩展无需重载扩展）。
- 当前仓库内示例配置为 3 栏 9 链接（常用 4 / 开发 3 / 阅读 2）。

### 8.6 包管理脚本

- `package.json`：`version` 1.0.1；scripts `test`（`vitest run`）、`test:watch`；devDependencies 仅 `vitest ^4.1.10`。
- `design/package.json` scripts：`icons`（`node make-icons.js`）、`preview`；依赖 `sharp ^0.35.3`（仅图标生成用，不在扩展运行时）。

### 8.7 待办运行时配置（v1.0.0）

> 待办模块刻意**不**抽离独立 CONFIG，全部阈值硬编码在 `utils/todo-storage.js` / `manager/todo.js` 函数内（与项目"小模块零配置"约定一致）：

| 项 | 值 | 位置 |
|----|----|------|
| 事项 `content` 长度上限 | 5000 字符 | `addItem` 内部 |
| 清单名 `name` 长度上限 | 60 字符 | `normalizeListName` |
| 事项默认排序键 | `order = max(未完成)+1` | `addItem` |
| 拖拽接受 | 仅未完成项；跨清单/跨完成边界拒绝 | `manager/todo.js` 拖拽事件 |

---

## 9. 版本与变更

### v1.0.1 — 待办工作台布局微调（2026-08-15）

- 版本号：`manifest.json` / `package.json` 均为 **1.0.1**（上一版 1.0.0）。
- **侧边栏**：`manager/todo.css` 中 `.todo-sidebar` 的默认桌面宽度由 240px 调整为 **300px**；仍使用 `flex-shrink: 0`，不参与收缩。
- **添加事项输入框**：`.todo-add-form input` 使用 `flex: 0 1 480px`、`width: 480px` 与 `min-width: 0`。其初始宽度和弹性基准均为 **480px**，窄窗口时可收缩；窗口扩宽时不因剩余空间自动增长，仅恢复至自身基准或内容需要的宽度。`.todo-content` 允许作为外层 flex 项收缩，内容内层最大宽度为 960px，为可见扩展预留空间。
- **添加按钮**：`.todo-add-form button` 使用 `flex: 0 0 28px`、最小宽高均为 28px，防止超长输入内容挤压或拉伸按钮，并通过 `margin-left: auto` 将其固定在表单右端。
- **内容驱动扩展**：`manager/todo.js` 的 `resizeAddItemInput(input)` 每次输入时用 canvas 文本测量当前输入值；若文本所需宽度超过 480px，则同步更新 inline `width` 与 `flex-basis`；提交后清空输入值并重设基准。数据模型、待办 CRUD、路由、权限与存储键均无变化。
- **测试**：现有 Vitest 套件仍为 4 个测试文件、**100** 个用例，`npm test` 全部通过；本次未新增专门针对 DOM 尺寸计算的测试。

### v1.0.0 — 待办清单功能（2026-08-15）

- 版本号：`manifest.json` / `package.json` 均为 **1.0.0**（上一版 0.8.1）。
- **新增待办功能**（同页 Tab，非独立页面）：
  - 管理页顶部 brand 区域新增「待办」`<a href="#todo">` 入口；hash 路由 `#collect` / `#todo[/...]` 切换采集/待办 tab；
  - 待办内 4 视图（工作台 / 全部待办 / 已完成 / 模板库）由 hash 段驱动（`#todo` / `#todo/all` / `#todo/done` / `#todo/templates` / `#todo/list/<id>`）；
  - 双层路由：manager.js `applyRouteFromHash` 切主视图；todo.js `handleHashChange` 切待办内视图；
  - 待办模块：`manager/todo.js`（视图渲染 + 事件 + 拖拽）+ `manager/todo.css`（复用 `manager.css` 的 `:root` 变量）；
  - 数据层：`utils/todo-storage.js`（纯函数 + storage Promise；与 `utils/storage.js` 互不依赖）；
  - 4 视图：工作台（清单详情 + X/Y 进度 + 事项列表 + 输入框 + 存为模板/删除清单 + 拖拽）/ 全部待办（跨清单分组）/ 已完成（跨清单分组 + 时间）/ 模板库（卡片网格 + 使用/复制/删除）；
  - 模板：仅从清单存为模板（文本快照，不含 id/时间戳）；使用模板创建新清单；复制到当前清单；删除；
  - 首启惰性创建「今日待办」：`getOrCreateTodayList`，引用清单被删时幂等恢复。
- **点击扩展图标行为**：**未变**——SW 仍 `tabs.create({url: 'manager/manager.html'})`（无 hash），管理页 `applyRouteFromHash` 视为空 = 采集 tab。**与 v0.8.1 完全一致**。
- **管理页顶部 brand 形态回到 v0.8.1**（svg mark + 「采集」纯文字 + `<a href="#todo">待办</a>`），**无箭头、无激活态视觉**。
- **存储**：待办数据**完全独立**于采集记录，使用 `todo_` 前缀键；与 `snip_*` / `snippets_order` / `collectEnabled` 互不读写。
- **样式**：待办 CSS（`.todo-*` 前缀）复用 `manager.css` 已加载的 `:root` 变量，不重定义。
- **测试总数**：64 → **100**（新增 `tests/todo-storage.test.js` 36 例）。
- **采集记录管理、采集功能、采集开关、导航配置、快捷键、导出格式、manifest 权限均无变化**。
- **删除**：旧版 v0.8 错误实现的 `todo/` 子目录与 `todo.html` 已被 v1.0.0 移除（commit `2b681d3` 整段重写后）。

---

## 附：明确的「无」

- 无后端、无**外部**网络请求、无第三方 API（唯一 `fetch` 读取包内配置文件 `config/nav.json`）。
- 无登录/账号/角色/权限体系。
- 导入功能已删除（用户确认；当前代码无任何导入实现，grep 验证）。
- 无 localStorage / sessionStorage / cookie 使用。
- 无环境变量、无构建/打包脚本（扩展以源码形式加载）。
- 无路由框架、无前端框架（原生 DOM 操作）。
