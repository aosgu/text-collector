# 功能规格 — 网页文字采集器

> 依据：`docs/_facts.md` 与代码（v1.0.1，2026-08-15）。每个功能包含：用户故事、触发入口、交互流程、输入/输出、边界情况、关联接口/数据/组件、置信度。
> 交互描述均对应到具体组件（DOM id/class）与文件。共 **27 个功能**（功能 21 为 v0.8.0 新增的网站导航；功能 22–27 为 v1.0.0 新增的待办清单；v1.0.1 微调功能 24 的工作台布局与输入宽度行为）。

---

## 功能 1：划词自动采集

- **用户故事**：作为用户，我在网页上选中一段文字，不做任何额外操作，它就被自动保存下来。
- **触发入口**：任意网页（`manifest.json` content_scripts `matches: ["<all_urls>"]`）内 `selectionchange` 事件。
- **交互流程**：
  1. 用户选中文本 → 页面 `selectionchange` 触发；
  2. `content/content.js` 重置防抖计时器（`CONFIG.DEBOUNCE_MS = 500`）；
  3. 防抖到期 → `processSelection()` 顺序检查：已初始化 / 开关开启 / 非编辑区 / 超过页面加载保护期（`PAGE_LOAD_GRACE_MS = 2000`）/ 存在选区；
  4. 准入过滤（见功能 2）→ `NFC` 规范化 → 超过 `MAX_TEXT_LENGTH = 5000` 时安全截断（`truncateText`，不在代理对中间切断）；
  5. 调 `addSnippet(text, location.href, document.title || url)` 写库；
  6. 按返回结果弹出 toast。
- **输入**：页面选区文本（`window.getSelection().toString()`）、`location.href`、`document.title`。
- **输出**：`chrome.storage.local` 新增 `snip_<uuid>` + `snippets_order` 置顶；页面右上角 toast。
- **边界情况**（均见 `content/content.js`）：
  - 开关关闭 / 未初始化完成 → 直接 return，无任何反馈；
  - 页面加载后 2s 内（浏览器恢复上次选区）→ 跳过；
  - 选区在 input/textarea/contenteditable（含 Shadow DOM 内、未聚焦 contenteditable）→ 跳过；
  - `addSnippet` reject → toast「采集失败」（danger）；错误为 `Extension context invalidated` 时静默不提示；
  - storage 初始化失败 → 默认开启并 `console.warn`，不静默失效。
- **关联**：`content/content.js`（processSelection / showToast）、`utils/storage.js`（addSnippet / CONFIG）、`manifest.json`。
- **置信度：高**（行为全部由代码直接定义；相关纯函数有单测）。

## 功能 2：采集准入过滤

- **用户故事**：我不希望太短的、纯符号、纯数字、纯 URL 的选中被存进记录里。
- **触发入口**：`processSelection()` 内部自动执行（无用户交互）。
- **交互流程**（顺序短路，任一不满足即放弃本次采集）：
  1. `meetsLengthThreshold`：`中文字数/5 + 英文词数/3 ≥ 1`（加权混合，纯中文 ≥5 字、纯英文 ≥3 词）；
  2. `isPureSymbol`：仅标点与符号（`\p{P}\p{S}`，不支持时 fallback ASCII+全角符号表）；
  3. `isPureNumber`：仅数字/小数点/逗号/空白；
  4. `isPureURL`：`^(https?|ftp|file)://` 开头、全 ASCII 可见字符、长度 > 10 的整段 URL；
  5. 超长截断：UTF-16 code unit 上限 5000，代理对（emoji/生僻字）安全截断。
- **输入**：选区原始文本；**输出**：通过 → 进入写库流程；未通过 → 丢弃（无任何反馈）。
- **边界情况**：含中文/emoji 的 URL 不判为 URL（按普通文本继续）；正则不支持 Unicode 属性时走 fallback。
- **关联**：`content/content.js`（meetsLengthThreshold / isPureSymbol / isPureNumber / isPureURL / truncateText / isSelectionInEditable）、`utils/storage.js`（CONFIG 阈值）、`tests/content.test.js`（39 个用例覆盖）。
- **置信度：高**（函数与阈值均有单测）。

## 功能 3：去重与扩选合并

- **用户故事**：同一页面重复选中同一段文字不会产生重复记录；先选半句再扩选整句时，只保留最后选中的整句。
- **触发入口**：`utils/storage.js` `addSnippet` 内部（每次写入时自动执行）。
- **交互流程**（检查最近 `DEDUP_CHECK_LIMIT = 500` 条记录）：
  1. 计算 `urlKey`（origin + pathname，忽略 query/hash）；
  2. 同 urlKey + 文本完全相同 → `action: 'duplicate'`，仅更新 `lastSelectedAt`，不新增；
  3. 同 urlKey + `EXPAND_REPLACE_WINDOW_MS = 5000` 窗口内 + 新文本包含旧文本 → `action: 'replaced'`，替换 `text` 与 `lastSelectedAt`；
  4. 均不命中 → `action: 'created'`，生成 UUID 写入 `snip_<id>`，再 prepend 到 `snippets_order`（写后校验重试 ≤3 次，缩小并发竞态窗口）。
