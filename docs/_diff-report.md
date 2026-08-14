# 变更对照报告 — 旧 PRD / README 迭代说明 vs 当前代码

> 对照基准：
> - 旧文档：`docs/archive/original-PRD.md`（PRD v0.5，2026-08-10）、`docs/archive/legacy-notes.md`（README 版本历史 v0.5–v0.7.2 等）
> - 当前代码：v0.8.1 工作区快照，2026-08-14（`_facts.md` 同源）
> - 用途：只做差异对照；本报告不改动 docs/01~06。
> 证据格式：`文件:位置` 或 grep 结论。

---

## 1. 旧 PRD 有、当前代码也有 → 保留

### 1.1 采集模块（全部保留）

| PRD 条目 | 当前代码证据 |
|----------|--------------|
| selectionchange + 500ms 防抖（P0） | `content/content.js`：`document.addEventListener('selectionchange')` + `CONFIG.DEBOUNCE_MS=500` |
| 最小长度阈值（≥5 中文字/3 英文词，P0） | `content/content.js` `meetsLengthThreshold`（实现为加权混合，差异见 §4.1） |
| 扩选替换（同 URL 5 秒内，P0） | `utils/storage.js` `addSnippet`：`EXPAND_REPLACE_WINDOW_MS=5000` + `normalizedText.includes(s.text)` |
| 过滤纯符号/纯数字/纯 URL（P0） | `content/content.js` `isPureSymbol` / `isPureNumber` / `isPureURL` |
| 记录来源标题、URL、选中时间（P0） | `snip_<id>` 字段 `title` / `url` / `capturedAt`（仅存储层；展示层只显示 text，见 PRD §3.8 一致） |
| 保存时轻量 toast（P0） | `content/content.js` `showToast` |
| 去重：同 URL 完全相同文本不重复保存（P0） | `addSnippet` `action:'duplicate'` 分支 |
| 预处理 trim + NFC（P0） | `processSelection`：`text.trim()` + `text.normalize('NFC')`（顺序差异见 §4.2） |
| 跳过 input/textarea/contenteditable（P0） | `isEditableElement` + `isSelectionInEditable`（后者为迭代增强） |
| 关闭时灰色 badge OFF（P0） | `background/service-worker.js` `updateBadge`（色值差异见 §4.5） |
| 最大长度 ≤5000 截断（§3.2 ⑥） | `CONFIG.MAX_TEXT_LENGTH=5000` + `truncateText`（代理对安全截断为增强） |

### 1.2 管理模块（全部保留）

| PRD 条目 | 当前代码证据 |
|----------|--------------|
| 点击图标新 tab 打开管理页（P0） | `service-worker.js` `action.onClicked` → `tabs.create`（增强：已开则聚焦） |
| 列表最新在前（P0） | `snippets_order` prepend + `render.js` 渲染顺序 |
| 每条记录仅显示文本（P0） | `render.js` `createCard` 仅渲染 `record.text` |
| 「共 N 条 · 占用约 X KB」（P0） | `render.js` `updateRecordInfo`（另加「最新在前」） |
| 单条删除按钮（P0） | `.card-delete` + `deleteSnippet` |
| 单条点击复制 + toast（P0） | `.card-text` 点击 → `copyToClipboard` → 「已复制」 |
| 导出 TXT/JSON（P0） | `manager/export.js` `handleExport` |
| 清空全部二次确认（含条数+最早日期，P0） | `manager.js` `handleClearAll` + `getEarliestDate` + `showConfirmModal` |
| 采集开关一键暂停/恢复（P0） | `#collect-toggle` + `get/setCollectEnabled` |
| 删除 5 秒内撤销（P1） | `performDeleteRecord` toast `duration: 5000` + onAction 恢复 |
| 新记录实时追加 + 视觉提示（P1） | `manager.js` onChanged → `prependNewCards` + `#new-records-hint`（3s） |
| 超 5000 条温和提示（P1） | `CONFIG.STORAGE_WARNING_THRESHOLD=5000` + `#storage-warning` |
| chrome.commands 快捷键 Ctrl+Shift+S（P1） | `manifest.json` `commands.toggle-collect`（「全局」用词差异见 §4.4） |
| 加载更多（50 条/批）（P1） | `PAGE_SIZE=50` + `loadMore`（交互形态差异见 §4.3） |
| 空状态引导（§3.7） | `#empty-state`（文案差异见 §4.8） |
| 3 行截断 + 展开/收起（§3.7） | `applyTruncationCheck` + `.card.expanded` + `-webkit-line-clamp: 3` |
| 管理页渲染必须 textContent（§3.7 安全规则） | `render.js`：`textEl.textContent = record.text` + 多处注释禁止 innerHTML |

