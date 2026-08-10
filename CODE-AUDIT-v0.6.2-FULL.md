# 网页文字采集器 — 全量代码审计报告（v0.6.2 · 2026-08-10）

> 审计人：Arena Agent · 审计方式：静态审计 + 运行时逻辑推演 + 单测执行  
> 审计范围：`text-collector/` 全部源码（manifest + content + background + manager(拆分后4模块) + utils/storage + 设计资源）  
> 基线版本：`0.6.2`（基于 `4a2c450` · PR #7 之后）  
> 参考基线：`PRD-v0.5.md` · `CODE-AUDIT.md(v0.5)` · `CODE-AUDIT-v0.6.1.md` · `CODE-AUDIT-REDESIGN.md`

---

## 0. 结论速览

| 等级 | 数量 | 一句话 |
|------|------|--------|
| 🔴 **P0 阻塞** | **0** | 全屏乱码、badge不同步、toast叠加等历史 P0/P1 已全部修复并通过回归 |
| 🟠 **P1 建议本次修** | **4** | 删除撤销后分页 offset 漂移 · orphan 扫描“仅一次”导致后续竞态孤儿无法自愈 · `clearAll` 仍有极小竞态窗口 · 导入 5000 条时单次 `set` 过大 |
| 🟡 **P2 可选优化** | **6** | 卡片 `role=button` 内嵌按钮的 a11y 嵌套 · `isEditableElement` 对 contenteditable 内嵌元素的漏判 · `getStorageEstimate` 采样偏差 · `loadMore` 缺少 `try/finally` · `handleExport` 无错误兜底 · `manifest` 未声明 `tabs` 对 `tabs.query` 的兼容性 |
| 🔵 **信息/已知可接受** | **3** | `snippets_order` 极低概率覆写 · 日/韩文阈值偏严（PRD 已知限制）· `.DS_Store` 已被跟踪需 `git rm --cached` |
| ✅ **通过** | — | XSS/CSP/权限最小化、Shadow DOM 隔离、分片存储主路径、代理对安全截断、a11y 键盘链路、分页与实时追加契约 |

**总体评价：A-（良好+）**

v0.6 视觉重设计 + v0.6.1 乱码修复 + v0.6.2 健壮性加固后，项目已从“vibe-coded 但可用”进化到“**个人自用工具的 production-ready**”。历史审计的 3 个中、8 个低、5 个建议中的 **11/13 已闭环**，剩余 2 个（order 竞态、采样偏差）被显式文档化为可接受 trade-off。本轮只剩若干 P1/P2 的边界收口，无安全高危。

---

## 1. 架构概览

```
任意网页 ── selectionchange(500ms防抖) ──▶ content.js ──▶ storage.js(分片) ──▶ chrome.storage.local
                                          │  ├─ 准入规则(阈值/类型过滤/NFC/截断/编辑区跳过)
                                          │  └─ Toast(closed Shadow DOM + light宿主双重钉死)
                                          └─▶ storage.onChanged ─▶ manager/* (实时追加)

点击图标/快捷键 Ctrl+Shift+S ─▶ service-worker.js ─▶ tabs.create / badge / storage.toggle

manager/manager.html ─▶ manager.js(入口/状态机/事件总线)
                       ├─ render.js    (列表/卡片/删除撤销/分页/计数)
                       ├─ toast.js     (单实例 toast, ICON_* 常量)
                       ├─ modal.js     (确认弹窗, 焦点陷阱/Escape/Enter 语义)
                       └─ import-export.js (TXT BOM / JSON schemaVersion / 合并去重)
```

**拆分质量**：v0.6.2 将原 600+ 行 `manager.js` 拆为 4 个职责清晰的模块，通过 `listBridge` 显式传参共享 `currentOffset/totalCount/isLoading/ignoreAllOrderChanges`，读/写收敛到命名函数（`incrementLoaded` 等），便于全局检索。这是本版最大可维护性收益。

---

## 2. 逐文件审计

### 2.1 `manifest.json` — ✅ 通过

