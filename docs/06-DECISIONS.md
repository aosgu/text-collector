# 技术决策记录 — 网页文字采集器

> 依据：代码注释（决策意图大多写在源码注释里）、`docs/_facts.md`、当前 README「配置」部分。版本基线：v1.0.1（待办工作台布局微调，2026-08-15）。
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

## F. 网站导航（v0.8.0）

### F1. 决策：站点列表用「包内配置文件」而非前端编辑 UI

- **决策**：导航站点来自扩展包内 `config/nav.json`，管理页只读渲染，**不提供添加/删除/排序的前端界面**，也不写 `chrome.storage.local`。
- **背景（已知）**：`nav.js` 头部注释：「数据源为扩展包内配置文件 `config/nav.json`（无前端编辑功能，通过后台文件配置）」「修改配置文件后刷新管理页即生效」。
- **影响**：零新增存储键、零数据迁移负担，导航与采集数据完全解耦；代价是改站点需要编辑文件并刷新页面（unpacked 扩展场景下成本很低），且配置不随浏览器 profile 同步。
- **置信度：高**（注释 + 代码结构可证）。

### F2. 决策：URL 只放行 `http:` / `https:`，其余一律过滤

- **决策**：`normalizeNavConfig` 用 `new URL()` 解析后检查 `protocol`，非 http/https（`javascript:`、`data:`、`chrome:`、解析失败的相对路径等）的条目直接丢弃。
- **背景（已知）**：注释：「new URL 解析失败或 javascript:/data:/chrome: 等协议一律过滤，**防 XSS**」。
- **影响**：即使配置文件被恶意篡改，也无法通过导航链接注入脚本；代价是无法配置 `chrome://` 内部页面等快捷方式（属刻意取舍）。
- **置信度：高**（有单测覆盖）。

### F3. 决策：配置无效时「整体隐藏导航入口」，而非报错或显示空面板

- **决策**：文件缺失 / HTTP 非 200 / JSON 非法 / 无有效链接 → `console.warn` + `#nav-root` 加 `.hidden`；`initNav()` 外层再包一层 `.catch` 兜底隐藏。
- **背景（已知）**：注释：「配置文件缺失 / 解析失败 / 无有效链接时，导航图标整体隐藏，不影响其他功能」「导航初始化失败绝不影响管理页主功能」。
- **影响**：导航是可选增强，任何失败都不会波及采集与记录管理；代价是配置写错时界面无显式提示，需查 console。
- **置信度：高**。

### F4. 决策：面板渲染全用 `textContent`，不使用 `innerHTML`

- **决策**：`renderNavPanel` 逐个 `createElement` + `textContent` 赋值。
- **背景（已知）**：注释：「全部 textContent，无 innerHTML」；与项目既有安全约定一致（`innerHTML` 仅用于硬编码 SVG 图标常量）。
- **影响**：配置文件中的 `name` 即使含标签也只会作为纯文本显示，与 F2 构成双重防护。
- **置信度：高**。

### F5. 决策：hover 展开 + 200ms 宽限收起，并保留点击/键盘双通路

- **决策**：`NAV_CLOSE_GRACE_MS = 200`，鼠标离开导航区域后延迟收起；同时支持点击切换（触摸设备无 hover）与 Enter/Space/↓/Esc 键盘操作。
- **背景（已知）**：注释：「交互参考 zed.dev 顶部 Resources」「鼠标离开导航区域 200ms 宽限后收起（宽限期内可移入面板）」「点击图标切换开合（触摸设备）」。
- **影响**：鼠标从图标斜向移入面板不会误收起；触摸与键盘用户仍可用；面板是 `#nav-root` 的 DOM 后代，命中测试天然覆盖，无需额外的坐标判断。
- **置信度：高**。

### F6. 决策：nav.js 不接入 manager.js 的 `listBridge` 状态通道

- **决策**：`navOpen` / `navCloseTimer` 为 nav.js 模块内私有变量；nav.js 不读写 manager.js 的任何全局状态，manager.js 也不引用 nav.js。
- **背景（已知）**：注释：「本文件不读写 manager.js 的任何全局状态」；且导航按钮的 click 事件**刻意不 stopPropagation**——注释：「让点击冒泡到 document，使 manager.js 的『点击外部关闭导出菜单』逻辑对导航区域同样生效」。
- **影响**：模块可独立删除/替换；两个下拉（导出菜单、导航面板）的互斥关闭无需显式协调。
- **置信度：高**。