### 1.3 导出规范（全部保留）

| PRD 条目 | 当前代码证据 |
|----------|--------------|
| TXT：UTF-8 BOM（§6.1） | `export.js`：`'\uFEFF' + content`，`text/plain;charset=utf-8` |
| TXT：仅文本、`\n\n` 分隔、capturedAt 升序（§6.1） | `texts.join('\n\n')` + `getAllSnippets` 升序排序 |
| TXT 文件名 `snippets_<日期>.txt`（§6.1） | `snippets${suffix}${dateStr}.txt`（suffix 见 §3.7 新增） |
| JSON：`{schemaVersion, exportedAt, count, snippets}`（§6.2） | `export.js` 结构完全一致 |
| JSON 含完整元数据（§6.2） | records 原样导出（另含迭代新增字段，见 §3） |

### 1.4 技术方案（全部保留）

| PRD 条目 | 当前代码证据 |
|----------|--------------|
| Manifest V3、原生 JS 无框架 | `manifest.json` `manifest_version: 3`；无框架依赖 |
| 分片存储（§3.6.2） | `snip_<uuid>` 独立 key + `snippets_order` 索引 |
| schemaVersion=1（§3.6.3） | `SCHEMA_VERSION=1` + SW `onInstalled` 初始化 |
| `action: {}` 不设 popup（§3.7/§4.2） | `manifest.json` `"action": {}`（无 default_popup） |
| all_frames: false（§4.2） | `manifest.json` content_scripts `"all_frames": false` |
| CSP（§4.5） | `manifest.json` `content_security_policy: script-src 'self'; object-src 'self'` |
| SW 不做数据中转（§5.7） | `service-worker.js` 头部注释原文一致 |
| Toast Shadow DOM + z-index 2147483647 + fixed 右上 16px + 1.5s + 单实例（§5.5/§7） | `content.js` `showToast`（圆角/配色差异见 §4.6） |
| 开关跨页面同步（§5.10） | `chrome.storage.onChanged` 三方订阅（content/manager/SW） |
| 存储估算 JSON.stringify（§5.4） | `getStorageEstimate`（增强为均匀采样，见 §3） |
| 页面加载 2s 保护期（§5.2） | `CONFIG.PAGE_LOAD_GRACE_MS=2000` |
| 空标题用 URL（§9） | `addSnippet`：`title: title \|\| url` |
| 保留换行 pre-wrap（§9） | `manager.css` `.card-text { white-space: pre-wrap }` |
| 卸载重装数据丢失、无恢复（§9） | 平台行为；代码无备份/恢复机制（导入已删） |
| 非目标清单（§8，10 项） | 全部与代码一致：无云同步/账号/分享/AI/搜索筛选/右键菜单/快捷键采集/发布/编辑区采集/选中弹窗菜单（grep 无相关实现） |

---

## 2. 旧 PRD 有、当前代码没有

### 2.1 已删除（有明确删除记录）

| 功能 | PRD 依据 | 删除证据 |
|------|----------|----------|
| **导入 JSON 恢复数据**（含全部导入规范） | §2 管理 P1「导入 JSON 恢复数据」；§3.7「导入」按钮与交互；§6.3 完整导入规范（结构校验、schemaVersion 兼容、合并去重、toast「导入了 X 条，跳过 Y 条」）；§11 验收项 | legacy-notes v0.7.1：「移除导入功能…删除管理页『导入』按钮与隐藏的 file input、`utils/storage.js` 的 `importSnippets()`、以及 `handleImport`/`handleImportFileChange`」；用户确认；当前 grep 无 `importSnippets`/`handleImport`/`<input type="file">` |
| 「导入」按钮（PRD §3.7 布局图/§7 工具栏） | 同上 | 同 v0.7.1 证据 |
| 导入相关验收项（§11 两条） | 「导入 JSON → 合并去重 → 提示『导入了 X 条，跳过 Y 条』」 | 同上 |
| `importSnippets` 分批写入 + 类型守卫（README v0.6.2/v0.6.3 记录的功能） | —（迭代说明层面） | 随 v0.7.1 删除，见 §5 |

### 2.2 未实现（PRD 写了但代码中无对应实现）

