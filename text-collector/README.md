# 网页文字采集器 Chrome 插件

## 项目简介

浏览任意网页时，用鼠标选中文字即自动保存（带智能过滤，避免噪音）；点击插件图标可查看所有采集记录，支持复制、删除（可撤销）、导出（TXT/JSON）等操作。管理页可一键关闭采集，关闭时工具栏图标变灰提示。

- 个人自用工具 · 不对外发布
- Chrome Manifest V3 扩展
- 零摩擦采集：选中即存，自带智能准入过滤、去重与分片存储

## 安装

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `text-collector` 文件夹

## 使用

### 采集

- 在任意网页选中文本（中文 ≥ 5 字或英文 ≥ 3 词），500ms 后自动保存
- 页面右上角会显示「已采集」轻量 toast（不影响页面布局与文字渲染）
- 选中太短、纯符号、纯数字、纯 URL 不会保存
- 先选半句再扩选整句（5 秒内同页面），只保留最终结果

### 管理记录

- 点击工具栏插件图标，打开管理页
- 点击卡片（或 Tab 聚焦后按 Enter/Space）→ 复制到剪贴板
- 点击「展开 ↓ / 收起 ↑」→ 切换文本截断
- 点击 🗑 → 删除（5 秒内可撤销）
- 「导出」→ TXT 或 JSON 格式
- 「清空全部」→ 需二次确认（默认焦点在「取消」）

### 采集开关

- 管理页右上角开关：一键暂停/恢复采集
- 快捷键 `Ctrl+Shift+S`：在 Chrome 窗口内切换采集开关（非全局；需在 Chrome 前台生效）
- 关闭后图标显示灰色 `OFF` 标记
- 开关状态浏览器重启后保持

### 键盘操作

- `Tab` / `Shift+Tab`：在卡片、按钮、开关之间导航
- `Enter` / `Space`：触发聚焦按钮 / 复制聚焦卡片 / 切换开关
- `Esc`：关闭导出菜单 / 关闭确认弹窗
- `↑` / `↓`：在导出菜单内移动焦点

## 配置

所有采集/存储/UI 阈值常量集中在 `utils/storage.js` 的 `CONFIG` 对象里，优先改常量。

| 需求 | 修改位置 |
|------|---------|
| 调整最小长度阈值（中文/英文） | `utils/storage.js` → `CONFIG.MIN_CHINESE_CHARS` / `CONFIG.MIN_ENGLISH_WORDS` |
| 调整防抖时间 | `utils/storage.js` → `CONFIG.DEBOUNCE_MS` |
| 调整页面加载保护期 | `utils/storage.js` → `CONFIG.PAGE_LOAD_GRACE_MS` |
| 调整扩选替换窗口 | `utils/storage.js` → `CONFIG.EXPAND_REPLACE_WINDOW_MS` |
| 调整单条最大字符数 | `utils/storage.js` → `CONFIG.MAX_TEXT_LENGTH` |
| 调整管理页分页大小 | `utils/storage.js` → `CONFIG.PAGE_SIZE` |
| 修改 toast 样式 / 图标 | `content/content.js` → `showToast()` 内 Shadow DOM 的 `<style>` 与 SVG；toast 宿主 light-DOM 几何样式同时在 `content/content.css` 与内联 `cssText` 两处，需同步修改 |
| 修改管理页主题色 | `manager/manager.css` → `:root` 中的 CSS 变量 |
| 修改快捷键 | `manifest.json` → `commands.toggle-collect.suggested_key`（注意：MV3 非全局快捷键，如需全局需加 `"global": true`） |
| 修改图标 | 直接替换 `icons/` 下的 PNG 文件；管理页品牌 SVG 在 `manager.html` 的 `.brand-mark` 与 `.empty-icon` 中（需手动同步） |

## License

本项目为个人自用工具，未指定开源 License，不对外发布。
