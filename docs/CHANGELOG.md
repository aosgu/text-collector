# 变更日志 — text-collector

> 本文件记录 **v0.8.0 起**的版本变更；v0.5 – v0.7.2 的历史版本说明见 [`docs/archive/legacy-notes.md`](archive/legacy-notes.md)（历史文档，仅供追溯，禁止改动）。
> 版本号与 `text-collector/manifest.json`、`text-collector/package.json` 保持一致。

---

## v1.0.1 — 待办工作台布局微调（2026-08-15）

本版本仅调整待办工作台的布局尺寸与添加事项输入框的宽度反馈，**不改变**待办数据模型、存储键、CRUD、模板、路由、扩展权限或采集功能。

### 调整

- **侧边栏加宽**（`manager/todo.css`）
  - `.todo-sidebar` 默认宽度由 `240px` 调整为 **`300px`**；
  - 保持 `flex-shrink: 0`，以固定桌面侧边栏的可读空间。
- **添加事项输入框的弹性规则重设与可见宽度修复**（`manager/todo.css`）
  - `.todo-content` 改为 `flex: 1 1 0` + `min-width: 0`，内容内层最大宽度增至 `960px`，避免侧边栏加宽后压缩右侧可用空间；
  - `.todo-add-form` 显式占满内容宽度；`.todo-add-form input` 从 `flex: 1` 调整为 `flex: 0 1 480px`，并设置 `width: 480px`、`max-width: calc(100% - 36px)` 与 `min-width: 0`；
  - 输入框以 **480px** 为常态基准：容器变窄时允许收缩，容器变宽时不因剩余空间继续拉伸；恢复空间后最多回到基准宽度。
- **添加按钮防挤压并固定右侧**（`manager/todo.css`）
  - `.todo-add-form button` 设为 `flex: 0 0 28px`，并设置最小宽高为 `28px`，确保加号始终保持方形；
  - 添加 `margin-left: auto`，使按钮占用输入框之后的剩余空间并始终贴齐整行表单右侧。
- **文字超出时按内容扩展**（`manager/todo.js`）
  - `resizeAddItemInput(input)` 复用 canvas 并按当前计算字体测量输入文字；
  - 在每次 `input` 事件时，只有文字所需宽度超过 480px 才同步提高 inline `width` 与 `flex-basis`；
  - 按 Enter 提交后清空输入值并重新计算，输入框回到 480px 基准。
- **`#todo` 首屏空白修复**（`manager/manager.js`、`manager/todo.js`）
  - 主 Tab 路由进入 `#todo` 时调用 `TodoApp.handleHashChange()`；待办模块未就绪时安全忽略，初始化完成后自行重试；
  - `handleHashChange()` 在路由解析后始终渲染侧边栏和内容区，不再只在视图状态变化时渲染；
  - 因此直接打开 `manager.html#todo`、重复点击同一待办入口或普通 hash 变化都会立即显示当前清单工作台，无需先点击侧边栏。

### 验证

- `npm test`：**4 个测试文件、100/100 用例通过**；
- `git diff --check`：通过；
- 本次未新增数据层或纯函数接口，未增加专门针对浏览器 DOM 尺寸测量的自动化测试。

---

## v1.0.0 — 待办清单功能（2026-08-15）

为扩展新增待办清单功能。**待办与采集共存于同一个管理页**，通过管理页顶部的「采集 / 待办」文字入口（hash 路由 `#collect` / `#todo[/...]`）切换；点击扩展图标默认仍打开管理页的采集 tab（保持历史行为）。

### 新增

- **同页 Tab 切换入口**（`manager/manager.html` + `manager/manager.js`）
  - 管理页顶部 brand 区域「采集 / 待办」两段可点击文字入口（serif 18px 600，**无箭头、无激活态视觉**，仅靠点击切换）；
  - hash 路由：`#collect`（默认）= 采集 tab；`#todo` = 待办工作台；`#todo/all` / `#todo/done` / `#todo/templates` / `#todo/list/<id>` = 待办内 4 视图；
  - 双层路由：manager.js `applyRouteFromHash` 切主视图；todo.js `handleHashChange` 切待办内视图；
  - 点击扩展图标（`chrome.action.onClicked`）→ 打开 `manager.html`，hash `#collect`（与 v0.8.1 一致）。
- **待办 tab 4 视图**（`manager/todo.js` + `manager/todo.css`）
  - **清单工作台**：当前清单的标题 + 进度文字「X / Y」+ 事项列表（未完成可拖拽 + 已完成可折叠）+ 常驻输入框（Enter 提交）+ 顶部「存为模板 / 删除清单」两按钮；
  - **全部待办**：跨清单分组显示未完成事项，每组显示清单名 + 计数 + 复选框；
  - **已完成**：跨清单分组显示已完成事项，每项附「今天/昨天/X 月 X 日」格式完成时间；
  - **模板库**：响应式卡片网格（`auto-fill minmax(220px, 1fr)`），卡片显示模板名 + 「N 个待办 · 更新于 X」+ 前 5 项预览；hover 显示「使用该模板」「复制到当前清单」；右上角删除按钮。
