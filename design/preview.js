/**
 * 生成图标验收对比图 design/preview.png
 *
 * 内容：图标在 Chrome 浅色 / 深色工具栏底色上的真实尺寸效果 +
 *      16 / 48 / 128 三尺寸放大像素图 + （可选）与旧图标的 before/after 对比。
 *
 * 用法：
 *   node design/preview.js
 *
 *   # 想加上与旧图标的对比，先把旧 PNG 导出到某个目录再指过去：
 *   mkdir -p /tmp/oldicons
 *   for f in icon16 icon48 icon128; do \
 *     git show HEAD:text-collector/icons/$f.png > /tmp/oldicons/$f.png; done
 *   OLD_ICONS_DIR=/tmp/oldicons node design/preview.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { svgFor } = require('./icon-spec.js');

const OUT = path.join(__dirname, 'preview.png');
const ICONS = path.join(__dirname, '..', 'text-collector', 'icons');

const LIGHT = { r: 222, g: 225, b: 230, alpha: 1 };  // Chrome 浅色工具栏 #DEE1E6
const DARK  = { r: 41,  g: 42,  b: 45,  alpha: 1 };  // Chrome 深色工具栏 #292A2D
const PAPER = { r: 245, g: 243, b: 238, alpha: 1 };  // 品牌暖白 #F5F3EE

const W = 900;
const txt = (s, size, color, w = W) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size + 8}">` +
    `<text x="0" y="${size}" font-family="DejaVu Sans, sans-serif" font-size="${size}" fill="${color}">${s}</text></svg>`
  );

(async () => {
  const png = async size => sharp(Buffer.from(svgFor(size)), { density: 2048 })
    .resize(size, size).png().toBuffer();

  const new16 = await png(16), new48 = await png(48), new128 = await png(128);
  const comp = [];
  let y = 0;

  // ── 标题 ──
  comp.push({ input: txt('Text Collector — new icon (blue slab + white serif quotes)', 20, '#1c1d20'), top: y, left: 24 });
  y += 40;

  // ── 工具栏模拟：浅色 / 深色 ──
  for (const [name, bg, fg] of [['Light toolbar  #DEE1E6', LIGHT, '#1c1d20'], ['Dark toolbar  #292A2D', DARK, '#ffffff']]) {
    const barH = 54;
    const bar = await sharp({ create: { width: W - 48, height: barH, channels: 4, background: bg } })
      .composite([
        // 新图标 ×3（真实 16px，模拟工具栏并排）
        { input: new16, top: 19, left: 24 },
        { input: new16, top: 19, left: 60 },
        { input: new16, top: 19, left: 96 },
      ]).png().toBuffer();
    comp.push({ input: txt(name, 13, fg === '#ffffff' ? '#666' : '#666'), top: y, left: 24 });
    y += 20;
    comp.push({ input: bar, top: y, left: 24 });
    y += barH + 18;
  }

  // ── 三尺寸放大像素图 ──
  comp.push({ input: txt('Pixel view — each size drawn separately (16px uses a bolder glyph)', 14, '#666'), top: y, left: 24 });
  y += 24;

  const zooms = [
    { p: new16,  s: 16,  z: 8 },
    { p: new48,  s: 48,  z: 2.6 },
    { p: new128, s: 128, z: 1 },
  ];
  let x = 24;
  for (const zm of zooms) {
    const side = Math.round(zm.s * zm.z);
    const z = await sharp(zm.p).resize(side, side, { kernel: 'nearest' }).png().toBuffer();
    comp.push({ input: z, top: y, left: x });
    comp.push({ input: txt(`${zm.s}px`, 12, '#888', 80), top: y + side + 6, left: x });
    x += side + 28;
  }
  y += 128 + 30;

  // ── 与旧图标对比（旧 PNG 从 git HEAD 取，仅在存在时绘制）──
  const OLDDIR = process.env.OLD_ICONS_DIR;
  if (OLDDIR && fs.existsSync(path.join(OLDDIR, 'icon16.png'))) {
    comp.push({ input: txt('Before / after at true toolbar size (16px)', 14, '#666'), top: y, left: 24 });
    y += 24;

    const old16 = await sharp(path.join(OLDDIR, 'icon16.png')).resize(16, 16).png().toBuffer();
    const barH = 58, barW = 400;

    for (const [name, bg, fg] of [['light', LIGHT, '#333'], ['dark', DARK, '#ddd']]) {
      const bar = await sharp({ create: { width: barW, height: barH, channels: 4, background: bg } })
        .composite([
          { input: old16, top: 21, left: 60 },
          { input: old16, top: 21, left: 96 },
          { input: new16, top: 21, left: 250 },
          { input: new16, top: 21, left: 286 },
          { input: txt('OLD', 11, fg, 40), top: 24, left: 16 },
          { input: txt('NEW', 11, fg, 40), top: 24, left: 206 },
        ]).png().toBuffer();
      comp.push({ input: bar, top: y, left: 24 });
      comp.push({ input: txt(name, 12, '#888', 200), top: y + barH + 4, left: 24 });
      y += barH + 26;
    }
  }

  const H = y + 20;
  await sharp({ create: { width: W, height: H, channels: 4, background: PAPER } })
    .composite(comp).png().toFile(OUT);
  console.log('wrote', OUT, `${W}x${H}`);
})();
