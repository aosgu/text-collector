# 产品文档 — 网页文字采集器（Chrome 扩展）

> 依据：`docs/_facts.md`（代码事实清单）及当前代码快照（v1.0.0，2026-08-15）。
> 本文件只描述代码中可证明存在的产品事实，不参考 `docs/archive/`。
> 置信度：**高** = 代码直接证明；**中** = 由代码/注释推断；**低** = 推测。

---

## 一句话定义产品

**网页文字采集器** 是一个 Chrome Manifest V3 浏览器扩展：在任意网页上**选中文字即自动保存**为本地采集记录，并可通过工具栏图标打开管理页，对记录进行**查看、复制、删除（可撤销）、导出、收藏、编辑**；管理页同时承担「新标签页」角色，头部提供**网站导航快捷方式面板**（v0.8.0），并在 v1.0.0 起通过顶 Tab 切换到**待办清单**功能（多清单 / 待办项 / 模板库，与采集数据完全隔离）。

（来源：`manifest.json` name/description；`content/content.js`；`manager/manager.html`）

## 目标用户（推断）

> 以下为**从功能反推的推断**（代码无用户画像信息），标注推断依据：

| 推断 | 推断依据（代码事实） |
|------|----------------------|
| 单机、本地、个人用户（无账号、无云同步） | 无任何账号/登录/角色代码；无任何**外部**网络请求（grep 无 XHR/WebSocket；唯一 `fetch` 读扩展包内 `config/nav.json`，chrome-extension:// 同源）；数据仅存 `chrome.storage.local` |
| 需要频繁摘录网页文字的桌面 Chrome 用户 | 核心交互为「选中即存」；`manifest.json` 未声明 `"action": {"default_popup"}`，管理页以整页打开 |
| 对数据隐私敏感的用户 | 零外部网络请求 + `unlimitedStorage` 本地存储 + CSP `script-src 'self'` |
| 中文内容使用者 | 管理页 `lang="zh-CN"`、toast/弹窗/提示文案均为中文 |

## 核心价值

1. **选中即存，无需任何额外操作**：监听 `selectionchange` + 500ms 防抖（`CONFIG.DEBOUNCE_MS`）自动保存，不需要右键菜单、快捷键或复制粘贴（`content/content.js`）。
2. **自动过滤噪声**：长度阈值（中文 ≥5 字 / 英文 ≥3 词加权）、纯符号、纯数字、纯 URL 过滤、可编辑区域跳过，避免存下垃圾记录（`content/content.js` 准入规则）。
3. **去重与扩选合并**：同 URL 完全相同的文本不重复入库；5 秒内扩选自动替换旧记录（`utils/storage.js` `addSnippet`）。
4. **数据完全本地化**：`chrome.storage.local` + `unlimitedStorage`，扩展不发起任何**外部**网络请求（唯一 `fetch` 读包内导航配置，同源）；导出 JSON/TXT 可自行备份（`manifest.json`、`manager/export.js`）。
5. **记录可管理**：分页浏览、实时追加、一键复制、删除撤销、收藏/已保存页签、编辑、清空、导出（`manager/*`）。
6. **管理页兼作新标签页**：头部导航图标 hover 展开网站快捷方式分栏面板，站点列表由包内 `config/nav.json` 配置（v0.8.0；`manager/nav.js`）。
7. **健壮性设计**：孤儿记录自动收领、并发写竞态校验重试、toast 样式与页面隔离、键盘可达（`utils/storage.js`、`content/content.js`）。
8. **待办清单**（v1.0.0 起）：管理页顶 Tab 切换到「待办」即可使用多清单 / 待办项 / 模板管理。数据完全独立（`todo_` 前缀存储键），不影响采集链路（`manager/todo.js` + `utils/todo-storage.js`）。

## 功能全景图