- **输入**：新采集文本 + URL + 标题；**输出**：`{action, record}` 三态。
- **边界情况**：超过最近 500 条范围的记录不参与去重/扩选；order 校验重试 3 次后仍失败则放弃写 order（记录本身已写入，靠孤儿扫描兜底）。
- **关联**：`utils/storage.js`（addSnippet / getUrlKey / generateUUID / CONFIG）、`content/content.js`（toast 文案按 action 区分：「已采集」success /「已采集过」info）。
- **置信度：高**（`getUrlKey` 有单测；分支逻辑代码直接可证）。

## 功能 4：采集开关

- **用户故事**：我可以在不想采集时一键暂停，图标上能看出当前状态。
- **触发入口**：
  - 管理页右上角开关 `#collect-toggle`（点击或键盘 Enter/Space，`role="switch"`）；
  - 全局快捷键 `Ctrl+Shift+S`（`manifest.json` `commands.toggle-collect`，非全局、需 Chrome 前台）。
- **交互流程**：
  1. `manager/manager.js` `handleToggle()` → 读 `collectEnabled` → 取反 → `setCollectEnabled` → `updateToggleUI`（ON/OFF 文案 + `aria-checked`）；
  2. 快捷键路径：`service-worker.js` `chrome.commands.onCommand` → 切换存储 → `updateBadge`；
  3. `chrome.storage.onChanged` 把新值同步给：内容脚本缓存（`content.js`）、管理页 UI、SW badge。
- **输入/输出**：`collectEnabled`（boolean，存于 `chrome.storage.local`）；badge：开启 = 无文字，关闭 = 灰色「OFF」（底 `#9a9890`、字 `#ffffff`）。
- **边界情况**：未设置时所有读取方按 `true` 处理（`!== false`）；安装时 SW 初始化 `collectEnabled = true`；SW 冷启动/事件唤醒时兜底同步 badge。
- **关联**：`manager/manager.js`（handleToggle / updateToggleUI）、`background/service-worker.js`（onCommand / updateBadge / onInstalled / onStartup）、`content/content.js`（缓存与订阅）、`utils/storage.js`（get/setCollectEnabled）。
- **置信度：高**。

## 功能 5：记录列表与分页加载

- **用户故事**：打开管理页能看到全部采集记录，最新在前，可以一直往下翻。
- **触发入口**：打开 `manager/manager.html` → `init()` → `loadFirstPage`；点「加载更多」`#btn-load-more`。
- **交互流程**：
  1. `adoptOrphanSnippets()` 先收领孤儿（见功能 16）；
  2. `loadMore` → `getSnippets(offset, PAGE_SIZE=50, filter)` → 逐条 `createCard` 渲染；
  3. `updateRecordInfo`：显示「共 N 条 / 占用约 N KB / 最新在前」（`getStorageEstimate` 均匀采样 50 条估算）；
  4. 已加载 < 总数 → 显示「加载更多」；`totalCount > STORAGE_WARNING_THRESHOLD = 5000` → 显示存储警告条（「记录数已超过 5000 条，建议导出备份」）。
- **输入/输出**：无用户输入；输出为卡片列表 + 计数 + 警告条。
- **边界情况**：
  - 空态：首页「还没有采集记录」（副文案引导）；已保存页签「还没有已保存的笔记」；
  - 加载失败：toast「加载失败，请重试」，**保留已加载列表**，可重试；
  - 初始化失败：`renderLoadError` 展示「加载失败」错误态（含恢复指引文案）；
  - 加载中重复点击被 `isLoading` 拦截。
- **关联**：`manager/render.js`（loadMore / updateRecordInfo / applyTruncationCheck / renderLoadError）、`manager/manager.js`（listBridge 状态通道）、`utils/storage.js`（getSnippets / getStorageEstimate / CONFIG.PAGE_SIZE / CONFIG.STORAGE_WARNING_THRESHOLD）。
- **置信度：高**。

## 功能 6：新记录实时追加

- **用户故事**：管理页开着时，新采集的记录自动出现在列表顶部，不用手动刷新。
- **触发入口**：无用户操作；`chrome.storage.onChanged`（`snippets_order` 变化）自动触发。
- **交互流程**：
  1. 比较新旧 order，取出新增 id；
  2. 按当前页签 `filterOrderRecords` 筛选（「已保存」页签下未收藏的新记录不插入）；
  3. `prependNewCards` 从后往前插到列表顶部（保持最新在上）；
  4. 显示提示条「新增了 N 条记录」，3 秒后自动隐藏（`newRecordTimer`）。
- **边界情况**：本地操作（删除/清空/撤销）期间 `ignoreAllOrderChanges = true` 抑制追加，避免与手动操作重复。
- **关联**：`manager/manager.js`（onChanged 订阅 / newRecordsCount / newRecordTimer）、`manager/render.js`（prependNewCards）、`utils/storage.js`（filterOrderRecords / getFilteredOrder）。
- **置信度：高**。

## 功能 7：复制到剪贴板

- **用户故事**：点一下记录就能把文字复制走。
- **触发入口**：点击卡片文本区 `.card-text`；卡片键盘聚焦后按 Enter/Space；已保存卡片「复制」按钮 `.btn-copy`。
- **交互流程**：
  1. `copyToClipboard(record.text)`：优先 `navigator.clipboard.writeText`；
  2. 失败 fallback：临时 `<textarea>` + `document.execCommand('copy')`；
  3. 成功反馈：toast「已复制」（success）+ 卡片 `card-copied` 高亮动画 500ms。
