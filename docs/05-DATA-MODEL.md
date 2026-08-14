# 数据模型与数据流 — 网页文字采集器

> 依据：`docs/_facts.md` 与代码（v1.0.0，2026-08-15）。无数据库/无后端；所有**业务数据**在浏览器端 `chrome.storage.local`；另有一份随扩展包分发的**只读配置文件** `config/nav.json`（v0.8.0，见 §1.4 / §3），以及 v1.0.0 起新增的**待办数据**（`todo_` 前缀，见 §1.5–§1.7 / §3）。
> 「接口」指代码层函数接口（本项目无网络 API）。

---

## 1. 核心实体与字段

### 1.1 实体：Snippet（采集记录）— `snip_<uuid>`

| 字段 | 类型 | 必填 | 写入方 | 语义 |
|------|------|------|--------|------|
| `id` | string（UUID v4） | 是 | `addSnippet`；`adoptOrphanSnippets`（补写缺失 id） | 记录主键；key 后缀 |
| `text` | string | 是 | `addSnippet`（NFC 规范化、≤5000 截断）；`updateSnippetText`（trim） | 采集/编辑后的正文 |
| `url` | string | 是 | `addSnippet` | 采集时的 `location.href` |
| `urlKey` | string | 是 | `addSnippet`（`getUrlKey`：origin+pathname） | 去重/扩选匹配键 |
| `title` | string | 是 | `addSnippet`（`document.title \|\| url`） | 来源页标题 |
| `domain` | string | 是 | `addSnippet`（`getDomain`：hostname） | 来源域名 |
| `capturedAt` | number（epoch ms） | 是 | `addSnippet` | 首次采集时间；导出升序排序键 |
| `lastSelectedAt` | number（epoch ms） | 是 | `addSnippet`；去重/扩选分支更新 | 最近选中时间；扩选窗口判断键 |
| `saved` | boolean | 否（undefined=未收藏） | `toggleFavoriteSnippet` | 收藏标记 |
| `clearedFromHome` | boolean | 否（undefined=未被清空保留过） | `clearAllSnippets`（对 saved 记录置 true） | 首页清空保留标记 |
| `updatedAt` | number（epoch ms） | 否 | `updateSnippetText` | 最近编辑时间 |

### 1.2 实体：顺序索引 — `snippets_order`

| 字段 | 类型 | 语义 |
|------|------|------|
| `snippets_order` | string[]（id 列表，最新在前） | 全局有序索引；去重/分页/筛选/导出的排序依据；含不在 order 的 `snip_*` 即「孤儿」 |

### 1.3 实体：配置与元数据（单值键）

| 键 | 类型 | 默认 | 写入方 | 语义 |
|----|------|------|--------|------|
| `collectEnabled` | boolean | `true`（未设置按 true 读） | `setCollectEnabled`（管理页/快捷键）；`onInstalled` 初始化 | 采集开关 |
| `schemaVersion` | number | `1`（`onInstalled` 初始化；常量 `SCHEMA_VERSION=1`） | SW 安装时 | 数据版本标记；导出 JSON 携带 |
| `orphanScanV1` | number（epoch ms） | 无 | `adoptOrphanSnippets` 每次扫描后 | 孤儿扫描节流时间戳（24h） |

### 1.4 只读配置：NavConfig — `config/nav.json`（v0.8.0 新增，非 storage）

随扩展包分发的静态 JSON 文件，由 `manager/nav.js` 经 `fetch(chrome.runtime.getURL('config/nav.json'))` 只读加载，**不写入、不持久化到 `chrome.storage.local`**。

| 字段 | 类型 | 必填 | 语义 / 校验（`normalizeNavConfig`） |
|------|------|------|-------------------------------------|
| `columns` | Array\<NavColumn\> | 是（或用顶层 `links` 兼容糖） | 分栏列表；非数组且无顶层 `links` → 整份配置视为无效（返回 `null`） |
| `columns[].title` | string | 否 | 栏标题；trim；缺失或非字符串 → `''`（该栏不渲染标题） |
| `columns[].links` | Array\<NavLink\> | 是 | 该栏链接；无有效链接的栏整体移除 |
| `columns[].links[].name` | string | 是 | 显示名；trim；空串 → 该条目丢弃 |
| `columns[].links[].url` | string | 是 | 目标地址；trim；`new URL()` 解析失败或协议非 `http:`/`https:` → 该条目丢弃（防 XSS） |

