# 用户流程 — 网页文字采集器

> 依据：`docs/_facts.md` 与代码（v1.0.0，2026-08-15）。以下为关键用户流程（12 个；流程 8 为 v0.8.0 新增；流程 9–12 为 v1.0.0 新增的待办），每个流程给出步骤与状态迁移。
> 说明：代码中**不存在**显式的流程图/状态机文件（无 mermaid/dot/状态机库）；以下「状态迁移」均取自代码中可证明的状态变化：`addSnippet` / `toggleFavoriteSnippet` / `addItem` / `toggleItem` / `saveAsTemplate` 等的返回 action 分支、`clearAllSnippets` 的字段迁移、`chrome.storage.local` 键的变化。

---

## 流程 1：采集一条网页文本（核心闭环）

**入口**：任意网页（content_scripts `matches: ["<all_urls>"]`）选中文本。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 用户选中文本 | 页面 `selectionchange` 触发 | `content/content.js`（document 监听） |
| 2 | 500ms 防抖等待（重复选择会重置计时器） | `debounceTimer` 重置 | `content/content.js` |
| 3 | 前置检查：初始化完成、开关开启、非编辑区、过 2s 页面加载保护期、有选区 | 任一不满足 → 流程终止（无反馈） | `content/content.js` `processSelection` |
| 4 | 准入过滤：长度阈值 / 纯符号 / 纯数字 / 纯 URL | 未通过 → 流程终止（无反馈） | `meetsLengthThreshold` 等 |
| 5 | NFC 规范化 + 5000 字符安全截断 | `text` 规范化 | `truncateText` |
| 6 | `addSnippet(text, href, title)` | **三态分支**（见下表） | `utils/storage.js` |
| 7 | 按 action 弹 toast | UI 反馈 | `showToast` |

**状态迁移（`addSnippet` 三态，代码直接定义）**：

```
选中文本
  ├─ 同 urlKey + 完全相同文本 → action:'duplicate' → 仅更新 lastSelectedAt（不新增）
  ├─ 同 urlKey + 5s 窗口内 + 新文本包含旧文本 → action:'replaced' → 替换 text/lastSelectedAt
  └─ 均不命中 → action:'created' → 新增 snip_<uuid> + snippets_order 置顶
```

**toast 反馈**：`created`/`replaced` → 「已采集」（success）；`duplicate` → 「已采集过」（info）；写库异常 → 「采集失败」（danger，`Extension context invalidated` 除外）。

**涉及**：`content/content.js`、`utils/storage.js`。

---

## 流程 2：打开管理页并浏览记录

**入口**：点击工具栏扩展图标。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 点击图标 | `chrome.action.onClicked` 触发 | `background/service-worker.js` |
| 2 | 查询已打开的管理页 | `chrome.tabs.query({url: MANAGER_URL})` | 同上 |
| 3a | 已打开 → 激活 tab + 聚焦窗口 | 无数据变化 | `tabs.update` + `windows.update` |
| 3b | 未打开 → 新建 tab | — | `tabs.create` |
| 4 | 管理页 `init()`：孤儿收领 → 开关渲染 → 首屏加载 | `adoptOrphanSnippets()` 可能修复 order；列表渲染 | `manager/manager.js` |
| 5 | 分页加载 50 条 | `currentOffset` 0→50；`totalCount` 赋值 | `manager/render.js` `loadMore` |
| 6 | 计数与存储估算显示 | 「共 N 条 / 占用约 N KB / 最新在前」 | `updateRecordInfo` |
| 7 | 点「加载更多」（如有） | `currentOffset += 50`，追加卡片；加载中 `isLoading` 防重入 | `loadMore` |
| 8 | 新记录实时到达 | `snippets_order` 变化 → 新卡片 prepend + 「新增了 N 条记录」提示条 3s | `manager/manager.js` onChanged |

**边界**：空列表 → 空态页（首页/已保存文案不同）；加载失败 → toast「加载失败，请重试」且保留已加载项；init 失败 → 错误态页面「加载失败」；记录数 > 5000 → 存储警告条。

**涉及**：`background/service-worker.js`、`manager/manager.js`、`manager/render.js`、`utils/storage.js`。

---