- **待办侧边栏**
  - 清单列表（按 `order` 字段升序，**无拖拽、**无 ↑↓ 入口）；
  - 底部 3 按钮：全部待办 / 已完成 / 模板库；
  - 「+ 新建清单」按钮（`createList` 自动跳到新清单并进入重命名态）。
- **待办数据层**（`utils/todo-storage.js`，纯函数 + storage Promise）
  - 与 `utils/storage.js` 互不依赖、两份独立的 `generateUUID`、无共享 `CONFIG`；
  - 清单 CRUD（`createList` / `renameList` / `deleteList` / `getLists`）；
  - 事项 CRUD（`addItem` / `toggleItem` / `deleteItem` / `saveItems` / `getItems` / `sortItems`）；
  - 模板 CRUD（`loadTemplates` / `saveAsTemplate` / `createListFromTemplate` / `copyTemplateToList` / `deleteTemplate`）；
  - 首启惰性创建「今日待办」：`getOrCreateTodayList`（引用清单被删时幂等恢复）。
- **拖拽**（仅未完成项）
  - HTML5 dragstart/dragover/drop，目标项加 `todo-item-drop-above` 视觉提示；
  - drop 后重写未完成项 `order`，已完成项 `order` 保持不变；
  - 跨清单、跨「已完成」边界拒绝。
- **内联编辑**
  - 清单名（侧边栏双击 / F2）+ 待办项文本（双击），`contenteditable=true` 全选；Enter / blur 保存、Esc 取消；空内容 = 视为删除；与原文相同 = noop。
- **模板管理**（4 个动作）
  - 存为模板：仅从非空清单存为模板（保存 `items.map(content)` 文本快照，**不含** id / completed / 时间戳）；
  - 使用模板：基于模板建新清单，按序 `addItem` 全部未完成态；
  - 复制到当前清单：按序追加到现有清单末尾（需先在工作台视图）；
  - 删除模板：二次确认后删除。
- **跨模块复用**（`window.__managerBridge`）
  - 待办模块通过 manager 暴露的 `showToast` / `showConfirmModal` / `showEditModal` 复用采集模块的 UI 组件，避免重复实现。

### 设计约定

- **同页 Tab，非独立页面**：v1.0.0 实际是管理页内 hash 路由切换，**不是**整页替换为待办；点击扩展图标默认仍打开采集 tab（与 v0.8.1 一致）。
- **采集开关在待办 tab 下置灰**：`#collect-toggle` 加 `.is-disabled` + `aria-disabled="true"`，防止误操作。
- **数据完全隔离**：所有 `snip_*` / `snippets_order` / `collectEnabled` 与所有 `todo_*` 键**互不读写**；两个数据层文件（`utils/storage.js` vs `utils/todo-storage.js`）互不依赖。
- **清单不暴露拖拽/↑↓ 入口**：`utils/todo-storage.js` 中 `reorderLists` 函数**不导出**给 todo.js（仅按 `TodoList.order` 排序）。
- **待办项仅未完成项可拖拽**：已完成项无 `.todo-item-handle`、拖拽被拒绝。
- **进度显示为「X / Y」纯文字**：**无** `<progress>` 元素、**无**自定义进度条。
- **删除清单入口仅在工作台顶部**：侧边栏无删除入口。
- **删除待办项无撤销**：直接删除、无二次确认、无撤销 toast。
- **无登录/账号体系**：数据仅存 `chrome.storage.local`，无用户标识或认证。
- **无搜索功能**：待办 tab 无搜索输入框、无按内容过滤。
- **无独立「新建空模板」按钮**：仅通过「存为模板」从已有清单创建。
- **样式复用 `manager.css`**：待办 CSS 仅追加 `.todo-*` 前缀类，不重定义 `:root` 变量。

### 存储结构

| 键 | 类型 | 说明 |
|----|------|------|
| `todo_lists` | TodoList[] | 清单列表：id / name / order / createdAt / updatedAt |
| `todo_items_<listId>` | TodoItem[] | 单清单的待办项：id / listId / content / order / completed / completedAt / createdAt |
| `todo_templates` | Template[] | 模板列表：id / name / items（string[]）/ createdAt / updatedAt |
| `todo_today_list_id` | string \| null | 「今日待办」清单 id 指针（`getOrCreateTodayList` 写入） |

> 待办数据**独立于**采集记录（`snip_*` / `snippets_order` / `collectEnabled`），两个功能的数据变更互不触发对方 `onChanged` 监听。

### 影响面

- 采集记录管理、采集功能、采集开关、导航配置、快捷键、导出格式、manifest 权限**均无变化**。
- 管理页 toolbar 形态回到 v0.8.1（svg mark + 「采集」纯文字 + `<a href="#todo">待办</a>`）；无箭头、无激活态。
- 旧版 v0.8 错误实现的 `todo/` 子目录与 `todo.html` 已被 v1.0.0 移除（commit `2b681d3` 整段重写）。
- 测试总数 64 → **100**（新增 `tests/todo-storage.test.js` 36 例：清单 CRUD 14 + 事项 CRUD 11 + 模板 8 + `getOrCreateTodayList` 3）。
- 文档：6 份同步重写（`docs/01-PRODUCT.md` / `02-FEATURES.md` / `03-USER-FLOWS.md` / `04-ARCHITECTURE.md` / `05-DATA-MODEL.md` / `06-DECISIONS.md` / `07-TODO-DESIGN.md` 加 §0 修订记录；`docs/_facts.md` §8 / §9 大改）。