| 条目 | PRD 依据 | 当前证据 / 说明 |
|------|----------|-----------------|
| `about:blank` 页面来源标记为「未知页面」 | §9：「网页 URL 为 about:blank → 保存，来源标记为『未知页面』」 | 代码无「未知页面」文案；`getUrlKey`/`getDomain` 仅在 URL 解析异常时返回 `'unknown'`，`about:blank` 可被 `new URL()` 正常解析（urlKey ≈ `nullblank`），不会产生该标记。**未实现** |
| Shadow DOM 内文本采集（getComposedRanges） | §5.3 | PRD 自身已降级为已知限制：「v0.5 降级处理：不做特殊处理」；代码确实无 getComposedRanges 调用。**PRD 主动放弃，未实现（与 PRD 一致）** |
| 内容脚本注入限制的表单化说明 | §5.1（chrome://、商店、PDF 等） | 平台行为，代码无相关逻辑；说明文字已不在当前精简 README（原在旧 README「已知限制」，已归档） |
| 性能目标「1000 条打开 < 1s」「可存约 1 万条」 | §5.4、§11 | 无法从代码验证 → **待确认** |
| Google Docs / Notion / 飞书兼容验收 | §11 | 无法从代码验证 → **待确认** |

---

## 3. 代码里有、旧 PRD 没有 → 迭代中新增

### 3.0 功能层（v0.8.0 网站导航）

| 新增能力 | 代码证据 | 迭代来源 |
|----------|----------|----------|
| 管理页头部网站导航图标 + hover 分栏快捷方式面板 | `manager/nav.js` `initNav`/`renderNavPanel`；`manager.html` `#nav-root`/`#btn-nav`/`#nav-panel`；`manager.css` `.nav*` | v0.8.0 |
| 包内导航配置文件（无前端编辑） | `config/nav.json` + `loadNavConfig`（`fetch(chrome.runtime.getURL(...))`） | v0.8.0 |
| 导航配置校验/规范化（http/https 白名单、trim、空栏移除） | `normalizeNavConfig`（纯函数，`tests/nav.test.js` 9 例） | v0.8.0 |
| 导航键盘可达（Enter/Space/↓ 展开、Esc 收起归还焦点、focusin 兜底） | `nav.js` keydown / focusin 监听 | v0.8.0 |
| 配置无效时导航入口整体隐藏，不影响主功能 | `initNav` 分支 + 底部 `.catch` 兜底 | v0.8.0 |
| 面板分栏并排修复（`width: max-content`）与移除原生 tooltip | `manager.css` `.nav-panel`；`manager.html` `#btn-nav` 去 `title` | v0.8.0 |

> 与 PRD 的关系：旧 PRD（v0.5）无「管理页兼作新标签页」设想，本项为**纯迭代新增**，非 PRD 遗漏项。

### 3.1 功能层（v0.7.0 收藏与编辑体系）

| 新增能力 | 代码证据 | 迭代来源 |
|----------|----------|----------|
| 收藏/取消收藏（`saved` 字段 + `.card-favorite` 书签按钮） | `utils/storage.js` `toggleFavoriteSnippet`；`render.js` createCard | v0.7.0 |
| 首页/已保存双页签导航 | `#tab-home`/`#tab-saved` + `filterOrderRecords`（home/saved/all 三态筛选） | v0.7.0 |
| 清空全部保留已保存记录（`clearedFromHome` 标记） | `clearAllSnippets` 分支 | v0.7.0 |
| 已保存记录删除二次确认 | `deleteRecord`：`record.saved \|\| isSavedTab` 分支 | v0.7.0 |
| 已保存卡片「复制」「编辑」按钮 + 编辑弹窗 | `.btn-copy`/`.btn-edit` + `modal.js` `showEditModal` | v0.7.0 |
| `updatedAt` 编辑时间字段 | `updateSnippetText` | v0.7.0 |
| 导出按页签过滤 + `_saved_` 文件名后缀 | `export.js`：`suffix = filter === 'saved' ? '_saved_' : '_'` | v0.7.0 |
| 记录字段 `saved`/`clearedFromHome`/`updatedAt` 进入 JSON 导出 | `getAllSnippets` 原样导出 records | v0.7.0 |
| 已保存页签专属空态文案 | `render.js` loadMore 空态分支 | v0.7.0 |
| 实时追加按当前页签过滤（避免未收藏记录误入已保存页签） | `manager.js` onChanged → `filterOrderRecords(..., currentTab)` | v0.7.0 审计修复 |