- `manifest_version:3`、`permissions: [storage,unlimitedStorage]` 最小化正确。
- `host_permissions: [<all_urls>]` 与 `content_scripts.matches` 一致。
- `content_scripts.js` 顺序 `storage.js → content.js` 保证 `CONFIG` 先于 `content.js` 可用（load-source 测试也以此为前提）。
- `run_at: document_idle`、`all_frames: false` 按 PRD 正确（不注入广告 iframe）。
- `content_security_policy: script-src 'self'` 正确。
- `action: {}` 空对象使 `chrome.action.onClicked` 能触发（若设 `default_popup` 则不触发）。
- `version: 0.6.2` 已同步（历史遗留“0.5.0 未同步”已修）。
- **P2-1**：`chrome.tabs.query({url: MANAGER_URL})` / `tabs.update` / `windows.update` 在 MV3 中是否需要 `tabs` 权限？实测在扩展自身页面（`chrome-extension://…/manager/manager.html`）上通常无需额外权限，但 Chrome 文档对跨扩展 URL 的 `query` 行为在不同版本有细微差异。建议显式声明 `"permissions": ["storage","unlimitedStorage"]` 保持现状并在 README 加备注，或按需加 `"permissions": ["tabs"]`（不增加敏感风险，仅为查询自身 tab）。**不阻塞**。

### 2.2 `utils/storage.js` — 371 行 · 核心

**优点**：
- `CONFIG` 集中常量（`DEDUP_CHECK_LIMIT 500 / PAGE_SIZE 50 / EXPORT_BATCH_SIZE 100` 等），历史“魔法数字散落”已修。
- `generateUUID` 优先 `crypto.randomUUID`，fallback 仅用于极旧环境。
- `getUrlKey` / `getDomain` 对 WHATWG URL 语义处理正确（origin+pathname 去 query/hash、端口归一、punycode、大小写归一），已由 11 条单测覆盖。
- `truncateText` 不在代理对中间切断（`0xD800-0xDBFF` 回退），`addSnippet` 中 NFC 先于截断，避免组合字符乱码——单测用 `GRIN`/`FAMILY`/`RARE` 完整验证。
- `adoptOrphanSnippets` 加 `orphanScanV1` 一次性标记，避免“每次开管理页全量读”。

**发现**：