兼容糖：顶层 `links` 数组等价于 `columns: [{ title: '', links }]`。全部栏为空 → `normalizeNavConfig` 返回 `null` → 导航入口整体隐藏。

### 1.5 实体：TodoList（待办清单）— `todo_lists`（v1.0.0 新增）

存储于 `chrome.storage.local` 的 **单键** `todo_lists`，值为 `TodoList[]`。每条清单对应一个独立的 `todo_items_<listId>` 桶存放其事项。

| 字段 | 类型 | 必填 | 写入方 | 语义 |
|------|------|------|--------|------|
| `id` | string（UUID v4） | 是 | `createList`（`generateUUID`） | 清单主键；同时作为 `todo_items_<id>` 桶名后缀 |
| `name` | string | 是 | `createList`（默认「未命名清单」/「今日待办」）；`renameList`（trim + 60 字符上限） | 显示名；UI 侧边栏 + 工作台标题 |
| `order` | number | 是 | `createList`（`max+1`） | 侧边栏排序键；**清单不暴露拖拽/↑↓ UI 入口，仅按 `order` 字段排序** |
| `createdAt` | number（epoch ms） | 是 | `createList` | 创建时间；UI 不展示 |
| `updatedAt` | number（epoch ms） | 是 | `createList` / `renameList` / 任何 items 桶写入 | 最近更新时间；侧边栏「更新于 X」可选展示 |

### 1.6 实体：TodoItem（待办事项）— `todo_items_<listId>`（v1.0.0 新增）

**每个清单一个独立桶**，键为 `todo_items_<listId>`，值为 `TodoItem[]`（**始终数组**，空清单 = `[]`，绝不删除键）。

| 字段 | 类型 | 必填 | 写入方 | 语义 |
|------|------|------|--------|------|
| `id` | string（UUID v4） | 是 | `addItem`（`generateUUID`） | 事项主键；用于 toggle / delete / 拖拽定位 |
| `listId` | string | 是 | `addItem` | 所属清单 id（冗余字段，便于跨清单汇总 `renderAllView`/`renderDoneView`） |
| `content` | string | 是 | `addItem`（trim + 5000 上限）；编辑回调（trim） | 事项文本 |
| `order` | number | 是 | `addItem`（`max(未完成)+1`）；拖拽重排后整段重写 | 同清单未完成项排序键；已完成项 `order` 保持不变 |
| `completed` | boolean | 是 | `addItem`（默认 false）；`toggleItem` | 完成标记 |
| `completedAt` | number \| null | 是（null） | `toggleItem`（翻转 completed 时同步写/清） | 完成时间；已完成视图按「今天/昨天/X 月 X 日」展示 |
| `createdAt` | number（epoch ms） | 是 | `addItem` | 创建时间；UI 不展示；`sortItems` 同序决胜 |

### 1.7 实体：Template（模板）— `todo_templates`（v1.0.0 新增）

存储于 `chrome.storage.local` 单键 `todo_templates`，值为 `Template[]`。**模板是事项文本快照**（不含 id / completed / completedAt / listId），与原清单生命周期解耦。

| 字段 | 类型 | 必填 | 写入方 | 语义 |
|------|------|------|--------|------|
| `id` | string（UUID v4） | 是 | `saveAsTemplate`（`generateUUID`） | 模板主键 |
| `name` | string | 是 | `saveAsTemplate`（trim + 默认取清单名） | 模板名；模板库卡片标题 |
| `items` | string[] | 是 | `saveAsTemplate`（`items.map(content)` 文本快照） | 待办文本列表；过滤空字符串 |
| `createdAt` | number（epoch ms） | 是 | `saveAsTemplate` | 创建时间；UI「更新于 X」展示 |
| `updatedAt` | number（epoch ms） | 是 | `saveAsTemplate` | 同上（v1.0 写入时两者均取 `Date.now()`） |