## 流程 3：删除一条记录并撤销

**入口**：卡片垃圾桶按钮 `.card-delete`。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 点击删除按钮（已保存记录/已保存页签先弹「确认删除」） | `record.saved \|\| isSavedTab` 分支 | `manager/render.js` `deleteRecord` |
| 2 | 记录 order 原位快照 | 存 `originalIndex` | `performDeleteRecord` |
| 3 | 卡片淡出 180ms 后移除 | UI：`currentOffset -1`、`totalCount -1` | 同上 |
| 4 | `deleteSnippet(id)` | 存储：`snip_<id>` 移除；`snippets_order` 过滤掉 id | `utils/storage.js` |
| 5 | toast「已删除」（带「撤销」，5s） | — | `manager/toast.js` |
| 6a | 点「撤销」 | 存储：写回 `snip_<id>`（原记录副本）→ 按原 index 插回 order（index 失效则置顶）；UI：重建卡片插回原位，计数 +1；toast「已恢复」 | `performDeleteRecord` onAction |
| 6b | 5s 未撤销 | toast 自动消失，删除保持 | `dismiss` |

**状态迁移**：`记录存在 → 存储删除（UI 移除）→ [5s 内] 存储恢复 → 记录存在`；撤销期间 `ignoreAllOrderChanges = true` 抑制 onChanged 重复追加。

**涉及**：`manager/render.js`、`manager/toast.js`、`manager/modal.js`、`utils/storage.js`。

---

## 流程 4：清空全部记录

**入口**：管理页「清空全部」`#btn-clear`（仅首页页签可见）。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 点击清空按钮 | 读取最早记录日期 `getEarliestDate` | `manager/manager.js` `handleClearAll` |
| 2 | 确认弹窗（条数 + 最早日期，默认焦点「取消」） | Esc / 遮罩 / 取消 → 流程终止 | `manager/modal.js` |
| 3 | 点「确定」 | `clearAllSnippets()`（≤3 轮校验） | `utils/storage.js` |
| 4 | 清空分支处理 | **见下表** | 同上 |
| 5 | 重载首屏 + toast「已清空」 | 列表刷新 | `manager/manager.js` |

**状态迁移（`clearAllSnippets` 分支，代码直接定义）**：

```
遍历所有 snip_<id>
  ├─ saved === true → 保留：置 clearedFromHome = true；id 进入新 order
  └─ 其他 → 彻底删除：snip_<id> 移除
最终：snippets_order = 仅含已保存 id；校验 3 轮直到无未保存残留
```

**后续影响**：清空后普通记录消失；已保存记录仍可在「已保存」页签查看；这些记录之后若取消收藏会被彻底删除（见流程 6）。

**涉及**：`manager/manager.js`、`manager/modal.js`、`utils/storage.js`。

---

## 流程 5：收藏 / 取消收藏

**入口**：卡片左侧书签按钮 `.card-favorite`。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 点击书签按钮（`stopPropagation` 防触达卡片复制） | `toggleFavoriteSnippet(id)` | `manager/render.js` createCard |
| 2 | 收藏 | `saved: undefined → true`（`action:'updated'`）；图标变实心 | `utils/storage.js` |
| 3 | 取消收藏（常规） | `saved: true → false`（`action:'updated'`）；图标变空心 | 同上 |
| 4 | 取消收藏（曾被首页清空保留的记录） | `saved → false` 且 `clearedFromHome === true` → **彻底删除** `deleteSnippet(id)`（`action:'deleted'`） | 同上 |
| 5 | UI 反馈 | toast「已添加到"已保存"」/「已取消收藏」；已保存页签取消收藏 → 卡片淡出移除 + 计数递减 | `render.js` |

**状态迁移（`toggleFavoriteSnippet`，代码直接定义）**：

```
saved: undefined→true     → action:'updated'（收藏）
saved: true→false（无 clearedFromHome）→ action:'updated'（取消收藏，记录保留）
saved: true→false（clearedFromHome=true）→ action:'deleted'（彻底删除）
记录不存在 → 返回 null → UI 静默置未收藏
```

**涉及**：`manager/render.js`、`utils/storage.js`。

---

## 流程 6：编辑已保存笔记