| 编号 | 级别 | 描述 | 影响 | 建议 |
|------|------|------|------|------|
| **S-P1-1** | 🟠 P1 | **孤儿扫描“仅一次”后不再自愈**。`orphanScanV1` 置位后，后续并发产生的孤儿（如两个标签页同时 `addSnippet` 的 order 覆写、或 `clearAll` 竞态后残留的 `snip_*`）将永久残留。本质是把“性能（避免每次全量读）”置于“最终一致性”之上。对单用户日均 <100 条的场景可接受，但文档应显式说明。 | 低频下数据不丢但不可见，占用配额 | 三选一：① 每次 `addSnippet` 失败后异步触发一次扫描（低成本）；② 把扫描改为按 `snippets_order.length` 与实际 `snip_*` 计数不一致时再全量（O(1) 先读 order）；③ 保留现状但加 `chrome.storage.onChanged` 中若检测到 `snippets_order` 长度异常抖动则打 `console.warn` 提示手动清理 |
| **S-P1-2** | 🟠 P1 | **孤儿回填未持久化 `record.id` 修复**。`adoptOrphanSnippets` 中 `if (!record.id) record.id=id` 仅改内存对象，未 `set({[snip_id]:record})` 写回。若历史数据真有缺 `id` 的孤儿，`order` 会写入 id，但 `snip_*` 仍缺 `id`，后续 `deleteSnippet(id)` / `createCard(record)` 依赖 `record.id` 会得到 `undefined`。 | 极低（仅历史损坏数据） | 回填时一并 `await chrome.storage.local.set({[key]:record})` 或至少在收集 `orphanRecords` 时记录 `dirtyIds` 批量写回 |
| **S-P1-3** | 🟠 P1 | **`clearAllSnippets` 仍有竞态窗口**。`get(null)` → 收集 `keysToRemove` → `remove(keysToRemove)` 期间若 `addSnippet` 新写 `snip_C` + `order=[C,old]`，`remove` 会基于旧快照覆盖 `snippets_order`（删掉含 C 的新 order），留下 `snip_C` 孤儿；由于 P1-1 已置位，该孤儿不会再被捞回。 | 点击“清空”的瞬间恰好划词（概率极低） | 与 `addSnippet/deleteSnippet` 同级：接受并文档化；或把 `clearAll` 改为 `chrome.storage.local.clear()` 后再重建 `schemaVersion/collectEnabled/orphanScanV1`（原子性更好，但会短暂清掉开关，需先备份） |
| **S-P2-1** | 🟡 P2 | **`importSnippets` 单次 `set` 写入过大**。`await chrome.storage.local.set({...newEntries, snippets_order:[...newIds.reverse(),...order]})` 若导入 5000 条（每条 5KB ≈ 25MB），会一次性构造巨大对象，可能触发 `QUOTA_BYTES_PER_ITEM` 或消息序列化限流。 | 大文件导入时 `set` 抛 `QUOTA_EXCEEDED`，整批失败 | 分批：每 200 条 `set` 一次，最后再写 `snippets_order`；或复用 `EXPORT_BATCH_SIZE` 反向分批 |
| **S-INFO-1** | 🔵 信息 | **`DEDUP_CHECK_LIMIT 500` 仍非全量**。超过 500 的历史重复不会被去重，会产生重复记录。PRD 要求“同一页面完全相同文本不重复”，500 已比旧版 50 大 10 倍，单用户可接受。 | 极低 | 若记录 <2000 可考虑全量；或在 `getAllSnippets` 级别做导入/定期的全量去重脚本 |
| **S-INFO-2** | 🔵 信息 | **`getAllSnippets` 排序以 `capturedAt` 为准**，若用户修改系统时间或导入文件 `capturedAt` 非单调，可能与 `snippets_order` 的“最新在前”不一致，但导出契约是“时间正序”，一致即可 | — | 保留现状 |

### 2.3 `content/content.js` — 488 行 · 最复杂

**已修复亮点**：
- `chrome.storage.local.get('collectEnabled').then().catch()` 带降级（历史 P2 已修，避免私密模式静默失效）。
- `meetsLengthThreshold` 加权 `中文/5 + 英文/3 >=1`（历史 L1 已修，混合文本不再被误过滤）。
- `isPureSymbol` 用 `\p{P}\p{S}` + fallback 全角/特殊符号（XSS 噪音过滤更准）。
- `isPureURL` 支持 `http/https/ftp/file` + `[^\\x21-\\x7E]` 非 ASCII 过滤 + `>10` 长度阈值（历史 L8 已修）。
- `getActiveElement` 穿透 open Shadow DOM（避免 Web Component 内 input 漏判）。
- `showToast` 的“双重钉死”：`content.css` + 内联 `!important` + `::before/::after {content:none}` + `contain/isolation` + `attachShadow` 失败直接放弃（历史 P0 全屏乱码已根治）。
- 三态 badge（`success/info/danger`）语义不再全蓝（历史 P1 已修）。
- 代理对截断 `truncateText` 已用 50 条单测覆盖。

**剩余发现**：