- **输入/输出**：记录文本 → 系统剪贴板。
- **边界情况**：clipboard API 失败走 fallback（fallback 自身失败无额外反馈）；卡片内部按钮点击通过 `stopPropagation` 避免触发卡片复制。
- **关联**：`manager/render.js`（createCard / copyToClipboard）。
- **置信度：高**。

## 功能 8：删除与撤销

- **用户故事**：误删了一条记录，5 秒内能原样找回来。
- **触发入口**：卡片垃圾桶按钮 `.card-delete`。
- **交互流程**：
  1. 已保存记录（或处于「已保存」页签）→ 先弹 `showConfirmModal`「确认删除」二次确认；
  2. `performDeleteRecord`：记录原始 order 位置快照 → 卡片淡出 180ms 后移除 → `deleteSnippet(id)`（移除 `snip_<id>` + order 过滤）→ 计数 -1；
  3. toast「已删除」（info，带「撤销」按钮，5 秒）；
  4. 点「撤销」：写回 `snip_<id>` → 按原 index 插回 `snippets_order` → 重建卡片插入原位 → toast「已恢复」（success）→ 计数 +1。
- **输入/输出**：记录 id；输出为存储删除/恢复 + UI 更新。
- **边界情况**：撤销期间 `ignoreAllOrderChanges` 抑制实时追加；撤销后 `currentOffset`/`totalCount` 同步 ±1 防止分页错位；删除后为空 → 显示空态；原 index 失效 → 置顶恢复。
- **关联**：`manager/render.js`（deleteRecord / performDeleteRecord）、`manager/toast.js`（action 按钮）、`manager/modal.js`、`utils/storage.js`（deleteSnippet）。
- **置信度：高**。

## 功能 9：清空全部

- **用户故事**：我想一次性清掉所有普通采集记录，但保留收藏过的。
- **触发入口**：管理页「清空全部」`#btn-clear`（仅「首页」页签可见，`#tab-saved` 激活时隐藏）。
- **交互流程**：
  1. `showConfirmModal`：文案含总条数与最早记录日期（`getEarliestDate`），默认焦点在「取消」；
  2. 确认 → `clearAllSnippets()`（最多 3 轮校验循环）：`saved === true` 的记录保留并置 `clearedFromHome = true`，其余 `snip_*` 全部删除，`snippets_order` 只保留已保存 id；
  3. 重新加载首屏 → toast「已清空」（success）。
- **输入/输出**：确认操作；输出为存储批量删除 + 列表刷新。
- **边界情况**：**无显式失败反馈**（`handleClearAll` 无 catch 分支）；确认弹窗 Esc/遮罩可取消；清空后已保存记录仍在「已保存」页签可见。
- **状态迁移**：记录状态 `saved=true` → 追加 `clearedFromHome=true`；未收藏记录 → 从存储移除。
- **关联**：`manager/manager.js`（handleClearAll）、`manager/modal.js`（showConfirmModal）、`utils/storage.js`（clearAllSnippets / getEarliestDate）。
- **置信度：高**。

## 功能 10：首页 / 已保存页签

- **用户故事**：普通采集和收藏的笔记分开两个视图查看。
- **触发入口**：管理页 `#tab-home` / `#tab-saved`（`role="tablist"`）。
- **交互流程**：`handleTabSwitch` → 更新 `currentTab`、按钮 active/`aria-selected` → 切换「清空全部」显隐 → `loadFirstPage(filter)` 重载列表。
- **筛选语义**（`utils/storage.js` `filterOrderRecords`）：`home` = 未被 `clearedFromHome` 标记；`saved` = `saved === true`；`all` = 全部（导出用）。
- **边界情况**：两页空态文案不同；已保存页签下取消收藏 → 卡片淡出移除（见功能 11）。
- **关联**：`manager/manager.js`（handleTabSwitch / currentTab）、`manager/render.js`（loadMore 按 filter）、`utils/storage.js`（filterOrderRecords / getFilteredOrder）。
- **置信度：高**。

## 功能 11：收藏 / 取消收藏

- **用户故事**：重要的记录标上书签，在「已保存」页签里单独管理。
- **触发入口**：卡片左侧书签按钮 `.card-favorite`（实心=已收藏；`aria-label`「收藏这条笔记 / 取消收藏」）。
- **交互流程**：
  1. `toggleFavoriteSnippet(id)`：翻转 `saved`；
  2. 更新按钮图标/标题/aria + toast「已添加到"已保存"」（success）或「已取消收藏」（info）；
  3. 在「已保存」页签取消收藏 → 卡片淡出 180ms 移除，计数同步递减。
- **状态迁移**（`toggleFavoriteSnippet` 返回三态）：
  - `saved: undefined → true` → `action: 'updated'`；
  - `saved: true → false`（且无 `clearedFromHome`）→ `action: 'updated'`；
  - `saved: true → false`（且 `clearedFromHome === true`，即曾被首页清空保留过）→ 记录被**彻底删除**，`action: 'deleted'`。
- **边界情况**：记录不存在时返回 `null` → UI 静默置为未收藏，无提示。
- **关联**：`manager/render.js`（createCard 收藏按钮）、`utils/storage.js`（toggleFavoriteSnippet / deleteSnippet）。
- **置信度：高**。

