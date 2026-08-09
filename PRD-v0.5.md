# 网页文字采集器 Chrome 插件 — 产品需求文档 (PRD)

> 个人自用工具 · 不对外发布
> 版本 v0.5 · 2026-08-10

### 版本历史

| 版本 | 变更内容 |
|------|---------|
| **v0.5** | **重大更新**：新增「采集准入规则」（长度阈值 + 防抖延迟 + 扩选替换 + 纯符号过滤）；事件模型从 mouseup 改为 selectionchange + 500ms 防抖；存储方案从单数组改为分片存储解决并发写入；新增单条复制（P0）、删除撤销（P1）、JSON 导入（P1）、图标 badge 状态；补充 schemaVersion / textContent 安全规则 / UTF-8 BOM / all_frames 说明；全局快捷键提至 P1；降级 getComposedRanges；补充并发/扩选/XSS 等验收用例 |
| v0.4 | 明确去重策略（URL 匹配、空白处理、Unicode 归一化）；补充敏感字段检测；补充 toast 叠加行为；闭环「展开」交互；定义 TXT 导出格式；新增记录计数、存储警告、清空确认增强；合并权限清单；补充 CSP / install 初始化 / run_at 等工程细节；移除移动端适配（移至 P2） |
| v0.3 | 管理页增加采集开关，可一键暂停/恢复划词采集 |
| v0.2 | 管理页确认用新 tab；移除来源标题/URL/时间显示；移除搜索和域名筛选 |

---

## 1. 产品概述

### 一句话定义

浏览任意网页时，用鼠标选中文字即自动保存（带智能过滤，避免噪音）；点击插件图标可查看所有采集记录、删除、导出、复制或清空。可在管理页一键关闭采集，关闭时图标变灰提示。

### 目标用户

仅本人，单设备使用，不需要账号体系，不需要云同步。

### 核心价值

- **零摩擦采集**：选中即存，不需要右键菜单、不需要快捷键、不需要复制粘贴
- **智能过滤**：太短的划过不存、扩选自动合并、纯符号跳过——避免一天存 500 条垃圾
- **轻量管理**：随时翻阅、复制、删除（可撤销）、导出、导入
- **无打扰**：不弹窗、不阻塞浏览，仅有轻量视觉反馈
- **可关闭**：不需要采集时一键关闭，划词行为完全不受影响；关闭后图标变灰，防止忘记

---

## 2. 功能清单

| 模块 | 功能点 | 优先级 |
|------|--------|--------|
| 采集 | 鼠标选中文本后自动保存（selectionchange + 500ms 防抖） | P0 |
| 采集 | 采集准入规则：最小长度 ≥ 5 中文字 / 3 英文词 | P0 |
| 采集 | 采集准入规则：扩选自动替换上一条（同一 URL 5 秒内） | P0 |
| 采集 | 采集准入规则：过滤纯符号、纯数字、纯 URL | P0 |
| 采集 | 记录来源网页标题、URL、选中时间 | P0 |
| 采集 | 保存时轻量视觉反馈（toast） | P0 |
| 采集 | 去重：同一页面选中完全相同文本不重复保存 | P0 |
| 采集 | 采集前文本预处理（trim + Unicode NFC 归一化） | P0 |
| 采集 | 跳过 input / textarea / contenteditable 内选中（自动覆盖密码框等敏感字段） | P0 |
| 采集 | 采集关闭时图标显示灰色 + badge `OFF` | P0 |
| 管理 | 点击插件图标打开管理页（新 tab） | P0 |
| 管理 | 列表展示所有记录，最新在前 | P0 |
| 管理 | 每条记录仅显示文本内容 | P0 |
| 管理 | 显示「共 N 条 · 占用约 X KB」 | P0 |
| 管理 | 单条删除按钮 | P0 |
| 管理 | 单条点击复制到剪贴板 + toast「已复制」 | P0 |
| 管理 | 顶部「导出」按钮（TXT / JSON） | P0 |
| 管理 | 顶部「清空全部」按钮（需二次确认，含记录数和最早日期） | P0 |
| 管理 | 采集开关：一键暂停/恢复划词采集 | P0 |
| 管理 | 删除后 5 秒内可撤销（toast「已删除 [撤销]」） | P1 |
| 管理 | 导入 JSON 恢复数据 | P1 |
| 管理 | 管理页打开期间有新记录时自动追加（带视觉提示） | P1 |
| 管理 | 超过阈值（5000 条）时顶部温和提示 | P1 |
| 管理 | 全局快捷键切换采集开关（`chrome.commands`） | P1 |
| 管理 | 管理页滚动加载更多（每次 50 条） | P1 |
| 导出 | 导出为 TXT（纯文本，含来源信息，UTF-8 BOM） | P0 |
| 导出 | 导出为 JSON（含 schemaVersion + 完整元数据） | P1 |

