# 变更日志 — text-collector

> 本文件记录 **v0.8.0 起**的版本变更；v0.5 – v0.7.2 的历史版本说明见 [`docs/archive/legacy-notes.md`](archive/legacy-notes.md)（历史文档，仅供追溯，禁止改动）。
> 版本号与 `text-collector/manifest.json`、`text-collector/package.json` 保持一致。

---

## v1.0.0 — 待办清单功能（2026-08-15）

为扩展增加独立的待办清单功能，作为点击扩展图标打开的默认页面。

### 新增

- **待办页面**（`todo/todo.html` + `todo/todo.css` + `todo/todo.js`）
  - 点击扩展图标打开待办页面（整页），不再默认打开管理页；管理页顶部品牌链接可跳转待办页面，待办页面顶部品牌链接可跳转管理页；
  - 左侧边栏：清单列表（支持创建、重命名、删除、拖拽排序）、视图切换标签（工作台/全部待办/已完成/模板库）；
  - 右侧内容区四个视图：
    - **工作台**：显示当前清单名称和待办输入框，支持快速添加待办项；
    - **全部待办**：列出当前清单所有未完成的待办项；
    - **已完成**：列出当前清单所有已完成的待办项；
    - **模板库**：网格卡片展示所有模板，支持使用、复制、存为模板、删除操作。
- **待办数据层**（`utils/todo-storage.js`）
  - 封装 `chrome.storage.local` 操作，提供清单和待办项 CRUD 接口；
  - 存储键前缀 `todo_`（清单索引）、`todo_items_`（待办项）、`todo_templates`（模板）；
  - "今日待办"清单惰性创建（首次访问时按需生成，ID 持久化存储）。
- **模板管理**
  - 将当前清单存为模板（保存待办项文本列表，不含 id/时间戳）；
  - 使用模板创建新清单；
  - 将模板内容复制到当前清单；
  - 删除模板。

### 设计约定

- **无登录/账号体系**：待办数据仅存储在 `chrome.storage.local`，无用户标识或认证逻辑。
- **无搜索功能**：待办页面不支持搜索待办项。
- **无独立"新建模板"按钮**：仅通过"存为模板"从已有清单创建模板。
- **样式复用**：待办页面复用 `manager.css` 的 `:root` CSS 变量和组件样式，保持与管理页视觉一致。

### 存储结构

| 键 | 类型 | 说明 |
|----|------|------|
| `todo_lists` | object[] | 清单列表，含 id/name/order/createdAt |
| `todo_items_<listId>` | object[] | 单个清单的待办项，含 id/text/completed/createdAt/completedAt |
| `todo_templates` | object[] | 模板列表，含 id/name/items/createdAt |
| `todo_today_list_id` | string | "今日待办"清单 ID（首次创建时写入） |

> 待办数据**独立于**采集记录（`snip_*` / `snippets_order`），两个功能的数据变更互不影响。

### 影响面

- 点击扩展图标行为变更：原来打开管理页，现在打开待办页面。
- 管理页与待办页面可相互跳转（通过顶部品牌链接）。
- 采集记录管理、采集功能、导航配置、快捷键、导出格式、manifest 权限**均无变化**。
- 待办数据存储键前缀 `todo_`，不影响现有采集数据。

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