### 3.2 健壮性层（v0.6.x 审计修复）

| 新增能力 | 代码证据 | 迭代来源 |
|----------|----------|----------|
| 孤儿记录自动收领（24h 节流 + 空 order 强制 + 缺 id 写回） | `adoptOrphanSnippets` + `orphanScanV1` 键 | v0.6 / v0.6.3 |
| `addSnippet` 写后校验重试（≤3 次，退避） | `addSnippet` while 循环 | v0.6.3 |
| `clearAllSnippets` 循环校验（≤3 轮） | `clearAllSnippets` for 循环 | v0.6.3 |
| 存储估算均匀采样 | `getStorageEstimate` 步长抽样 | v0.6.3 |
| 未聚焦 contenteditable 采集防护 | `isSelectionInEditable`（anchorNode 向上查可编辑祖先） | v0.6.3 |
| toast 深色环境自适应（含 hsl/hsla） | `detectDarkSurrounding` | v0.6 / v0.6.3 |
| 代理对安全截断（emoji/生僻字不切半） | `truncateText` | v0.6.1 |
| 删除/撤销后分页 offset 修正 | `decrementLoaded`/`incrementLoaded` | v0.6.1 / v0.6.3 |
| SW 冷启动 badge 同步（onStartup + 顶层兜底） | `service-worker.js` 两处 | v0.6.1 / v0.6.3 |
| `handleExport` 错误兜底 + 未知格式提示 | `export.js` try/catch + else 分支 | v0.6.3 |
| `loadMore` try/finally + 失败保留列表 | `render.js` `loadMore` | v0.6.3 |
| 管理页初始化错误态 | `renderLoadError` | v0.6.x（render.js 拆分时） |
| 卡片 `role="group"`（消除嵌套告警） | `createCard` | v0.6.3 |
| manifest 新增 `tabs` 权限 | `manifest.json`（PRD §4.2 权限清单无此项） | v0.6.3 |

### 3.3 交互/无障碍层（v0.6.x）

| 新增能力 | 代码证据 | 迭代来源 |
|----------|----------|----------|
| 管理页 toast 单实例（顶掉旧 toast） | `toast.js` `currentToastEl` | v0.6 |
| 确认弹窗键盘支持（焦点陷阱/Enter 尊重焦点/默认焦点「取消」） | `modal.js` | v0.6.2 |
| 卡片键盘复制（Tab + Enter/Space） | `createCard` keydown | v0.6.2 |
| 展开按钮键盘操作 | `.card-expand` keydown | v0.6.2 |
| 导出菜单键盘导航（Esc/↑/↓ + aria-expanded/haspopup） | `manager.js` setupListeners | v0.6.2 |
| toast `role="status"` / `aria-live` | `content.js`、`toast.js` | v0.6.2 |
| 点击卡片外部关闭导出菜单（focusin 监听） | `manager.js` | v0.6.2 前后 |
| 视觉重设计（暖白 `#F5F3EE` + 衬线标题 + Zed 蓝 `#2F6FED`） | `manager.css` `:root` | v0.6 |
| 垃圾桶图标替换「×」 | `ICON_TRASH` | v0.6 |
| 页面内 toast 浅/深双版本 + 三态徽标 | `content.js` Shadow DOM 样式 | v0.6 |
| 图标更换（品牌蓝圆角方 + 无衬线开引号） | `icons/*.png` + `design/` 参数化工具链（sharp） | v0.7.2 |
| 响应式布局 `@media (max-width: 640px)`（含触摸设备删除按钮常驻） | `manager.css` L752 | 迭代新增（PRD v0.4 曾将移动端适配移至 P2；当前以响应式 CSS 形态部分落地） |
| `prefers-reduced-motion` 减弱动效 | `manager.css` L776 | 迭代新增 |
| 测试体系（vitest + 语法提取纯函数，64 用例） | `tests/` + `vitest.config.js` + `package.json` | 迭代新增（PRD 无测试相关内容；v0.8.0 起含 nav 9 例） |
| 删除撤销时 `ignoreAllOrderChanges` 抑制 onChanged | `manager.js` | 迭代新增 |
| `listBridge` 状态通道（状态修改收敛命名函数） | `manager.js` 头部约定 | 模块拆分时新增 |
| 管理页模块拆分（render/toast/modal/export 独立文件） | `manager/` 目录结构（PRD §4.3 仅 manager.js 单文件） | 迭代新增 |

