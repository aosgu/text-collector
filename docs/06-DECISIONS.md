# 技术决策记录 — 网页文字采集器

> 依据：代码注释（决策意图大多写在源码注释里）、`docs/_facts.md`、当前 README「配置」部分。
> 禁止参考 `docs/archive/`。每条决策均标注「已知（代码注释/配置直接写明）」或「推断」。
> 无法从代码确定的决策列于文末「待确认问题清单」。

---

## A. 存储与并发设计

### A1. 决策：分片存储（每条记录独立 key + 全局 order 列表），而非单数组

- **决策**：`snip_<uuid>` 独立存储键 + `snippets_order` 有序 id 列表。
- **背景（已知）**：`storage.js` 头部注释：「每条采集记录独立存为 snip_<uuid>，snippets_order 保存有序 id 列表，**避免单数组在并发写入时相互覆盖**」；`adoptOrphanSnippets` 注释提及「v0.4 单数组写入竞态」为孤儿产生原因之一（历史遗留证据）。
- **影响**：并发写不同记录互不覆盖；代价是引入「order 与 snip_* 不一致」的孤儿问题，需额外扫描兜底（见 A4）。
- **置信度：高**（注释明确 + 代码结构可证）。

### A2. 决策：写入顺序「先写数据，再写索引」

- **决策**：`addSnippet` 先 `set snip_<id>`，后 prepend `snippets_order`。
- **背景（已知）**：注释：「正常流程下 addSnippet 已经先写 snip_* 再写 order，新数据不会成为孤儿」。
- **影响**：最坏情况下产生「有数据无索引」的孤儿（可收领），而非「索引指向不存在数据」的悬空引用（不可恢复）。
- **置信度：高**。

### A3. 决策：order 写入采用「写后校验 + 重试（≤3 次）」

- **决策**：prepend 后重读校验，不在 order 则重试，最多 3 次，20ms 递增退避。
- **背景（已知）**：注释：「写后校验 + 重试把孤儿概率再降一个数量级」「两个标签页几乎同时走到这里时，后写者可能覆盖先写者」。
- **影响**：多标签页并发时 order 覆盖概率显著下降；仍不保证绝对一致，剩余概率由孤儿扫描兜底。
- **置信度：高**。

### A4. 决策：孤儿记录自动收领，24h 节流 + 特殊条件强制扫描

- **决策**：管理页打开时执行 `adoptOrphanSnippets()`：`orphanScanV1` 时间戳节流（24h）；order 为空但仍有 `snip_*` 时强制扫描；缺 `id` 孤儿批量写回（100/批）。
- **背景（已知）**：注释详列产生原因（历史单数组竞态、order 覆盖、clearAll 并发竞态、版本残留）；节流理由：「避免每次打开管理页全量读 5MB」；强制扫描理由：「clearAll 竞态典型」。
- **影响**：历史/并发损坏可自愈；扫描成本受节流约束。
- **置信度：高**。

### A5. 决策：清空全部采用「3 轮校验循环」

- **决策**：`clearAllSnippets` 删除后全量校验残留，最多 3 轮，20ms 间隔。
- **背景（已知）**：代码注释：「校验是否仍有未保存的残留记录」；循环理由为兜底清空与并发写入竞态（与 A3 同源问题）。
- **影响**：极端并发下仍可能残留（3 轮后放弃，无日志标记——代码未记录放弃路径的反馈）。
- **置信度：高**（行为可证；"放弃后无反馈"亦为代码事实）。

### A6. 决策：去重/扩选检查只扫最近 N 条（`DEDUP_CHECK_LIMIT=500`）

- **决策**：`addSnippet` 仅对 order 前 500 条做去重与扩选匹配。
- **背景（已知）**：注释：「避免每次写入都扫全表」。
- **影响**：写入延迟稳定；超过 500 条后的重复/扩选不再被识别（成为新增）。
- **置信度：高**。

### A7. 决策：存储占用估算用均匀采样（`STORAGE_ESTIMATE_SAMPLES=50`）

- **决策**：`getStorageEstimate` 按步长均匀抽样而非取头部 50 条。
- **背景（已知）**：注释：「当记录数远大于采样数时，不再只取前 50 条（可能全为短/长文本导致偏差），而是按步长均匀抽取，使平均值更接近全量」。
- **影响**：估算偏差降低；仍为估算值（显示「约 N KB」）。
- **置信度：高**。

---