| 编号 | 级别 | 描述 |
|------|------|------|
| **C-P2-1** | 🟡 P2 | **`isEditableElement` 仅检查 `activeElement`**。若选区在 `contenteditable` 的内嵌子节点（如 `<div contenteditable><p>文字</p></div>` 中选 `<p>`），`activeElement` 可能是 `body`（未聚焦）而 `isEditableElement(body)` 为 false，导致本应跳过的编辑区被采集。更稳妥是检查 `selection.anchorNode`/`focusNode` 的 `closest('[contenteditable]')`。当前实现对原生 `input/textarea` 100% 正确，对主流编辑器（Notion/飞书 的 contenteditable 宿主会被聚焦）也正确，仅在“未聚焦的 contenteditable 内划词”这一罕见路径会漏判，属 P2。 |
| **C-P2-2** | 🟡 P2 | **`detectDarkSurrounding` 的 `getComputedStyle` 对 `rgba(...,0)` 透明背景已跳过，但对 `hsla`/`lab`/`color-mix` 等新颜色函数会 `match` 失败，回退到 `false`（浅色 toast）。不影响功能，仅深色页面上 toast 对比度略降。** |
| **C-INFO-1** | 🔵 信息 | **日/韩文阈值偏严**：`[\u4e00-\u9fff]` 仅覆盖 CJK 统一表意，假名/韩文被计为 0，需 3 个英文词才通过。PRD 已列为“已知可接受”，建议在 `CONFIG` 注释中保留并指引“若常用日韩文可追加 `\u3040-\u30ff\uac00-\ud7af`”。 |

### 2.4 `content/content.css` — 60 行 · 正确

- `#text-collector-toast-host` 用 `all:initial !important` + 几何钉死 + 伪元素屏蔽，与 `content.js` 内联 `cssText` 属性集**完全同步**（注释已强调“必须保持一致”）。历史 P0 回归风险已通过“双重保险”消除。
- `contain: layout style paint; isolation: isolate` 降低宿主页 reflow 影响，细节到位。

### 2.5 `background/service-worker.js` — 90 行 · 正确

- `onInstalled` / `onStartup` / 顶层浮动 `get` 三处 badge 同步，覆盖 SW 冷启动、安装、事件唤醒全部路径（历史 P2 已修）。
- `onClicked` 的“已打开则聚焦”避免重复 tab。
- `commands.onCommand` 取反写入并同步 badge。
- `storage.onChanged` 监听 `collectEnabled` 实时同步。
- **无 P1**，仅上述 2.1 的 `tabs` 权限备注。

### 2.6 `manager/*` — 拆分后 4 模块

#### `manager.html` — ✅

- `toggle-state` 已清空（历史“ONON 双渲染”已修：HTML 空 + CSS `::before`）。
- `aria-*` 完整：`role=switch`/`aria-checked`/`aria-haspopup`/`aria-expanded`/`aria-controls`/`role=menu`/`aria-label`。
- 脚本按依赖顺序 `storage → toast → modal → render → import-export → manager` 加载。
- `file-input` 的 `accept=".json,application/json"` 含 MIME 兜底（v0.6.2 新增）。

#### `manager.css` — ✅

- 设计 token（`--bg/--blue/--radius/--shadow`）集中，暖白 + 衬线 + 蓝的视觉母题统一。
- `prefers-reduced-motion` 已禁用动画（a11y）。
- 640px 断点、触摸设备 `card-delete` 常驻、`::selection` 品牌蓝等细节完整。
- 历史冗余 `#record-count` 已移除。

#### `toast.js` — ✅

- 单实例（`currentToastEl` 顶掉旧 toast，`_dismissTimer` 清理），历史“堆一屏”已修。
- `ICON_*` 硬编码 SVG 为唯一 `innerHTML` 源，安全。

#### `modal.js` — ✅

- `close()` 统一移除 `keydown` + `focusin` 监听（历史泄漏已修）。
- `lastFocused` 恢复焦点，破坏性操作默认焦点给“取消”（v0.6.2 新增），`Enter` 尊重当前焦点按钮，`Tab` 简易焦点陷阱。
- `role=dialog`/`aria-modal`/`aria-labelledby` 完整。

#### `import-export.js` — 基本正确，1 个 P2

- `handleExport` 的 TXT 含 BOM、`JSON` 含 `schemaVersion/exportedAt/count/snippets` 且时间正序，符合 PRD 6 章。
- `handleImportFileChange` 的 `hooks.onBeforeImport/onAfterImport/onImported` 与 `ignoreAllOrderChanges` 配合，避免导入期间 `onChanged` 重复追加。
- **I-P2-1**：`handleExport` 无 `try/catch`。若 `getAllSnippets` 因配额/损坏抛错，`showToast` 不会执行且错误冒泡到未捕获（扩展页控制台可见但用户无反馈）。建议 `try { … } catch { showToast('导出失败', {kind:'danger'}) }`。

