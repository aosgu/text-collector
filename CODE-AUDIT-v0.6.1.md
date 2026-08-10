# 网页文字采集器 — 全量代码审计报告（v0.6.1）

> 审计日期：2026-08-10  
> 审计范围：`text-collector/` 全部源码（manifest + content + background + manager + storage）  
> 触发问题：**鼠标选中文字后，页面出现全屏乱码**  
> 审计维度：正确性 · 安全性 · 性能 · 宿主页兼容性 · PRD 符合度

---

## 0. 结论速览

| 等级 | 数量 | 说明 |
|------|------|------|
| 🔴 **P0 已修复** | 1 | 选中文字后宿主页全屏乱码（toast 宿主被页面 CSS 污染） |
| 🟠 **P1 已修复** | 3 | 代理对截断乱码、删除后分页 offset 漂移、孤儿扫描写入无效 id |
| 🟡 **P2 已修复/加固** | 3 | SW 冷启动 badge 不同步、toast 定时器泄漏、扩展上下文失效误报 |
| 🔵 **已知可接受** | 2 | `snippets_order` 极低概率竞态、日/韩文长度阈值偏严 |
| ✅ 通过 | — | XSS、CSP、权限、textContent、Shadow 内样式隔离、分片存储主路径 |

**整体评价**：v0.6 redesign 把 toast 宿主的 light-DOM 防护（`content.css` 的 `#text-collector-toast-host { all: initial }`）误删后，toast 宿主变成「裸 div」。在大量使用全局 `div` / `div::before`（尤其 iconfont）的站点上，选中触发 toast 会瞬间把伪元素图标字符和错误布局铺满视口，用户感知为「全屏乱码」。本次已双重加固并顺手修完审计中的 P1/P2。

---

## 1. 🔴 P0 — 全屏乱码（根因与修复）

### 1.1 现象

在任意网页用鼠标选中足够长的文本 → 约 500ms 后页面突然出现**全屏乱码/图标字符/遮罩**，而不是右上角一个小 toast。

### 1.2 根因链

```
selectionchange → 防抖 500ms → addSnippet 成功
  → showToast()
    → 创建 light DOM 节点 <div id="text-collector-toast-host">
    → attachShadow(closed) 放入内部 UI
    → append 到 document.documentElement
```

关键事实：

1. **Shadow DOM 只隔离内部样式**，宿主节点本身仍在 light DOM，会吃到页面所有全局 CSS。
2. v0.5 的 `content.css` 曾有：
   ```css
   #text-collector-toast-host { all: initial; }
   ```
3. **v0.6 redesign 把 `content.css` 清空成注释**（见 PR #3），防护消失。
4. 宿主仅靠 `host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:…'`，**没有** `!important`，也**没有**屏蔽 `::before`/`::after`。
5. 常见站点 CSS 例如：
   ```css
   div { position: relative; width: 100%; }
   div::before { content: "\e6xx"; font-family: "iconfont"; … }
   *::before { … }
   ```
   会覆盖/叠加到宿主上：
   - `width:100%` + 错误定位 → 视觉上铺满
   - `::before` 挂 iconfont 私用区字符 → **全屏乱码**
   - 高 z-index 宿主把乱码盖在所有内容之上

### 1.3 修复（双重保险）

| 层 | 文件 | 做法 |
|----|------|------|
| A | `content/content.css` | 恢复并强化 `#text-collector-toast-host`：`all:initial !important` + 几何钉死 + `::before/::after { content:none !important }` + `contain/isolation` |
| B | `content/content.js` | 内联 `cssText` 同样带 `!important`（即使 CSS 未注入也能自保）；`attachShadow` 失败则**放弃 toast**，绝不把内部样式泄到 light DOM；去掉危险的 `* { all: initial }` |

### 1.4 回归注意

- 重新加载扩展后**必须刷新已打开的网页**，旧 content script 不会自动更新。
- 验证：在带 iconfont 的站点（或本地写 `div::before { content:"乱"; font-size:80px }`）划词，应只见右上角小 toast，页面正文不变。

---

## 2. 🟠 P1 — 本次一并修复

### 2.1 长文本截断切断代理对 → 末尾 `�`

**文件**：`content/content.js`

`substring(0, 5000)` 可能落在 emoji/CJK 扩展区高位代理上，产生孤立 surrogate。

**修复**：`truncateText()` 检测高位代理并回退 1 个 code unit；且保持「先 NFC 再截断」。

### 2.2 管理页删除后 `currentOffset` 不减 → 分页漏条

**文件**：`manager/manager.js` — `deleteRecord`

删除一张已加载卡片后 `totalCount--`，但 `currentOffset` 仍指向旧窗口末端。下一次「加载更多」会从错误 offset 起读，**漏掉因前移而落到边界上的那条**。

**修复**：删除时 `currentOffset = max(0, currentOffset - 1)`，并按需重新显示「加载更多」。

### 2.3 孤儿扫描可能把无效 id 写进 order

**文件**：`utils/storage.js` — `adoptOrphanSnippets`

损坏的 `snip_*`（非对象 / 无 text / 无 id）会被 `push` 后 `map(r => r.id)` 得到 `undefined`。

**修复**：校验对象与非空 `text`，补齐 `id`，`filter(Boolean)` 后再写 order。

