# 技术架构 — 网页文字采集器

> 当前基线 v1.4.0。Chrome MV3 扩展，原生 JavaScript/CSS，无后端、前端框架或构建步骤。

## 1. 技术栈

| 层 | 技术 |
|---|---|
| 扩展 | Chrome Manifest V3 |
| 语言与界面 | 原生 JavaScript、DOM API、CSS |
| 持久化 | `chrome.storage.local` |
| 脚本 | manifest / HTML 顺序加载，全局函数共享；无运行时 bundler |
| 测试 | Vitest，Node 环境；源码纯函数提取和契约断言 |
| 图标工具 | Node.js + sharp（仅开发期） |

## 2. 运行结构

```text
Chrome
├── Background Service Worker: background/service-worker.js
│   ├── 安装/启动初始化与 toolbar badge
│   ├── 工具栏图标打开或聚焦管理页
│   ├── Ctrl+Shift+S 切换采集开关
│   └── Arena 右键菜单 → tabs.sendMessage → Arena 内容脚本
├── Content Scripts
│   ├── 所有网页: utils/storage.js → content/content.js + content.css
│   └── Arena 对话页: content/arena-exporter.js
├── 管理页: manager/manager.html
│   └── storage.js → toast.js → nav.js → modal.js → render.js → export.js → manager.js
└── chrome.storage.local
    ├── snip_<uuid> + snippets_order
    ├── collectEnabled / schemaVersion / orphanScanV1
    └── 只读配置文件 config/nav.json 随扩展包分发
```

Service Worker、网页内容脚本和管理页各自在隔离上下文运行。采集内容脚本直接读写 `chrome.storage.local`，管理页通过 storage 变更事件同步，SW 负责浏览器级事件和 badge。Arena 对话导出使用明确的 runtime 消息把导出动作从 SW 传给页面内容脚本。

## 3. 模块职责

| 模块 | 文件 | 职责 |
|---|---|---|
| 后台 | `background/service-worker.js` | 扩展安装、打开/聚焦管理页、快捷键、badge、Arena 右键菜单和补注入。 |
| 采集 | `content/content.js`、`content/content.css` | 选区监听、准入过滤、写入记录、页面 toast。 |
| Arena 导出 | `content/arena-exporter.js` | 对话 DOM 提取、Markdown 转换和文件下载。 |
| 管理页 | `manager/manager.js` | 初始化、列表状态桥接、事件绑定、开关、已保存颜色筛选、实时新增记录处理。 |
| 列表渲染 | `manager/render.js` | 卡片、分页、悬停/键盘聚焦书签颜色浮层、收藏、编辑、删除/撤销和错误展示。 |
| 辅助 UI | `manager/modal.js`、`manager/toast.js` | 确认/编辑弹窗和 toast。 |
| 导出 | `manager/export.js` | TXT/JSON 离线导出。 |
| 导航 | `manager/nav.js`、`config/nav.json` | 加载、验证和渲染本地快捷链接配置。 |
| 数据 | `utils/storage.js` | 采集记录存储、去重、扩选替换、孤儿收领及统计。 |

## 4. 脚本加载顺序

网页采集内容脚本：`utils/storage.js` → `content/content.js`。管理页：`utils/storage.js` → `toast.js` → `nav.js` → `modal.js` → `render.js` → `export.js` → `manager.js`。共享模块使用扩展页面全局变量，不引入 ES Module 运行时。

## 5. 运行与验证

- 安装：Chrome `chrome://extensions` → 开启开发者模式 → 加载 `text-collector/`。
- 测试：`cd text-collector && npm install && npm test`（76 项）。
- 图标：`cd design && npm install && npm run icons`。
- 无生产构建命令；`manifest.json` 直接引用仓库源码。
