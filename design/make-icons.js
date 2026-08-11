/**
 * 由 design/icon-spec.js 生成扩展图标。
 *
 * 流程：icon-spec.js（参数） → icon-src/*.svg（可读源文件） → text-collector/icons/*.png
 *
 * 三个尺寸各自调参绘制（见 icon-spec.js），不是等比缩放：
 * 16px 用加粗字形，48/128 用精细字形。
 *
 * 用法：node design/make-icons.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { svgFor } = require('./icon-spec.js');

const srcDir = path.join(__dirname, 'icon-src');
const outDir = path.join(__dirname, '..', 'text-collector', 'icons');

const targets = [
  { size: 128, svg: 'icon.svg',   png: 'icon128.png' },
  { size: 48,  svg: 'icon48.svg', png: 'icon48.png'  },
  { size: 16,  svg: 'icon16.svg', png: 'icon16.png'  },
];

(async () => {
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const t of targets) {
    const svg = svgFor(t.size);

    // 1) 写出 SVG 源文件，方便直接查看 / 手改 / 复用到页面内联图标
    fs.writeFileSync(path.join(srcDir, t.svg), svg);

    // 2) 高 density 光栅化后再落到目标尺寸，保证曲线边缘干净
    await sharp(Buffer.from(svg), { density: 2048 })
      .resize(t.size, t.size)
      .png({ compressionLevel: 9 })
      .toFile(path.join(outDir, t.png));

    console.log(`wrote ${t.svg} + ${t.png} (${t.size}px)`);
  }
})();