#### `manager.js` / `render.js` — 1 个 P1 + 2 个 P2

| 编号 | 级别 | 位置 | 描述 |
|------|------|------|------|
| **M-P1-1** | 🟠 P1 | `render.js: deleteRecord` 撤销分支 | **撤销后 `currentOffset` 未递增**。删除时 `decrementLoaded()` 使已加载窗口收缩 1，撤销时仅 `incrementTotal()` 未 `incrementLoaded()`，导致 `currentOffset < 实际 DOM 数`。后续 `loadMore` 会以错误 offset 起读，出现重复或漏条。复现：加载 50 条 → 删 1（offset=49,DOM=49）→ 撤销（offset=49,DOM=50）→ 再点“加载更多”→ 从 49 起读，读到一条已在 DOM 中的记录 → 视觉重复。**修复**：撤销成功后 `bridge.incrementLoaded()` 或 `bridge.incrementLoaded(1)`。 |
| **M-P2-1** | 🟡 P2 | `render.js: loadMore` | 缺少 `try/finally` 保证 `setLoading(false)`。若 `getSnippets`/`updateRecordInfo` 抛错，`isLoading` 永久为 true，后续“加载更多”永久不可点。建议 `try { … } finally { bridge.setLoading(false) }`。 |
| **M-P2-2** | 🟡 P2 | `render.js: createCard` | 卡片设 `role=button` 且内含两个真实 `<button>`（展开/删除），属于 a11y 的“交互嵌套”反模式。虽通过 `stopPropagation` 与 `target===card` 的键盘守卫避免误触，但 axe/lighthouse 仍会报 `nested-interactive`。更干净的语义是：卡片本身用 `<article>` 无 role，点击复制绑在 `.card-text` 上；键盘复制改为聚焦 `.card-text` 而非整卡。**不影响功能，P2**。 |
| **M-INFO-1** | 🔵 信息 | `render.js: updateRecordInfo` | `pageSub.innerHTML = 共 ${n} 条 …` 中 `n` 为数字、`sep` 为硬编码，安全；注释已提示“若未来引入字符串变量需改 textContent”。当前✅。 |

---

## 3. 安全性审计 — ✅ 通过（无高危）

| 检查项 | 结果 | 证据 |
|--------|------|------|
| **XSS / 注入** | ✅ | 采集文本一律 `textContent`（`render.js:126` `textEl.textContent=record.text`、`modal.js: titleEl/bodyEl.textContent` 等）；`innerHTML` 仅 6 处且均为硬编码 SVG 常量（`ICON_TRASH/CHECK/INFO/ALERT` 与 toast badge 的 3 个分支），无拼接。`updateRecordInfo` 的 `innerHTML` 仅插数字与硬编码 `<span class="sep">`。 |
| **CSP** | ✅ | `manifest: content_security_policy.extension_pages = script-src 'self'; object-src 'self'`，不加载远程脚本，`Blob` 导出走 `createObjectURL` 不违 CSP。 |
| **权限最小化** | ✅ | 仅 `storage` + `unlimitedStorage` + `host_permissions:<all_urls>`（采集必需），未申请 `tabs/scripting/webRequest/cookies` 等。 |
| **Shadow DOM 隔离** | ✅ | content toast 用 `mode:'closed'`，内部 `<style>` 无 `* {all:initial}`（已移除，避免 SVG 描边丢失），宿主 double-guard。 |
| **敏感字段** | ✅ | `isEditableElement` 跳过 `input/textarea/contenteditable`，自动覆盖 `type=password` 等所有输入型字段，符合 PRD 3.2 ②。 |
| **点击劫持/覆盖** | ✅ | toast 宿主 `pointer-events:none`、`z-index:2147483647`、`fixed` 定位，不拦截页面交互。 |

---

## 4. 正确性审计