---

## 3. 产品逻辑

### 3.1 事件模型选型

| 方案 | 优点 | 缺点 |
|------|------|------|
| **mouseup** | 事件量少，性能开销极小 | 不覆盖键盘选择（Shift+方向键、Ctrl+A）；需要 setTimeout(0) hack 等 selection 就绪；扩选会产生多条中间态记录 |
| **selectionchange + 防抖 500ms** ✅ | 天然覆盖键盘和鼠标选择；selection 一定已就绪，无需 setTimeout hack；防抖天然合并扩选，中间态自动丢弃 | 事件频率高（但防抖后实际触发极少）；需注意在 input/textarea 中也触发，要额外过滤 |

**选择 `selectionchange + 500ms 防抖`**。原因：它从根本上解决了「扩选存多条」「mouseup 时 selection 未就绪」「键盘选择漏采」三个问题，且防抖后实际触发频率很低，性能开销可忽略。

防抖逻辑：每次 `selectionchange` 重置 500ms 计时器。仅当用户停止改变选择 500ms 后，才执行采集检查。中间态（比如用户从 2 个字划到整句的过程中的每一帧）都不会触发采集——只取最终状态。

### 3.2 采集准入规则

> **这是决定插件能不能用的核心规则。**「选中即存 + 最小 1 字符」在真实使用中一天能存几百条噪音（双击选词、划过链接时的轻微拖拽、阅读时无意识划动等）。

准入检查按以下顺序执行，任一不通过即直接 return（不保存、不提示）：

| 序号 | 规则 | 阈值 | 说明 |
|------|------|------|------|
| ① | 采集开关 | 必须为「开」 | 关闭时 selectionchange 回调直接 return |
| ② | 跳过编辑区域 | `input` / `textarea` / `[contenteditable]` 内选中不触发 | 避免干扰编辑操作，同时自动覆盖密码框等所有输入型字段 |
| ③ | 防抖等待 | 500ms 无新 selectionchange | 过滤拖动过程中的所有中间态 |
| ④ | 最小长度 | 中文 ≥ 5 字，英文 ≥ 3 词 | 双击选词（通常 1-2 字/词）直接过滤 |
| ⑤ | 内容类型过滤 | 纯符号、纯数字、纯 URL 跳过 | 避免存下 `////////` `12345678` `https://...` 等无意义选中 |
| ⑥ | 最大长度 | ≤ 5000 字符 | 超过则截断到 5000 字符后保存（不跳过，用户可能故意选了大段文字） |
| ⑦ | 预处理 | trim + Unicode NFC 归一化 | 统一空白和字符编码后再进入去重 |

**检测中文/英文词数的简易实现**：
```javascript
function meetsLengthThreshold(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars >= 5 || englishWords >= 3;
}
```

**内容类型过滤**（满足任一即跳过）：
- 仅包含标点符号和空白字符
- 仅包含数字（含小数点、逗号分隔）
- 仅包含一个 URL（以 `http://` / `https://` 开头且占全文 90% 以上）

### 3.3 扩选替换规则

用户选中文本时的常见行为：先选半句 → 发现不够 → 扩大选择范围。当前设计会存两条。正确行为是只保留最终结果。

**规则**：在同一个 URL 上，若 5 秒内新选中的文本**包含**上一条已保存的全部文本，则**替换**上一条（更新 `text` 和 `lastSelectedAt`），而非新增。

```javascript
// 伪代码
function shouldReplace(snippets, newText, currentUrlKey, now) {
  const recent = snippets.filter(s =>
    s.urlKey === currentUrlKey &&
    (now - s.lastSelectedAt) < 5000
  );
  // 找到最近一条被新文本包含的记录
  return recent.find(s => newText.includes(s.text)) || null;
}
// 如果找到 → 替换该条；如果没找到 → 新增
```

去重（完全相同文本）优先级高于扩选替换：先检查去重，再检查扩选替换。

### 3.4 采集触发流程（完整）