### F7. 决策：面板显式声明 `width: max-content`（v0.8.0 内修复）

- **决策**：`.nav-panel` 除 `position: absolute` + `flex-wrap: wrap` 外，显式声明 `width: max-content`；窄屏 `@media (max-width: 640px)` 的 `position: fixed` 全宽分支用 `width: auto` 覆盖。
- **背景（已知）**：CSS 注释：「绝对定位元素的 shrink-to-fit 以包含块（32px 宽的 `.nav`）为可用宽度，不显式给宽会塌缩到 min-content（= 最宽一列），导致各栏竖着堆叠」。同页 `.dropdown-menu` 未暴露该问题，是因为它有 `min-width: 168px` 且内容窄。
- **影响**：多栏并排显示正确，超宽时仍由 `max-width: min(92vw, 760px)` 收窄换行；新增栏目无需再调宽度。
- **置信度：高**（真实 Chromium 渲染实测：三栏 x = 215/343/474 同一行）。

### F8. 决策：图标只留 `aria-label`，不设 `title`（v0.8.0 内修复）

- **决策**：`#btn-nav` 移除 `title="网站导航"`，保留 `aria-label="网站导航"`。
- **背景**：`title` 会触发浏览器原生 tooltip，与 hover 展开的面板同时出现，视觉上互相干扰。
- **影响**：hover 只展开面板；辅助技术仍可读出按钮名称，无障碍语义不变。
- **置信度：高**。

---

## G. 待办功能（v1.0.0）

### G1. 决策：待办数据与采集记录完全隔离存储

- **决策**：待办功能使用独立的存储键前缀（`todo_lists` / `todo_items_<listId>` / `todo_templates` / `todo_today_list_id`），**不复用** `snip_*` / `snippets_order` / `collectEnabled` 等采集记录键；`utils/todo-storage.js` 与 `utils/storage.js` 互不依赖（两份独立的 `generateUUID`，不共享 `CONFIG`）。
- **背景**：待办清单（多清单 + 事项 + 模板）与采集记录（单条 url + 文本 + 时间戳）是完全不同的领域模型，键混用会让跨模块的 `onChanged` 监听互相干扰；命名空间隔离让两模块可独立演进、独立测试、独立回滚。
- **影响**：待办数据变更不会触发采集相关的 `onChanged` 监听器；采集逻辑也不会因为新增待办而被迫重读全表；两套单测完全隔离。
- **置信度：高**（代码层 `utils/todo-storage.js` 全文 grep 无 `snip_` 引用；`utils/storage.js` 无 `todo_` 引用）。

### G2. 决策：待办与采集共用同一个管理页（同页 Tab 切换），而非独立页面

- **决策**：v1.0.0 不再有独立 `todo.html`。管理页 `manager.html` 通过 hash 路由 `#collect` / `#todo[/...]` 在**同一个 DOM 容器**内切换「采集 tab」与「待办 tab」；待办视图由 `manager/todo.js` 渲染（仍加载为 `manager.html` 的一个 `<script>`）。
- **背景**（用户第七轮纠正前曾有独立 `todo.html`，用户本轮原话「回退到原来的导航条」「只要点击切换就可以」）：待办与采集是同一扩展内的并列功能，开两个页面会让用户记不住入口；同页切换用 hash 路由天然支持深链（`#todo/templates`），不引入路由库。
- **影响**：
  - 一个 tab、一个 url、两个视图；扩展图标点击 → 默认打开采集 tab（`#collect`），与历史行为一致（v0.8.1 起即如此）；
  - 待办模块通过 `window.__managerBridge` 复用采集模块的 toast / confirm / edit 弹窗，**不重复实现**；
  - 待办 tab 下采集开关置灰（`aria-disabled`）防止误操作；
  - 旧版 `todo.html` / `todo/todo.css` 目录已被 v1.0.0 移除（删除 commit `2b681d3` 之前）。
- **置信度：高**。

### G3. 决策：待办模块复用 `manager.css` 的主题变量，待办样式仅追加 `todo-` 前缀类