---

## 4. 旧 PRD 与代码描述不一致 → 差异清单

| # | 差异点 | PRD 描述 | 代码实际 | 证据 |
|---|--------|----------|----------|------|
| 4.1 | **长度阈值判定逻辑** | 伪代码 `chineseChars >= 5 \|\| englishWords >= 3`（「或」，单边达标即可） | 加权混合 `chinese/5 + english/3 >= 1`（双边按比例累加） | `content.js` `meetsLengthThreshold`；单测 `tests/content.test.js`。影响示例：4 中文字 + 1 英文词（0.8+0.33=1.13）→ PRD 逻辑拒绝、代码保存。当前 README「使用」部分「中文 ≥ 5 字或英文 ≥ 3 词」同样为简化表述 |
| 4.2 | **NFC 与截断的顺序** | §3.4 流程：⑥ 截断 → ⑦ `normalize('NFC')` | 先 `normalize('NFC')` 后截断 | `processSelection`；代码注释：「NFC 规范化必须在长度截断之前执行，避免在 Unicode 组合字符中间截断导致乱码」——**代码为刻意修正** |
| 4.3 | **加载更多交互形态** | §3.6.2「滚动到底时加载下一批」；§3.7「滚动加载更多」 | 显式「加载更多」**按钮**点击（`#btn-load-more`），无 scroll 监听 | `manager.html` L89；`manager.js` `$btnLoadMore`；grep 无 scroll 事件 |
| 4.4 | **快捷键称谓** | §2/§3.9/§4.1 称「全局快捷键」 | 浏览器内快捷键（非全局）：manifest `commands` 无 `"global": true`，需 Chrome 前台生效 | `manifest.json`；当前 README「配置」：「MV3 非全局快捷键，如需全局需加 `"global": true`」。注：PRD 自身的 manifest 示例（§3.9）也无 global 字段——**PRD 内部用词与示例矛盾** |
| 4.5 | **badge OFF 背景色** | §3.7「背景灰色 `#888`」 | `#9a9890`（文字 `#ffffff`） | `service-worker.js` L86-87 |
| 4.6 | **页面内 toast 样式** | §7「深色半透明背景，白色文字，圆角 6px，内边距 8px 16px」 | 浅/深两版自适应（浅色版为白底深字），圆角 10px，内边距 9px 14px 9px 9px | `content.js` Shadow DOM 样式（v0.6 视觉重设计） |
| 4.7 | **toast 文案** | §7「已采集 ✓ / 已采集过 / 采集失败」 | 「已采集 / 已采集过 / 采集失败」（无 ✓ 字符） | `content.js` `showToast` 调用处 |
| 4.8 | **空状态文案** | §3.7「还没有采集记录，去网页上选中文字试试吧」 | 「还没有采集记录」+「去任意网页上选中一段文字，500ms 后会自动保存到这里。」（已保存页签另有专属文案） | `manager.html` `#empty-title`/`#empty-sub`；`render.js` 空态分支 |
| 4.9 | **复制 toast 时长** | §7「toast『已复制』1.5 秒」 | 管理页 toast 默认 1600ms（页面内 toast 才是 1500ms） | `toast.js` `duration = actionText ? 5000 : 1600` |
| 4.10 | **去重/扩选检查顺序（PRD 内部矛盾）** | §3.3：「去重（完全相同文本）优先级高于扩选替换：先检查去重，再检查扩选替换」；§3.5 却写「去重检查在扩选替换之后、写入之前执行」 | 先 duplicate 后 replace，与 §3.3 一致 | `addSnippet` 分支顺序；**PRD §3.3 与 §3.5 互相矛盾，代码采用 §3.3** |
| 4.11 | **工具栏布局** | §3.7/§7：「[导入] [导出 ▾] [清空全部] · 共 N 条 · 占用约 X KB · 采集 [开/关]」 | 无「导入」；条数/占用移至副标题区（`#page-sub`），工具栏右侧仅开关；工具栏另有品牌区与 `#toolbar-count` | `manager.html` 结构 |
| 4.12 | **准入检查顺序** | §3.2 表格：①开关 ②编辑区 ③防抖 ④长度…；§3.4 流程图无「页面加载保护期」步骤 | 实际：防抖（事件层）→ 开关 → 编辑区 → **2s 保护期** → 选区 → 可编辑校验 → trim → 长度 → 类型过滤 → NFC → 截断 | `processSelection`；保护期为代码新增（PRD §5.2 仅作文字说明） |
| 4.13 | **存储估算展示精度** | §5.4「占用约 X KB（通过 JSON.stringify(record).length 估算）」 | 均匀采样后 `(平均单条 × 总数)/1024` 取整 | `getStorageEstimate`（增强，基础一致） |