## 功能 12：编辑已保存笔记

- **用户故事**：收藏下来的笔记文字写错了，可以直接改。
- **触发入口**：已保存卡片「编辑」按钮 `.btn-edit`（`record.saved === true` 或处于已保存页签时显示）。
- **交互流程**：
  1. `showEditModal`：纯文本 `<textarea>` 预填原文，焦点与光标置于末尾；保存 = 点「保存」或 `Ctrl/Cmd+Enter`；Esc 取消；
  2. 校验：trim 后为空 → toast「笔记内容不能为空」（danger），不写入；
  3. trim 后与原文相同 → 直接返回，不写库；
  4. `updateSnippetText(id, newText)`：更新 `text` + `updatedAt`；
  5. 卡片文本刷新 + `applyTruncationCheck` 重算截断 → toast「已保存修改」（success）。
- **输入/输出**：新文本（string）→ `snip_<id>.text` / `.updatedAt` 更新。
- **边界情况**：空内容拒绝保存；弹窗 Tab 焦点陷阱（textarea ↔ 取消 ↔ 保存）；Esc/遮罩关闭不保存。
- **关联**：`manager/modal.js`（showEditModal）、`manager/render.js`（编辑按钮回调）、`utils/storage.js`（updateSnippetText）。
- **置信度：高**。

## 功能 13：导出 TXT / JSON

- **用户故事**：把记录导出成文件，备份或另作他用。
- **触发入口**：管理页「导出」`#btn-export` → 下拉菜单「导出为 TXT」/「导出为 JSON」（`data-format`）。
- **交互流程**：
  1. `handleExport(format)` → `getAllSnippets(当前页签 filter)`（按 `EXPORT_BATCH_SIZE = 100` 分批读取，按 `capturedAt` 升序）；
  2. TXT：文本以 `\n\n` 连接，`\uFEFF` UTF-8 BOM，`text/plain;charset=utf-8`；
  3. JSON：`{schemaVersion: 1, exportedAt: ISO, count, snippets}`，`application/json`；
  4. `downloadBlob`（objectURL + `<a download>`）→ toast「已导出 N 条」（success）。
- **输入/输出**：格式选择 → 下载文件 `snippets[_saved_]_<YYYY-MM-DD>.txt/.json`（`_saved_` 后缀用于已保存页签）。
- **边界情况**：未知格式 → toast「未知导出格式」（danger）；读取异常 → toast「导出失败：存储读取异常」（danger）；空列表也正常导出（`count: 0`，无特殊空态分支）。
- **关联**：`manager/export.js`（handleExport / downloadBlob）、`utils/storage.js`（getAllSnippets / SCHEMA_VERSION / CONFIG.EXPORT_BATCH_SIZE）。
- **置信度：高**。

## 功能 14：Toast 通知（页面内 / 管理页两套）

- **用户故事**：操作后要有即时、不打扰的反馈。
- **触发入口**：由各功能自动触发（采集结果、复制、删除、导出等）。
- **交互流程**：
  - **页面内 toast**（`content/content.js` `showToast`）：closed Shadow DOM 注入宿主页；`detectDarkSurrounding`（系统深浅色偏好 + 页面背景亮度 YIQ）自动选浅/深色版；1500ms 淡出 + 200ms 移除；success/info/danger 三种徽标（硬编码 SVG）；宿主样式由 `content/content.css` + 内联 `!important` 双重钉死。
  - **管理页 toast**（`manager/toast.js`）：单实例（新 toast 顶掉旧）；默认 1600ms、带操作按钮 5000ms；`ICON_CHECK/INFO/ALERT` 徽标。
- **边界情况**：页面禁止 `attachShadow` → 放弃 toast（不泄漏样式）；toast 宿主被页面 CSS 污染 → 双保险隔离；管理页 toast 操作按钮（如「撤销」）点击后立即 dismiss。
- **关联**：`content/content.js`、`content/content.css`、`manager/toast.js`、`manager/manager.html` `#toast-container`。
- **置信度：高**。

## 功能 15：确认 / 编辑弹窗（modal）

- **用户故事**：破坏性操作（删除/清空）前有确认；编辑时有安全的输入框。
- **触发入口**：清空全部、删除已保存记录 → `showConfirmModal`；编辑笔记 → `showEditModal`。
- **交互流程**：遮罩 + 弹窗（`role="dialog"` / `aria-modal`）；Esc 关闭；Tab/Shift+Tab 焦点陷阱循环；Enter 尊重当前焦点（破坏性操作默认焦点在「取消」，Enter 不触发确认）；遮罩点击关闭；关闭后焦点还原到触发元素。
- **边界情况**：焦点逃逸兜底（`focusin` 拉回弹窗内）；清空确认含最早记录日期动态文案。
- **关联**：`manager/modal.js`（showConfirmModal / showEditModal）、调用方 `manager/manager.js`、`manager/render.js`。
- **置信度：高**。

## 功能 16：孤儿记录自动收领

- **用户故事**：历史竞态产生的"有数据但不在列表"的记录，打开管理页时自动找回来。
- **触发入口**：管理页 `init()` 时自动执行 `adoptOrphanSnippets()`。
- **交互流程**：
  1. 节流检查：`orphanScanV1` 时间戳，24h 内且 order 非空 → 跳过；
  2. 全量扫描 `snip_*`：不在 `snippets_order` 中的有效记录 → 收领；
  3. 缺 `id` 的孤儿 → 批量写回补 `id`（100 条/批）；
  4. 收领记录按 `capturedAt` 降序合并进 `snippets_order` 头部（去重）。
