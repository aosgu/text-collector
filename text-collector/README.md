# 网页文字采集器 Chrome 插件

## 版本历史

| 版本 | 变更内容 |
|------|---------|
| **v0.7.2** | **更换扩展图标**：原图标为暖白底 + 细线蓝括号，底色与 Chrome 工具栏几乎同色、墨量不足 10%，16px 下括号退化成两个灰点，辨识度很低。新图标改为**实心品牌蓝圆角方 + 白色衬线开引号**（方向 D + 实心底策略）：语义从抽象的「选中」转为更直白的「摘录 / 引用」，呼应管理页的衬线气质；实心蓝底保证在浅色 `#DEE1E6` 与深色 `#292A2D` 工具栏上都是一块高对比色。16 / 48 / 128 **三个尺寸各自绘制不等比缩放**——48/128 用 Garamond 风格的「球体 + 收尖尾」精细字形，16px 换用「球体 + 圆头描边尾」的加粗字形（`stroke-linecap="round"` 保证尾巴有最小物理像素宽度，不会糊成圆点）。图标改为**参数化生成**：`design/icon-spec.js`（定稿参数）→ `design/build-icon.js`（字形绘制）→ `node design/make-icons.js` 输出 SVG 源文件与 PNG；`node design/preview.js` 生成验收对比图。管理页 `.brand-mark` 与 `.empty-icon` 同步为新引号字形。 |
| v0.7.1 | **移除导入功能**：该功能缺少实际使用场景，故整体下线。删除管理页「导入」按钮与隐藏的 file input、`utils/storage.js` 的 `importSnippets()`、以及 `handleImport` / `handleImportFileChange`；`manager/import-export.js` 重命名为 `manager/export.js`（现仅含 `handleExport` / `downloadBlob`）。导出功能不受影响，导出的 JSON 结构保持不变。 |
| **v0.7.0** | **新增收藏与编辑功能（已保存页签及二次确认改造）**：1. 卡片左侧增加**收藏按钮**（书签图标 🔖），支持一键收藏/取消收藏；2. 管理页顶部新增「首页」与「已保存」**双页签导航**，点击可查看所有已保存的笔记；3. 改写「清空全部」逻辑，**首页清空**时彻底删除未收藏记录，而已保存笔记仍然保留（`clearedFromHome=true`）并在已保存页面继续显示；4. 针对已保存笔记，**删除时额外提供确认对话框**防止误删；5. 为已保存笔记增加底部**「复制」与「编辑」功能按钮**，点击「复制」快速写入系统剪贴板并提示 Toast；6. 新增**极简纯文字编辑弹窗** (`showEditModal`)，使用纯文本 `<textarea>` 安全编辑笔记内容并记录修改时间；7. 优化导入导出，支持随 JSON 完整恢复 `saved`、`clearedFromHome` 和 `updatedAt` 状态，并针对页签过滤导出文件。 |
| **v0.6.3** | **全量审计 P1/P2 清零**：`adoptOrphanSnippets` 24h 节流 + `order为空强制扫描` + 缺`id`孤儿批量写回；`addSnippet` 写后校验重试(3次)收口并发覆写；`clearAllSnippets` 循环校验(3轮)兜底并发孤儿；`importSnippets` 分批写入(100/批) + order 单独合并；`getStorageEstimate` 均匀采样；`content` 追加 `isSelectionInEditable` 覆盖未聚焦 contenteditable；`detectDarkSurrounding` 支持 hsl/hsla；`render` 的 `loadMore` 加 `try/finally` + 删除撤销补 `incrementLoaded` + 卡片 `role` 由 `button` 改 `group` 消除嵌套告警；`import-export` 的 `handleExport` 加错误兜底；`manifest` 增 `tabs` 权限保证 `tabs.query` 兼容；移除已跟踪的 `.DS_Store` |
| **v0.6.2** | **健壮性 + a11y 加固**：`importSnippets` 加类型守卫（坏记录不会再导致整批导入失败）；`deleteSnippet` 与 `addSnippet` 一致采用"删数据 → 重读 order → 写回"以缩小竞态窗口；清空确认弹窗默认焦点改为「取消」、Enter 键尊重当前焦点、加简易焦点陷阱与 `role="dialog"`/`aria-modal`；卡片支持 Tab 聚焦 + Enter/Space 键盘复制；展开按钮可键盘操作；导出菜单加 Escape/方向键导航、`aria-expanded`/`aria-haspopup`；toast 加 `role="status"`/`aria-live`；toast 宿主内联样式与 `content.css` 属性集同步；file input accept 加 MIME 兜底；清理 CSS 冗余选择器；注释与文档更新 |
| **v0.6.1** | **修复选中后全屏乱码**：toast 宿主 light-DOM 被页面 CSS/`::before` iconfont 污染；恢复并强化 `content.css` 隔离 + 内联 `!important` 双重钉死；安全截断代理对；删除后分页 offset 修正；孤儿扫描健壮性；SW 冷启动 badge 同步 |
| **v0.6** | **视觉重设计（方案 E · 轻霜 × Zed）**：暖白底 `#F5F3EE` + 衬线标题 + Zed 蓝 `#2F6FED`；新 logo（蓝括号 + 选中线）；管理页卡片细描边 + hover 上浮，左侧括号标记；toast 改为轻霜浮片（蓝勾徽标，浅/深页面自适应）；采集状态三态（成功/去重/失败）；删除按钮由 × 改为垃圾桶图标；toast 单实例、modal 键盘支持；orphan 扫描加一次性标记避免每次开页全量遍历 |
| v0.5 | 采集准入规则（长度阈值 + 防抖延迟 + 扩选替换 + 纯符号过滤）；分片存储；单条复制 / 删除撤销 / JSON 导入；图标 badge 状态；浏览器内快捷键 |