---

## 5. 只写在 README 迭代说明里、但与当前代码不一致的点

来源：`legacy-notes.md`（原 README 版本历史/文件结构/已知限制/安全说明）。

| # | 迭代说明（legacy-notes） | 与当前代码的不一致 | 证据 |
|---|--------------------------|---------------------|------|
| 5.1 | v0.7.0：「优化导入导出，**支持随 JSON 完整恢复 `saved`、`clearedFromHome` 和 `updatedAt` 状态**，并针对页签过滤导出文件」 | 「随 JSON 恢复」能力已不存在：v0.7.1 删除导入后，JSON 导出**仍包含**这些字段（`getAllSnippets` 原样导出 records），但**无任何消费/恢复路径**；仅「针对页签过滤导出」仍成立 | `export.js`；无 import 实现（grep 证实）；v0.7.1 记录 |
| 5.2 | v0.6.2：「file input accept 加 MIME 兜底」 | 当前代码**无 file input**（已随导入功能删除） | `manager.html` 无 `<input type="file">`；v0.7.1 记录 |
| 5.3 | v0.6.3：「`importSnippets` 分批写入(100/批) + order 单独合并」；v0.6.2：「`importSnippets` 加类型守卫」 | `importSnippets` 函数不存在 | grep 无该标识符；v0.7.1 记录 |
| 5.4 | v0.6（README 行）：「JSON 导入」列入 v0.5 功能 | 已删除 | v0.7.1 记录 |
| 5.5 | v0.6：「orphan 扫描加**一次性标记**避免每次开页全量遍历」 | 当前实现为 **24h 节流标记**（`orphanScanV1`）+ 空 order 强制扫描，「一次性标记」描述与现行机制不符（v0.6.3 记录已更新为节流方案，但 v0.6 行仍保留旧说法） | `adoptOrphanSnippets`：`ORPHAN_SCAN_FLAG='orphanScanV1'`、`SCAN_INTERVAL_MS=24h` |
| 5.6 | v0.7.1：「导出的 JSON 结构保持不变」 | 基本成立（`{schemaVersion, exportedAt, count, snippets}` 未变）；但记录对象较 v0.5 多出 `saved`/`clearedFromHome`/`updatedAt` 字段（v0.7.0 加入，导出随之携带）——「结构不变」仅对四层外壳成立 | `export.js`；§3.1 |

**核对为一致（非差异）的迭代说明**（供参考）：v0.7.2 图标描述 ↔ `design/icon-spec.js`；v0.6 视觉重设计配色 ↔ `manager.css :root`；v0.6.3「manifest 增 tabs 权限」↔ `manifest.json`；v0.6.1「toast 双重钉死」↔ `content.css` + 内联样式；v0.6.2「弹窗默认焦点取消」↔ `modal.js`；已知限制（chrome://、iframe、Shadow DOM、编辑区、卸载数据丢失）↔ 当前代码行为；「导出文件仅作离线存档，插件不提供导入恢复」↔ 当前代码（自洽）。

---

## 附：对照结论摘要

- **保留**：PRD v0.5 全部 P0 功能点 + 多数 P1（24 项管理/采集条目 + 技术方案），删除/导入除外。
- **已删除**：导入功能全家（按钮、`importSnippets`、file input、导入验收项）——v0.7.1。
- **未实现**：`about:blank`「未知页面」标记（PRD 写了但从未实现）；Shadow DOM 采集（PRD 主动降级）；性能/兼容性验收项（无法代码验证，待确认）。
- **迭代新增**：网站导航（v0.8.0）、收藏/编辑/双页签体系（v0.7.0）、孤儿扫描与并发校验（v0.6.x）、无障碍与键盘支持、视觉重设计、响应式、测试体系、`tabs` 权限、图标工具链。
- **不一致**：13 项（§4），其中 4.2（NFC 顺序）为代码刻意修正、4.10 为 PRD 内部矛盾、4.1 影响实际采集行为。
- **README 迭代说明与代码不符**：6 项（§5），核心为「导入导出恢复」表述（5.1）与已删导入相关的残留记录（5.2–5.4）。