- **决策**：`manager/todo.css` 不重新定义 `:root` 颜色/字体/间距变量；直接 `import`/链接 `manager.css`（manager.html 的 `<link rel="stylesheet">` 已加载），所有自定义样式以 `.todo-*` 前缀命名避免与采集模块冲突。
- **背景**：同页 Tab 切换（G2）下两视图共享同一文档/样式上下文；为待办单独维护一套主题会导致两套品牌色、两套暗色变量漂移，与「同页切换」体验背离。
- **影响**：
  - 主题色、暗色、字体、间距、过渡时长等全部继承自管理页；
  - 待办新增的「复选框打勾色」「拖拽目标高亮」「模板卡片 hover 阴影」等仅使用 `:root` 中已有的色阶；
  - 未来若需要「仅待办页定制色」，需在 06 / 04 文档先记录决策再改 CSS（当前刻意不做）。
- **置信度：高**（`manager/todo.css` 头部注释 + grep 无自定义 `--*` 变量定义可证）。

### G4. 决策：清单元数据存单键 `todo_lists`；清单下的待办项存每清单一桶 `todo_items_<listId>`

- **决策**：`todo_lists` 是包含所有清单元数据的**单键数组**（id / name / order / createdAt / updatedAt）；每个清单的待办项分别存到 `todo_items_<id>` 独立键（**始终数组**，空清单 = `[]`，**绝不删除键**）。
- **背景**：
  - 清单元数据（创建/重命名）变更频率低，单键数组可一次 `set` 原子完成；
  - 事项的增删改拖非常频繁，按清单分桶后单次写入只影响一个清单，不被其他清单的 onChanged 监听回响；
  - 桶为空也保留键 → 删完所有事项不会产生「键消失导致引用悬挂」，新加事项时直接 push。
- **影响**：
  - `getItems(listId)` 对不存在的 id 视为 `[]` 而非 throw（兼容新建清单空桶边界）；
  - `deleteList(id)` 同步 `remove todo_items_<id>` 清桶；
  - 跨清单汇总视图（全部待办 / 已完成）一次性 `getLists()` + 多次 `getItems(listId)` 串行读；通过 onChanged 整体 reloadFromStorage 触发重渲染。
- **置信度：高**。

### G5. 决策：「今日待办」清单首启惰性创建，按需生成；指针存 `todo_today_list_id`

- **决策**：`getOrCreateTodayList()` 在 todo.js `init()` 阶段调用一次：
  1. 读 `todo_today_list_id`；命中且清单仍在 → 直接返回；
  2. 否则 `createList('今日待办')` → 写指针 → 返回；
  3. 若原 id 对应的清单被删除 → 先清指针，再走创建路径（幂等恢复）。
- **背景**：
  - 避免「每次打开都创建新清单」的累积；
  - 「今日待办」是用户首次进入待办 tab 的默认落脚点，但用户可能根本不用它——惰性创建避免无效清单；
  - 指针独立于 `todo_lists` 数组（不在清单对象上加 `isToday` 字段），保持清单对象纯净，删除/重命名时不会误改标识。
- **影响**：
  - 删除「今日待办」清单是允许的（用户主动选择）——后续首次进入待办 tab 会幂等重建一个同名清单；
  - `todo_today_list_id` 始终指向真实存在的清单或为 null（创建过程中短暂 null 是被设计吸收的）。
- **置信度：高**（`getOrCreateTodayList` 在 `tests/todo-storage.test.js` 中有幂等 / 失效重建覆盖）。

### G6. 决策：模板是「事项文本快照」而非「清单引用」

- **决策**：`saveAsTemplate(listId, name)` 读取清单下所有 `items` → 拍平为 `items.map(content)` 文本数组（**不**保留 id / completed / completedAt / listId / createdAt）→ 写入 `todo_templates`。
- **背景**：
  - 模板是「配方」而不是「实例的引用」——用户期望模板与原清单完全解耦：删原清单、勾完原清单全部事项、修改原清单某条，模板都不应被波及；
  - 反之「复制到当前清单」「基于模板创建新清单」必须生成新 id、新 createdAt——避免 id 冲突和「跨清单 id 重用导致数据混淆」；
  - 文本快照也意味着模板不存储任何时间戳（`createdAt`/`updatedAt` 仅记录模板自身「创建时刻」，与原清单时间无关）。
- **影响**：
  - 同一模板可被任意次复用，每次生成完全独立的新清单；
  - 模板卡片 UI 显示「N 个待办 · 更新于 X」中的「N」是 `items.length` 过滤空字符串后的实际数；
  - 空清单不能存为模板（`onSaveAsTemplate` 先检查 `items.length > 0`，否则 toast 拒绝）。
