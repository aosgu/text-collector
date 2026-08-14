# 网页文字采集器（text-collector）

个人自用的 Chrome 扩展：在任意网页**选中文字即自动保存**，点击工具栏图标打开管理页（采集 / 待办双 Tab），采集可查看、复制、删除（可撤销）、收藏、编辑与导出，待办可建清单、勾选、模板复用。

> 纯个人备忘 · 数据完全本地 · 零外部网络请求 · 不对外发布

## 特性

- **选中即存**：监听 `selectionchange` + 500ms 防抖，无需右键菜单、快捷键或复制粘贴
- **智能准入**：长度阈值（中文 ≥5 字 / 英文 ≥3 词，加权混合）、过滤纯符号/纯数字/纯 URL、跳过输入框与可编辑区域
- **去重与扩选合并**：同页同文本不重复保存；5 秒内扩选自动替换旧记录
- **本地存储**：`chrome.storage.local` 分片存储，不发起任何网络请求
- **记录管理**：分页列表、一键复制、删除可撤销（5 秒）、清空（二次确认）、收藏/已保存页签、编辑笔记
- **导出备份**：TXT（UTF-8 BOM）/ JSON，按当前页签过滤
- **采集开关**：管理页开关或快捷键 `Ctrl+Shift+S`，关闭时工具栏图标显示灰色 OFF
- **网站导航**：管理页头部导航图标，hover 展开网站快捷方式分栏面板（新标签页打开），站点列表由包内 `config/nav.json` 配置
- **待办清单**（v1.0.0 起）：管理页顶 Tab 切换到「待办」即可使用：多清单 + 待办项 + 模板库（首启惰性创建「今日待办」），数据与采集完全隔离（`todo_` 前缀存储键）
- **键盘可达**：Tab 导航、焦点陷阱、aria 语义

## 文档地图

| 文档 | 说明 |
|------|------|
| [`docs/_facts.md`](../docs/_facts.md) | **当前事实源**：代码事实清单（页面/模块/操作/数据模型/接口/状态/权限/配置） |
| [`docs/01-PRODUCT.md`](../docs/01-PRODUCT.md) | 产品文档：定义、目标用户、功能全景、非目标 |
| [`docs/02-FEATURES.md`](../docs/02-FEATURES.md) | 功能规格：21 个功能，含交互流程、边界情况、置信度 |
| [`docs/03-USER-FLOWS.md`](../docs/03-USER-FLOWS.md) | 用户流程：8 个关键流程的状态迁移 |
| [`docs/04-ARCHITECTURE.md`](../docs/04-ARCHITECTURE.md) | 技术架构：模块划分、依赖、部署运行 |
| [`docs/05-DATA-MODEL.md`](../docs/05-DATA-MODEL.md) | 数据模型：实体字段、接口清单、数据流向 |
| [`docs/06-DECISIONS.md`](../docs/06-DECISIONS.md) | 技术决策记录（含待确认问题清单） |
| [`docs/CHANGELOG.md`](../docs/CHANGELOG.md) | **变更日志**：v0.8.0 起的版本变更（更早版本见 `docs/archive/legacy-notes.md`） |
| [`docs/_diff-report.md`](../docs/_diff-report.md) | 旧 PRD / README 迭代说明 vs 当前代码的变更对照 |
| [`docs/archive/`](../docs/archive/) | **历史文档，仅供追溯，不作为当前事实来源**（原始 PRD、旧 README 笔记） |

> **迭代约定**：修改业务代码后请同步更新 `docs/_facts.md` 与 `docs/CHANGELOG.md`（涉及功能/流程/架构/数据/决策时一并更新 01–06），并同步 `manifest.json` 与 `package.json` 的版本号；`docs/archive/` 禁止改动。

## 安装

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本仓库的 `text-collector` 文件夹

## 使用

### 采集

- 在任意网页选中文本（中文 ≥5 字或英文 ≥3 词），500ms 后自动保存
- 页面右上角显示采集反馈 toast（已采集 / 已采集过 / 采集失败）
- 太短、纯符号、纯数字、纯 URL、输入框内的选中不会保存
- 先选半句再扩选整句（5 秒内同页面），只保留最终结果

### 管理记录

- 点击工具栏插件图标打开管理页（已打开则直接聚焦）
- 点击卡片文本 → 复制到剪贴板
- 「展开 ↓ / 收起 ↑」切换长文截断
- 🗑 删除（5 秒内可撤销）；已保存笔记删除需二次确认
- 「导出」→ TXT 或 JSON（按当前页签过滤）
- 「清空全部」→ 二次确认；已收藏记录保留在「已保存」页签
- 🔖 收藏笔记；「编辑」修改已保存笔记内容

### 网站导航

- 管理页头部（品牌名右侧）的指南针图标：hover 展开快捷方式面板，点击快捷方式在新标签页打开
- 站点列表**不在前端编辑**，直接改扩展目录里的 `config/nav.json`，刷新管理页即生效：

```json
{
  "columns": [
    {
      "title": "常用",
      "links": [
        { "name": "GitHub", "url": "https://github.com" }
      ]
    }
  ]
}
```

- 每栏 `title` 可选；链接仅放行 http/https；文件缺失或无有效链接时图标自动隐藏

### 采集开关

- 管理页右上角开关：一键暂停/恢复采集
- 快捷键 `Ctrl+Shift+S`：浏览器内切换（非全局快捷键，需 Chrome 前台生效）
- 关闭后工具栏图标显示灰色 OFF

### 待办清单（v1.0.0 起）