### 1.8 实体：今日待办指针 — `todo_today_list_id`（v1.0.0 新增）

单值键（string | null），指向一个 `TodoList.id`，标记当前「今日待办」清单。

- 由 `getOrCreateTodayList` 写入；引用清单被删除时由 `getOrCreateTodayList` 幂等恢复重建。
- 仅作为首启惰性创建的定位指针；`todo_lists` 数组本身不包含任何「今日」标记。

## 2. 实体关系

```
snippets_order (string[])
   │ 1:N（id 引用）
   ▼
snip_<uuid> (Snippet 实体)        collectEnabled / schemaVersion / orphanScanV1
                                    （独立单值键，与 Snippet 无引用关系）
```

- **主键**：`id`（UUID v4），同时出现在存储 key 后缀与 order 列表元素中；两者不一致即产生孤儿（`adoptOrphanSnippets` 收领逻辑）。
- **无外键/无嵌套关系**：Snippet 之间无引用；title/url/domain/urlKey 为冗余快照字段（采集时写入，编辑不更新）。

```
todo_lists (TodoList[])
   │ 1:1
   ▼
todo_items_<listId> (TodoItem[])

todo_templates (Template[])         todo_today_list_id (string | null)
（独立集合，不引用 todo_lists）       （→ todo_lists 中某项的 id；幂等恢复）
```

- **待办清单与事项**：`todo_lists` 数组中每项的 `id` 对应一个 `todo_items_<id>` 桶；`TodoItem.listId` 字段为冗余引用，UI 跨清单汇总视图（全部待办 / 已完成）通过 `listId` 索引。
- **模板与清单**：`Template.items` 是**值复制**（`items.map(content)`），不持有对原清单或原事项的引用；删除原清单不影响已创建的模板，使用模板创建新清单后也不影响模板本身。
- **今日待办指针**：`todo_today_list_id` 与 `todo_lists` 双向弱引用：清单被删后指针失效，`getOrCreateTodayList` 幂等重建。
- **采集与待办数据完全隔离**：所有 `snip_*` / `snippets_order` / `collectEnabled` 等键与所有 `todo_*` 键**互不读写**，两模块的代码层（`utils/storage.js` vs `utils/todo-storage.js`）也互不引用。

## 3. 存储位置

| 数据 | 位置 | 说明 |
|------|------|------|
| 全部业务数据 | `chrome.storage.local` | 浏览器本地；`unlimitedStorage` 权限；**无 localStorage/IndexedDB/文件/外部服务**（grep 证实） |
| 导出文件 | 用户下载目录（浏览器行为） | `downloadBlob` 触发 `<a download>`，扩展不持有 |
| 导航配置 | `text-collector/config/nav.json`（仓库内，随扩展包分发） | v0.8.0；只读静态文件，用户手改后刷新管理页生效；**不进 storage、不随导出文件携带** |
| 图标产物 | `text-collector/icons/*.png`（仓库内） | 开发期生成，随扩展打包 |
| 测试数据 | 无持久化（内存断言） | vitest 纯函数测试 |

## 4. 接口清单（代码层函数）

### 4.1 存储工具层 `utils/storage.js`（全局函数，content 与 manager 共用）

