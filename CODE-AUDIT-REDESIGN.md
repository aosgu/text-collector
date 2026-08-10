# 代码审计报告 — Redesign v0.6（方案 E · 轻霜 × Zed）

- **分支**：`arena/019fe91f-text-collector`
- **审计范围**：本次 redesign 涉及的全部变更（manager 三件套、content toast、service-worker、icons）
- **审计方法**：逐文件静态审查 + `node --check` 语法校验 + 资源完整性检查 + 安全/并发/UX 交叉验证
- **审计日期**：2026-08-10

## 0. 结论速览

| 等级 | 数量 | 说明 |
|------|------|------|
| 🔴 **P0 必须修** | 1 | 视觉 Bug：开关状态文字会显示成「ONON」/「OFFOFF」 |
| 🟠 **P1 建议修** | 5 | 重复勾图标、版本号未更新、危险操作文案含 ✓、孤儿数据扫描性能、并发竞态 |
| 🟡 **P2 可优化** | 6 | 冗余 DOM、无 .gitignore、init 缺错误兜底、模态 keydown 清理、toast 重复调用、storage 回调无错误处理 |
| ✅ 通过项 | — | XSS 安全、CSP、权限、图标尺寸、Shadow DOM 隔离、textContent 规则、撤销/并发保护 |

**整体评价**：redesign 落地质量良好，JS 全部通过 `node --check`，所有静态资源到位，XSS / 权限 / CSP 等核心安全项没有回退。只有 1 个肉眼可见的 P0 视觉 bug（开关文字重复）必须在交付前修掉，其余按优先级处理即可。

---

## 1. 🔴 P0 — 必须修复

### 1.1 开关状态文字双重渲染，会显示「ONON」

**文件**：`manager/manager.html:46` + `manager/manager.css:296-298`

HTML 里已经有静态文字：
```html
<span class="toggle-state">ON</span>
```
CSS 又用 `::before` 内容追加了一遍：
```css
.toggle.off .toggle-state::before { content: "OFF"; }
.toggle.on  .toggle-state::before { content: "ON";  }
```
两者叠加会渲染成 **「ONON」**（开）或 **「OFFOFF」**（关）。这是这次重构 CSS 时引入的回归。

**修复建议（二选一）**：
- 推荐：清空 HTML 静态文字，让 CSS 全权负责 —— 把 `<span class="toggle-state">ON</span>` 改成 `<span class="toggle-state"></span>`，同时为无障碍加 `aria-label`；
- 或者：删掉两条 `::before { content: ... }` 规则，让 `updateToggleUI()` 像旧版那样直接 `textContent = 'ON'/'OFF'`。

我建议第一种（CSS 方案），并让 `toggle-state` 加 `aria-hidden="true"`，避免屏幕阅读器读到重复文本。

---

## 2. 🟠 P1 — 建议本次修

### 2.1 采集 toast 的「已采集 ✓」与蓝色勾徽标重复

**文件**：`content/content.js:135-139`

新 toast 左侧已经有一个蓝色方块勾图标，但文案仍保留了旧版的 `✓` 字符：
```js
showToast('已采集 ✓');   // 135, 137
showToast('已采集过');   // 139
```
视觉上会同时出现一个蓝色勾 + 一个文字勾，重复且不统一（管理页 toast 已经没有字符勾）。

**建议**：去掉文案里的 ` ✓`，三态统一为：
- 成功：`已采集`（徽标带勾）
- 替换：`已采集`（同上，不区分）
- 去重：`已采集过`（徽标建议换成中性 info 图标，弱化提示）
- 失败：`采集失败`（徽标红色感叹号）

注意：当前 `showToast(message)` 只接受文案，不接受 kind 参数。建议顺手把 content toast 也支持 `kind` 字段（与 manager 一致），让「已采集过」显示 info 灰徽标、「采集失败」显示红徽标——现在它们三个全是蓝色勾，语义丢失。

### 2.2 manifest 版本号未同步

**文件**：`manifest.json:4`

```json
"version": "0.5.0"
```
README / PRD 里也写的是 v0.5，但本次已经是完整的视觉重设计，按语义化版本应该升到 `0.6.0`。自用工具不发布商店，但版本号能让你日后一眼看出在跑哪一版。

**建议**：改为 `"version": "0.6.0"`。同时 PRD 顶部可以加一行 v0.6 的变更记录。

### 2.3 「采集失败」也显示蓝色成功勾，语义错误

**文件**：`content/content.js:142`

```js
.catch(() => { showToast('采集失败'); });
```
但 `showToast` 内部无条件渲染蓝色 `#2f6fed` 成功徽标 + 勾选 path。错误反馈用蓝色勾会误导用户。