| # | 功能 | 位置（入口） | 概述 |
|---|------|--------------|------|
| 1 | 划词自动采集 | `content/content.js` | selectionchange → 500ms 防抖 → 准入 → 写库 → toast |
| 2 | 采集准入过滤 | `content/content.js` | 长度阈值 / 纯符号 / 纯数字 / 纯 URL / 编辑区跳过 / 截断 |
| 3 | 去重与扩选合并 | `utils/storage.js` `addSnippet` | 同 URL 同文本去重；5s 窗口扩选替换 |
| 4 | 采集开关 | `manager/manager.html` `#collect-toggle`、快捷键 `Ctrl+Shift+S` | 暂停/恢复采集，badge 显示 OFF |
| 5 | 记录列表与分页 | `manager/render.js` `loadMore` | 每页 50 条、最新在前、计数/占用 KB、存储警告 |
| 6 | 新记录实时追加 | `manager/manager.js` onChanged | 管理页打开时新记录自动置顶 + 提示条 |
| 7 | 复制 | 卡片点击 / 键盘 / 已保存卡片「复制」按钮 | 剪贴板写入（含 fallback） |
| 8 | 删除与撤销 | `.card-delete` / toast「撤销」 | 删除后 5 秒内可恢复原位 |
| 9 | 清空全部 | `#btn-clear`（二次确认） | 未收藏彻底删除；已收藏保留并标记 |
| 10 | 首页 / 已保存页签 | `#tab-home` / `#tab-saved` | 按收藏状态筛选列表 |
| 11 | 收藏 | `.card-favorite` 书签按钮 | 一键收藏/取消收藏 |
| 12 | 编辑笔记 | 已保存卡片「编辑」按钮 | 纯文本弹窗修改内容 |
| 13 | 导出 TXT / JSON | 导出菜单 `#btn-export` | 按当前页签导出，文件名带日期 |
| 14 | Toast 通知（两套） | `content.js` / `manager/toast.js` | 页面内 Shadow DOM toast；管理页单实例 toast |
| 15 | 确认 / 编辑弹窗 | `manager/modal.js` | 键盘可操作、焦点陷阱 |
| 16 | 孤儿记录自动收领 | `utils/storage.js` `adoptOrphanSnippets` | 管理页打开时扫描，24h 节流 |
| 17 | 打开/聚焦管理页 | `background/service-worker.js` | 图标点击：已开则聚焦，未开则新开 |
| 18 | 键盘可达与无障碍 | `render.js` / `modal.js` / `manager.js` | Tab 导航、焦点陷阱、aria 属性 |
| 19 | 响应式与减弱动效 | `manager/manager.css` | ≤640px 布局调整、`prefers-reduced-motion` |
| 20 | 单元测试 | `tests/`（vitest，64 用例） | 纯函数在 Node 环境验证 |
| 21 | 网站导航（v0.8.0 新增） | `manager/nav.js` + `config/nav.json`（头部 `#btn-nav`） | hover 展开分栏快捷方式面板，新标签页打开；配置文件驱动，无效配置时图标隐藏 |
| 22 | 主视图顶 Tab 切换（v1.0.0） | `manager.html` 顶部 `.brand-name` 内 `<a href="#collect">` / `<a href="#todo">` | URL hash 路由：`#collect`（默认）= 采集 tab，`#todo[/...]` = 待办 tab；点图标默认进采集 |
| 23 | 待办：清单 CRUD（v1.0.0） | `manager/todo.js` 侧边栏 + `utils/todo-storage.js` | 创建（自动 order）/ 重命名（双击 / F2 / Enter）/ 删除（**仅**工作台顶部按钮，二次确认） |
| 24 | 待办：事项 CRUD（v1.0.0） | `manager/todo.js` 工作台 | 添加（输入框 Enter）/ 勾选（点击或键盘 Space/Enter）/ 删除（hover 按钮）/ 内联编辑（双击 / Enter 保存 / Esc 取消 / 空内容=删除）/ 未完成项拖拽排序 |
| 25 | 待办：模板管理（v1.0.0） | `manager/todo.js` 模板库视图 | 「存为模板」（从清单导 content 文本列表）/「使用该模板」（建新清单）/「复制到当前清单」/ 删除（hover 按钮） |
| 26 | 待办：四视图切换（v1.0.0） | `manager/todo.js` 侧边栏导航 + URL hash | 工作台（清单详情）/ 全部待办（按清单分组）/ 已完成（按清单分组 + 完成时间）/ 模板库 |
| 27 | 待办：首启惰性创建「今日待办」（v1.0.0） | `utils/todo-storage.js` `getOrCreateTodayList` | 首次进入待办 tab 时创建并写 `todo_today_list_id`；后续幂等，删后自动重建 |

## 非目标（明确不做什么）

| 非目标 | 代码依据 |
|--------|----------|
| **不做导入功能**（导出数据不可恢复回扩展） | 导入功能已删除（用户确认）；当前代码无任何导入实现，导出 JSON 无对应解析器 |
| **不做任何网络/云能力**：无远程同步、无备份服务、无第三方 API | 全库无 `XMLHttpRequest`/`WebSocket`/`sendMessage` 调用；唯一 `fetch`（`manager/nav.js`）只读扩展包内 `config/nav.json`，不产生对外流量 |
| **不做账号体系**：无登录、无角色、无多用户 | 无相关代码；数据全部本地 |
| **不采集可编辑区域内的文本**（input / textarea / contenteditable，含 Shadow DOM 内） | `content.js` `isEditableElement` / `isSelectionInEditable`，注释：「避免捕获用户在输入框里的文本选择」 |
| **不在 iframe 内采集** | `manifest.json` content_scripts `"all_frames": false` |
| **不做工具栏弹窗（popup）** | `manifest.json` `"action": {}` 无 `default_popup`，点击图标打开整页管理页 |
| **不做后台页面**（MV3 无 background page） | `manifest.json` 仅声明 `service_worker` |
| **不展示来源标题/URL/时间**等元数据到卡片 | `createCard`（`render.js`）仅渲染文本内容与操作按钮；元数据仅存于 `snip_<id>` 记录字段 |
| **网站导航不做前端编辑**（无「添加/删除快捷方式」UI，不读写 storage） | `manager/nav.js` 仅 `fetch` 包内 `config/nav.json` 渲染；无任何写入路径（v0.8.0 决策 F1） |
| **待办不做搜索** | `manager/todo.js` 无搜索输入框与过滤逻辑（v1.0.0 设计约定） |
| **待办不做账号/云同步** | 待办数据仅存 `chrome.storage.local`，与采集一样无任何外部请求（v1.0.0 设计约定） |
| **待办不做独立"新建空模板"按钮** | 模板只能从现有清单"存为模板"产生；模板库视图无创建入口（v1.0.0 设计约定） |
| **待办不做清单拖拽排序** | 清单按 `order` 字段升序展示，UI 不暴露拖拽入口（v1.0.0 产品决定） |
| **待办不做进度条** | 工作台顶部仅显示 `已完成 / 总数` 文本，无进度条元素（v1.0.0 产品决定） |
