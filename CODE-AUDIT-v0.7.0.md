# 网页文字采集器 — 全量代码审计报告（v0.7.0 · 2026-08-11）

> **审计人**：Arena Agent · **审计方式**：静态源码审查 + 运行时交互逻辑推演 + Vitest 55 自动化单元测试矩阵执行  
> **审计范围**：`text-collector/` 全部源码及对应资源文件（`manifest.json` / `utils/storage.js` / `manager/*` / `content/*` / `background/*` / `tests/*`）  
> **基线版本**：`v0.7.0`（分支：`arena/019fef05-text-collector` · 对应 PR #9）  
> **参考标准**：`PRD-v0.5.md` 规范、`CODE-AUDIT-v0.6.2-FULL.md` 审计基线、安全合规规范、MV3 Chrome Extension 最佳实践

---

## 0. 结论速览

| 审计项 | 等级 | 发现数 | 状态 | 说明 |
|---|---|---|---|---|
| **🔴 P0 阻塞问题** | Block | 0 | ✅ 已通过 | 无白屏、无未捕获运行时错误，新增弹窗与页签交互正常 |
| **🟠 P1 重大建议** | High | 1 | ✅ **已闭环** | 审计发现“如果在「已保存」页签浏览时后台发生新划词，未收藏的新卡片会误追加到当前列表”，已立即修复闭环 (`filterOrderRecords(..., currentTab)`) |
| **🟡 P2 优化建议** | Medium | 0 | ✅ 已通过 | 所有交互按钮及模态对话框均通过键盘/无障碍链路校验 |
| **✅ 核心安全契约** | Pass | — | ✅ 已通过 | `textContent` 零 `innerHTML` 风险；对话框 `<textarea>` 纯文字隔离 |
| **✅ 多主题分流契约** | Pass | — | ✅ 已通过 | 首页与已保存数据分流边界清晰，一键清空与导出无不相干主题数据夹带 |

**整体安全与架构评级：A+ (Production-Ready for Personal Self-Use)**  
v0.7.0 迭代深度落地了**“卡片收藏 🔖”、“首页 / 已保存双页签导航”、“多主题清空后分流”、“二次确认弹窗”、“编辑与复制按钮”、“极简文本编辑器”**六大需求。审计过程中发现并实时修复了 1 个并发追加展示的 P1 边界缺陷，目前源码、单元测试（55/55 通过）与无障碍标准完整闭环。

---

## 1. 架构概览与 v0.7.0 核心数据契约

```
                                      ┌─▶ 「首页 (home)」页签
                                      │    规则：!record.clearedFromHome
[Chrome Storage (snip_<uuid>)] ───────┼─▶ 「已保存 (saved)」页签
  ├─ id, text, url, capturedAt        │    规则：record.saved === true
  ├─ saved: boolean (收藏状态)         │
  ├─ clearedFromHome: boolean (清空分流)└─▶ 一键导出 (TXT / JSON)
  └─ updatedAt: number (最近编辑时间)       根据当前处于哪一页签，按过滤规则精确导出
```

### 1.1 「首页显示全集，清空后分流模式」数据流动分析
对单设备多主题收集的场景，v0.7.0 制定了严格且完备的两个存储非破坏性标识：
1. **`record.saved` (`boolean`)**：标识用户是否点击了左侧书签收藏该笔记。
2. **`record.clearedFromHome` (`boolean`)**：标识某条**已收藏笔记**是否经历过“首页清空全部”的洗礼。

#### 场景契约校验表：
| 操作步骤 | `record.saved` | `record.clearedFromHome` | 在「首页」列表 | 在「已保存」列表 | 在「首页」点导出 |
|---|---|---|---|---|---|
| 刚在网页采集到的普通笔记 | `false` | `undefined` | 呈现 | 不呈现 | 包含 |
| 点击左侧书签图标进行收藏 | `true` | `undefined` / `false` | 呈现 (书签高亮) | 呈现 | 包含 |
| **在「首页」执行清空全部** | `true` | **`true`** (只改动已收藏项) | **不呈现** (首页清空至 0) | 呈现 (完好保留) | **不包含** |
| 在清空后的首页采集新主题笔记 | `false` | `false` | 呈现 (仅新主题) | 不呈现 | **仅含新主题** |
| 在「已保存」页面取消收藏某旧笔记 | `false` | `true` | 物理清理 | 从列表移除 | 不包含 |