**建议**：与 2.1 一起，给 content toast 加 kind 参数：
```js
function showToast(message, kind = 'success') { ... }
```
- `success`：蓝勾（已采集）
- `info`：灰圆点（已采集过）
- `danger`：红感叹号（采集失败）

这与 `manager.js` 的 toast API 完全一致，未来两边可以抽成共享函数（目前不需要，content script 有隔离）。

### 2.4 `adoptOrphanSnippets()` 全量扫描 storage，每次打开管理页都跑

**文件**：`utils/storage.js:51`

`init()` 一进来就调用 `adoptOrphanSnippets()`，它执行 `chrome.storage.local.get(null)`（读全部分片），然后用 `startsWith('snip_')` 扫描。自用场景数据量不大时没问题，但：
- 5000+ 条时，每次打开管理页都要全量读 ≈ 5MB+ 数据到内存；
- 它是为「修复早期并发 bug 遗留的孤儿」设计的，但 `addSnippet` 现在已经是「先写 snip_*，再读 order 再写 order」，新产生孤儿的概率本应很低；
- 它和 `loadMore` 同时发生，可能造成首屏短暂卡顿。

**建议（任选）**：
- 加一个 `orphanScanVersion` 标记，每个 schema 版本只扫描一次（最稳）；
- 或者把扫描放到 `requestIdleCallback` / `setTimeout(..., 500)` 里，不阻塞首屏；
- 至少在扫描前先读一次 `snippets_order`，如果 order 长度和实际 snip_* key 数一致就跳过全量遍历。

这不是本次 redesign 引入的，但审计范围内顺手提。

### 2.5 `addSnippet()` 仍有 order 写入竞态窗口

**文件**：`utils/storage.js:144-153`

```js
// 先写 snip_<id>
await chrome.storage.local.set({ [`snip_<id>`]: record });
// 再读 order → 再写 order
const latest = (await chrome.storage.local.get('snippets_order')).snippets_order || [];
await chrome.storage.local.set({ snippets_order: [id, ...latest] });
```
两个标签页几乎同时新增时：
1. A、B 都写入各自的 `snip_*`（不冲突 ✅）
2. A 读到 `[old]`，B 也读到 `[old]`
3. A 写 `[A, old]`，B 写 `[B, old]` → **A 从 order 中丢失**（但 snip_A 数据还在，下次 orphan 扫描能捞回来）

这正是 PRD 3.6.1 节描述想解决的问题，但当前方案只把「数据丢失」降级为「order 丢失 + 孤儿可恢复」，并没有彻底消除并发覆盖。在单用户单设备的实际场景里两个标签 500ms 内同时新增的概率极低，且有 orphan 扫描兜底，所以风险可接受。

**建议**：
- 自用场景下留个 TODO 注释即可；
- 彻底解决需要在 storage.js 里做一个内存写队列（所有 order 写入串行化），代价不大，可作为 P2 后续。

---

## 3. 🟡 P2 — 可选优化

### 3.1 冗余的 `#record-count` DOM

**文件**：`manager/manager.html:42`

```html
<span id="record-count" class="record-info"></span>
```
`manager.js` 已经把计数渲染到 `#page-sub`（页面标题下方），不再引用 `record-count`；CSS 里也没有 `.record-info` 规则。这是 dead DOM。

**建议**：删掉这一行，同时删掉 toolbar 里它占的间距。

### 3.2 仓库根目录无 `.gitignore`，`design/node_modules/`（29MB）未被忽略

**文件**：`design/node_modules/`（29 MB，sharp 及其原生依赖）

`design/` 是设计稿目录，里面为了生成图标临时 `npm install sharp`，但 `node_modules/` 不应该进仓库。当前没有 `.gitignore`，如果 `git add .` 会把 29MB 二进制依赖加进去。

**建议**：在仓库根加 `.gitignore`：
```gitignore
# 依赖
node_modules/

# 系统/编辑器
.DS_Store
*.swp
.vscode/
.idea/

# 构建产物
*.log
```
另外 `design/package.json` + `design/package-lock.json` 可以保留（让图标构建可复现），`design/node_modules/` 必须忽略。

### 3.3 `init()` 没有顶层 catch，存储异常会静默吞掉

**文件**：`manager/manager.js:566`

```js
init();
```
如果 `adoptOrphanSnippets()` / `loadFirstPage()` 抛错（比如 storage 损坏、配额满），页面会一直停在空白状态，用户什么都看不到。

**建议**：
```js
init().catch(err => {
  console.error('[text-collector] init failed:', err);
  $list.innerHTML = '';
  $emptyState.classList.remove('hidden');
  $emptyState.querySelector('.empty-title').textContent = '加载失败';
  $emptyState.querySelector('.empty-sub').textContent =
    '存储读取异常，请尝试重启浏览器；如持续出现请在扩展管理页重置本地数据。';
});
```