**入口**：已保存卡片「编辑」按钮 `.btn-edit`（`record.saved` 或已保存页签时显示）。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 点击「编辑」 | `showEditModal` 打开（textarea 预填原文，光标置尾） | `manager/modal.js` |
| 2 | 修改文本 | 弹窗内状态（未提交） | 同上 |
| 3 | 保存（按钮 / Ctrl+Enter） | 校验：trim 后为空 → toast「笔记内容不能为空」，不写库；与原文本相同 → 直接返回 | `render.js` 编辑回调 |
| 4 | `updateSnippetText(id, newText)` | 存储：`snip_<id>.text = trim 后文本`；`updatedAt = Date.now()` | `utils/storage.js` |
| 5 | UI 刷新 | 卡片文本更新 + 截断重算（`applyTruncationCheck`）+ toast「已保存修改」 | `render.js` |
| 6 | 取消 / Esc / 遮罩 | 关闭弹窗，不写库，焦点还原 | `modal.js` |

**状态迁移**：`text/updatedAt` 原地更新（记录 id、url、capturedAt 等不变）。

**涉及**：`manager/modal.js`、`manager/render.js`、`utils/storage.js`。

---

## 流程 7：导出备份（TXT / JSON）

**入口**：管理页「导出」`#btn-export` → 菜单选择格式。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 点击「导出」 | 菜单开合（`aria-expanded` 同步；打开后焦点入第一项） | `manager/manager.js` |
| 2 | 选择「导出为 TXT」/「导出为 JSON」 | 菜单关闭，焦点还给按钮 | 同上 |
| 3 | `handleExport(format)` | `getAllSnippets(当前页签)`：分批读取（100/批），按 `capturedAt` 升序 | `manager/export.js`、`utils/storage.js` |
| 4a | TXT | 文本 `\n\n` 连接 + UTF-8 BOM → Blob → 下载 | `export.js` |
| 4b | JSON | `{schemaVersion:1, exportedAt, count, snippets}` → 下载 | 同上 |
| 5 | 成功 | toast「已导出 N 条」（success）；文件 `snippets[_saved_]_<日期>.txt/.json` | 同上 |
| 6 | 失败 | toast「导出失败：存储读取异常」；未知格式 → 「未知导出格式」 | 同上 |

**状态迁移**：无存储变化（只读流程）；导出范围随当前页签（`home`/`saved`）变化，已保存页签导出文件名带 `_saved_` 后缀。

**涉及**：`manager/export.js`、`manager/manager.js`、`utils/storage.js`。

---

## 流程 8：通过网站导航跳转（v0.8.0 新增）

**入口**：管理页头部指南针图标 `#btn-nav`（hover / 点击 / 键盘）。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 管理页加载 | `initNav()` → `loadNavConfig()` 读包内 `config/nav.json` | `manager/nav.js` |
| 2 | 配置规范化 | `normalizeNavConfig`：过滤非法条目 → 有效则 `renderNavPanel` 建面板并显示图标；无效 → `#nav-root` 加 `.hidden`，流程终止（管理页其余功能不受影响） | 同上 |
| 3 | hover 导航区域 | `navOpen: false → true`；`.nav.open` + `aria-expanded="true"`，面板去 `.hidden` | `openNav` / `setNavOpen` |
| 4a | 鼠标离开导航区域 | `scheduleNavClose()` 起 200ms 宽限计时；期间移回（含移入面板）→ 计时取消，保持展开 | `scheduleNavClose` / `openNav` |
| 4b | 点击图标 | 展开 ⇄ 收起切换（触摸设备无 hover 时的入口） | `#btn-nav` click |
| 4c | 键盘 Enter / Space / ↓ | 展开并聚焦首个链接；已展开时 Enter / Space 收起；Esc 收起并把焦点还给图标 | keydown 分支 |
| 5 | 点击快捷方式 `.nav-link` | 浏览器新标签页打开目标站点（`target="_blank" rel="noopener"`）；面板收起 | `#nav-panel` click |
| 6 | 点击导航区域外 / 焦点离开导航区域 | `navOpen: true → false` | document click / focusin |

**状态迁移**（纯 UI 状态，`navOpen` 为模块级内存变量，**不落存储**）：