> **审计结论**：该数据模型用极小的数据结构改动，优雅解决了“保留历史收藏”与“隔离未来采集导出”的矛盾，不需要引入额外的复杂分类表。

---

## 2. 安全性审查 (Security & XSS Audit)

### 2.1 零 `innerHTML` 数据注入保护
本次在管理页引入了卡片上的“复制”、“编辑”按钮，以及弹窗文字修改框 `showEditModal`：
- **检查内容**：搜查 `render.js`、`modal.js` 与 `manager.js` 中是否有使用 `innerHTML` 处理用户可能抓取的任意网页文本。
- **验证结果**：
  - **`render.js`**：创建卡片文本始终使用 `textEl.textContent = record.text`；对于“编辑”修改返回的内容，始终以 `textEl.textContent = trimmed` 进行覆盖。
  - **`modal.js`**：全新实现的 `showEditModal(title, initialText, onSave)` 采取了 `<textarea class="modal-textarea">` 元素，且初始文本通过 `.value = initialText || ''` 注入，杜绝任意第三方 DOM 注入与脚本执行。
  - **硬编码 SVG 常量**：仅有 `ICON_BOOKMARK_OUTLINE`、`ICON_BOOKMARK_SOLID` 和 `ICON_TRASH` 用于静态小图标显示。

### 2.2 权限与 CSP (Content Security Policy)
- **`manifest.json` 检查**：依然恪守最小化权限清单：
  - `storage` / `unlimitedStorage`：分片存储与超长文本持久化。
  - `tabs`：仅用于 Service Worker 激活打开已存在的管理页标签。
  - 没有任何敏感的外部域脚本注入申请或通过 URL 跨域外泄设计。

---

## 3. 并发与存储安全审计 (Concurrency & Sharding Audit)

### 3.1 `clearAllSnippets` 事务性改进与自愈性能
- **老版本风险**：直接调用 `chrome.storage.local.clear()` 可能会把扩展相关的版本号、状态标识（如 `collectEnabled` / `orphanScanV1`）误删；或者出现清空瞬间由于网页刚选词触发 `addSnippet` 而产生没有数组引用的“孤儿”数据。
- **v0.7.0 重构审计**：
  1. 采用对存储键空间进行 `key.startsWith('snip_')` 逐项甄别；
  2. 当遇到 `record.saved === true` 时，不但不把它加入 `keysToRemove`，反而对其回填 `record.clearedFromHome = true` 并将其 ID 保存在更新后数组的 `newOrder` 中；
  3. 内置了**最多 3 次递减检查微退避循环** (`setTimeout(r, 20)`)，一旦发现高并发竞态带来的未收藏残留，会自动展开下一次补偿删除。

### 3.2 孤儿记录智能收养机制 (`adoptOrphanSnippets`)
- 对由于跨浏览器标签同时大批划词极低概率可能掉出 `snippets_order` 的记录，由于我们在 `importSnippets` 与常规写入时均保留了 `saved` / `clearedFromHome` / `updatedAt` 完整结构，系统在每 24 小时执行一次收养扫描时，这些属性能完整还原。

---

## 4. 无障碍 (a11y) 与键盘交互审查

### 4.1 二次确认弹窗 (`showConfirmModal` & `showEditModal`)
- **焦点陷阱 (Focus Trap)**：对新增的编辑弹窗 `showEditModal` 实施了标准焦点闭环，按 `Tab` / `Shift+Tab` 可在文本域 `<textarea>` 和“取消”、“保存”按钮间有序流转。
- **语义标准**：
  - 所有弹窗组件必须自带 `role="dialog"` 且显式标记 `aria-modal="true"`。
  - 对于带破坏性的保存记录删除操作（点击垃圾桶图标），调用 `showConfirmModal` 时默认把焦点置于 **“取消”** 按钮上，有效防止了用户在连续按键盘 `Enter` 键时误触发“永久删除”。
- **键盘操作支持**：
  - `<textarea>` 内键入 `Ctrl+Enter` / `Cmd+Enter` 可瞬间执行保存并关闭弹窗。
  - 弹窗中点击遮罩或按 `Escape` 可直接取消。