| 函数（method） | 入参 | 出参 | 使用位置 |
|----------------|------|------|----------|
| `generateUUID()` | — | string（UUID v4） | addSnippet 内部；todo-storage 内部 |
| `getUrlKey(url)` | string | string（origin+pathname） | addSnippet；tests |
| `getDomain(url)` | string | string（hostname） | addSnippet；tests |
| `adoptOrphanSnippets()` | — | Promise\<number\>（收领数） | manager.js init |
| `addSnippet(text, url, title)` | string, string, string | Promise\<{action:'created'\|'duplicate'\|'replaced', record}\> | content.js processSelection |
| `deleteSnippet(id)` | string | Promise\<void\> | render.js（删除/取消收藏清理）；toggleFavoriteSnippet 内部 |
| `filterOrderRecords(order, recordsMap, filter)` | string[], Object, 'home'\|'saved'\|'all' | string[] | manager.js onChanged；getFilteredOrder；tests |
| `getFilteredOrder(filter)` | 'home'\|'saved'\|'all'（默认 home） | Promise\<string[]\> | manager.js onChanged；内部 |
| `clearAllSnippets()` | — | Promise\<void\> | manager.js handleClearAll |
| `getSnippets(offset, limit, filter)` | number, number, string | Promise\<{records, total}\> | render.js loadMore |
| `getAllSnippets(filter)` | 'home'\|'saved'\|'all'（默认 all） | Promise\<Snippet[]\>（capturedAt 升序） | export.js handleExport |
| `toggleFavoriteSnippet(id)` | string | Promise\<{action:'updated'\|'deleted', record?, id?}\|null\> | render.js 收藏按钮 |
| `updateSnippetText(id, newText)` | string, string | Promise\<record\|null\> | render.js 编辑回调 |
| `getCollectEnabled()` | — | Promise\<boolean\> | manager.js renderToggle/handleToggle；content.js 初始化 |
| `setCollectEnabled(enabled)` | boolean | Promise\<void\> | manager.js handleToggle；SW onCommand |
| `getEarliestDate(filter)` | string | Promise\<number\|null\>（capturedAt） | manager.js handleClearAll |
| `getStorageEstimate(filter)` | string | Promise\<number\>（KB 估算） | render.js updateRecordInfo |

### 4.1b 待办数据层 `utils/todo-storage.js`（v1.0.0 新增，全局函数，manager + todo 上下文共用）

| 函数 | 入参 | 出参 | 语义与边界 |
|------|------|------|------------|
| `generateUUID()` | — | string（UUID v4） | 与 storage.js 同实现（复制版），保证 v1.0 待办模块独立可测试 |
| `normalizeListName(name, fallback)` | string?, string | string（trim；空/超 60 → `fallback`） | 统一清单名：trim → 空或 > 60 字符 → 落到 `fallback`（默认「未命名清单」） |
| `getOrCreateList(key, fallbackName)` | string, string | `Promise<{id, …} \| null>`（storage 失败时 null） | 工具：key 已存在且对应清单在 `todo_lists` → 返回；否则 `createList` |
| `getOrCreateTodayList()` | — | `Promise<TodoList>` | 见 §1.8；幂等；引用清单被删时清理 `todo_today_list_id` 后重建 |
| `getLists()` | — | `Promise<TodoList[]>`（按 `order` 升序） | 仅读 `todo_lists` |
| `createList(name?)` | string? | `Promise<TodoList>` | name 缺省/空 → 「未命名清单」；`order = max+1`；同步预创建 `todo_items_<id> = []`；写 `updatedAt = Date.now()` |
| `renameList(id, newName)` | string, string | `Promise<TodoList \| null>` | trim + 60 字符；trim 后空 → throw；不存在的 id → null |
| `deleteList(id)` | string | `Promise<{deleted: TodoList, removedItems: number} \| null>` | 同步清 `todo_items_<id>` 桶 + 若是「今日待办」清 `todo_today_list_id`；不存在 → null |
| `getItems(listId)` | string | `Promise<TodoItem[]>` | 读 `todo_items_<id>`，缺键视为 `[]` |
| `saveItems(listId, items)` | string, TodoItem[] | `Promise<void>` | 整桶重写；过滤非数组项；空数组 = `[]` 保留键 |
| `addItem(listId, content)` | string, string | `Promise<TodoItem>` | trim + 5000 上限；空 → throw；`order = max(未完成)+1`；同步 `TodoList.updatedAt` |
| `toggleItem(listId, itemId)` | string, string | `Promise<TodoItem \| null>` | 翻转 `completed` + 写/清 `completedAt`；不存在 → null |
| `deleteItem(listId, itemId)` | string, string | `Promise<boolean>` | 过滤掉该 id；不存在 → false |
| `sortItems(items)` | TodoItem[] | TodoItem[]（副本） | 未完成在前（按 `order` 升序）→ 已完成在后（按 `completedAt` 降序）；同 completed+order 时按 `createdAt` 决胜 |
| `loadTemplates()` | — | `Promise<Template[]>` | 读 `todo_templates`，缺键视为 `[]` |
| `saveAsTemplate(listId, templateName?)` | string, string? | `Promise<Template>` | 空清单 → throw；items 仅 `map(content)` 文本快照 |
| `createListFromTemplate(templateId, listName?)` | string, string? | `Promise<TodoList>` | 建新清单 + 按序 `addItem` 模板内容（未完成态） |
| `copyTemplateToList(templateId, listId)` | string, string | `Promise<{added: number} \| null>` | 过滤空字符串；不存在模板/清单 → null；按序追加到目标清单末尾 |
| `deleteTemplate(id)` | string | `Promise<boolean>` | 不存在 → false |