```
配置无效 → 图标隐藏（终态）
配置有效 → 收起 ⇄ 展开
             ├─ hover / 点击 / Enter·Space·↓ → 展开
             └─ 离开 200ms 宽限 / 再次点击 / Esc / 点击区域外 / 焦点移出 → 收起
```

**边界**：`fetch` 失败或 JSON 非法 → `console.warn` + 图标隐藏；非 http/https 链接被过滤；`initNav()` 抛错时 `.catch` 兜底隐藏导航，绝不影响采集与列表功能。

**涉及**：`manager/nav.js`、`config/nav.json`、`manager/manager.html`、`manager/manager.css`。

---

## 附：代码中可证实的跨流程机制

| 机制 | 说明 | 位置 |
|------|------|------|
| 实时同步 | `chrome.storage.onChanged` 驱动：新记录追加（manager）、开关同步（manager/content/SW badge）、待办变更重新渲染（todo.js） | 三处订阅 |
| 本地修改抑制 | `ignoreAllOrderChanges` 防止删除/撤销/清空期间 onChanged 重复操作 | `manager/manager.js` |
| 并发写保护 | `addSnippet` 写后校验重试 ≤3 次；`clearAllSnippets` 3 轮校验 | `utils/storage.js` |
| 孤儿兜底 | 管理页打开时 24h 节流扫描，捞回 order 外记录 | `adoptOrphanSnippets` |
| 状态通道 | `listBridge` 命名 getter/setter 收敛 `currentOffset/totalCount/isLoading` 等修改点 | `manager/manager.js` |
| 待办 hash 路由 | `#collect` / `#todo[/...]` 双层路由：manager.js 切主视图，todo.js 切待办内视图 | `applyRouteFromHash` + `handleHashChange` |
| 数据隔离 | `snip_*` / `snippets_order` 与 `todo_*` 互不读写，两模块互不感知 | `chrome.storage.local` 键命名空间 |
| Bridge 跨模块复用 | `window.__managerBridge` 把 showToast / showConfirm / showEdit 暴露给 todo.js | `manager/manager.js` |

---

## 流程 9：从采集 tab 切到待办 tab（v1.0.0）

**入口**：管理页头部 brand 区域「待办」链接 `#brand-todo-link`。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 点击「待办」`<a href="#todo">` | `location.hash = '#todo'`；浏览器改 hash | 浏览器默认行为 |
| 2 | 触发 `hashchange` | `window.addEventListener('hashchange', applyRouteFromHash)` 收到事件 | `manager/manager.js` |
| 3 | `applyRouteFromHash` 切换主视图 | `#view-collect` 加 `.hidden`；`#view-todo` 移除 `.hidden`；`#collect-toggle` 加 `.is-disabled` + `aria-disabled="true"`；`#toolbar-count` 加 `.hidden`；`#collect-toolbar-extras` 加 `.hidden` | 同上 |
| 4 | `TodoApp.handleHashChange` 解析待办内视图 | hash `#todo`（无后续段）→ `currentView='list'`，`currentListId` fallback 到第一个清单或今日待办 | `manager/todo.js` |
| 5 | todo.js 渲染 | `renderSidebar`（侧边栏清单列表 + 导航）+ `renderContent`（工作台/汇总/模板） | 同上 |
| 6 | 首启惰性创建「今日待办」 | `getOrCreateTodayList`（init 阶段已跑过；此处若被删则重建） | `utils/todo-storage.js` |
| 7 | 回到「采集」链接 → 逆向对称流程 | `location.hash = '#collect'` → 触发 `applyRouteFromHash` → 主视图切回 | — |

**状态迁移**：

```
#collect（默认）    ──点"待办"──▶   #todo
   主视图: 采集                 主视图: 待办
   toggle 可点                 toggle 置灰
   toolbar-count 显示            toolbar-count 隐藏
   collect-extras 显示           collect-extras 隐藏
   #view-collect 显示            #view-todo 显示
```

**边界**：hash 已是 `#todo` 时点同一链接 → click 兜底 `applyRouteFromHash` 强制应用一次（避免 hashchange 不触发导致"无反应"）。