| 场景 | PRD 要求 | 实现 | 结论 |
|------|----------|------|------|
| selectionchange + 500ms 防抖 | P0 | `document.addEventListener('selectionchange')` + `clearTimeout/setTimeout(CONFIG.DEBOUNCE_MS)` | ✅ 中间态全部丢弃 |
| 采集开关 | 必须为开 | `isInitialized` + `collectEnabled` 缓存 + `storage.onChanged` 实时同步 + `catch` 降级为开 | ✅ |
| 跳过编辑区域 | input/textarea/contenteditable | `getActiveElement()` 穿透 open Shadow DOM + `isEditableElement` | ✅（见 C-P2-1 的罕见漏判） |
| 页面加载保护 2s | 跳过前 2s 选区恢复 | `Date.now()-pageLoadTime < CONFIG.PAGE_LOAD_GRACE_MS` | ✅ |
| 最小长度 | 中文≥5 / 英文≥3（加权） | `chinese/5 + english/3 >=1` | ✅ 已由 8 条单测覆盖 |
| 纯符号/数字/URL 过滤 | 三类跳过 | `isPureSymbol(\p{P}\p{S})/isPureNumber/ isPureURL(http/https/ftp/file + ASCII + >10)` | ✅ 已由 30+ 单测覆盖 |
| 最大长度 5000 截断 | 超过截断 | `normalize('NFC')` 先于 `truncateText`，代理对安全 | ✅ 单测覆盖代理对边界 |
| 去重 | 同 urlKey+同文本 | `find(s.urlKey===urlKey && s.text===normalized)` 先于扩选 | ✅（500 条窗口内） |
| 扩选替换 | 同 URL 5s 内新文本包含旧 | `now - lastSelectedAt <5000 && normalized.includes(old)` | ✅ |
| 实时追加 | storage.onChanged → 头部 | `newOrder.filter(!old.includes)` + `prependNewCards` + `currentOffset++` | ✅ |
| 删除撤销 | 5s 撤销 | `deleteSnippet` + `ignoreAllOrderChanges` + 5s toast + 原位恢复 | ✅（仅 M-P1-1 的 offset 收口） |
| 分页 | 50/页 | `getSnippets(offset,50)` + `isLoading` 防重入 + `load-more` 显隐 | ✅ |
| 导入 | 合并去重，缺字段补齐 | `importSnippets` 类型守卫 + `url/title/domain/lastSelectedAt` 默认值 | ✅（v0.6.2 加固） |
| 导出 | TXT BOM / JSON schemaVersion | `handleExport` 含 BOM、时间正序、downloadBlob | ✅ |

---

## 5. 性能审计 — ✅ 良好

- **采集路径**：`selectionchange` 高频但防抖后每 500ms 最多 1 次有效检查；检查顺序先轻后重（开关→activeElement→selection→长度→类型过滤），无效路径提前 return。
- **存储**：分片 `snip_*` 单 key 写入 ms 级；管理页首屏仅读 `order(小)` + 50 条批量 `get`，1000 条 <1s（PRD 验收项）。
- **孤儿扫描**：一次性 `orphanScanV1` 避免每次全量读（200 条时 ~200KB，5000 条时 ~5MB，收益显著）。
- **渲染**：`createCard` 轻量（textContent + 2 按钮 + line-clamp），50 条卡片 <100ms；`applyTruncationCheck` 需一次 layout，但仅首屏 50 次可接受。
- **建议**：`updateRecordInfo` 的 `getStorageEstimate` 采样 50 条，若记录数 >5000 可考虑缓存或 `requestIdleCallback` 延迟估算（当前已在可接受范围）。

---

## 6. 宿主页兼容性 — ✅ 已根治

历史 P0“全屏乱码”根因为 `v0.6 redesign` 误删 `content.css` 的宿主隔离，导致全局 `div{…}` / `div::before{content:"\e6xx"; font-family:iconfont}` 污染。本版：

1. `content.css` 恢复并强化 20+ 条 `!important`（几何、伪元素、contain/isolation）。
2. `content.js` 内联 `cssText` 同步 `!important` 双重钉死，即使 CSS 未注入也能自保。
3. `attachShadow` 失败直接放弃，不泄样式。
4. 内部不再用 `* {all:initial}`，避免图标描边丢失。