---

## 3. 🟡 P2 — 加固项

### 3.1 Service Worker 冷启动 badge 不同步

**文件**：`background/service-worker.js`

仅 `onInstalled` 刷 badge。浏览器重启后 SW 冷启动若未走 `onInstalled`，关闭状态可能丢 `OFF` badge。

**修复**：增加 `onStartup` + SW 脚本顶层一次 `get + updateBadge`；`onInstalled` 以 updates 合并后的最终值为准。

### 3.2 Toast 定时器在快速连续触发时的清理

**文件**：`content/content.js`

旧实现只 `remove()` 节点，不 `clearTimeout` 旧的 hide/remove 定时器（虽然有 `toastHost === host` 守卫，但仍会空转）。

**修复**：`removeToastHost()` 统一清定时器 + 节点。

### 3.3 扩展热重载后「采集失败」误报

旧 content script 在扩展 reload 后调用 `chrome.storage` 会抛 `Extension context invalidated`，弹出红色「采集失败」。

**修复**：识别该错误后静默返回，不弹 toast。

---

## 4. 🔵 已知可接受 / 非阻塞

| 项 | 说明 | 建议 |
|----|------|------|
| `snippets_order` 并发覆盖 | 两标签页同时 `created` 时后写 order 可能丢掉先写 id；`snip_*` 数据仍在，orphan 扫描可捞 | 单用户可接受；彻底方案是 order 写队列 |
| 日文/韩文长度阈值 | 只计 `\u4e00-\u9fff` 与 `[a-zA-Z]+`，纯假名/韩文易被滤 | 若常用可再加假名/Hangul 计数 |
| orphan 只扫一次 | `orphanScanV1` 标记后不再扫；新竞态孤儿需升 V2 或手动清标记 | 可接受 |
| Shadow DOM 内选区 | `getSelection()` 对 closed shadow 选区不完整 | PRD 已知限制 |
| `chrome://` / PDF / 跨域 iframe | 无法注入 | PRD 已知限制 |

---

## 5. ✅ 安全与工程通过项

| 项 | 状态 |
|----|------|
| 管理页用户文本 `textContent` | ✅ |
| Toast 文案 `textContent` | ✅ |
| `innerHTML` 仅硬编码 SVG 常量 | ✅ |
| Toast closed Shadow DOM | ✅ |
| CSP `script-src 'self'` | ✅ |
| 权限仅 `storage` + `unlimitedStorage` + host | ✅ |
| 跳过 input/textarea/contenteditable（含 shadow 穿透） | ✅ |
| 分片存储 `snip_<id>` | ✅ |
| 导出 TXT UTF-8 BOM | ✅ |
| 导入 schemaVersion 校验 | ✅ |
| 删除 5 秒撤销 | ✅ |
| 采集开关持久化 + badge | ✅ |

---

## 6. 逐文件审计摘要

### `manifest.json`
- MV3、无 popup、`content_scripts` 含 `storage.js` + `content.js` + `content.css` ✅
- `all_frames: false` 符合 PRD ✅

### `content/content.js` + `content.css`
- 采集主路径与 PRD 一致 ✅
- **P0 toast 宿主污染** — 已修
- 长度/符号/数字/URL 过滤、防抖、NFC、扩选/去重入口 ✅

### `utils/storage.js`
- 分片读写、导入导出、估算 ✅
- 孤儿扫描健壮性 — 已修
- order 竞态 — 文档化可接受

### `manager/manager.js` + HTML/CSS
- XSS 安全、撤销、导入导出、实时追加 ✅
- 删除 offset — 已修
- 开关 ON/OFF 由 CSS `::before` 渲染，HTML 内无静态文字，无 ONON 回归 ✅

### `background/service-worker.js`
- 打开管理页、快捷键、badge ✅
- 冷启动同步 — 已修

---

## 7. 变更清单（本轮）

```
text-collector/content/content.css          # 恢复并强化宿主隔离（P0）
text-collector/content/content.js           # toast 双重钉死 + 安全截断 + 定时器/错误处理
text-collector/manager/manager.js           # 删除后 currentOffset 修正
text-collector/utils/storage.js             # 孤儿扫描校验 + order 去重 prepend
text-collector/background/service-worker.js # onStartup / 冷启动 badge
text-collector/README.md                    # toast 文案描述
CODE-AUDIT-v0.6.1.md                        # 本报告
```

---

## 8. 建议验收用例

- [ ] 普通文章页划 ≥5 中文字 → 仅右上角「已采集」，正文无变化
- [ ] 带 iconfont / 全局 `div::before` 的站点划词 → **无全屏乱码**
- [ ] 深色站点划词 → toast 深色版，文字与勾可见
- [ ] 重复划同一句 → 「已采集过」
- [ ] 先半句再扩整句（5s 内）→ 只 1 条且为整句
- [ ] 管理页删除一条后再「加载更多」→ 无漏条/重条
- [ ] 关闭采集 → badge `OFF`；重启浏览器 → badge 仍为 `OFF`
- [ ] 扩展管理页「重新加载」后刷新网页再划词 → 正常，无「采集失败」刷屏

---

*审计完成。P0 全屏乱码已定位并修复；P1/P2 已落地。重新加载扩展并刷新网页后验证即可。*