**错误约定**：`createList` / `renameList` / `addItem` / `saveAsTemplate` 对无效输入（空名 / 空内容 / 空清单）`throw new Error`；其他函数对「资源不存在」返回 `null` / `false`。所有写操作底层都基于 `chrome.storage.local` Promise 串行，无并发竞态。

### 4.2 管理页 UI 模块接口（manager.html 脚本上下文）

| 函数 | 入参 | 出参 | 使用位置 |
|------|------|------|----------|
| `toast.js: showToast(message, opts)` | string, {kind, actionText, onAction, duration} | void | render.js / export.js / manager.js |
| `toast.js: dismiss(toast)` | Element | void | showToast 内部；action 点击 |
| `modal.js: showConfirmModal(title, body, onConfirm)` | string, string, Function? | void | manager.js（清空）；render.js（删除确认） |
| `modal.js: showEditModal(title, initialText, onSave)` | string, string, Function | void | render.js（编辑） |
| `nav.js: normalizeNavConfig(raw)` | any（解析后的 JSON） | `{columns:[{title,links:[{name,url}]}]}` \| `null` | loadNavConfig；`tests/nav.test.js`（9 例） |
| `nav.js: loadNavConfig()` | — | Promise\<规范化配置 \| null\> | initNav |
| `nav.js: renderNavPanel(config)` | 规范化配置 | void（构建 `#nav-panel` DOM，全 textContent） | initNav |
| `nav.js: initNav()` | — | Promise\<void\> | nav.js 自调用（模块底部，含 `.catch` 兜底） |
| `export.js: handleExport(format)` | 'txt'\|'json' | Promise\<void\> | manager.js 导出菜单 |
| `export.js: downloadBlob(blob, filename)` | Blob, string | void | handleExport 内部 |
| `manager.js: window.__managerBridge` | — | `{ showToast, showConfirmModal, showEditModal }` | v1.0.0：暴露给 `manager/todo.js`，让待办模块复用采集模块的 toast / 弹窗 UI（避免重复实现） |

### 4.3 Service Worker 接口（事件监听，无导出函数）

| 事件 | 入参（事件负载） | 行为 |
|------|------------------|------|
| `chrome.runtime.onInstalled` | — | 初始化 `schemaVersion=1`、`collectEnabled=true`（缺失时）；刷新 badge |
| `chrome.runtime.onStartup` | — | 按 `collectEnabled` 刷新 badge |
| `chrome.action.onClicked` | tab | 查询/创建/聚焦管理页 |
| `chrome.commands.onCommand` | 'toggle-collect' | 切换 `collectEnabled` + badge |
| `chrome.storage.onChanged` | {collectEnabled} | badge 同步 |

### 4.4 网络接口