```
用户改变选中文本 → selectionchange 事件 → 重置 500ms 防抖计时器
  500ms 内无新的 selectionchange → 开始采集检查：

  ① 采集开关是否为「开」? → 否 → return
  ② activeElement 是否为 input/textarea/[contenteditable]? → 是 → return
  ③ 获取 selection.toString() → trim() → 长度 ≥ 1? → 否 → return
  ④ 满足最小长度阈值（中文 ≥ 5 字 或 英文 ≥ 3 词）? → 否 → return
  ⑤ 是否为纯符号/纯数字/纯URL? → 是 → return
  ⑥ 长度 > 5000 字符? → 是 → 截断到 5000 字符
  ⑦ text.normalize('NFC')
  ⑧ 去重检查（同 urlKey + 完全相同文本）→ 命中 → 更新 lastSelectedAt, toast「已采集过」
  ⑨ 扩选替换检查（同 urlKey + 5秒内 + 新文本包含旧文本）→ 命中 → 替换旧记录, toast「已采集 ✓」
  ⑩ 都没命中 → 写入新记录, toast「已采集 ✓」
```

### 3.5 去重策略

**文本预处理**（步骤⑥⑦已经做了）：
1. 截断或保留（≤ 5000 字符）
2. `.trim()` 去除首尾空白字符
3. `.normalize('NFC')` Unicode 归一化

**URL 匹配规则**：

> 「同一 URL」定义为 **origin + pathname 相同**，忽略 query string 和 hash fragment。

示例：
```
https://example.com/article?a=1    }
https://example.com/article?a=2    }  视为同一 URL
https://example.com/article#sec1   }
https://example.com/article        }
https://example.com/other           → 不同 URL
```

**去重逻辑**：
- 同一 urlKey + 预处理后完全相同文本 → 不新增，更新 `lastSelectedAt`，toast「已采集过」
- 不同 urlKey 上相同文本 → 正常保存
- 去重检查在扩选替换之后、写入之前执行

### 3.6 存储方案

#### 3.6.1 为什么不用单数组

v0.4 将 `snippets` 作为一个大数组存储在 `chrome.storage.local` 的单一 key 下。**这有并发写入问题**：

```
标签页A: 读snippets → 追加 → 写回
标签页B:       读snippets → 追加 → 写回  ← B覆盖了A的写入，A的数据静默丢失
```

#### 3.6.2 分片存储方案（v0.5 起采用）

每条采集记录作为一个独立 key 存储，写入互不覆盖：

```
storage 结构：
  schemaVersion: 1                          # 数据格式版本号
  collectEnabled: true                      # 采集开关
  snippets_order: ["id3", "id2", "id1"]     # 记录 ID 列表（有序，用于管理页排序）
  snip_<uuid1>: { id, text, url, urlKey, title, domain, capturedAt, lastSelectedAt }
  snip_<uuid2>: { id, text, url, urlKey, title, domain, capturedAt, lastSelectedAt }
  snip_<uuid3>: { ... }
```

**优势**：
- 写入互不覆盖，解决并发丢失问题
- 删除单条只需移除一个 key 和 `snippets_order` 中的对应 ID
- 管理页可以分批读取（先读 `snippets_order`，再按需读具体记录）

**管理页加载策略**：
1. 先读取 `snippets_order`（仅 ID 列表，极小）
2. 取前 50 个 ID，批量 `storage.local.get([...ids])`
3. 滚动到底时加载下一批 50 个
4. 计数 = `snippets_order.length`

**存储空间估算**：`chrome.storage.local` 单个 key value 上限约为 8KB（与 sync 不同，local 无此严格限制），但仍建议保持每条远小于此值。5000 字符文本 + 元数据 ≈ 5.5KB，安全。

#### 3.6.3 schemaVersion

`schemaVersion` 是整数，存储在 `chrome.storage.local` 中。当前值为 `1`。将来数据结构变更时递增，Service Worker `onInstalled` 中检查并执行迁移逻辑。导出的 JSON 文件也包含 `schemaVersion`，导入时校验兼容性。

```
onInstalled:
  if schemaVersion 不存在 → 设为 1（首次安装）
  if schemaVersion < currentVersion → 执行迁移 → 更新 schemaVersion
```

### 3.7 管理页交互

**入口**：点击工具栏插件图标

**页面形式**：使用 `chrome.tabs.create` 打开独立管理页（新 tab）。注意：`manifest.json` 中 `action` 不能设置 `default_popup`，否则 `onClicked` 事件不触发。

**布局**：

