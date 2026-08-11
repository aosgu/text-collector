# 图标生成

扩展图标是**参数化生成**的，不要直接手改 `text-collector/icons/` 下的 PNG —— 那是产物，下次重新生成会被覆盖。

## 设计

实心品牌蓝圆角方 + 白色衬线开引号（“），语义为「摘录 / 引用」。

| | |
|---|---|
| 底色 | 品牌蓝渐变 `#3D7BF7 → #2159D6`（与 `manager.css` 的 `--blue: #2F6FED` 同源） |
| 字形 | 白色，参考 Garamond 开引号的「球体 + 上扬收尖尾」 |
| 圆角 | 128 → 28，48 → 11，16 → 3.4（约 22% 边长） |

**三个尺寸各自绘制，不等比缩放**：

- **48 / 128** 用精细字形 `glyphFine()`：球体 + 贝塞尔收尖尾，保留书卷气
- **16** 用加粗字形 `glyphBold()`：球体 + **圆头描边**尾（`stroke-linecap="round"`）

16px 必须换字形，因为收尖的填充尾巴在 16px 下宽度不足 1 物理像素，会退化成「两个圆点」；
改用描边后 `stroke-width` 直接保证了尾巴的最小宽度。

## 文件

| 文件 | 作用 |
|---|---|
| `icon-spec.js` | **定稿参数**（各尺寸的 pad / radius / 字形参数）。调图标改这里 |
| `build-icon.js` | 字形绘制与 SVG 组装，参数化，无副作用 |
| `make-icons.js` | 构建脚本：生成 `icon-src/*.svg` + `../text-collector/icons/*.png` |
| `preview.js` | 生成验收对比图 `preview.png` |
| `icon-src/*.svg` | **生成产物**，供查看 / 复用到页面内联图标 |

## 用法

```bash
cd design
npm install          # 只需一次（sharp）

npm run icons        # 重新生成 SVG 源文件 + PNG
npm run preview      # 生成 preview.png 验收图
```

想在验收图里加上与旧图标的 before/after 对比：

```bash
mkdir -p /tmp/oldicons
for f in icon16 icon48 icon128; do
  git show HEAD:text-collector/icons/$f.png > /tmp/oldicons/$f.png
done
OLD_ICONS_DIR=/tmp/oldicons node preview.js
```

## 注意

改完图标后，管理页里的两处内联品牌 SVG **需要手动同步**（它们复用同一条字形 path）：

- `text-collector/manager/manager.html` → `.brand-mark`（顶栏 logo，24 viewBox）
- `text-collector/manager/manager.html` → `.empty-icon`（空状态插画，48 viewBox）

`content.js` toast 里的 SVG 是状态徽标（对勾 / 感叹号 / info），**不是**品牌标，不需要跟着改。
