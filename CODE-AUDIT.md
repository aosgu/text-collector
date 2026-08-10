# 网页文字采集器 — 全量代码审计报告

> 审计日期：2026-08-10
> 审计范围：v0.5.0 全部源码（manifest.json + 7 个 JS/CSS/HTML 文件）
> 审计维度：安全性 · 正确性 · 性能 · 代码质量 · PRD 符合度

---

## 📊 总体评价

**整体质量：良好 (B+)**

作为一个 vibe-coded 的个人工具，代码结构清晰、安全意识强、PRD 覆盖完整。没有发现高危安全漏洞。以下按严重程度分类列出所有发现。

| 严重程度 | 数量 |
|---------|------|
| 🔴 高   | 0    |
| 🟡 中   | 3    |
| 🔵 低   | 8    |
| ⚪ 建议 | 5    |

---

## 🔴 高严重度（安全漏洞）

**无。** 代码在安全方面做得很好：
- ✅ 管理页渲染使用 `textContent`，未使用 `innerHTML` 渲染用户数据
- ✅ Toast 使用 Shadow DOM (`mode: 'closed'`) 隔离
- ✅ 跳过所有编辑区域（自动覆盖密码框）
- ✅ 不加载任何远程资源，无 `eval`/`Function` 调用
- ✅ CSP 配置正确

---

## 🟡 中严重度（正确性问题）

### M1. `snippets_order` 并发写入竞态条件

**文件：** `utils/storage.js` — `addSnippet()` / `deleteSnippet()` / `clearAllSnippets()`

**问题：** 分片存储解决了 `snip_*` 数据的并发覆盖问题，但 `snippets_order` 仍然是一个单独的大数组，使用 read-modify-write 模式更新。两个标签页同时采集时，后写入的会覆盖先写入的 order 更新，导致先写入的 snippet ID 从 order 中丢失（成为「孤儿数据」）。

**复现场景：**
```
Tab A: 读 order = [id2, id1]
Tab B: 读 order = [id2, id1]
Tab A: 写 order = [id3, id2, id1]  ← id3 加入
Tab B: 写 order = [id4, id2, id1]  ← id3 丢失！
```

结果：`snip_id3` 数据仍在 storage 中，但 manager 页和导出都看不到它。

**影响：** 个人使用场景下发生概率低（需要 ~同一时刻在两个标签页选中文本），但一旦发生数据不会丢失只是不可见。

**修复建议：**
```js
// 方案 A：写入时只追加 order，使用 chrome.storage.local 的事务特性
// 方案 B：定期清理孤儿数据（对比 order 和实际 snip_* keys）
// 方案 C（推荐，简单实用）：接受这个 trade-off，因为实际触发概率极低
```

---

### M2. Toast 竞态导致短暂双 Toast 叠加

**文件：** `content/content.js` — `showToast()`

**问题：** `showToast` 的超时清理回调中无条件执行 `toastHost = null`。如果在 1.5s+0.2s 的窗口内连续调用 `showToast`，旧 toast 的清理回调会把新 toast 的引用清空，导致下一次调用时无法正确移除当前 toast。

**代码位置：**
```js
setTimeout(() => {
  toast.classList.remove('show');
  setTimeout(() => {
    if (host.parentNode) {
      host.remove();
    }
    toastHost = null;  // ← 可能清除新 toast 的引用
  }, 200);
}, 1500);
```

**修复：**
```js
setTimeout(() => {
  if (host.parentNode) {
    host.remove();
  }
  if (toastHost === host) {  // ← 只清理自己的引用
    toastHost = null;
  }
}, 200);
```

---

### M3. 去重仅检查最近 50 条记录

**文件：** `utils/storage.js` — `addSnippet()`

**问题：** 去重和扩选替换只读取 `order.slice(0, 50)` 即最近 50 条记录。如果用户在同一个页面上先采集了一段文本，然后采集了超过 50 条其他页面的内容后回到同一页面再次采集相同文本，不会被检测为重复。

**影响：** 可能产生少量重复记录。对个人工具来说影响较小。

**修复建议：** 如果记录数不太多（<1000），可以扩大检查范围或全量检查。或者在 manager 页增加手动去重功能。

---

## 🔵 低严重度

### L1. 混合语言文本的阈值判断偏严

**文件：** `content/content.js` — `meetsLengthThreshold()`

**问题：** 中英混合文本（如 "hello 世界 test"）会被分别计数：2 个中文字 + 2 个英文词，两者都不满足阈值（≥5 中文 / ≥3 英文），导致被过滤。

**建议：** 可以考虑加权混合计算，如 `chineseChars/5 + englishWords/3 >= 1`。

---

### L2. `window._newRecordTimer` 全局变量污染

**文件：** `manager/manager.js`

**问题：** 使用 `window._newRecordTimer` 存储定时器 ID，污染全局命名空间。