- **输入/输出**：无用户输入；输出为 order 修复 + 收领数（返回值，当前调用方未展示）。
- **边界情况**：order 为空但存在 `snip_*`（清空竞态典型）→ 节流期内也强制扫描；元信息读取失败 → 宁可多扫不丢数据。
- **关联**：`utils/storage.js`（adoptOrphanSnippets / ORPHAN_SCAN_FLAG / SCAN_INTERVAL_MS=24h）、`manager/manager.js`（init）。
- **置信度：高**。

## 功能 17：打开 / 聚焦管理页

- **用户故事**：点工具栏图标就能打开管理页；已经开着就直接切过去。
- **触发入口**：点击工具栏扩展图标（`manifest.json` 无 `default_popup`，故 `action.onClicked` 生效）。
- **交互流程**：`chrome.tabs.query({url: MANAGER_URL})` → 已存在则 `tabs.update` 激活 + `windows.update` 聚焦；不存在则 `tabs.create`。
- **边界情况**：多窗口场景按第一个匹配 tab 处理。
- **关联**：`background/service-worker.js`（onClicked / MANAGER_URL）。
- **置信度：高**。

## 功能 18：键盘可达与无障碍

- **用户故事**：纯键盘也能完成复制、开关、菜单、弹窗操作。
- **交互流程**：卡片 `tabindex=0` + Enter/Space 复制（焦点在卡片本身时）；导出菜单 ↑/↓ 移动焦点、Esc 关闭、打开后焦点进第一项、关闭后焦点还给按钮；开关 Enter/Space 切换；弹窗焦点陷阱（见功能 15）；相关元素带 `role`/`aria-*`（switch / tablist / menu / menuitem / dialog / status / aria-live / aria-expanded / aria-checked 等）。
- **边界情况**：点击弹窗外元素 → 菜单自动关闭（`focusin` 监听）；卡片内部按钮不冒泡触发卡片复制。
- **关联**：`manager/manager.js`（setupListeners）、`manager/render.js`（createCard）、`manager/modal.js`、`manager/toast.js`（`role="status"`）。
- **置信度：高**。

## 功能 19：响应式与减弱动效

- **用户故事**：窄窗口/触摸设备上布局不崩，系统要求减弱动效时动画停止。
- **交互流程**（纯 CSS，无 JS 分支）：
  - `@media (max-width: 640px)`：工具栏纵向堆叠、品牌副标题隐藏、卡片内边距调整、删除按钮 `opacity: 1` 常驻（注释：触摸设备一直显示）；
  - `@media (prefers-reduced-motion: reduce)`：全局动画/过渡时长压至 0.01ms。
- **关联**：`manager/manager.css`（L752 / L776）、`manager/render.js` 注释（删除按钮 hover 语义）。
- **置信度：高**（CSS 直接可证）。

## 功能 20：单元测试（开发期能力）

- **说明**：`tests/` 用语法提取源码纯函数（`helpers/load-source.js` 的 `extractFunction`/`extractObjectLiteral`，不执行浏览器代码）在 Node 环境跑 vitest；`storage.test.js` 16 例（getUrlKey/getDomain/filterOrderRecords 等）、`content.test.js` 39 例（准入规则/截断等）、`nav.test.js` 9 例（`normalizeNavConfig` 配置校验，v0.8.0 新增）——合计 64 例。
- **关联**：`tests/*`、`vitest.config.js`（environment: node）、`package.json`（`npm test`）。
- **置信度：高**。

## 功能 21：网站导航（管理页快捷方式面板）

> v0.8.0 新增。管理页被当作「新标签页」使用，本功能提供类似 Chrome 新标签页固定网站快捷方式的能力。

- **用户故事**：作为把管理页当新标签页用的用户，我希望在页面头部一键跳转到常去的网站，且站点列表能自己配。
- **触发入口**：管理页头部品牌名右侧的指南针图标 `#btn-nav`（hover / 点击 / 键盘）；容器 `#nav-root`，面板 `#nav-panel`。
- **交互流程**：
  1. 管理页加载 → `initNav()` → `loadNavConfig()`：`fetch(chrome.runtime.getURL('config/nav.json'))`；
  2. `normalizeNavConfig(raw)` 校验规范化 → 无有效内容返回 `null` → `#nav-root` 加 `.hidden` 整体隐藏，流程结束；
  3. 有效配置 → `renderNavPanel(config)` 按栏构建（全部 `textContent`，无 `innerHTML`）→ 移除 `.hidden` 显示图标；
  4. hover `#nav-root` → `openNav()` 展开（`.nav.open` + `aria-expanded="true"`）；鼠标离开 → `scheduleNavClose()` 200ms 宽限后收起（宽限期内可移入面板）；
  5. 点击图标切换开合（触摸设备无 hover）；点击导航区域外 / 焦点离开导航区域 → 收起；
  6. 点击 `.nav-link` → 新标签页打开（`target="_blank" rel="noopener"`）并收起面板。