---

## v0.8.1 — 管理页字体统一（2026-08-14）

### 调整

- 顶部记录数（如 `1 snippets`）由等宽字体改为与品牌副标题 `manager` 相同的无衬线字体栈，并移除额外字间距。
- 网站导航面板中的快捷方式名称由衬线字体改为与 `manager` 相同的无衬线字体栈；保留原有字号、颜色与布局层级。

### 影响面

- 仅修改 `manager/manager.css` 的字体呈现，不影响导航配置、交互、存储结构、采集链路、导出格式或扩展权限。

---

## v0.8.0 — 管理页网站导航（2026-08-13）

管理页被当作「新标签页」使用，本版为它补上类似 Chrome 新标签页固定网站快捷方式的能力。

### 新增

- **网站导航面板**（`manager/nav.js` + `config/nav.json`，管理页头部品牌名右侧的指南针图标）
  - hover 图标展开分栏快捷方式面板（交互参考 zed.dev 顶部 Resources），点击快捷方式在新标签页打开（`target="_blank" rel="noopener"`）；
  - 鼠标离开导航区域 200ms 宽限后收起（宽限期内可移入面板）；点击图标切换开合（触摸设备无 hover）；点击区域外、焦点离开导航区域自动收起；
  - 键盘可达：图标上 Enter / Space / ↓ 展开并聚焦首个链接，Esc 收起并归还焦点，Tab 在链接间自然移动；
  - 站点列表**不做前端编辑**，改扩展目录内的 `config/nav.json` 后刷新管理页即生效（unpacked 扩展无需重载扩展）。
- **导航配置文件** `config/nav.json`：`{ "columns": [ { "title", "links": [ { "name", "url" } ] } ] }`；兼容糖：顶层 `links` 数组视为单个无标题栏。
- **配置校验**（`normalizeNavConfig`，纯函数）：仅放行 `http:` / `https:` 协议（`javascript:` / `data:` / `chrome:` / 相对路径一律过滤），name / url / title 做 trim，空条目与无有效链接的栏整体移除；配置缺失、解析失败或无有效链接时导航图标整体隐藏，不影响管理页其余功能。
- **单元测试**：`tests/nav.test.js` 9 个用例覆盖 `normalizeNavConfig`；测试总数 55 → **64**（storage 16 + content 39 + nav 9）。

### 修复（v0.8.0 内）

- **导航面板未能分栏**：`.nav-panel` 为 `position: absolute`，包含块是仅 32px 宽的 `.nav`，绝对定位元素的 shrink-to-fit 以此为可用宽度，宽度塌缩到 min-content；叠加 `flex-wrap: wrap` 后 flex 容器的 min-content 宽度等于最宽单栏宽度，导致第 2、3 栏被换行到第一栏下方。显式声明 `width: max-content` 让各栏并排，超出时仍由 `max-width: min(92vw, 760px)` 收窄换行；窄屏 `@media (max-width: 640px)` 的 `position: fixed` 全宽分支同步补 `width: auto` 覆盖。
- **hover 图标浮出「网站导航」原生提示**：移除 `#btn-nav` 的 `title` 属性，保留 `aria-label="网站导航"`，无障碍语义不变。

### 影响面

- 存储结构、采集链路、导出格式**均无变化**（导航为纯读的包内配置，不写 `chrome.storage.local`）。
- 唯一的 `fetch` 调用为读取扩展包内同源资源 `chrome-extension://.../config/nav.json`，**仍无任何外部网络请求**。
- 权限清单不变（未新增 manifest 权限）。

---

## 历史版本

v0.7.2 及更早版本的变更说明见 [`docs/archive/legacy-notes.md`](archive/legacy-notes.md)「版本历史」小节：

| 版本 | 一句话摘要 |
|------|-----------|
| v0.7.2 | 更换扩展图标（实心品牌蓝圆角方 + 白色无衬线开引号，16px 单独调参） |
| v0.7.1 | 移除导入功能（`import-export.js` → `export.js`） |
| v0.7.0 | 收藏与编辑体系（已保存页签、二次确认、编辑弹窗、按页签导出） |
| v0.6.3 | 全量审计 P1/P2 清零（孤儿节流、写后校验重试、清空循环校验等） |
| v0.6.2 | 健壮性 + a11y 加固 |
| v0.6.1 | 修复选中后全屏乱码（toast 宿主样式双重钉死） |
| v0.6 | 视觉重设计（暖白 `#F5F3EE` + 衬线标题 + 品牌蓝 `#2F6FED`） |
| v0.5 | 采集准入规则、分片存储、删除撤销、badge、快捷键 |