```
┌───────────────────────────────────────────────────────┐
│ [导入]  [导出 ▾]  [清空全部]    共 N 条 · 占用约 X KB   采集 [开/关] │
├───────────────────────────────────────────────────────┤
│ ⚠ 记录数已超过 5000 条，建议导出备份（仅超阈值显示）         │
├───────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐ │
│ │ 采集的文本内容（最多显示 3 行，超出截断显示           │ │
│ │ 「展开」）                                          │ │
│ │ 点击「展开」→ 内联展开全部文本，按钮变为「收起」      │ │
│ │ 点击「收起」→ 恢复 3 行截断                         │ │
│ │ 点击文本区域 → 复制到剪贴板 → toast「已复制」        │ │
│ │                                        [🗑]       │ │
│ └───────────────────────────────────────────────────┘ │
│ ┌───────────────────────────────────────────────────┐ │
│ │ 🆕 新增了 3 条记录（有新记录时显示, 3秒后消失）       │ │
│ └───────────────────────────────────────────────────┘ │
│ ┌───────────────────────────────────────────────────┐ │
│ │ ...更多记录（滚动加载）...                           │ │
│ └───────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

**交互细节**：

| 操作 | 行为 |
|------|------|
| 点击卡片文本区域 | 复制文本到剪贴板，toast「已复制」1.5 秒 |
| 点击 🗑 | 立即删除，底部 toast「已删除 [撤销]」，5 秒后消失；点击「撤销」→ 恢复记录 |
| 展开/收起 | 3 行截断 + 「展开」→ 内联展开 + 「收起」→ 恢复截断 |
| 清空全部 | 二次确认：「确定清空全部 N 条记录？最早记录于 YYYY-MM-DD。此操作不可撤销。」 |
| 导出 | 下拉选择 TXT / JSON，点击即下载 |
| 导入 | 点击「导入」→ 选择 JSON 文件 → 合并到现有记录（去重）→ 提示导入条数 |
| 开关 | 点击切换，即时生效，状态持久化 |
| 实时更新 | 管理页监听 `storage.onChanged`，新记录自动追加到头部 + 3 秒提示 |

**图标 badge 状态**：
- 采集开启时：无 badge（或显示绿色圆点，待 UI 阶段确定）
- 采集关闭时：badge 文字 `OFF`，背景灰色 `#888`
- 切换即时生效（`chrome.action.setBadgeText` / `setBadgeBackgroundColor`）

**空状态**：
> 「还没有采集记录，去网页上选中文字试试吧」

**存储用量警告**：超过 5000 条时顶部显示温和提示。

**⚠️ 关键安全规则**：管理页渲染记录文本时，**必须使用 `textContent`，绝对禁止 `innerHTML`**。采集的文本可能包含 `<script>`、`<img onerror=...>` 等恶意标签，innerHTML 会导致代码执行。

### 3.8 单条记录数据结构

```json
{
  "id": "a1b2c3d4-...",
  "text": "预处理后的文本内容（已 trim + Unicode NFC 归一化 + 截断）",
  "url": "https://example.com/article?foo=bar",
  "urlKey": "https://example.com/article",
  "title": "网页标题",
  "domain": "example.com",
  "capturedAt": 1723241880000,
  "lastSelectedAt": 1723243240000
}
```

管理页只展示 `text` 字段，其余字段仅在导出 JSON 时体现。

### 3.9 全局快捷键

使用 `chrome.commands` API 注册全局快捷键，切换采集开关：

```json
"commands": {
  "toggle-collect": {
    "suggested_key": { "default": "Ctrl+Shift+S" },
    "description": "切换采集开关"
  }
}
```

按下快捷键 → 读取当前 `collectEnabled` → 取反写入 → `storage.onChanged` 自动广播到所有 Content Script。管理页的开关 UI 同步更新。无需打开管理页即可切开关。

---

## 4. 技术方案概要

### 4.1 技术栈

- Manifest V3
- 原生 HTML / CSS / JavaScript（不引入框架）
- `chrome.storage.local` 持久化（分片存储）
- `chrome.tabs.create` 打开管理页
- Content Script 注入到 `<all_urls>`，`run_at: "document_idle"`
- 事件模型：`selectionchange` + 500ms 防抖
- `chrome.commands` 全局快捷键

### 4.2 权限清单

```json
{
  "manifest_version": 3,
  "permissions": [
    "storage",
    "unlimitedStorage"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "commands": {
    "toggle-collect": {
      "suggested_key": { "default": "Ctrl+Shift+S" },
      "description": "切换采集开关"
    }
  },
  "action": {},
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/content.js"],
      "css": ["content/content.css"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ]
}
```

| 权限 | 用途 |
|------|------|
| `storage` | 读写采集记录和开关状态 |
| `unlimitedStorage` | 解除 10 MB 限制 |
| `<all_urls>` | Content Script 注入到所有网页 |
| `commands` | 全局快捷键切换采集开关 |
| `action` (空) | 不设 `default_popup`，确保 `onClicked` 触发打开管理页 |

**`action` 说明**：设为空对象 `{}`，不指定 `default_popup`。如果设置了 popup，`chrome.action.onClicked` 不会触发，就无法用点击图标打开管理页。

