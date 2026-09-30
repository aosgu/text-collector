# 数据模型与数据流 — 网页文字采集器

> 当前基线 v1.4.0。没有数据库或后端；运行时业务数据保存在浏览器 `chrome.storage.local`。接口均为本地 JavaScript 函数，不是网络 API。

## 1. 持久化实体

### Snippet：`snip_<uuid>`

每条记录独立存储，便于并发写入；`snippets_order` 保存有序 id 索引。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | UUID，记录主键与 key 后缀。 |
| `text` | string | NFC 规范化后的采集正文，单条最多 5000 字符。 |
| `url` | string | 采集时页面 URL。 |
| `urlKey` | string | URL 的 origin + pathname，用于去重与扩选合并。 |
| `title` / `domain` | string | 页面标题与 hostname。 |
| `capturedAt` / `lastSelectedAt` | number | 首次采集与最近选中时间（epoch ms）。 |
| `saved` | boolean? | 收藏标记。未设置表示未收藏。 |
| `color` | string? | 可选颜色 ID：`red` / `orange` / `yellow` / `green` / `blue` / `purple` / `gray`；每条已保存记录最多一个标签。 |
| `clearedFromHome` | boolean? | 清空首页时用于保留收藏记录的标记。 |
| `updatedAt` | number? | 最近编辑时间。 |

### 索引与元数据

| 键 | 类型 | 说明 |
|---|---|---|
| `snippets_order` | string[] | 按最新优先排列的记录 id 索引。 |
| `collectEnabled` | boolean | 采集开关；缺失时视为开启。 |
| `schemaVersion` | number | 当前存储结构版本为 1。 |
| `orphanScanV1` | number | 孤儿记录扫描时间，用于 24 小时节流。 |

### 静态导航配置

`config/nav.json` 随扩展包分发，不属于 `chrome.storage.local`。`manager/nav.js` 校验配置并只接受 `http:` / `https:` 链接。

## 2. 核心数据操作

`utils/storage.js` 提供 UUID / URL 工具，以及 `addSnippet`、`deleteSnippet`、`filterOrderRecords`、`getFilteredOrder`、`clearAllSnippets`、`getSnippets`、`getAllSnippets`、`toggleFavoriteSnippet`、`setSnippetColor`、`updateSnippetText`、采集开关读写、日期和存储估算等函数。列表、导出、日期和占用估算查询均可接收可选颜色过滤参数。

### 新增记录

1. 正文 NFC 规范化，计算 `urlKey` 和域名。
2. 检查最近最多 500 条记录：同 URL 同文案刷新选中时间；5 秒内新文本包含旧文本则替换旧记录。
3. 否则先写 `snip_<uuid>`，再更新 `snippets_order`。

### 清空与修复

- `clearAllSnippets` 删除未收藏记录，收藏记录保留并标记；管理页有二次确认。
- `adoptOrphanSnippets` 按需扫描 `snip_*`，收领不在索引中的有效记录；普通完整索引情况下最多每 24 小时全量扫描一次。

## 3. 数据流

```text
网页选区
  → content/content.js（准入、防抖、过滤）
  → utils/storage.js:addSnippet
  → snip_<uuid> + snippets_order
  → chrome.storage.onChanged
  → manager/manager.js + manager/render.js 更新记录列表
```

管理页的筛选、复制、收藏、删除、编辑和导出均在本地完成。Arena 导出读取页面 DOM 并直接下载 Markdown，不写入采集记录存储。

## 4. 本地数据兼容说明

v1.3.0 已移除旧版本待办功能，不再读取或写入 `todo_*` 键。为避免静默销毁用户数据，扩展升级时不会清理旧版遗留键；它们不会影响当前采集功能，也不再有对应 UI 或代码访问。