### 3.4 确认弹窗的全局 `keydown` 监听器只在 Escape 时移除

**文件**：`manager/manager.js:385-391`

```js
document.addEventListener('keydown', function onKey(e) {
  if (e.key === 'Escape') {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
});
```
- 用户点「取消」或「确定」时，`overlay.remove()` 但 `onKey` 仍挂在 document 上（之后按任何键都会再跑一次 `if (e.key==='Escape')`，虽然 `overlay.remove()` 已 no-op，但监听器本身泄漏）；
- 多次打开/关闭弹窗会累积多个 detached listener。

**建议**：封装一个 `close()` 函数统一清理：
```js
function close() {
  overlay.remove();
  document.removeEventListener('keydown', onKey);
}
// 取消 / 确定 / 遮罩点击全部调用 close()
```

### 3.5 `showToast` 在 manager 端没有单实例限制

**文件**：`manager/manager.js:268`

content toast 有 `if (toastHost) toastHost.remove()` 保证同时只有一个；但 manager toast 是 append 到 `#toast-container`，快速触发会堆出一屏 toast（比如连点导出/复制/删除撤销）。当前每个 toast 1.6s 后自动消失，但视觉上可能叠 3-4 个。

**建议**：manager toast 也做单实例——同 kind 的新 toast 顶掉旧的，或者整个容器只保留最新一个。content 端已经做对了，可以对齐。

### 3.6 content.js 读取 `collectEnabled` 用回调式，无错误处理

**文件**：`content/content.js:19`

```js
chrome.storage.local.get('collectEnabled', (data) => {
  collectEnabled = data.collectEnabled !== false;
  isInitialized = true;
});
```
- 如果 `chrome.storage` 出错（扩展上下文失效、用户在私密模式禁用），回调不触发，`isInitialized` 永远是 false，所有选中都被静默忽略，用户无从知晓；
- manifest 用了 callback，与文件其他地方的 promise 风格不一致。

**建议**：
```js
chrome.storage.local.get('collectEnabled')
  .then(data => {
    collectEnabled = data.collectEnabled !== false;
    isInitialized = true;
  })
  .catch(err => {
    console.warn('[text-collector] storage init failed, fallback to enabled', err);
    isInitialized = true;  // 失败时默认开启，避免完全不工作
  });
```

### 3.7 （可选）`setBadgeTextColor` 在旧版 Chrome 上不存在

**文件**：`background/service-worker.js:72`

```js
await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
```
已经用了可选链 `?.` 做兼容性保护，写法正确，仅提示：Chrome 108+ 才支持，在更老的版本上 badge 文字会用浏览器默认色（通常黑色），不影响功能。

### 3.8 （可选）`content.css` 已经实质为空

**文件**：`content/content.css`

只有一条 `#text-collector-toast-host { all: initial; }`，但现在 host 元素的样式完全由内联 `cssText` + Shadow DOM 内部接管，这条外部规则在 Shadow DOM 下既作用不到 host 内部，对 host 本身也被内联样式覆盖，是死代码。

**建议**：可以把 `content.css` 清空成一行注释说明样式在 Shadow DOM 内，或者干脆从 `manifest.json` 的 `content_scripts[].css` 里移除。保留也无害。

---

## 4. ✅ 审计通过项（不需要改）

### 4.1 安全

- **XSS 防护到位**：
  - `manager.js:155` 采集文本用 `textContent` 渲染 ✅
  - 所有用户/采集文本（标题、body、toast 文案、modal body、新记录提示）全部 `textContent` ✅
  - 静态字符串里的 `<` `>` 已经是 HTML entity，不经过 innerHTML ✅
  - 唯一的 `innerHTML` 用法（`manager.js:180, 283-285`、`content.js:283`）注入的是**硬编码 SVG 常量**（`ICON_TRASH` / `ICON_CHECK` / `ICON_ALERT` / `ICON_INFO` / 勾 path），无任何外部拼接，安全 ✅
- **CSP**：`manifest.json` 仍保留 `script-src 'self'; object-src 'self'` ✅
- **Shadow DOM 隔离**：toast 用 `mode: 'closed'`，第三方页面无法访问/篡改 ✅
- **z-index**：`2147483647`（int32 max），不会被页面其它元素盖住 ✅
- **toast `pointer-events: none`**：不拦截用户点击/选择 ✅
- **删除/清空二次确认**：清空走 modal + 记录数 + 最早日期，单条删除有 5 秒撤销 ✅

### 4.2 权限 / Manifest