**`all_frames` 说明**：当前设为 `false`，只注入顶层页面。设为 `true` 可以让 Content Script 注入跨域 iframe（有 host 权限即可），但也会注入广告 iframe 等不需要的子框架。当前需求不需要采集 iframe 内容，故不开启。如后续需要，改为 `true` 并可选加 `match_about_blank: false`。

### 4.3 文件结构

```
text-collector/
├── manifest.json
├── content/
│   ├── content.js        # selectionchange 监听 + 防抖 + 准入规则 + toast + 开关联动
│   └── content.css       # toast 样式
├── manager/
│   ├── manager.html      # 管理页
│   ├── manager.js        # 列表渲染 / 复制 / 删除 / 撤销 / 导出 / 导入 / 清空 / 开关
│   └── manager.css       # 管理页样式
├── background/
│   └── service-worker.js # 安装初始化 + 点击图标打开管理页 + badge 状态管理 + 快捷键响应
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── utils/
    └── storage.js        # 分片存储读写工具函数（共用）
```

> v0.5 新增 `utils/storage.js`：封装分片存储的读写、去重、排序等逻辑，Content Script 和 Manager 共用。

### 4.4 核心流程

```
┌──────────────┐  selectionchange  ┌───────────────┐    chrome.storage    ┌──────────────┐
│ 任意网页      │ ────────────────→ │ Content Script │ ──────────────────→ │ Storage      │
│ (用户选中文本) │                  │ ① 500ms 防抖    │ ←────────────────── │ (local)      │
└──────────────┘                   │ ② 查开关        │   读取/写入          │ snip_<id> × N│
                                   │ ③ 跳过编辑区域   │                      │ snippets_    │
                                   │ ④ 准入规则检查   │                      │ order        │
                                   │ ⑤ 去重+扩选替换  │                      │ collect      │
                                   │ ⑥ 写入分片      │                      │ Enabled      │
                                   └──────┬──────────┘                      │ schemaVersion│
                                          │ toast (仅开关开时)               └──────────────┘
                                          ↓
                                   ┌──────────────┐
                                   │ 页面内浮层     │
                                   │「已采集 ✓」   │
                                   │ (同时最多1个)  │
                                   └──────────────┘

┌──────────────┐  click icon or  ┌──────────────┐   chrome.storage    ┌──────────────┐
│ 浏览器工具栏  │  快捷键          │ Service      │ ──────────────────→│ Storage      │
│ + badge OFF  │ ───────────────→ │ Worker       │ ←──────────────────│ (local)      │
└──────────────┘                  │ → tabs.create│                     └──────────────┘
                                  │ → badge 更新  │
                                  │ → 快捷键响应  │
                                  └──────┬───────┘
                                         ↓
                                  ┌──────────────┐
                                  │ Manager Page │
                                  │ 列表/复制/删除 │
                                  │ 撤销/导出/导入 │
                                  │ 采集开关       │
                                  │ 实时更新       │
                                  └──────────────┘
```

### 4.5 Content Security Policy

管理页使用 `Blob URL` 实现导出下载，使用 `FileReader` 实现导入。如遇 CSP 拦截，在 `manifest.json` 中添加：

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```

### 4.6 关键安全规则

> **以下规则必须严格遵循，违反任意一条即为安全漏洞。**

| 规则 | 说明 |
|------|------|
| `textContent` 禁止 `innerHTML` | 管理页渲染采集文本时必须用 `textContent` 或创建文本节点。采集内容来自任意网页，可能含 `<script>`、`<img onerror>` 等 |
| 密码框不采集 | 跳过所有 `input` / `textarea` / `[contenteditable]`，自动覆盖密码框，无需单独判断 `type` |
| Toast Shadow DOM | Toast 注入目标页面时使用 Shadow DOM 隔离样式，同时防止被页面 JS 篡改 |

---

## 5. 技术坑点与应对

### 5.1 内容脚本注入限制

| 场景 | 能否采集 | 原因 |
|------|---------|------|
| 普通网页 (http/https) | ✅ | 内容脚本正常注入 |
| `chrome://` 页面 | ❌ | 浏览器安全策略，禁止扩展注入 |
| Chrome 扩展商店 | ❌ | 同上 |
| 本地 `file://` 页面 | ⚠️ | 需用户在扩展管理页手动开启「允许访问文件 URL」 |
| Chrome 内置 PDF 阅读器 | ❌ | 内容脚本无法注入 PDF 查看器 |
| 网页内嵌 PDF (iframe) | ❌ | 同上 |
| 跨域 iframe | ❌ | `all_frames: false`，只注入顶层页面。如需支持改为 `true`（注意会注入广告 iframe） |