- **置信度：高**（`saveAsTemplate` / `createListFromTemplate` / `copyTemplateToList` 全部有单测覆盖）。

### G7. 决策：待办不提供搜索/筛选/排序 UI（除按 `order` 字段与 `completedAt` 排序外）

- **决策**：待办 tab 内**无**搜索输入框、**无**按内容过滤、**无**按清单筛选、**无**自定义排序；事项按 `sortItems`（未完成按 `order` 升序、已完成按 `completedAt` 降序）展示，模板按 `createdAt` 降序。
- **背景**（用户确认）：待办定位为「轻量清单管理」而非「全功能任务管理」；搜索会引入新的 UI 复杂度（防抖、跨字段匹配、键盘快捷键）但日常场景很少需要。
- **影响**：
  - 大量事项需滚动浏览；
  - 跨清单汇总（全部待办 / 已完成）也是按 listId 分组后直接渲染，不做内容过滤；
  - 未来若用户提出搜索需求，需单独迭代（此决策下不预留扩展点）。
- **置信度：高**（用户明确）。

### G8. 决策：待办无登录 / 账号 / 云同步；数据 100% 本地

- **决策**：`utils/todo-storage.js` 与 `manager/todo.js` 中**无任何**用户标识、认证、token、网络请求逻辑；数据仅存 `chrome.storage.local`。
- **背景**（用户确认）：扩展为本地工具；登录体系会让数据所有权变得复杂（云端 vs 本地谁为准）；本项目采集模块也是同样的「零外部依赖」原则。
- **影响**：
  - 数据随浏览器 profile 存储；卸载扩展或换浏览器 = 数据不可迁移（`chrome.storage.local` 平台语义，代码无备份/迁移机制）；
  - 「跨设备同步」是本扩展的根本性非目标；
  - 待办与采集共享同一份「零账号零云」立场。
- **置信度：高**（用户明确）。

### G9. 决策：工作台是默认视图（清单详情），「+ 新建清单」与四视图入口都在侧边栏

- **决策**：进入待办 tab 默认渲染工作台（当前清单详情 = 标题 + 进度文字 X/Y + 事项列表 + 输入框）；侧边栏底部三按钮「全部待办 / 已完成 / 模板库」与列表项「+ 新建清单」是切视图入口；URL 同步为 `#todo` / `#todo/all` / `#todo/done` / `#todo/templates` / `#todo/list/<id>`。
- **背景**：工作台（添加今/明日事项）是最高频场景，默认落到工作台缩短点击路径；侧边栏与 hash 路由的组合让视图切换既可点 URL 也可点 UI。
- **影响**：
  - 刷新页面回到工作台（hash 缺省为 `#collect`/`#todo` → 落到当前清单的工作台，hash `#todo/list/<id>` 落到指定清单工作台）；
  - 「删除清单」操作**仅**在工作台顶部可见（侧边栏无删除入口），避免误删；
  - 4 视图在工作台之外是互斥切换（汇总视图下不显示清单工作台的输入框）。
- **置信度：高**。

### G10. 决策：待办视图切换走 hash 路由（`#todo[/...]`），不引入路由库

- **决策**：使用 URL hash 段作为视图状态：`#todo`（工作台）/ `#todo/all` / `#todo/done` / `#todo/templates` / `#todo/list/<id>`。两层路由：
  - `manager.js` `applyRouteFromHash` 负责「采集 ↔ 待办」主视图切换；
  - `todo.js` `handleHashChange` 负责待办内部 4 视图/指定清单切换。
- **背景**：
  - 浏览器原生 hash 路由无需依赖、零 KB、键盘后退/前进自动支持；
  - 与项目「无 SPA 框架 / 无路由库」约定一致（管理页也未引入路由）；
  - `hashchange` 事件 + 直接 `applyRouteFromHash` 兜底，hash 已是目标值时点同一链接也强制应用一次，避免「看起来没反应」。
- **影响**：
  - URL 反映当前状态，可分享/收藏深链（`#todo/templates` 直达模板库）；
  - 浏览器后退可在视图间穿梭（不退出待办 tab）；
  - 协议变更需同步改 `applyRouteFromHash`（manager.js）+ `handleHashChange`（todo.js）两处，是本决策下唯一需要双改的维护成本。