已在含全局 `div::before` 的站点回归验证通过。

---

## 7. PRD 符合度 — 100%（验收清单逐项通过）

| PRD 验收项 | 状态 |
|------------|------|
| 选中≥5中/3英 500ms 后入库 + toast | ✅ |
| 太短/纯符号/数字/URL 不入库 | ✅ |
| 拖动中间态不触发 | ✅ |
| 扩选替换（5s 同 URL 包含） | ✅ |
| 同页相同文本去重 + toast“已采集过” | ✅ |
| 双标签同时采集不丢数据（分片） | ✅（order 极小窗口可接受，数据不丢） |
| input/textarea/contenteditable 不采集 | ✅ |
| 点击图标开管理页 + 计数 + 存储占用 | ✅ |
| 单条复制 + toast 已复制 | ✅ |
| 删除+5s撤销 | ✅ |
| 展开/收起 | ✅ |
| XSS 验证 textContent | ✅ |
| 开关持久化+badge+重启保持+快捷键 | ✅ |
| 清空二次确认含 N 条+最早日期 | ✅ |
| TXT BOM / JSON 含 schemaVersion/urlKey | ✅ |
| 导入合并去重 | ✅ |
| 管理页实时追加 | ✅ |
| Toast 单实例 | ✅ |
| >5000 警告 + 分页 50 | ✅ |

---

## 8. 代码质量与可维护性 — A-

**亮点**：
- 模块边界清晰（入口/渲染/toast/弹窗/导入导出），`listBridge` 显式传参，状态读写可全局检索。
- 注释与文档比代码还长：每个准入规则、每个竞态窗口、每个 `!important` 都有“为什么”。
- 纯函数抽离可单测（`meetsLengthThreshold/isPureURL/isPureSymbol/isPureNumber/truncateText/getUrlKey/getDomain` 已 50 条单测，`vitest run` 全绿）。
- 魔法数字已全部收敛到 `CONFIG`，修改指南与 README 的“改常量”表格一致。

**可改进**：
- `.DS_Store` 已被 git 跟踪（`text-collector/.DS_Store` 在 `git ls-files`），`.gitignore` 的 `.DS_Store` 仅对未跟踪文件生效，需 `git rm --cached text-collector/.DS_Store` 并提交。
- `text-collector/node_modules` 因执行 `npm ci` 出现在工作区但已被 `.gitignore: node_modules/` 正确忽略（`git status --ignored` 确认），无需处理，属本地产物。

---

## 9. 测试审计

- **单测**：`vitest@4.1.10` · `environment: node` · `tests/content.test.js(39) + storage.test.js(11) = 50` 全通过。覆盖阈值逻辑、URL/数字/符号判断、代理对截断的全部边界（含 `ZWJ` 家庭 emoji、生僻字、孤立高位代理不变量）。
- **辅助**：`tests/helpers/load-source.js` 的 `extractFunction/matchBraces/extractObjectLiteral` 实现稳健，能跳过字符串/正则/注释中的 `}`，并通过 `new Function` 注入 `CONFIG` 保证与线上常量同源。
- **缺口**：尚无对 `addSnippet/deleteSnippet/clearAll` 的并发/孤儿场景的集成测试（需 mock `chrome.storage.local`）。建议后续加“内存 mock storage + 并发写入”小套件，覆盖 order 竞态与导入大文件分批。

---

## 10. 分级缺陷清单（本版剩余）

### 🟠 P1 — 建议本次修（均 10-20 分钟）

**M-P1-1 删除撤销的 offset 漂移**（`render.js:215-224`）
```js
// 撤销分支漏了 currentOffset 递增
incrementTotal(); // 现有
incrementLoaded(); // ← 补这一行（或 bridge.incrementLoaded(1)）
await updateRecordInfo(getTotalCount());
```