- 管理页顶部「**采集 / 待办**」两段文字均为可点击入口；点「待办」切到待办 tab
- 默认 tab 仍是采集；待办 tab 不会自动开启/影响采集
- 待办 tab 内：
  - 左侧栏：清单列表 + 「全部待办 / 已完成 / 模板库」三个视图入口 + 「+ 新建清单」按钮
  - 工作台（清单详情）：输入框 + 待办项（未完成在上，已完成自动沉底并可折叠）
  - 待办项支持双击编辑、勾选完成、悬停删除；未完成项可拖拽手柄排序
  - 删除清单的入口**仅**在工作台顶部「删除清单」按钮（避免侧边栏误触）
  - 模板：把任意清单「存为模板」；模板可一键「使用该模板」（建新清单）或「复制到当前清单」
  - 跨清单汇总：点「全部待办 / 已完成」按清单分组查看
- 首启惰性创建「今日待办」清单（同名仅首次创建）
- 数据完全独立于采集（`todo_lists` / `todo_items_<id>` / `todo_templates` / `todo_today_list_id`，与 `snip_*` 不互通）

## 数据与隐私

- 所有数据仅存于浏览器本地 `chrome.storage.local`（扩展申请了 `unlimitedStorage` 权限）
- 扩展**不发起任何外部网络请求**：无远程同步、无统计上报、无第三方 API（唯一的 `fetch` 读取扩展包内的 `config/nav.json`，走 `chrome-extension://` 同源协议）
- 卸载扩展后数据丢失（无云备份）
- 导出 JSON 仅作离线存档，**插件不提供导入恢复**

## 配置

所有采集/存储/UI 阈值常量集中在 `utils/storage.js` 的 `CONFIG` 对象，优先改常量：

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `MIN_CHINESE_CHARS` | 5 | 中文最小字数（加权） |
| `MIN_ENGLISH_WORDS` | 3 | 英文最小词数（加权） |
| `DEBOUNCE_MS` | 500 | 采集防抖延迟 |
| `PAGE_LOAD_GRACE_MS` | 2000 | 页面加载保护期 |
| `MAX_TEXT_LENGTH` | 5000 | 单条最大字符数（超出截断） |
| `EXPAND_REPLACE_WINDOW_MS` | 5000 | 同页扩选替换窗口 |
| `DEDUP_CHECK_LIMIT` | 500 | 去重检查的最近记录数 |
| `PAGE_SIZE` | 50 | 管理页分页大小 |
| `EXPORT_BATCH_SIZE` | 100 | 导出分批读取大小 |
| `STORAGE_WARNING_THRESHOLD` | 5000 | 存储警告条阈值（条数） |

其他修改入口：主题色 → `manager/manager.css` `:root`；快捷键 → `manifest.json` `commands.toggle-collect`；图标 → `design/` 工具链（**勿手改 `icons/*.png`，那是生成产物**）。

## 开发

```
text-collector/
├── manifest.json          # MV3 配置（权限 / 快捷键 / 内容脚本声明）
├── content/
│   ├── content.js         # 内容脚本：选区监听 + 准入规则 + Shadow DOM toast
│   └── content.css        # toast 宿主钉死样式（与内联样式双保险）
├── manager/
│   ├── manager.html       # 管理页（含 #collect 采集 tab 与 #todo 待办 tab）
│   ├── manager.js         # 入口 / 编排 / 状态（listBridge）/ hash 路由
│   ├── render.js          # 列表渲染 / 卡片 / 删除撤销
│   ├── nav.js             # 网站导航（hover 面板 / 配置读取）
│   ├── modal.js           # 确认 / 编辑弹窗
│   ├── toast.js           # 单实例 toast
│   ├── export.js          # TXT / JSON 导出
│   ├── todo.js            # 待办 tab 入口 / 视图路由 / 事件 / 拖拽
│   ├── todo.css           # 待办模块样式（侧边栏 / 4 视图 / 拖拽视觉）
│   └── manager.css        # 管理页样式（含 :root 变量，被 todo.css 复用）
├── config/
│   └── nav.json           # 网站导航配置（后台文件配置，无前端编辑）
├── background/
│   └── service-worker.js  # 安装初始化 / 图标点击 → manager.html / 快捷键 / badge
├── utils/
│   ├── storage.js         # 采集记录分片存储 + CONFIG 常量
│   └── todo-storage.js    # 待办数据层（todo_ 前缀键，与 snip_* 隔离）
├── icons/                 # 扩展图标（生成产物）
└── tests/                 # vitest 单元测试（Node 环境）
```

- 测试：`cd text-collector && npm install && npm test`（vitest，100 用例：storage 16 + content 39 + nav 9 + todo-storage 36）
- 图标再生成：`cd design && npm install && npm run icons`（sharp 参数化生成）
- 详细技术说明见上方「文档地图」

## 已知限制

- `chrome://` 页面、扩展商店、内置 PDF 阅读器无法采集
- 跨域 iframe 内文本无法采集（`all_frames: false`）
- closed Shadow DOM 内的选中文本可能无法采集
- input / textarea / contenteditable 中的选中文本不采集（设计如此）
- 纯日文假名 / 韩文（不含汉字）易被长度阈值过滤，若常用可在 `CONFIG` 中追加计数规则
- 扩展卸载后数据丢失，建议定期导出 JSON 备份（导出文件仅作离线存档，插件不提供导入恢复）

## License

[MIT](../LICENSE)

当前版本 **v1.0.0**。变更日志见 [`docs/CHANGELOG.md`](../docs/CHANGELOG.md)；v0.7.2 及更早的版本历史见 [`docs/archive/legacy-notes.md`](../docs/archive/legacy-notes.md)（历史文档，仅供追溯）。