- **置信度：高**。

### G11. 决策：清单不暴露拖拽/↑↓ 入口；待办项仅未完成项可拖拽

- **决策**：
  - 清单侧边栏**无**拖拽手柄、**无**「↑/↓」按钮、**无**右键菜单；`state.lists` 仅按 `TodoList.order` 字段升序展示；
  - 待办项中**未完成**项有拖拽手柄（`.todo-item-handle`），已完成项拖拽被拒绝；
  - 拖拽后 `sortItems` + 整桶 `saveItems` 持久化；新事项追加到未完成末尾（`order = max(未完成)+1`）。
- **背景**（用户首轮明确）：清单排序是低频操作，UI 暴露拖拽会让侧边栏变得拥挤；待办项排序是高频操作（临时调整优先级），需要直观拖拽。
- **影响**：
  - `utils/todo-storage.js` 中 `reorderLists` 接口**不导出**（仅留 `reorderItems`）—— `reorderLists` 函数不暴露给 todo.js；未来若需要「清单排序 UI」需先在 06 改决策；
  - 跨清单拖拽被拒绝（drop target 必须在同一 `ul`）；
  - 已完成项拖拽被拒绝（视觉上 `.todo-item-handle` 在已完成项不出现）。
- **置信度：高**。

### G12. 决策：工作台进度显示为「X / Y」纯文字，无进度条

- **决策**：工作台顶部「进度」字样直接显示 `<已完成> / <总数>`（如 `3 / 8`），**不**渲染 `<progress>` 元素或自定义进度条。
- **背景**（用户首轮明确）：进度条会让 UI 元素变多、移动端横屏体验差、与项目「轻量」定位不符；纯文字更克制、符合管理页整体极简风。
- **影响**：
  - 进度文字**可访问性**：使用 `aria-label="已完成 X 项，共 Y 项"` 让屏幕阅读器读出全句；
  - 视觉上无 fill/track 元素；
  - 未来若用户提出进度条需求，需单独迭代。
- **置信度：高**（用户明确）。

### G13. 决策：扩大待办侧边栏；输入框采用「固定基准 + 收缩优先 + 内容驱动扩展」

- **决策**：待办工作台 `.todo-sidebar` 的桌面宽度设为 **300px**，继续使用 `flex-shrink: 0`；右侧 `.todo-content` 设为 `flex: 1 1 0` + `min-width: 0`，其内容内层最大宽度为 960px。添加事项输入框 `.todo-add-form input` 设为 `flex: 0 1 480px`、`width: 480px` 与 `min-width: 0`；添加按钮设为 `flex: 0 0 28px`。因此输入框以 480px 为基础，容器不足时可收缩，容器变宽时不因剩余空间增长；只有 `resizeAddItemInput` 测得输入文字所需宽度超过 480px 时，才同步上调 inline `width` 与 `flex-basis`。
- **背景（用户明确）**：侧边栏需要更宽的工作区以改善清单名称和导航信息的可读性；添加事项输入框应在正常场景保持稳定宽度，避免宽窗口下空白区被无意义占满，同时仍允许用户输入明显更长的待办文本。
- **影响**：
  - 窄窗口仍保持原有弹性收缩路径，不因 480px 基准造成水平溢出；
  - 用户输入超过基准后，输入框只在右侧 960px 内容区和剩余空间允许的范围内扩大；提交后清空输入值并回到 480px 基准；
  - 添加按钮不参与收缩，始终保持 28px 方形，避免长文本挤压加号；
  - 本决策仅影响管理页运行时 DOM/CSS，不引入数据字段、存储写入、路由或外部依赖；
  - 宽度测量使用浏览器原生 canvas `measureText`，与当前 `fontStyle`、`fontVariant`、`fontWeight`、`fontSize`、`fontFamily` 一致。
- **置信度：高**（用户明确 + `manager/todo.css` / `manager/todo.js` 代码直接可证）。

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
9. **导航配置未来是否需要用户界面/同步能力？**（F1 目前为文件配置；若要跨设备同步需改用 `chrome.storage.sync`，当前无相关代码。）
10. **导航面板是否需要站点图标（favicon）？**（当前仅文字链接；抓取 favicon 会引入外部网络请求，与「零外部请求」定位冲突，未见相关讨论。）