- **输入**：扩展包内 `config/nav.json`；**输出**：面板 DOM + 新标签页跳转。**不读写 `chrome.storage.local`，无任何持久化状态**。
- **配置 Schema**：
  ```json
  { "columns": [ { "title": "常用", "links": [ { "name": "GitHub", "url": "https://github.com" } ] } ] }
  ```
  兼容糖：顶层 `links` 数组视为单个无标题栏；每栏 `title` 可选。
- **边界情况**：
  - 文件缺失 / HTTP 非 200 / 非法 JSON / 无有效链接 → `console.warn` + 导航入口整体隐藏，**管理页其余功能不受影响**（`initNav().catch` 二次兜底）；
  - 非 `http:` / `https:` 协议（`javascript:`、`data:`、`chrome:`、相对路径）→ 该链接被过滤（防 XSS）；
  - `name` / `url` 空串或非字符串 → 该条目丢弃；栏内无有效链接 → 整栏移除；
  - 栏数多、面板过宽 → `max-width: min(92vw, 760px)` 收窄后换行；窄屏（≤640px）改为顶部 `position: fixed` 全宽覆盖；
  - 修改 `config/nav.json` 后刷新管理页即生效（unpacked 扩展无需重载扩展）。
- **键盘可达**：图标上 Enter / Space / ↓ 展开并聚焦首个链接；已展开时 Enter / Space 收起；面板内 Esc 收起并归还焦点到图标；Tab 在链接间自然移动，焦点离开导航区域自动收起。
- **样式要点**（`manager.css` `.nav` / `.nav-panel` / `.nav-col` / `.nav-link`）：面板 `position: absolute` 挂在 32px 宽的 `.nav` 上，必须显式 `width: max-content` 才能让各栏并排——否则 shrink-to-fit 会塌缩到 min-content，配合 `flex-wrap: wrap` 使各栏竖向堆叠（v0.8.0 修复）；窄屏分支用 `width: auto` 覆盖。
- **关联**：`manager/nav.js`（normalizeNavConfig / loadNavConfig / renderNavPanel / initNav）、`config/nav.json`、`manager/manager.html`（`#nav-root`/`#btn-nav`/`#nav-panel`）、`manager/manager.css`、`tests/nav.test.js`（9 例）。
- **置信度：高**（交互与校验规则代码直接可证；`normalizeNavConfig` 有单测覆盖）。

---

## 功能 22：主视图顶 Tab 切换（采集 / 待办）

> v1.0.0 新增。采集与待办共存于 `manager.html`，通过顶部 brand 区域「采集 / 待办」两段可点击文字入口切换，URL hash 路由驱动。

- **用户故事**：作为用户，我能在同一个管理页内切换采集记录与待办清单，不用开多个页面。
- **触发入口**：管理页头部 brand 区域：
  - `采集` → `<a id="brand-collect-link" class="brand-collect" href="#collect">`（serif 18px 600，深色 var(--text)，可点）
  - `待办` → `<a id="brand-todo-link" class="brand-sub" href="#todo">`（同字号同字重，灰 var(--text-muted)，可点）
  - 点击扩展图标（SW）→ 默认打开 `manager.html`，无 hash → `applyRouteFromHash` 视为 `#collect` 进采集
- **交互流程**：
  1. 点 `采集` 链接 → `location.hash = '#collect'` → 触发 `hashchange` → `applyRouteFromHash()` 隐藏 `#view-todo`、显示 `#view-collect`、解除采集开关置灰、显示 `toolbar-count` 与 `collect-toolbar-extras`；
  2. 点 `待办` 链接 → `location.hash = '#todo'` → `applyRouteFromHash()` 切到 `#view-todo`、置灰采集开关、隐藏采集计数与导出/清空按钮；
  3. hash 已是目标值时点同一链接：`setupBrandLinks` 在 click 上兜底再调一次 `applyRouteFromHash`，避免 hashchange 不触发导致"看起来没反应"。
- **URL hash 协议**（todo.js 也消费同一协议）：
  - `#collect` → 采集 tab
  - `#todo` → 待办工作台（默认取当前清单或今日待办）
  - `#todo/all` / `#todo/done` / `#todo/templates` / `#todo/list/<id>` → 待办内 4 视图
- **采集开关在待办 tab 下的行为**：`is-disabled` 类 + `aria-disabled="true"`，点击/键盘不响应；视觉上透明度 0.5。回到采集 tab 即恢复。
- **边界情况**：URL 直接带 `#todo` 打开 → 仍走 `applyRouteFromHash` 正确路由；hash 解析失败（陌生字符串）→ 视为空 hash = 采集。
- **关联**：`manager/manager.html`（brand-link）、`manager/manager.js`（`applyRouteFromHash` / `setupBrandLinks` / `window.addEventListener('hashchange', ...)`）、`manager/manager.css`（`.brand-collect` / `.brand-sub` / `.toggle.is-disabled`）、`background/service-worker.js`（默认打开 `manager.html`）。
- **置信度：高**。

## 功能 23：待办 — 清单 CRUD

> v1.0.0 新增。`utils/todo-storage.js` 纯数据层 + `manager/todo.js` 渲染/事件。

- **用户故事**：作为用户，我能在待办 tab 左侧创建多个清单、重命名、删除。
- **触发入口**：
  - 「+ 新建清单」按钮 `#todo-new-list-btn`；
  - 侧边栏清单项点击（切换工作台）/ 双击（重命名）；
  - 工作台顶部「删除清单」按钮（**仅**此处可删，侧边栏无删除入口）。