应对：在 README 中说明限制。用户在这些页面选中文字时不会触发采集，也不会报错。

### 5.2 selectionchange 的注意事项

**问题一：selectionchange 在 input/textarea 中也会触发**

用户聚焦输入框时选中文本也会触发 `selectionchange`，但我们不需要采集表单内文本。

应对：回调中首先检查 `document.activeElement`，若为 `input` / `textarea` / `[contenteditable]` 则直接 return。这同时自动覆盖了密码框等所有输入型字段，无需额外判断 `type="password"`。

**问题二：selectionchange 触发频率高**

每次改变选择都会触发，包括拖动过程中每一帧。

应对：500ms 防抖，只有用户停止改变选择 500ms 后才会执行采集检查。中间态全部丢弃。

**问题三：页面初始加载时触发**

页面加载完成后浏览器可能自动恢复之前的 selection，触发 selectionchange。

应对：Content Script `run_at: "document_idle"` 确保 DOM 就绪后才开始监听，此时用标志位跳过前 2 秒内的事件（页面初始化的 selection 恢复通常发生在加载后 1-2 秒内）。

### 5.3 Shadow DOM 选中文本

页面的 Shadow DOM 内选中文本，`window.getSelection()` 可能返回空或不完整。

应对：`getComposedRanges()` 是较新 API（Chrome 126+），兼容性不稳定。**v0.5 降级处理**：不做特殊处理，仅使用 `window.getSelection()`。如 Shadow DOM 内选中文本无法采集，属于已知限制。后续 Chrome 普及 `getComposedRanges()` 后可自然解决。此项从技术方案降级为已知限制。

### 5.4 Storage 容量与性能

**容量**：分片存储后，`chrome.storage.local` 默认 ~10 MB。按每条约 1 KB（key 名 + 元数据 + 文本），可存约 1 万条。加 `unlimitedStorage` 权限兜底。管理页显示「占用约 X KB」（通过 `JSON.stringify(record).length` 估算）。

**性能**：
- 写入：单 key 写入，ms 级延迟，不阻塞
- 读取管理页：先读 `snippets_order`（纯 ID 列表），再分批读记录（每次 50 条），1000 条时管理页打开 < 1s
- 超出 5000 条时温和提示

### 5.5 Toast 注入的页面冲突

- Toast 元素使用 Shadow DOM 隔离样式
- 设置极高 z-index（`2147483647`）
- 使用 `position: fixed` + top/right 定位
- 新 toast 出现时移除旧 toast，同时最多 1 个

### 5.6 页面性能影响

- `selectionchange` 事件频率高，但防抖后实际执行频率极低（每 500ms 最多一次有效检查）
- 不监听 mousemove / scroll 等高频事件
- storage 写入异步，不阻塞主线程
- 防抖回调中先做轻量检查（开关、activeElement），再读 selection

### 5.7 Manifest V3 Service Worker 生命周期

- 所有持久数据放 `chrome.storage.local`（分片存储）
- Service Worker 职责：安装初始化（含 schemaVersion 迁移）、点击图标打开管理页、快捷键响应、badge 更新
- Content Script 和 Manager Page 直接读写 storage，不经过 Service Worker 中转
- Service Worker 挂起不影响采集功能

### 5.8 管理页数据一致性

- 打开时读取 `snippets_order` + 首批 50 条记录渲染
- 监听 `chrome.storage.onChanged`，新记录自动追加到头部
- 追加时显示「🆕 新增了 X 条」提示，3 秒后消失

### 5.9 导出文件下载

使用 `URL.createObjectURL(new Blob(...))` → 触发下载 → `revokeObjectURL` 清理。

### 5.10 采集开关的跨页面同步

Content Script 监听 `chrome.storage.onChanged` → 实时更新内存缓存 → 管理页切换开关后所有页面即时生效。同时更新图标 badge。

---

## 6. 导出/导入规范

### 6.1 导出 TXT

- 文件名：`snippets_2026-08-10.txt`
- 编码：**UTF-8 with BOM**（解决 Windows 记事本打开中文乱码）
- 排序：时间正序（最早在前）
- 内容：**仅文本内容，不包含时间、来源、标题等任何元数据**
- 条目分隔：每条之间一个空行（`\n\n`）
- 格式示例：

```
第一段选中的文本内容

第二段选中的文本内容

第三段选中的文本内容
```

### 6.2 导出 JSON