## B. 内容脚本与页面隔离

### B1. 决策：toast 采用「light DOM 宿主 + closed Shadow DOM 内部」双层结构，双重钉死样式

- **决策**：宿主 `#text-collector-toast-host` 用内联 `!important` 属性集 + `content.css` 双保险；可见 UI 全在 closed Shadow DOM。
- **背景（已知）**：注释：「修复『选中文字后全屏乱码』」——宿主被页面 CSS（`div{position:fixed;inset:0}`、`div::before` iconfont）污染；「属性集必须与 content.css 保持一致，防止 content.css 因 CSP/扩展加载异常未生效时出现属性漂移」。
- **影响**：页面样式无法污染 toast；代价是两处样式需手动同步（代码注释明确要求）。
- **置信度：高**。

### B2. 决策：Shadow DOM 内禁止 `* { all: initial }`

- **决策**：toast 内部样式只重置 `:host`，不用 `*{all:initial}`。
- **背景（已知）**：注释：「会切断继承并清掉 SVG stroke，导致图标消失/文字异常」。
- **影响**：图标/继承正常；Shadow 内样式仍与页面完全隔离。
- **置信度：高**。

### B3. 决策：attachShadow 失败时放弃 toast，绝不泄样式

- **决策**：`attachShadow` 抛错 → `console.warn` 后 return。
- **背景（已知）**：注释：「极少数页面若禁止 attachShadow，直接放弃 toast，绝不能把样式泄到 light DOM」。
- **影响**：极少数页面无采集反馈（静默），但保证不破坏页面。
- **置信度：高**。

### B4. 决策：NFC 规范化先于长度截断 + 代理对安全截断

- **决策**：`text.normalize('NFC')` 在 `truncateText` 之前；截断点落在高位代理上时回退 1 个 code unit。
- **背景（已知）**：注释：「NFC 规范化必须在长度截断之前执行，避免在 Unicode 组合字符中间截断导致乱码」「绝不在代理对（emoji / 生僻字）中间切断，否则会产生孤立高位代理，显示为 � 乱码」。
- **影响**：中文/emoji 文本不产生乱码残片。
- **置信度：高**（有单测覆盖）。

### B5. 决策：准入长度用「加权混合评分」而非纯字数判断

- **决策**：`中文字数/5 + 英文词数/3 ≥ 1`。
- **背景（已知）**：注释：「纯中文需 ≥5 字、纯英文需 ≥3 词，混合按比例计算」。
- **影响**：中英混排文本可按比例通过阈值（如 3 字 + 1 词即通过）。
- **置信度：高**（单测覆盖）。

### B6. 决策：纯 URL 过滤限定「ASCII 可见字符 + 长度 > 10」

- **决策**：`isPureURL` 仅匹配 `http(s)|ftp|file://` 开头、全 `\x21-\x7E`、长度 > 10。
- **背景（已知）**：注释：「避免把包含链接的普通句子误判为 URL」「URL 内只允许 ASCII 可见字符；含中文/emoji/中文标点的一律按普通文本处理」。
- **影响**：含链接的普通文本仍可采集；非 ASCII 的 URL 按文本处理。
- **置信度：高**（单测覆盖）。

### B7. 决策：页面加载后 2s 保护期跳过选区恢复

- **决策**：`PAGE_LOAD_GRACE_MS=2000` 内的 selectionchange 不采集。
- **背景（已知）**：注释：「跳过页面加载初期的 selection 恢复（浏览器会恢复上次的选区）」。
- **影响**：避免刷新页面时把浏览器恢复的旧选区误存为新记录。
- **置信度：高**。

---

## C. Service Worker 设计

### C1. 决策：SW 不做数据中转，content script 直接读写 storage

- **决策**：采集逻辑在 content script 直接调 `addSnippet` 写 `chrome.storage.local`，不经 SW 转发。
- **背景（已知）**：`service-worker.js` 头部注释：「采集逻辑在 content script 里直接读写 storage，本文件不做中转」。
- **影响**：减少一跳与消息复杂度；代价是 content 与 manager 必须共享 storage.js 逻辑（靠脚本注入顺序）。
- **置信度：高**。

### C2. 决策：SW 顶层兜底同步 badge（不依赖 onInstalled/onStartup）