**建议：** 改用模块作用域变量：
```js
let newRecordTimer = null;  // 在文件顶部声明
```

---

### L3. 导入记录字段校验不完整

**文件：** `utils/storage.js` — `importSnippets()`

**问题：** 导入时只校验 `text`、`urlKey`、`capturedAt` 三个必填字段。缺失 `url`、`title`、`domain` 等字段的记录会被正常导入，导出时这些字段为 `undefined`，JSON 中会缺失。

**建议：** 补充默认值填充：
```js
newEntries[`snip_${id}`] = {
  url: '', title: '', domain: '', lastSelectedAt: snip.capturedAt,
  ...snip, id
};
```

---

### L4. `getAllSnippets` 大数据量性能

**文件：** `utils/storage.js` — `getAllSnippets()`

**问题：** 一次性读取所有记录。当记录数超过数千条时，`chrome.storage.local.get(所有ID)` 可能较慢（Chrome 对单次 get 的 key 数量有限制和性能开销）。

**建议：** 导出时改为分批读取（每批 100 条），拼接结果。

---

### L5. 存储估算精度有限

**文件：** `utils/storage.js` — `getStorageEstimate()`

**问题：** 仅采样前 10 条记录估算平均大小。如果前 10 条恰好很短而后续记录很长（或反过来），误差会很大。

**建议：** 采样更多记录（如 50 条），或随机采样。

---

### L6. `clearAllSnippets` 并发安全问题

**文件：** `utils/storage.js` — `clearAllSnippets()`

**问题：** 清空操作先读取 order，再删除所有 keys。如果在读取和删除之间有新记录写入，新记录可能丢失（其 ID 在写入的 `snippets_order` 中，但随后被 `remove('snippets_order')` 删除）。

**影响：** 极低概率（需要在点击"清空"的瞬间恰好有新采集触发）。

---

### L7. 无孤儿数据清理机制

**文件：** 全局

**问题：** 由于 M1 的竞态条件，storage 中可能存在 `snip_*` 数据存在但不在 `snippets_order` 中的「孤儿」记录。没有定期清理机制，这些数据会永久占用存储空间。

**建议：** 在 manager 页或 service worker 中增加一个「清理孤儿数据」的功能（对比 storage 中所有 `snip_*` keys 和 `snippets_order` 中的 ID）。

---

### L8. `isPureURL` 判断逻辑可被绕过

**文件：** `content/content.js` — `isPureURL()`

**问题：** 仅检测 `http://` 和 `https://` 开头的 URL。如果用户选中一个包含 `ftp://` 或 `file://` 的纯 URL 文本，不会被过滤。另外，判断条件中 `nonUrlChars === 0` 只检查中文字符，不含其他非 URL 字符（如中文标点、emoji 等）。

**建议：** 改为更全面的非 URL 字符检测，或直接用 URL pattern 全匹配。

---

## ⚪ 建议改进

### S1. 魔法数字散落各处

以下数值在代码中以字面量出现，建议提取为常量：

| 数值 | 含义 | 出现位置 |
|------|------|---------|
| 500 | 防抖延迟 (ms) | content.js |
| 2000 | 页面加载保护期 (ms) | content.js |
| 5000 | 最大文本长度 | content.js |
| 5000 | 扩选替换窗口 (ms) | storage.js |
| 50 | 去重检查范围 | storage.js |
| 50 | 分页大小 | manager.js |
| 5000 | 存储警告阈值 | manager.js |

**建议：** 创建 `config.js` 或在 `storage.js` 顶部集中定义。

---

### S2. content.css 的 `all: initial` 实际效果有限

**文件：** `content/content.css`

```css
#text-collector-toast-host {
  all: initial;
}
```

这条规则被 `content.js` 中的 inline style (`host.style.cssText`) 覆盖（inline style 优先级更高）。实际起作用的只有 inline style。不过 `all: initial` 对非 inline 属性（如 `font-family`、`line-height` 等继承属性）有重置作用，所以并非完全无用，但效果有限。

---

### S3. `document.execCommand('copy')` 降级方案已废弃

**文件：** `manager/manager.js` — `copyToClipboard()`

`document.execCommand('copy')` 是已废弃的 API。现代浏览器（Chrome 66+）都支持 `navigator.clipboard.writeText`。降级方案在扩展的 manager 页面中不太可能触发（manager 页面始终是 https 上下文）。

**建议：** 可以移除降级方案，或替换为更现代的 fallback。

---

### S4. 缺少单元测试

作为 vibe-coded 项目可以理解，但核心逻辑（去重、扩选替换、准入规则）的边界条件较多，建议至少对 `storage.js` 的关键函数编写单元测试。

---

### S5. 可考虑添加 `webAccessibleResources`

当前不需要，但如果将来需要让管理页与其他页面通信（如通过 `runtime.sendMessage`），可能需要配置此字段。目前不需要改动。