**无外部网络接口**。无 REST/gRPC/WebSocket/第三方 API（全库 grep 无 XHR/WebSocket/sendMessage）。
唯一的 `fetch` 调用位于 `manager/nav.js`（v0.8.0），读取扩展包内同源资源 `chrome-extension://<id>/config/nav.json`，不产生任何对外流量。

## 5. 数据流向（谁写入、谁读取）

### 5.1 按存储键

| 键 | 写入方 | 读取方 | 订阅方（onChanged） |
|----|--------|--------|---------------------|
| `snip_<id>` | addSnippet（新增/去重/扩选）、updateSnippetText、toggleFavoriteSnippet、clearAllSnippets（保留+标记）、撤销恢复（render.js 直接 set）、adoptOrphanSnippets（补 id） | render.js（列表/撤销快照）、manager.js（onChanged 新记录）、getAllSnippets（导出）、getStorageEstimate、adoptOrphanSnippets | 无直接订阅（随 order 变更间接触发） |
| `snippets_order` | addSnippet（prepend+校验重试）、deleteSnippet、clearAllSnippets、撤销恢复、adoptOrphanSnippets（合并） | 上述全部写入方 + getFilteredOrder/getSnippets/getAllSnippets/getEarliestDate | manager.js（新记录实时追加） |
| `collectEnabled` | setCollectEnabled（管理页/快捷键）、onInstalled | content.js（缓存）、manager.js、SW（badge）、getCollectEnabled | content.js、manager.js、SW（三方） |
| `schemaVersion` | onInstalled | export.js（写入导出文件） | 无 |
| `orphanScanV1` | adoptOrphanSnippets | adoptOrphanSnippets（节流判断） | 无 |
| `todo_lists`（v1.0.0） | createList / renameList / deleteList | getLists / getOrCreateList / getOrCreateTodayList / copyTemplateToList（检查存在性） | todo.js（reloadFromStorage 整体重读） |
| `todo_items_<listId>`（v1.0.0） | addItem / toggleItem / deleteItem / saveItems | getItems（sortItems 处理） | todo.js（reloadFromStorage） |
| `todo_templates`（v1.0.0） | saveAsTemplate / deleteTemplate | loadTemplates / createListFromTemplate / copyTemplateToList | todo.js（reloadFromStorage） |
| `todo_today_list_id`（v1.0.0） | getOrCreateTodayList | getOrCreateTodayList | todo.js（init / 重建） |

> `config/nav.json` 不在上表内：它是随包分发的只读文件，写入方为**开发者/用户手工编辑文件**，读取方仅 `manager/nav.js`，无订阅机制（改动后刷新管理页生效）。

### 5.2 主数据流（采集 → 存储 → 展示）

```
[页面选区]
   │ selectionchange
   ▼
content.js processSelection（准入过滤 → NFC → 截断）
   │ addSnippet()
   ▼
chrome.storage.local: snip_<id> 写入 → snippets_order prepend
   │ chrome.storage.onChanged（snippets_order）
   ├──▶ manager.js：新 id 筛选（filterOrderRecords）→ prependNewCards → 列表顶部插入
   └──▶ （页面内 toast：已采集/已采集过/采集失败）
```

### 5.3 开关数据流

```
管理页 handleToggle / SW 快捷键 onCommand
   │ setCollectEnabled()
   ▼
collectEnabled = !collectEnabled
   │ onChanged（collectEnabled）
   ├──▶ content.js：更新本地缓存 → 采集暂停/恢复
   ├──▶ manager.js：updateToggleUI（ON/OFF）
   └──▶ SW：updateBadge（开启=空 / 关闭=灰「OFF」）
```

### 5.4 导出数据流（只读）

```
export.js handleExport
   │ getAllSnippets(当前页签 filter)（分批 100/批，capturedAt 升序）
   ▼
records → TXT（\n\n + BOM）/ JSON（schemaVersion/exportedAt/count/snippets）
   │ downloadBlob（objectURL + <a download>）
   ▼
浏览器下载文件（扩展内不保存副本）
```

### 5.5 孤儿收领数据流

