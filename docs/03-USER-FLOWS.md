# 用户流程 — 网页文字采集器

> 依据：`docs/_facts.md` 与代码。以下为关键用户流程（7 个），每个流程给出步骤与状态迁移。
> 说明：代码中**不存在**显式的流程图/状态机文件（无 mermaid/dot/状态机库）；以下「状态迁移」均取自代码中可证明的状态变化：`addSnippet` / `toggleFavoriteSnippet` 的返回 action 分支、`clearAllSnippets` 的字段迁移、`chrome.storage.local` 键的变化。

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

## 附：代码中可证实的跨流程机制

| 机制 | 说明 | 位置 |
|------|------|------|
| 实时同步 | `chrome.storage.onChanged` 驱动：新记录追加（manager）、开关同步（manager/content/SW badge） | 三处订阅 |
| 本地修改抑制 | `ignoreAllOrderChanges` 防止删除/撤销/清空期间 onChanged 重复操作 | `manager/manager.js` |
| 并发写保护 | `addSnippet` 写后校验重试 ≤3 次；`clearAllSnippets` 3 轮校验 | `utils/storage.js` |
| 孤儿兜底 | 管理页打开时 24h 节流扫描，捞回 order 外记录 | `adoptOrphanSnippets` |
| 状态通道 | `listBridge` 命名 getter/setter 收敛 `currentOffset/totalCount/isLoading` 等修改点 | `manager/manager.js` |
