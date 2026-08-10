# 网页文字采集器 Chrome 插件

## 版本历史

| 版本 | 变更内容 |
|------|---------|
| **v0.6** | **视觉重设计（方案 E · 轻霜 × Zed）**：暖白底 `#F5F3EE` + 衬线标题 + Zed 蓝 `#2F6FED`；新 logo（蓝括号 + 选中线）；管理页卡片细描边 + hover 上浮，左侧括号标记；toast 改为轻霜浮片（蓝勾徽标，浅/深页面自适应）；采集状态分三态（成功/去重/失败）；删除按钮由 × 改为垃圾桶图标；toast 单实例、modal 键盘支持；orphan 扫描加一次性标记避免每次开页全量遍历 |
| v0.5 | 采集准入规则（长度阈值 + 防抖延迟 + 扩选替换 + 纯符号过滤）；分片存储；单条复制 / 删除撤销 / JSON 导入；图标 badge 状态；全局快捷键 |

## 安装方式

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `text-collector` 文件夹

## 使用方式

### 采集
- 在任意网页选中文本（中文 ≥ 5 字或英文 ≥ 3 词），500ms 后自动保存
- 页面右上角会显示「已采集 ✓」提示
- 选中太短、纯符号、纯数字、纯 URL 不会保存
- 先选半句再扩选整句（5 秒内同页面），只保留最终结果

### 管理记录
- 点击工具栏插件图标，打开管理页
- 点击卡片文本 → 复制到剪贴板
- 点击 🗑 → 删除（5 秒内可撤销）
- 「导出」→ TXT 或 JSON 格式
- 「导入」→ 从 JSON 文件恢复
- 「清空全部」→ 需二次确认

### 采集开关
- 管理页右上角开关：一键暂停/恢复采集
- 快捷键 `Ctrl+Shift+S`：全局切换开关
- 关闭后图标显示灰色 `OFF` 标记
- 开关状态浏览器重启后保持

## 文件结构

| 文件 | 用途 |
|------|------|
| `manifest.json` | 扩展配置文件 |
| `content/content.js` | 内容脚本：选中检测 + 防抖 + 准入规则 + toast |
| `content/content.css` | 内容脚本样式 |
| `manager/manager.html` | 管理页 HTML |
| `manager/manager.js` | 管理页逻辑：列表/复制/删除/撤销/导出/导入/开关 |
| `manager/manager.css` | 管理页样式 |
| `background/service-worker.js` | 后台：安装初始化/图标点击/badge/快捷键 |
| `utils/storage.js` | 分片存储读写工具函数 |
| `icons/` | 扩展图标 |

## 已知限制

- `chrome://` 页面、扩展商店、内置 PDF 阅读器无法采集
- 跨域 iframe 内文本无法采集
- Shadow DOM 内选中文本可能无法采集
- input / textarea / contenteditable 中的选中文本不采集（设计如此）
- 扩展卸载后数据丢失，建议定期导出 JSON 备份

## 修改指南

| 需求 | 修改位置 |
|------|---------|
| 调整最小长度阈值 | `content/content.js` → `meetsLengthThreshold()` |
| 调整防抖时间 | `content/content.js` → `setTimeout(processSelection, 500)` |
| 调整扩选替换窗口 | `utils/storage.js` → `addSnippet()` 中的 `5000` |
| 修改 toast 样式 | `content/content.js` → Shadow DOM 内的 `<style>` |
| 修改管理页主题色 | `manager/manager.css` → `:root` 中的 CSS 变量 |
| 修改快捷键 | `manifest.json` → `commands.toggle-collect.suggested_key` |
| 修改图标 | 替换 `icons/` 下的 PNG 文件 |