**涉及**：`manager/manager.html`（brand-link）、`manager/manager.js`（`applyRouteFromHash` / `setupBrandLinks` / `hashchange` 监听）、`manager/todo.js`（`handleHashChange` / init）。

## 流程 10：创建清单并添加第一条待办（v1.0.0）

**入口**：待办 tab 侧边栏「+ 新建清单」按钮。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 点击「+ 新建清单」 | `onCreateList()` → `createList('未命名清单')` | `manager/todo.js` |
| 2 | `createList` 创建 | 存储：`todo_lists` push 新清单（`order = max+1`）；预创建空 `todo_items_<id> = []` | `utils/todo-storage.js` |
| 3 | 跳到新清单工作台 | `state.currentListId = list.id`；`writeHash()` → `location.hash = '#todo/list/<id>'` | `manager/todo.js` |
| 4 | 自动进入重命名态 | `setTimeout(() => startRenameList(list.id), 30)` → 侧边栏 name `contenteditable=true` 全选 | 同上 |
| 5 | 用户输入新名 + Enter / blur | `renameList(id, newName)` → 存储更新 `name` + `updatedAt` | `utils/todo-storage.js` |
| 6 | 工作台输入框自动 focus | `setTimeout(() => input.focus(), 0)` | `manager/todo.js` |
| 7 | 用户输入待办文本 + Enter | `addItem(listId, text)` → 存储 push 新项（`order = max(未完成)+1`，`completed=false`）；写 `updatedAt` | `utils/todo-storage.js` |
| 8 | UI 重渲染 | 侧边栏计数 +1、内容区新项插入未完成区 | `manager/todo.js` |

**状态迁移**（核心三步）：

```
清单集合: [A,B]                  ──create──▶    [A,B,C]
items 桶:   A:[], B:[]                       A:[], B:[], C:[]
order 字段: A:1, B:2                          A:1, B:2, C:3
today 标记: 不变（今天待办独立存在）            不变

items(新清单): []
            ──addItem("带钥匙")──▶  [{content:"带钥匙", order:1, completed:false, completedAt:null}]
```

**边界**：
- `createList` 缺省 name → 「未命名清单」；name trim 后空 → 「未命名清单」；
- `addItem` 空内容 trim → throw → UI 静默 catch；
- 重命名 Esc 取消 → 恢复原值；blur 提交；trim 后空名拒绝；
- 自动进入重命名态是 30ms 延迟（避免与 input focus 抢焦点）。

**涉及**：`utils/todo-storage.js`、`manager/todo.js`。

## 流程 11：勾选完成 → 汇总视图查看（v1.0.0）

**入口**：工作台复选框；侧边栏「全部待办」「已完成」按钮。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 点击复选框 | `onToggleItem(listId, itemId)` → `toggleItem` | `manager/todo.js` / `utils/todo-storage.js` |
| 2 | 翻 completed + 写/清 completedAt | 存储：`item.completed = !prev`；`completedAt = prev ? null : Date.now()` | 同上 |
| 3 | UI 重渲染 | sortItems 把已完成项移到列表底部；勾选框变绿 + 文本划线 | `manager/todo.js` |
| 4 | 点侧边栏「全部待办」 | `switchTo('all', null)` → `writeHash` → hash `#todo/all` | 同上 |
| 5 | `renderAllView` 按清单分组 | 遍历 `state.lists` × `itemsByList.get(id).filter(!completed)`；过滤空组 | 同上 |
| 6 | 每组显示清单名 + 计数 + 复选框（仍可点） | — | 同上 |
| 7 | 点侧边栏「已完成」 | 切到 `done` 视图；每项文本后追加 `formatTime(completedAt)`（今天/昨天/X月X日） | 同上 |
| 8 | 在「已完成」视图点复选框 | 同流程 1 反向（恢复未完成）；视图会动态更新（因为 itemsByList 同步刷新） | — |

**状态迁移**：

```
items(清单 X): [
  {content:"带钥匙", order:1, completed:false, completedAt:null},   ← 未完成
  {content:"带手机", order:2, completed:true,  completedAt:1723728000000}  ← 已完成
]

toggleItem("带手机")
  ↓
  completed: true → false
  completedAt: 1723728000000 → null
  order 字段保持 2（sortItems 内 completed: false → 排到未完成区）
```