- 文件名：`snippets_2026-08-10.json`
- 编码：UTF-8（无需 BOM）
- 结构：

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-10T14:32:00.000Z",
  "count": 127,
  "snippets": [
    {
      "id": "a1b2c3d4-...",
      "text": "选中的文本内容",
      "url": "https://example.com/article?foo=bar",
      "urlKey": "https://example.com/article",
      "title": "网页标题",
      "domain": "example.com",
      "capturedAt": 1723241880000,
      "lastSelectedAt": 1723241880000
    }
  ]
}
```

> 排序：时间正序（`capturedAt` 升序）。

### 6.3 导入 JSON

- 点击「导入」→ 文件选择器（`<input type="file" accept=".json">`）
- 校验顶层结构：必须有 `schemaVersion`、`snippets` 数组
- `schemaVersion` 必须 ≤ 当前版本
- 对每条记录：检查 `text`、`urlKey`、`capturedAt` 必填字段存在
- 合并策略：逐条检查是否与现有记录重复（同 urlKey + 同 text）→ 已存在则跳过，不存在则新增
- 导入完成后 toast：「导入了 X 条新记录，跳过 Y 条重复」
- 导入过程中采集开关照常工作（导入和采集走不同入口，不冲突）

---

## 7. 交互细节

### 采集反馈 Toast

- 位置：页面右上角，距顶部 16px，距右侧 16px
- 样式：深色半透明背景，白色文字，圆角 6px，内边距 8px 16px
- 文案：`已采集 ✓` / `已采集过` / `采集失败`
- 持续时间：1.5 秒后自动淡出
- 不阻塞任何交互，不接收点击
- 新 toast 出现时移除旧 toast（同时最多 1 个）

### 管理页

- 顶部工具栏：[导入] [导出 ▾] [清空全部] · 共 N 条 · 占用约 X KB · 采集 [开/关]
- 图标 badge：采集开 → 无 / 采集关 → 灰色 `OFF`
- 卡片：仅显示文本，3 行截断 + 展开/收起
- 点击卡片文本 → 复制到剪贴板 → toast「已复制」1.5 秒
- 删除 → toast「已删除 [撤销]」，5 秒后消失，点击撤销恢复
- 空状态：「还没有采集记录，去网页上选中文字试试吧」
- 实时更新：新记录自动追加到头部 + 提示 + 计数更新
- 滚动加载更多：每次 50 条
- **所有文本渲染使用 `textContent`（安全规则）**

---

## 8. 非目标（不做什么）

- ❌ 不做云同步 / 多设备同步
- ❌ 不做账号 / 登录
- ❌ 不做分享功能
- ❌ 不做 AI 摘要 / 自动分类
- ❌ 不做搜索 / 筛选 / 分类——这是暂存内容的地方，不是知识管理工具
- ❌ 不做右键菜单
- ❌ 不做快捷键触发采集（选中即触发）
- ❌ 不对外发布，不上架 Chrome Web Store
- ❌ 不采集 `input` / `textarea` / `[contenteditable]` 中的文本（自动覆盖密码框等所有输入字段）
- ❌ 不做选中文本后的弹窗菜单

---

## 9. 边界情况

| 场景 | 处理方式 |
|------|---------|
| 选中文本 < 5 中文字且 < 3 英文词 | 不保存，不提示 |
| 选中纯符号/纯数字/纯URL | 不保存，不提示 |
| 选中文本超长（> 5000 字符） | 截断到 5000 字符后保存 |
| 用户拖动选择 → 中间态触发 selectionchange | 防抖 500ms，中间态全部丢弃 |
| 先选半句再扩选整句（5 秒内同 URL） | 替换上一条，只保留最终结果 |
| 选中文本含 HTML 标签 | 只保存纯文本 `selection.toString()` |
| 选中文本含换行符 | 保留换行，管理页 `white-space: pre-wrap` |
| 同一页面快速多次选中不同文本 | 每次都保存 |
| 同一页面快速多次选中相同文本 | 不新增，更新 `lastSelectedAt`，toast「已采集过」 |
| 网页标题为空 | 用 URL 作为标题 |
| 网页 URL 为 `about:blank` | 保存，来源标记为「未知页面」 |
| Storage 写入失败 | toast「采集失败」 |
| 管理页无记录 | 空状态引导 |
| 采集开关关闭后选中 | 不触发，不显示 toast |
| 采集开关关闭后开新页面 | Content Script 读到关闭状态，不采集 |
| 采集开关关闭后浏览器重启 | 开关状态从 storage 恢复，保持关闭 |
| 开关关闭 → 图标 badge 显示灰色 `OFF` | 防止忘记已关闭 |
| 用户在 input/textarea 选中 | 不采集 |
| 管理页打开期间有新记录 | 实时追加到头部 + 提示 + 计数更新 |
| Toast 快速叠加 | 同时最多 1 个，新的移除旧的 |
| 记录数 > 5000 | 管理页顶部警告 + 建议导出 |
| 管理页超多记录 | 滚动加载更多，每次 50 条 |
| 两个标签页几乎同时采集 | 分片存储，写入互不覆盖 |
| 删除后误操作 | 5 秒内可撤销 |
| 扩展被卸载重装 | 数据丢失（storage 清空），建议定期导出 JSON 备份 |
| 导入 JSON 含重复记录 | 跳过重复，提示跳过条数 |
| 管理页渲染含 `<script>` 标签的文本 | `textContent` 原样显示，不执行 |
| Shadow DOM 内选中文本 | 无法采集，已知限制 |

---

## 10. 后续可扩展方向（P2+）

| 方向 | 说明 |
|------|------|
| 标签 / 分类 | 给记录打标签，按标签筛选 |
| 笔记注释 | 在采集文本旁添加个人笔记 |
| 域名黑白名单 | 指定网站不采集 |
| 自动过期 | 30 天未查看的记录自动清理 |
| 富文本导出 | 导出为 HTML 文件 |
| 导出为 Markdown | 格式化为 MD |
| 表单内文本采集开关 | 允许采集 input/textarea 内选中文本 |
| 移动端管理页 | 独立响应式 Web 页面部署 |
| 暗色/亮色主题切换 | 管理页主题切换 |
| iframe 采集支持 | `all_frames: true` |
| Shadow DOM 采集 | 等 `getComposedRanges()` 普及 |

---

## 11. 开发验收清单

- [ ] 选中 ≥ 5 中文字或 ≥ 3 英文词 → 500ms 后出现 toast → 记录入库
- [ ] 选中 2 个字划过 → 不入库（长度阈值）
- [ ] 选中纯符号/纯数字/纯 URL → 不入库
- [ ] 拖动选择过程中 → 中间态不触发采集（防抖验证）
- [ ] 先选半句再扩选整句（5 秒内同 URL）→ 只存 1 条，且为整句（扩选替换）
- [ ] 同一页面选相同文本 → toast「已采集过」→ 不新增，更新 `lastSelectedAt`
- [ ] 两个标签页几乎同时采集 → 两条记录都在（并发验证）
- [ ] 在 input / textarea / contenteditable 中选中 → 不触发
- [ ] 在密码框中选中 → 不触发（自动被 input 规则覆盖）
- [ ] 点击插件图标 → 新 tab 打开管理页 → 显示记录（最新在前）+ 计数 + 存储占用
- [ ] 管理页每条记录只显示文本，无来源/URL/时间
- [ ] 点击卡片文本 → 复制到剪贴板 → toast「已复制」
- [ ] 管理页超长文本截断 3 行 → 「展开」→「收起」
- [ ] 删除 → toast「已删除 [撤销]」→ 点撤销恢复 → 5 秒后自动消失
- [ ] 管理页渲染含 `<img onerror=...>` 的文本 → 原样显示纯文本（XSS 验证）
- [ ] 采集开关切换 → 状态持久化 → 图标 badge 同步变化 → 浏览器重启后保持
- [ ] 采集开关关闭后选中文本 → 不触发采集、不显示 toast
- [ ] 采集开关切换后，已打开页面无需刷新即可生效
- [ ] 清空全部 → 二次确认（含 N 条 + 最早日期）→ 列表清空 + storage 清空
- [ ] 删除后刷新管理页 → 确实没了
- [ ] 导出 TXT → UTF-8 BOM 编码，Windows 记事本打开中文不乱码
- [ ] 导出 JSON → 含 `schemaVersion`、`exportedAt`、`count`、`snippets`（含 urlKey）
- [ ] 导入 JSON → 合并去重 → 提示「导入了 X 条，跳过 Y 条」
- [ ] 快捷键 Ctrl+Shift+S → 切换采集开关 → toast + badge 更新
- [ ] `chrome://` 页面选中 → 不触发、不报错
- [ ] 管理页空状态 → 显示引导文案
- [ ] 浏览器重启后 → 历史记录 + 开关状态 + badge 均保持
- [ ] 管理页打开期间有新记录 → 自动追加 + 提示 + 计数更新
- [ ] Toast 快速叠加 → 同时最多 1 个
- [ ] 记录数 > 5000 → 管理页警告
- [ ] 采集 1000 条后管理页打开耗时 < 1s
- [ ] 在 Google Docs / Notion / 飞书文档里选中 → 不崩、不干扰原生选中行为

---

*本文档由产品需求梳理生成，开发阶段如遇新问题可持续更新。*