---

## ✅ PRD 符合度检查

| PRD 要求 | 实现状态 | 备注 |
|---------|---------|------|
| selectionchange + 500ms 防抖 | ✅ 完整实现 | |
| 采集准入规则（长度阈值） | ✅ 完整实现 | 中文≥5/英文≥3 |
| 扩选替换（同URL 5秒内） | ✅ 完整实现 | |
| 纯符号/数字/URL 过滤 | ✅ 完整实现 | |
| 去重（同urlKey + 同文本） | ✅ 完整实现 | 仅检查最近50条 |
| 文本预处理（trim + NFC） | ✅ 完整实现 | |
| 跳过编辑区域 | ✅ 完整实现 | |
| 最大长度截断 5000 | ✅ 完整实现 | |
| Toast 反馈 | ✅ 完整实现 | Shadow DOM 隔离 |
| 采集开关 + 持久化 | ✅ 完整实现 | |
| 图标 badge 状态 | ✅ 完整实现 | |
| 全局快捷键 Ctrl+Shift+S | ✅ 完整实现 | |
| 管理页列表展示 | ✅ 完整实现 | |
| 单条复制 | ✅ 完整实现 | |
| 删除 + 撤销 | ✅ 完整实现 | |
| 展开/收起 | ✅ 完整实现 | |
| 导出 TXT（UTF-8 BOM） | ✅ 完整实现 | |
| 导出 JSON（含 schemaVersion） | ✅ 完整实现 | |
| 导入 JSON（合并去重） | ✅ 完整实现 | |
| 清空全部（二次确认） | ✅ 完整实现 | 含最早日期 |
| 实时更新 | ✅ 完整实现 | storage.onChanged |
| 滚动加载更多 | ✅ 完整实现 | 每页50条 |
| 5000条存储警告 | ✅ 完整实现 | |
| XSS 安全（textContent） | ✅ 完整实现 | |
| 分片存储 | ✅ 完整实现 | |
| schemaVersion | ✅ 完整实现 | |

**PRD 覆盖率：100%**（所有 P0/P1 功能均已实现）

---

## ✅ 亮点

1. **安全意识强**：`textContent` 渲染、Shadow DOM 隔离、编辑区域跳过（自动覆盖密码框）
2. **架构设计合理**：分片存储解决并发写入、Service Worker 职责清晰
3. **用户体验细节好**：扩选替换、防抖避免中间态、toast 同时最多1个、删除撤销
4. **PRD 和代码高度一致**：所有描述的功能都已实现，没有遗漏
5. **代码注释充分**：中文注释清晰，每个函数都有说明
6. **防御性编程**：多处 `|| []` 默认值、`try/catch` 错误处理

---

## 🔧 修复记录

所有中等问题和低严重度问题已修复。修复涉及 3 个文件：
`utils/storage.js` · `content/content.js` · `manager/manager.js`

| 编号 | 修复方案 | 修改文件 |
|------|---------|---------|
| **M1** | `addSnippet` 拆为两步写入：先写 `snip_*`（key 互不冲突），再重新读取最新 order 后追加，缩小竞态窗口 | `storage.js` |
| **M2** | Toast 清理回调改为条件清理：`if (toastHost === host) toastHost = null`，只清理自己的引用 | `content.js` |
| **M3** | 去重检查范围从 50 扩大到 500（`CONFIG.DEDUP_CHECK_LIMIT`） | `storage.js` |
| **L1** | 混合语言阈值改为加权计算：`chineseChars/5 + englishWords/3 >= 1` | `content.js` |
| **L2** | `window._newRecordTimer` 替换为模块作用域变量 `newRecordTimer` | `manager.js` |
| **L3** | 导入时补充 `url`/`title`/`domain`/`lastSelectedAt` 默认值，确保记录结构完整 | `storage.js` |
| **L4** | `getAllSnippets` 改为分批读取（每批 100 条），避免大量 keys 一次性 get | `storage.js` |
| **L5** | 存储估算采样数从 10 增加到 50，并增加 `validSamples` 校验避免除零 | `storage.js` |
| **L6** | `clearAllSnippets` 改为先扫描所有 `snip_*` keys 再精确 remove，避免并发写入竞态 | `storage.js` |
| **L7** | 新增 `cleanOrphanSnippets()` 函数，对比 storage keys 和 order，清理孤儿数据 | `storage.js` |
| **L8** | `isPureURL` 支持 `ftp://`/`file://` 协议，使用 ASCII 范围 `[\\x21-\\x7E]` 检测非 URL 字符 | `content.js` |

**额外改进**：提取所有魔法数字为集中配置 `CONFIG`（定义在 `storage.js`），消除散落的字面量。

---

*审计完成。所有中等和低严重度问题已修复。总体来说这是一个质量不错的 Chrome 扩展，安全性处理得当，核心功能完整。*
