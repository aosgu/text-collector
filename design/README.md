# 图标生成

扩展图标是**参数化生成**的，不要直接手改 `text-collector/icons/` 下的 PNG —— 那是产物，下次重新生成会被覆盖。

## 设计

实心品牌蓝圆角方 + 白色**无衬线**开引号（“），语义为「摘录 / 引用」。

字形定板 **N3 slant**（Inter 风格的斜切楔形）：斜度大、几何感强，
在 16px 下是两块实心色块，边缘比衬线版的「球+尾」更干净。

| | |
|---|---|
| 底色 | 品牌蓝渐变 `#3D7BF7 → #2159D6`（与 `manager.css` 的 `--blue: #2F6FED` 同源） |
| 字形 | 白色，参考 Inter / DejaVu Sans 开引号 U+201C 的斜切楔形 |
| 圆角 | 128 → 28，48 → 11，16 → 3.4（约 22% 边长） |

**16px 单独调参，不等比缩放**：

- **48 / 128** 用 `SANS_SLANT`
- **16** 用 `SANS_SLANT_16`：略收斜度 + 加宽 + 上下拉满

斜边在 16px 下会被抗锯齿吃掉墨量——直接等比缩放只剩 **7.4%**，楔形实心部分仅 2~3px 宽，
糊成两根细条。补过参数后墨量回到 **9.8%**，楔形实心 3px，同时保留可见的斜度。

三个尺寸实测墨量：16px 9.8% / 48px 9.3% / 128px 9.6%，视觉重量一致。

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

## 衬线 / 无衬线对比

`compare-serif-sans.png` 是衬线 vs 无衬线的对比图：

```bash
node design/compare-serif-sans.js
```

四个候选都调到**相同墨量**（128px 下白色像素占比 ≈ 9.6%）再比 ——
否则「哪个更显眼」只是在比谁画得更粗，比不出字形差异。

无衬线字形 `glyphSans()` 是照真字形量的，两个容易踩的坑：

1. **开引号是下重上轻**。上宽下窄会读成「closing 99」，方向反了。
2. **右边缘接近垂直**，只有左上角被斜切，不是左右对称的锥形。

最终定板 **N3 slant**（`SANS_SLANT`）。

其余变体仍保留在 `icon-spec.js` 里方便回退：
`SANS_BLOCK`（块状）/ `SANS_ROUNDED`（圆角）/ `FINE` + `BOLD`（衬线版，需去掉 `sans: true`）。