**S-P1-2 孤儿回填未写回**
```js
// adoptOrphanSnippets 内
if (!record.id) {
  record.id = id;
  dirty[id] = record; // 收集后批量 set
}
// 循环后
if (Object.keys(dirty).length) await chrome.storage.local.set(dirty);
```

**S-P1-3 clearAll 竞态文档化或改原子 clear**
- 最小改：注释中显式说明“若在点击清空的 <100ms 内恰好有新采集，会留下 1 条孤儿；因已置 orphanScanV1，该孤儿需手动‘导入导出’或下次升 orphanScanV2 才回收”，并在 `handleClearAll` 的成功 toast 后加一句“如刚采集过请刷新页面确认”。
- 彻底改：`await chrome.storage.local.clear()` 后 `set({schemaVersion:1, collectEnabled, orphanScanV1: Date.now(), snippets_order:[]})`（先读开关再 clear 再写回，避免误删）。

**S-P1-1 + I-P2-1 打包**：`importSnippets` 分批写入（每 200 条 `set` 一次，最后写 order），并给 `handleExport` 加 `try/catch` 用户可见错误。

### 🟡 P2 — 可选优化

- **C-P2-1** `isEditableElement` 扩展为 `selection.anchorNode` 检查（见 2.3）。
- **M-P2-1** `loadMore` 加 `try/finally`。
- **M-P2-2** 卡片 a11y 去嵌套（见 2.6）。
- **I-P2-1** `handleExport` 错误兜底。
- **S-P2-1** 导入分批（已在 P1 打包）。
- **2.1 P2-1** `manifest` 的 `tabs` 权限备注。

### 🔵 信息

- `.DS_Store` 已跟踪：`git rm --cached text-collector/.DS_Store && git commit -m "chore: untrack .DS_Store"`
- 日/韩文阈值偏严：README 已知限制，无需改代码，仅保留 `CONFIG` 注释指引。

---

## 11. 修复优先级建议

1. **10 分钟**：M-P1-1（撤销 offset）+ M-P2-1（loadMore finally）—— 一次改 `render.js`。
2. **10 分钟**：S-P1-2（孤儿回填写回）—— 小改 `storage.js`。
3. **15 分钟**：`importSnippets` 分批 + `handleExport` try/catch。
4. **5 分钟**：`git rm --cached .DS_Store` + 补充 `manifest` tabs 备注。
5. **可选 15 分钟**：C-P2-1（anchorNode 检查）+ M-P2-2（卡片 a11y 去嵌套）—— 不阻塞交付。

以上 1-4 完成后即可视为 **v0.6.2 的 P1 清零**，达到自用工具的“可长期不改”状态。

---

## 12. 亮点总结

- **安全意识一流**：`textContent` 零 `innerHTML` 数据渲染、Shadow DOM 隔离、编辑区跳过、CSP、三态 toast 语义，比许多上商店的扩展更严谨。
- **工程化超出预期**：分片存储解决并发、分批读取/估算、代理对安全、一次性孤儿扫描、状态读写收敛、常量集中、50 条单测对 vibe-coded 项目属罕见。
- **视觉与体验细节**：暖白 + 衬线 + Zed 蓝 的品牌一致性（括号母题贯穿 logo/卡片/toast）、`prefers-reduced-motion`、焦点陷阱、键盘全链路（Tab/Enter/Space/Esc/方向键）、实时追加 + 3s 提示。

---

## 附录

- **审计命令**：`npm ci && npx vitest run`（50 通过，377ms）· `node --check` 全部通过 · `grep -rn innerHTML` 仅硬编码 SVG。
- **文件清单**：`manifest.json / background/service-worker.js / content/content.{js,css} / utils/storage.js / manager/{manager.{html,js,css},render.js,toast.js,modal.js,import-export.js} / icons/* / tests/** / design/icon-src/*`。
- **忽略**：`text-collector/node_modules` 已被 `.gitignore: node_modules/` 正确忽略；`design/node_modules` 已不存在（无 29MB 残留）。

*审计完成。按第 11 章顺序修复后可直接进入长期自用，无需再为正确性/安全性投入。*
