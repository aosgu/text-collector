# 代码事实清单 — text-collector

> 当前事实基线：v1.4.0。依据当前 `text-collector/` 源码、`manifest.json`、`package.json` 与测试；历史版本信息仅见 `docs/CHANGELOG.md` 和 `docs/archive/`。

## 1. 页面与入口

| 页面 / 入口 | 实现 | 行为 |
|---|---|---|
| 管理页 | `manager/manager.html` | 单一采集管理页；工具栏图标打开或聚焦该页。无应用内 hash 路由。 |
| 网页选区 | `content/content.js` | 全网页监听文字选区，满足阈值后自动保存并显示 toast。 |
| Arena 对话右键菜单 | `background/service-worker.js` + `content/arena-exporter.js` | 在 `arena.ai/c/*`、`lmarena.ai/c/*` 提取对话并下载 Markdown。 |

## 2. 模块清单

| 模块 | 文件 | 职责 |
|---|---|---|
| MV3 配置 | `manifest.json` | 权限、快捷键、后台 worker、内容脚本匹配规则和扩展图标。 |
| 后台 | `background/service-worker.js` | 安装初始化、打开管理页、快捷键切换采集、badge、Arena 右键菜单与内容脚本消息。 |
| 采集内容脚本 | `content/content.js`、`content/content.css` | 选区准入、采集数据写入、页面内 Shadow DOM toast。 |
| Arena 导出 | `content/arena-exporter.js` | 提取对话 DOM、转 Markdown、触发下载。 |
| 管理页编排 | `manager/manager.js` | 初始化、采集开关、记录页签、已保存颜色筛选、导出菜单、storage 变更订阅与 `listBridge` 状态桥接。 |
| 列表 | `manager/render.js` | 分页、卡片渲染、悬停/键盘颜色选择器、复制、收藏、编辑、删除撤销和错误态。 |
| 导出 / 弹窗 / 通知 | `manager/export.js`、`manager/modal.js`、`manager/toast.js` | TXT/JSON 下载、确认与编辑弹窗、管理页 toast。 |
| 网站导航 | `manager/nav.js`、`config/nav.json` | 验证并渲染扩展包内配置的快捷链接。 |
| 采集数据层 | `utils/storage.js` | 采集记录 CRUD、去重/扩选、索引修复、开关和统计。 |
| 单元测试 | `tests/*.test.js`、`tests/helpers/load-source.js` | Vitest Node 环境纯函数和源码契约测试。 |

## 3. 用户操作

- 在网页选中文字后自动采集；跳过输入/可编辑区域、短文本、纯符号、纯数字和纯 URL。
- 管理页支持首页/已保存页签、分页、复制、收藏、颜色标签（红/橙/黄/绿/蓝/紫/灰）、编辑、删除撤销、清空和 TXT/JSON 导出；已保存页签默认显示全部，可按标签颜色过滤。
- 管理页导航面板读取 `config/nav.json`，有效链接仅允许 HTTP(S)。
- 管理页开关及 `Ctrl+Shift+S` 控制采集；关闭时工具栏 badge 显示 `OFF`。
- 在 Arena 对话页右键导出 Markdown；导出仅下载文件，不写入采集存储。

## 4. 持久化数据

### Chrome Storage

| 键 | 结构 | 用途 |
|---|---|---|
| `snip_<uuid>` | 单条 Snippet 对象 | 正文、来源 URL/标题/域名、采集时间、收藏状态等。 |
| `snippets_order` | id 字符串数组 | 采集记录顺序索引，最新记录在前。 |
| `collectEnabled` | boolean | 采集开关，缺省视为开启。 |
| `schemaVersion` | number | 存储结构版本（当前为 1）。 |
| `orphanScanV1` | epoch milliseconds | 孤儿记录扫描节流时间。 |

Snippet 主要字段：`id`、`text`、`url`、`urlKey`、`title`、`domain`、`capturedAt`、`lastSelectedAt`；可选字段为 `saved`、`color`（`red` / `orange` / `yellow` / `green` / `blue` / `purple` / `gray`）、`clearedFromHome`、`updatedAt`。

> v1.3.0 不再读取或写入旧版本待办数据。若浏览器中已有此前版本留下的 `todo_*` 键，它们保留在本地但不再被扩展访问或使用；本版不自动删除用户数据。

### 包内只读配置

`config/nav.json` 提供 `columns[]` 和链接列表，管理页通过扩展自身 URL 读取，不是业务数据，也不产生外部网络请求。

## 5. 关键函数与数据流

- `content/content.js` → `addSnippet(text, url, title)` → `chrome.storage.local`；成功/重复/扩选由 toast 反馈。
- `utils/storage.js`：`addSnippet`、`deleteSnippet`、`clearAllSnippets`、`getSnippets`、`getAllSnippets`、`toggleFavoriteSnippet`、`setSnippetColor`、`filterOrderRecords`、`getFilteredOrder`、`updateSnippetText`、`getCollectEnabled`、`setCollectEnabled` 等；列表、导出、日期和占用估算支持可选颜色筛选参数。
- `manager/manager.js` 监听 `chrome.storage.onChanged`：同步采集开关状态，并将新记录插入列表。
- `background/service-worker.js` 监听安装、启动、快捷键、工具栏点击和 Arena 右键菜单事件。
- 管理页 `<script>` 依次加载 `storage.js`、`toast.js`、`nav.js`、`modal.js`、`render.js`、`export.js`、`manager.js`。

## 6. 权限与外部请求

`manifest.json` 权限：`storage`、`unlimitedStorage`、`tabs`、`contextMenus`、`scripting`；`host_permissions` 为 `<all_urls>`。内容脚本匹配所有网页（非所有 frame）用于采集，Arena 导出脚本仅匹配两个 Arena 对话 URL 模式。扩展不调用远程 API；唯一 `fetch` 读取随扩展分发的 `config/nav.json`。

## 7. 测试与开发

- `cd text-collector && npm test`：Vitest，76 项（storage 18、content 44、nav 9、arena-exporter 5）。
- 无构建或打包步骤；源码即扩展运行文件。
- `design/` 提供 Node + sharp 图标生成工具，PNG 为生成产物。

## 8. 版本变更

- v1.4.0：Snippet 增加可选 `color` 标签；悬停书签或键盘聚焦可选七色，选择颜色会自动加入「已保存」；该页新增颜色筛选，默认「全部」，导出遵循当前颜色筛选。
- v1.3.0：移除待办 UI、路由、样式、数据层和测试；管理页保留单一采集视图；不触碰旧版遗留本地数据。
- v1.2.0 及以前：见 `docs/CHANGELOG.md`。待办功能历史描述仅用于记录旧版本，不代表当前代码。