- **交互流程**：
  - **创建**：`createList(name?)` → name 缺省或 trim 后空 → 「未命名清单」；`order = max(order)+1`（新清单放最下）；同步预创建空 items 桶 `todo_items_<id> = []`；UI：跳到新清单的工作台并自动进入重命名态。
  - **重命名**：双击 / F2 / Enter 触发 → 侧边栏 `todo-list-item-name` 设 `contenteditable=true` 全选；Enter / blur 保存；Esc 取消；空名拒绝（恢复原值）；trim 后改名同步写 `updatedAt`。
  - **删除**：工作台「删除清单」按钮 → `showConfirmModal` 二次确认（含清单名 + 不可撤销提示）→ `deleteList(id)`（同步清 items 桶 + 若是「今日待办」清 `todo_today_list_id`）；UI：当前工作台清单被删 → 自动切到 `#todo/all`；toast「已删除清单」（success）。
- **输入/输出**：清单名 string（trim + 限长 60）；操作结果 → 存储 + 视图切换。
- **边界情况**：重命名空名 throw → UI 静默恢复；删除不存在 id throw → toast danger；模板引用已删除清单的 items 仍然有效（**模板是 items 文本快照，与原清单生命周期解耦**）。
- **关联**：`utils/todo-storage.js`（createList / renameList / deleteList / normalizeListName）、`manager/todo.js`（onCreateList / startRenameList / onDeleteList / writeHash）、`manager/modal.js`。
- **置信度：高**（createList / deleteList 等有 todo-storage.test.js 单测覆盖）。

## 功能 24：待办 — 事项 CRUD（含拖拽）

- **用户故事**：作为用户，我能给当前清单加待办、勾选、删除、改内容、给未完成项排序。
- **触发入口**：工作台输入框（`[data-role="add-item-input"]`，`Enter` 提交）+ 复选框（`.todo-check` / `role=checkbox`，Space/Enter 切换）+ 悬停删除按钮（`.todo-item-delete`）+ 双击文本进入编辑 + 未完成项拖拽手柄（`.todo-item-handle`）。
- **交互流程**：
  - **添加**：`addItem(listId, text)` → trim 后空 throw；`order = max(未完成项.order)+1`（不影响已完成项 order）；保存后自动重渲染 sidebar（计数）+ 内容区；`updatedAt` 顺带写。v1.0.1 中输入框初始 `width` 与 `flex-basis` 均为 480px：窄容器内允许收缩、容器变宽时不因剩余空间继续拉伸；`input` 事件调用 `resizeAddItemInput`，仅在当前文字的测量宽度超过 480px 时同步扩大其 `width` 与 `flex-basis`，提交后清空并重置。右侧内容内层最大宽度为 960px，添加按钮固定为 28px 弹性项，超长内容不会挤压加号。
  - **勾选**：`toggleItem(listId, itemId)` → 翻转 `completed` + 写/清 `completedAt`；UI 切复选框 + 文本划线 + 沉底到「已完成」区。
  - **删除**：`deleteItem(listId, itemId)`；直接删除，无二次确认（**待办项是低破坏操作**）；UI 立即移除。
  - **内联编辑**：双击文本 → `contenteditable=true` 全选；Enter 保存、Esc 取消、blur 提交；空内容 = 视为删除；与原文相同 = noop；变更通过 `saveItems` 整存。
  - **拖拽**（仅未完成项）：HTML5 dragstart/dragover/drop；目标项加 `todo-item-drop-above` 视觉提示；drop 后重写未完成项 `order`（已完成项不动）；dragend 清除状态。
- **输入/输出**：文本 string / 勾选 toggle / 拖拽顺序变更 → 存储 + UI 重渲染。
- **边界情况**：
  - 完成后「已完成」区可点击「已完成 N」label 折叠/展开（`state.showCompleted`）；
  - 跨清单汇总（`#todo/all` / `#todo/done`）下复选框仍可点；删除在汇总视图下也会同步影响原清单；
  - 拖拽跨 list（`ul.dataset.listId` 不一致）拒绝；跨"已完成"边界拒绝；
  - 添加事项输入框为空或文本不超过 480px 时保持 480px 基准；在可用空间小于基准时依赖 `flex-shrink` 收缩；超长文本会同步扩大 `width` 与 `flex-basis`，但仍会受容器可用宽度约束；添加按钮始终保留 28px 方形尺寸。
- **关联**：`utils/todo-storage.js`（addItem / toggleItem / deleteItem / saveItems / sortItems）、`manager/todo.js`（onAddItem / onToggleItem / onDeleteItem / startEditItem / resizeAddItemInput / onDragStart 等）、`manager/todo.css`（`.todo-sidebar` / `.todo-add-form` / `.todo-item` / `.todo-check` / `.todo-item-handle`）。
- **置信度：高**（addItem / toggleItem / deleteItem / sortItems 等有单测覆盖）。

## 功能 25：待办 — 模板管理