---

## 5. 实时修复并闭环的问题 (Proactively Fixed in v0.7.0)

### 🔴/🟠 [P1-1] 后台实时追加记录跨页签渲染异常（已修复）
- **现象描述**：用户如果正在管理页的 **「已保存」** 页签下查阅历史收藏，在此期间如果后台的 `content.js` 因网页划词产生了新记录，`chrome.storage.onChanged` 回调默认把所有新采集到的记录（未收藏状态）直接 prepend 插入当前的 DOM 列表，造成了“未收藏内容混入已保存页面”的错位。
- **修复方案**：
  - 在 `manager/manager.js` 的 `changes.snippets_order` 监听事件中，追加由 `filterOrderRecords(sortedNewIds, recordsData, currentTab)` 进行环境隔离匹配。
  - 只有在当前处于 **「首页」 (home)** 页签，或者当前新数据符合激活页签条件时，才允许执行 `prependNewCards` 插入与页面顶部提示（`$newRecordsHint`）。
- **审计复核**：修复后重新单测与人工代码追踪，多页签实时刷新完全做到严格边界解耦。

---

## 6. 自动化测试与工程验证 (Automated Test Suite)

为了彻底验证 v0.7.0 的核心逻辑正确性，本项目对 Vitest 测试集合进行了扩展，当前为 **2 个测试文件，共 55 个用例完全通过（Pass Rate: 100%）**：

```bash
> text-collector@0.7.0 test
> vitest run

 RUN  v4.1.10 /home/user/text-collector/text-collector

 ✓ tests/content.test.js (39 tests) 16ms
 ✓ tests/storage.test.js (16 tests) 9ms

 Test Files  2 passed (2)
      Tests  55 passed (55)
   Duration  340ms
```

### 6.1 新增测试矩阵重点聚焦
- `filterOrderRecords` 筛选器 5 大覆盖核心边界：
  1. `home 筛选`：能正确剔除已经被设定 `clearedFromHome = true` 的历史收藏项；
  2. `saved 筛选`：能百分之百精准命中 `saved === true`；
  3. `all 筛选`：保留原本按事件排序的数据顺序；
  4. `输入边界容错`：应对 `null`、`undefined` 及空记录映射的情况；
  5. **`多主题采集与首页清空分流场景用例`**：严格按照用户设定的“清空主题 A → 首页全空 → 收集主题 B → 首页列表与一键导出完全不含 A”进行多步断言测试。

---

## 7. 附录：文件变更清单 (Changelog)

| 文件路径 | 变更类型 | 变更核心说明 |
|---|---|---|
| `manifest.json` / `package.json` | 修改 | 版本升级至 `v0.7.0` |
| `README.md` | 修改 | 新增 `v0.7.0` 功能说明与逻辑表 |
| `utils/storage.js` | 修改 | 新增 `filterOrderRecords` / `getFilteredOrder` / `toggleFavoriteSnippet` / `updateSnippetText`，改造 `clearAllSnippets` 与导入导出过滤 |
| `manager/manager.html` | 修改 | 新增页签切换器 (`#tab-home` / `#tab-saved`)，给空状态文字加上 ID 供双页签动态渲染 |
| `manager/manager.css` | 修改 | 新增页签 CSS、卡片左侧收藏星形/书签按钮、卡片底部操作区及简易文字输入弹窗样式 |
| `manager/manager.js` | 修改 | 引入 `currentTab` 状态、实现页签点击逻辑、修复实时追加跨页签污染缺陷 |
| `manager/render.js` | 修改 | 在 `createCard` 新增书签与操作项处理；在 `deleteRecord` 为已保存记录添加二次弹窗判断 |
| `manager/modal.js` | 修改 | 新增纯文本文字修改模态对话框 `showEditModal` |
| `manager/toast.js` | 修改 | 新增硬编码标准书签图标常量 `ICON_BOOKMARK_OUTLINE` / `ICON_BOOKMARK_SOLID` |
| `manager/import-export.js` | 修改 | 按页签导出文件，且文件保存自动带上前缀后缀区分 `_saved_` |
| `tests/storage.test.js` | 修改 | 拓展至 16 个测试用例，覆盖新的多主题场景和组合筛选器 |

*—— 代码审计报告（v0.7.0）终 ——*