- **决策**：脚本顶层直接 `chrome.storage.local.get('collectEnabled')` 刷新 badge。
- **背景（已知）**：注释：「onInstalled/onStartup 在某些唤醒场景（SW 被事件唤醒但不是浏览器重启）不会触发……这里在脚本顶层直接读一次 storage 对齐 badge」。
- **影响**：badge 状态在各类 SW 唤醒路径下保持正确。
- **置信度：高**。

### C3. 决策：图标点击「已开则聚焦，未开则新建」

- **决策**：`action.onClicked` → `tabs.query({url: MANAGER_URL})` → 命中则 `tabs.update` 激活 + `windows.update` 聚焦，否则 `tabs.create`。
- **背景（已知）**：注释：「若管理页已经打开，直接切过去，避免重复开 tab」。
- **影响**：避免多开管理页；依赖 `tabs` 权限（manifest 已申请）。
- **置信度：高**。

### C4. 决策：未设置 `default_popup`，管理页整页打开

- **决策**：`manifest.json` 中 `"action": {}`，无 `default_popup`。
- **背景（推断）**：代码无注释说明；效果是点击图标走 `action.onClicked` 打开整页管理页（SW 注释证实此路径）。
- **影响**：管理页拥有完整页面空间（列表/分页/弹窗），非 popup 小窗；图标点击行为与 popup 方案完全不同。
- **置信度：中**（行为高置信，原因推断）。

### C5. 决策：快捷键非全局（manifest 无 `global: true`）

- **决策**：`commands.toggle-collect` 未声明 `global`。
- **背景（已知）**：manifest 无 global 字段（grep 证实）；README「配置」提示：「MV3 非全局快捷键，如需全局需加 `"global": true`」。
- **影响**：`Ctrl+Shift+S` 仅在 Chrome 前台生效（README 使用说明原文）。
- **置信度：高**（行为）；选择非全局的**原因未注释，待确认**。

---

## D. 管理页工程结构

### D1. 决策：单文件 manager.js 拆分为 render/toast/modal/export 多模块

- **决策**：列表渲染、通知、弹窗、导出各自独立文件；`manager.js` 保留编排与状态。
- **背景（已知）**：各文件头部注释：「从原 manager.js 拆分而来」（render.js/toast.js/modal.js/export.js 均注明原位置行号区间）；拆分动机可推断为控制单文件复杂度。
- **影响**：职责边界清晰；依赖方向固定（manager.js 依赖其余四者，其余不反向依赖）。
- **置信度：高**（事实）；拆分动机细节未注释，推断成分低风险。

### D2. 决策：可变状态收敛到 manager.js + listBridge 读写通道

- **决策**：`currentOffset/totalCount/isLoading/ignoreAllOrderChanges` 的一切修改收敛到命名函数（`incrementLoaded`/`setTotalCount`/…），读取走 getter；经 `listBridge` 传给 render.js。
- **背景（已知）**：注释：「便于全局检索改动点」「不在模块间共享可变变量」。
- **影响**：状态变更点可 grep 审计；模块间无隐式共享可变全局。
- **置信度：高**。

### D3. 决策：弹窗默认焦点给「取消」，Enter 尊重当前焦点

- **决策**：`showConfirmModal` 打开后 `cancelBtn.focus()`；Enter 仅在焦点在按钮上时派发点击，否则关闭弹窗（不触发确认）。
- **背景（已知）**：注释：「破坏性操作（清空）绝不应在 Enter 下默认触发确认」「默认焦点给『取消』，避免误按 Enter 直接执行不可撤销操作」。
- **影响**：误触 Enter 不会执行破坏性操作；键盘流程符合安全预期。
- **置信度：高**。

### D4. 决策：卡片 `role="group"` 而非 `role="button"`

- **决策**：卡片 article 用 `role="group"`，内部文本/展开/删除仍为独立可交互元素。
- **背景（已知）**：注释：「P2 修复：卡片不再使用 role=button（避免 button 内嵌 button 的 a11y 嵌套违规）」。
- **影响**：辅助技术语义正确；键盘操作语义改为「卡片自身 Enter/Space 复制」+ 内部元素独立可达。
- **置信度：高**。

### D5. 决策：删除按钮用垃圾桶图标而非「×」

- **决策**：`.card-delete` 内嵌 `ICON_TRASH` SVG。
- **背景（已知）**：注释：「用垃圾桶图标而非 ×，避免被误认为『关闭』」。
- **影响**：语义清晰；图标为硬编码 SVG 常量（无用户输入）。
- **置信度：高**。

### D6. 决策：管理页 toast 单实例（新 toast 顶掉旧 toast）