- **用户故事**：作为用户，我能把常用清单存为模板，反复复用。
- **触发入口**：清单工作台顶部「存为模板」按钮；模板库视图下的「使用该模板」/「复制到当前清单」/ 卡片右上角删除按钮。
- **交互流程**：
  - **存为模板**：`saveAsTemplate(listId, templateName?)` → 弹出 `showEditModal` 输入模板名（默认取清单名）→ 仅快照 `items.map(content)` 文本列表（**不含** id / completed / 时间戳）→ 写入 `todo_templates`；空清单 → toast 拒绝。
  - **使用模板**：`createListFromTemplate(templateId, listName?)` → 建新清单（同名模板）→ 按顺序 `addItem` 全部模板内容（未完成态）→ 跳到该清单工作台 + toast。
  - **复制到当前清单**：`copyTemplateToList(templateId, listId)` → 按顺序追加到现有清单末尾；返回 `{added: N}`（过滤空字符串后实际添加数）；**需先在工作台视图**否则 toast 提示。
  - **删除模板**：模板卡片右上角删除 → `showConfirmModal` 二次确认 → `deleteTemplate(id)`；toast。
- **输入/输出**：模板名 / 模板 items 文本数组 → 存储；UI 卡片 / 视图切换。
- **边界情况**：
  - 空清单不能存为模板；
  - 模板名 trim 后空 → 取清单名；
  - 模板 items 为空 → 复制时 toast「模板为空，无可复制内容」，不写存储；
  - 模板可被任何清单使用（与原清单生命周期解耦，删除原清单不影响模板）。
- **关联**：`utils/todo-storage.js`（saveAsTemplate / createListFromTemplate / copyTemplateToList / deleteTemplate / loadTemplates）、`manager/todo.js`（onSaveAsTemplate / onUseTemplate / onCopyTemplateToCurrentList / onDeleteTemplate / makeTemplateCard）、`manager/modal.js`。
- **置信度：高**（saveAsTemplate / createListFromTemplate / copyTemplateToList 等有单测覆盖）。

## 功能 26：待办 — 四视图切换

- **用户故事**：作为用户，我能从侧边栏在不同粒度间切换：单清单详情 / 全部清单汇总未完成 / 全部清单汇总已完成 / 模板库。
- **触发入口**：侧边栏 `#todo-nav-all` / `#todo-nav-done` / `#todo-nav-templates` 三个按钮（`role=link`）；URL hash `#todo/all` / `#todo/done` / `#todo/templates` / `#todo` / `#todo/list/<id>`。
- **交互流程**：
  - **工作台（默认）**：当前清单的标题 + 进度文字「X / Y」+ 子标题「共 N 条 · 完成后自动沉底」+ 两个操作按钮（存为模板 / 删除清单）+ 输入框 + 未完成项列表（可拖拽）+ 已完成区（可折叠）+ 空态提示；自动 focus 输入框。
  - **全部待办**：跨清单按清单分组（`todo-summary-group`），每组显示清单名 + 计数徽标 + 未完成项；空态「暂无未完成事项」；总条数显示在子标题。
  - **已完成**：同上但显示已完成项 + 完成时间（如「今天 14:30」/「昨天 18:00」/「X 月 X 日」）；点复选框可恢复为未完成。
  - **模板库**：卡片网格（`todo-template-grid` 响应式 `auto-fill minmax(220px, 1fr)`），每卡显示模板名 + 「N 个待办 · 更新于 X」+ 前 5 项预览 + hover 显示「使用该模板」「复制到当前清单」两按钮 + 右上角删除按钮；空态「还没有模板」。
  - URL 改变（hashchange）→ `applyRouteFromHash`（manager.js）+ `handleHashChange`（todo.js）双层路由：manager.js 负责主视图切换，todo.js 负责待办内视图。
- **输入/输出**：用户点击 / URL 变化 → 视图状态 + 重渲染。
- **边界情况**：
  - 全部待办 / 已完成汇总：含 0 项的清单不出现在分组中；
  - 模板库：无模板时显示空态引导；
  - 工作台清单不存在（hash 里的 id 已失效）→ 自动 fallback 到第一个清单。
- **关联**：`manager/todo.js`（renderListView / renderAllView / renderDoneView / renderTemplatesView / handleHashChange / switchTo / writeHash）、`manager/manager.css` `.todo-view-*` / `.todo-summary-*` / `.todo-template-*`。
- **置信度：高**。

## 功能 27：待办 — 首启惰性创建「今日待办」

- **用户故事**：作为用户，我首次打开待办 tab 时不用手动建第一个清单，系统帮我创建好。
- **触发入口**：`manager/todo.js` `init()` 首调 `getOrCreateTodayList()`。
- **交互流程**：
  1. 读 `todo_today_list_id`；若 id 存在且对应清单仍在 `todo_lists` → 直接返回该清单；
  2. 否则 `createList('今日待办')` → 写 `todo_today_list_id = list.id` → 返回；
  3. 若原 id 对应的清单被删了（典型：用户主动删）→ 先清 `todo_today_list_id` 标记，再走创建路径（幂等恢复）。
- **输入/输出**：无用户输入；输出为 TodoList 对象。
- **边界情况**：
  - 连续调用不会重复创建（id 已写入）；
  - 清单被删后再次访问会重建（保持单实例的"今日待办"持续可用）；
  - 创建失败（storage 异常）→ todo.js 静默 catch，不阻塞 init（用户可手动 `+ 新建清单`）。
- **关联**：`utils/todo-storage.js`（`getOrCreateTodayList`）、`manager/todo.js`（init）。
- **置信度：高**（幂等与失效重建有单测覆盖）。