**边界**：
- `sortItems` 中「同 completed + 同 order」按 `createdAt` 决胜（保证稳定排序）；
- 跨清单汇总视图下点复选框：原清单状态同步变更（共享 `state.itemsByList`）；
- 已完成区可点击「已完成 N」label 折叠/展开（`state.showCompleted`）。

**涉及**：`utils/todo-storage.js`（`toggleItem` / `sortItems`）、`manager/todo.js`（`onToggleItem` / `renderListView` / `renderAllView` / `renderDoneView` / `formatTime`）。

## 流程 12：把清单存为模板 → 用模板建新清单（v1.0.0）

**入口**：工作台顶部「存为模板」按钮；模板库视图「使用该模板」按钮。

| 步骤 | 动作 | 状态迁移 / 数据变化 | 代码位置 |
|------|------|---------------------|----------|
| 1 | 在某清单工作台点「存为模板」 | `onSaveAsTemplate(list)` → 空清单 → toast 拒绝；否则 `showEditModal` 输入模板名（默认取清单名） | `manager/todo.js` / `manager/modal.js` |
| 2 | 提交模板名 | `saveAsTemplate(listId, name)` → 存储：`todo_templates` push 新模板，`items = items.map(content)` 文本快照（**不含** id / completed / 时间戳） | `utils/todo-storage.js` |
| 3 | 侧边栏「模板库」 | `switchTo('templates', null)` → 渲染卡片网格 | `manager/todo.js` |
| 4 | 点某模板卡「使用该模板」 | `onUseTemplate(t)` → `createListFromTemplate(t.id)` → 存储：建新清单（同模板名）→ 按顺序 `addItem` 全部模板内容（未完成态） | 同上 |
| 5 | 自动跳到新清单工作台 | `state.currentListId = list.id`；hash `#todo/list/<id>` | 同上 |
| 6 | toast「已基于模板创建「X」」 | — | 同上 |
| 7 | 在某工作台点模板卡「复制到当前清单」 | `onCopyTemplateToCurrentList(t)` → 当前清单必须存在；空模板 → toast 拒绝；否则 `copyTemplateToList` 按顺序追加 → 返回 `{added}` → toast「已复制 N 条到「X」」 | 同上 |
| 8 | 删除模板卡 | `onDeleteTemplate(t)` → `showConfirmModal` 二次确认 → `deleteTemplate(id)` | 同上 |

**状态迁移**（核心两步）：

```
清单 X: {id:X, name:"出差准备", items:[
  {content:"确认机票酒店", completed:false},
  {content:"打包衣物",     completed:false}
]}
                │
                │  saveAsTemplate(X, "出差清单 v1")
                ▼
todo_templates: [{id:T1, name:"出差清单 v1", items:["确认机票酒店", "打包衣物"]}]

创建模板后 X 仍在，清单本身不动；模板是内容快照，与原清单生命周期解耦
────────────────────────────────────────────────────────────

todo_templates: [{id:T1, items:["确认机票酒店","打包衣物"]}]
                │
                │  createListFromTemplate(T1, "三月出差")
                ▼
todo_lists:   [..., {id:Y, name:"三月出差", order:N}]
todo_items_Y: [
  {id:i1, listId:Y, content:"确认机票酒店", completed:false, order:1},
  {id:i2, listId:Y, content:"打包衣物",     completed:false, order:2}
]
```

**边界**：
- 空清单不能存为模板（`onSaveAsTemplate` 先检查 items.length）；
- 模板名 trim 后空 → 取清单名；
- 「复制到当前清单」要求 `currentList` 存在（不在工作台视图则 toast 拒绝）；
- 删除模板不影响已用该模板创建的清单（`createListFromTemplate` 是值复制，不是引用）；
- 模板库无模板时显示空态引导。

**涉及**：`utils/todo-storage.js`（`saveAsTemplate` / `createListFromTemplate` / `copyTemplateToList` / `deleteTemplate` / `loadTemplates`）、`manager/todo.js`（`onSaveAsTemplate` / `onUseTemplate` / `onCopyTemplateToCurrentList` / `onDeleteTemplate` / `makeTemplateCard` / `renderTemplatesView`）、`manager/modal.js`。