- **决策**：`toast.js` 持有 `currentToastEl`，新 toast 先移除旧实例。
- **背景（已知）**：文件头注释：「单实例，新 toast 会顶掉上一条」。
- **影响**：高频操作（连续复制）下 UI 不堆积。
- **置信度：高**。

### D7. 决策：管理页整页列表用「卡片 + 分页 50/页 + 实时 prepend」

- **决策**：`PAGE_SIZE=50` 分页加载；onChanged 新记录 prepend 顶部 + 提示条。
- **背景（已知）**：注释：「storage 实时新增时同步递增，避免后续分页重复或遗漏」；提示条 3s 自动隐藏（`newRecordTimer`）。
- **影响**：大数据量下首屏快；实时性靠 onChanged 事件驱动。
- **置信度：高**。

---

## E. 测试与工程

### E1. 决策：用「语法提取纯函数」的方式在 Node 跑单测，而非直接 import 源码

- **决策**：`tests/helpers/load-source.js` 用正则/括号匹配把源码中顶层 `function` 声明体提取出来，经 `new Function` 加载；不执行文件顶层代码。
- **背景（已知）**：注释：「storage.js / content.js 是给浏览器扩展（MV3）用的顶层脚本，靠全局变量互相引用……顶层还会访问 chrome、document、window、crypto 等浏览器 API。直接 import 会立刻执行这些浏览器代码」。
- **影响**：测试环境零浏览器依赖（vitest `environment: node`）；局限：仅支持无闭包依赖的顶层 function 声明（注释明示「若将来函数签名变成箭头函数等写法，这里需要同步更新」）。
- **置信度：高**。

### E2. 决策：CONFIG 常量集中在 storage.js（先于其他脚本加载）

- **决策**：所有阈值常量集中为 `CONFIG` 对象，位于 `utils/storage.js`。
- **背景（推断）**：manifest 把 `utils/storage.js` 排在 content_scripts 首位、manager.html 把它排在最前——content.js 顶部注释：「CONFIG 常量定义在 utils/storage.js 中（manifest 中先于本文件加载）」；README「配置」：「所有采集/存储/UI 阈值常量集中在 utils/storage.js 的 CONFIG 对象里，优先改常量」。
- **影响**：改阈值不用动业务逻辑；测试可提取真实 CONFIG 注入（`extractObjectLiteral`）。
- **置信度：高**（位置/集中度）；「为何不放独立 config 文件」原因未注释，待确认。

### E3. 决策：图标参数化生成（design 工具链），PNG 为产物

- **决策**：图标由 `design/` Node 脚本（sharp）按 `icon-spec.js` 参数生成，仓库内 PNG 为生成产物。
- **背景（已知）**：`design/README.md`：「扩展图标是参数化生成的，不要直接手改 text-collector/icons/ 下的 PNG——那是产物，下次重新生成会被覆盖」；`design/package.json` 提供 `icons`/`preview` 脚本。
- **影响**：图标可复现、可调参（16px 单独调参记录见 design 文档）；改图标需重跑工具链。
- **置信度：高**。

---

## 待确认问题清单

以下问题代码中无依据，无法确定，等确认：

1. **测试框架为何选 vitest？**（代码/README 只显示「用了 vitest」，无选型理由。）
2. **为何不设 `default_popup` 而用整页管理页？**（C4 的行为可证，选型原因未注释。）
3. **快捷键为何不做全局（`global: true`）？**（是刻意避免影响其他应用，还是未考虑？）
4. **`CONFIG` 为何放在 `storage.js` 而非独立配置文件？**（依赖加载顺序可解释，但原始动机未注释。）
5. **SCHEMA_VERSION 恒为 1，未来数据迁移策略是什么？**（导出 JSON 携带 schemaVersion 但当前无读取/迁移逻辑。）
6. **卸载前是否有数据导出引导？**（代码无卸载相关处理；当前精简版 `text-collector/README.md` 亦无「卸载后数据丢失/建议备份」提示——已 grep 验证。数据随 `chrome.storage.local` 随浏览器 profile 存储为平台语义，代码无任何备份/迁移机制。）
7. **design 工具链（sharp 版本 `^0.35.3`）的兼容基线**（Node 版本要求未记录）。
8. **`<all_urls>` + `all_frames: false` 的覆盖范围是否有意为之？**（iframe 不采集是 manifest 事实；是否为产品决定未注释。）