```
manager.js init → adoptOrphanSnippets()
   节流检查（orphanScanV1，24h；order 空则强制）
   → 扫描全部 snip_*：不在 order 中的有效记录
   → 缺 id 者批量写回（100/批）
   → 合并进 snippets_order 头部（按 capturedAt 降序，去重）
   → 写 orphanScanV1 = now；返回收领数
```

### 5.6 导航配置数据流（v0.8.0，只读、不落存储）

```
config/nav.json（扩展包内静态文件）
   │ manager/nav.js: fetch(chrome.runtime.getURL(...))
   ▼
normalizeNavConfig（协议白名单 http/https、trim、丢弃空条目与空栏）
   ├─ null（缺失/非法/无有效链接）→ #nav-root 加 .hidden，导航入口隐藏
   └─ 规范化配置 → renderNavPanel → #nav-panel DOM（textContent 渲染）
                     │ 用户点击 .nav-link
                     ▼
                  浏览器新标签页打开（target=_blank rel=noopener）
```

### 5.7 待办 CRUD 数据流（v1.0.0）

```
todo.js 事件（添加/勾选/删除/编辑/拖拽）
   │ utils/todo-storage.js 纯函数
   ▼
   ├─ addItem      → todo_items_<listId> push 1 项；order=max(未完成)+1；写 TodoList.updatedAt
   ├─ toggleItem   → todo_items_<listId> 翻转 completed + 写/清 completedAt
   ├─ deleteItem   → todo_items_<listId> 过滤该 id
   ├─ saveItems    → 整桶重写（编辑/拖拽后）
   ├─ createList   → todo_lists push 1 项；预创建 todo_items_<id> = []；写 updatedAt
   ├─ renameList   → todo_lists 改 name + updatedAt
   └─ deleteList   → todo_lists 过滤；同步 delete todo_items_<id>；若是今日清单 → 清 todo_today_list_id
   │
   ▼
todo.js reloadFromStorage() 重新读全部状态 + renderSidebar + renderContent
```

### 5.8 模板数据流（v1.0.0，值复制语义）

```
saveAsTemplate(listId, name)
   │ 读 list.items → items.map(content) → 文本数组
   ▼
todo_templates push 1 条（id / name / items / createdAt / updatedAt）

createListFromTemplate(templateId, listName?)
   │ 读 template.items
   ▼
createList(name) → todo_lists push；预创建空 todo_items_<id>
按序 addItem(template.items[i]) 全部（completed=false）

copyTemplateToList(templateId, listId)
   │ 读 template.items（过滤空字符串）
   ▼
按序 addItem 到目标 list（completed=false）；返回 {added: N}
```

### 5.9 待办实时同步（chrome.storage.onChanged）

```
todo_lists / todo_items_<id> / todo_templates / todo_today_list_id 任一变更
   │ chrome.storage.onChanged
   ▼
todo.js reloadFromStorage() → 重新读全部状态 + renderSidebar + renderContent
   │
   ※ 与 manager.js 相同的本地修改抑制模式（todo.js 内 `isApplyingLocalChange`）：
     在本地写入完成前 set true、写完 set false，期间忽略 onChanged 的回响
```

## 6. 一致性机制摘要

| 机制 | 说明 | 位置 |
|------|------|------|
| 先写数据后写索引 | `addSnippet` 先 `set snip_<id>` 再 prepend order，避免索引指向不存在数据 | storage.js |
| 写后校验重试 | order 写入后校验 ≤3 次（20ms 递增退避） | storage.js addSnippet |
| 删除竞态缩小 | 先 remove `snip_<id>` 再重读 order 过滤，避免覆盖并发新增 | storage.js deleteSnippet |
| 清空校验循环 | ≤3 轮：删后全量校验未保存残留 | storage.js clearAllSnippets |
| 订阅抑制 | 本地操作期间 `ignoreAllOrderChanges=true` 防 onChanged 重复操作 | manager.js |
| 孤儿兜底 | 24h 节流扫描 + 空 order 强制扫描 | storage.js adoptOrphanSnippets |