## 安装方式

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `text-collector` 文件夹

## 使用方式

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

## 文件结构

| 文件 | 用途 |
|------|------|
| `manifest.json` | 扩展配置文件（MV3） |
| `content/content.js` | 内容脚本：选中检测 + 防抖 + 准入规则 + Shadow DOM toast |
| `content/content.css` | 内容脚本样式（仅作用于 toast 宿主 light-DOM 节点） |
| `manager/manager.html` | 管理页 HTML |
| `manager/manager.js` | 管理页入口：初始化 / 全局状态 / 事件绑定 / storage 实时订阅 / 开关与清空 |
| `manager/render.js` | 管理页列表渲染：卡片创建 / 分页加载 / 计数 / 删除撤销 / 新记录 prepend / 错误态 |
| `manager/toast.js` | 管理页 Toast（单实例）：`showToast` / `dismiss` / `ICON_*` 图标常量 |
| `manager/modal.js` | 管理页确认弹窗：`showConfirmModal` |
| `manager/export.js` | 管理页导出：`handleExport` / `downloadBlob` |
| `manager/manager.css` | 管理页样式（暖白 + 衬线 + 品牌蓝） |
| `background/service-worker.js` | 后台 SW：安装初始化 / 图标点击 / badge / 快捷键 |
| `utils/storage.js` | 分片存储读写工具函数（content 与 manager 共用）+ `CONFIG` 常量 |
| `icons/` | 扩展图标（16/48/128） |

## 已知限制

- `chrome://` 页面、扩展商店、内置 PDF 阅读器无法采集
- 跨域 iframe 内文本无法采集
- closed Shadow DOM 内的选中文本可能无法采集
- input / textarea / contenteditable 中的选中文本不采集（设计如此）
- 纯日文假名 / 韩文（不含汉字）易被长度阈值过滤，若常用可在 `CONFIG` 中追加计数规则
- 扩展卸载后数据丢失，建议定期导出 JSON 备份（导出文件仅作离线存档，插件不提供导入恢复）

## 修改指南

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
| 修改图标 | 改 `design/icon-spec.js` 的形状参数 → 跑 `node design/make-icons.js` 重新生成 `icons/` 下 PNG 与 `design/icon-src/` 下 SVG；管理页品牌 SVG 在 `manager.html` 的 `.brand-mark` 与 `.empty-icon` 中（需手动同步） |

## 安全说明

- 所有来自网页的采集文本均通过 `textContent` 渲染，**不使用 `innerHTML`**
- `innerHTML` 仅用于硬编码的 SVG 图标常量（`ICON_TRASH / ICON_CHECK / ICON_INFO / ICON_ALERT`，以及 toast badge 内联 SVG），不接受用户输入
- Toast 内部 UI 位于 **closed Shadow DOM**，页面 CSS 无法污染内部节点；toast 宿主位于 light DOM，由 `content.css` + 内联 `!important` 双重钉死
- CSP：`script-src 'self'; object-src 'self'`，不加载远程脚本
- 权限：仅申请 `storage` / `unlimitedStorage` / `tabs`（用于聚焦已打开的管理页）/ `<all_urls>` host 权限，不申请 `scripting` / `webRequest` / `cookies` 等敏感权限