- `permissions` 只有 `storage` + `unlimitedStorage`，没有 `<all_urls>` 之外的多余权限 ✅
- `action: {}` 为空，不设 `default_popup`，`chrome.action.onClicked` 能正常触发 ✅
- `host_permissions: ["<all_urls>"]` 与 content script 注入需求一致 ✅
- `all_frames: false`，不注入 iframe，避免广告 iframe 噪音 ✅
- 命令 `toggle-collect` 与 service-worker 监听一致 ✅
- CSP 配置正确 ✅

### 4.3 图标

- 三个尺寸（16/48/128）全部是正确的正方形 PNG（已用 Python 校验头信息）✅
- 文件大小合理（362 B / 1.1 KB / 3.0 KB）✅
- `manifest.json` 路径正确 ✅
- 视觉上：白底圆角 + Zed 蓝括号 + 深色横线，在浅色工具栏上识别度好，缩小到 16px 仍可辨认 ✅

### 4.4 采集逻辑（storage.js / content.js）

- selectionchange + 500ms 防抖，合并扩选中间态 ✅
- 编辑区域检测穿透 Shadow DOM（`getActiveElement`）✅
- 长度阈值：中文 5 / 英文 3 的加权计算正确 ✅
- NFC 归一化在比较前执行 ✅
- 去重优先于扩选替换，与 PRD 3.5 一致 ✅
- 最大长度 5000 截断 ✅
- URL key 用 `origin + pathname`，忽略 query/hash ✅
- 导出 TXT 含 UTF-8 BOM（Windows 记事本兼容）✅
- 导入校验 `schemaVersion ≤ 当前版本`，合并去重 ✅
- 删除支持 5 秒撤销，且恢复到原始位置（含 originalIndex）✅
- 删除期间设置 `ignoreAllOrderChanges`，避免 onChanged 重复追加 ✅

### 4.5 管理页交互

- 开关切换：click + Enter/Space 都能触发（`role="switch"` + tabindex）✅
- 导出下拉菜单点击外部关闭（`document.click`），并在按钮上 `stopPropagation` 防止自触 ✅
- 卡片展开/收起、点击复制、hover 删除按钮三种操作互不冲突（都有 `stopPropagation`）✅
- 新记录实时追加到头部，`currentOffset++` 防止后续滚动加载重复 ✅
- 加载更多每页 50 条，isLoading 防重入 ✅
- 空状态有图标、标题、说明三档信息层级，比旧版 emoji 精致 ✅
- `prefers-reduced-motion` 时禁用所有动画/过渡 ✅
- 移动端 breakpoint 640px，触摸设备上删除按钮常驻（无 hover）✅
- 文本选择高亮色用品牌蓝（`::selection`），细节统一 ✅

### 4.6 视觉规范一致性

- 三色（蓝 / 红 / 灰）在 manager toast 和 content toast 中用法一致（content 还差 kind 参数，见 2.1/2.3）
- 所有圆角走 5/7/10/12 四档 token
- 字体层级：衬线只用于页面标题 / 模态标题 / 空状态标题 / 品牌名，正文一律无衬线
- 卡片左侧括号标记、toast 蓝徽标、品牌 logo 三处使用同一「括号 + 横线」视觉母题，形成品牌统一
- 开关、主按钮、链接色全部使用 `#2f6fed`，无散乱颜色

---

## 5. 修复优先级建议

我可以直接按以下顺序帮你修，你点头我就动手：

1. **P0**：修开关「ONON」双重渲染（5 分钟）
2. **P1**：content toast 加 kind 参数，去掉「✓」字符，「已采集过」用灰徽、「采集失败」用红徽（15 分钟）
3. **P1**：manifest 升 0.6.0；README / PRD 加一行 changelog（5 分钟）
4. **P2**：删除 `#record-count` 死 DOM、加 `.gitignore`、`init()` 加错误兜底、modal 清理 keydown listener（15 分钟）

**P1 中 2.4（孤儿扫描性能）和 2.5（order 竞态）** 属于底层改动，需要单独测并发，建议另开一轮，不阻塞这次 redesign 交付。

---

## 6. 文件变更清单

本次 redesign 实际改动文件（`git diff --stat`）：

```
text-collector/background/service-worker.js |   5 +-
text-collector/content/content.js           | 140 ++++++--
text-collector/icons/icon128.png            | Bin
text-collector/icons/icon16.png             | Bin
text-collector/icons/icon48.png             | Bin
text-collector/manager/manager.css          | 662 ++++++++++++++++++--------
text-collector/manager/manager.html         |  51 ++-
text-collector/manager/manager.js           | 372 ++++++++--------
8 files changed, 750 insertions(+), 480 deletions(-)
```

未跟踪：`design/`（设计稿与 SVG 源文件，建议保留但加 .gitignore 忽略 node_modules）。
