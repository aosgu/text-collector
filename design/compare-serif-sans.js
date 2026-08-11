/**
 * 衬线 vs 无衬线引号对比图 → design/compare-serif-sans.png
 *
 * 四个候选都调到 **相同墨量**（128px 下白色像素占比 ≈ 9.6%）再比，
 * 否则「哪个更显眼」只是在比谁画得更粗，不是在比字形。
 *
 * 用法：node design/compare-serif-sans.js
 */
const sharp = require('sharp');
const path = require('path');
const { buildIcon } = require('./build-icon.js');
const { svgFor } = require('./icon-spec.js');

const OUT = path.join(__dirname, 'compare-serif-sans.png');

const LIGHT = { r: 222, g: 225, b: 230, alpha: 1 };
const DARK  = { r: 41,  g: 42,  b: 45,  alpha: 1 };
const PAPER = { r: 245, g: 243, b: 238, alpha: 1 };

// 等墨量参数（由 _match 扫描得出）
const sans = (comma, quoteW) => s => buildIcon({
  size: s, pad: 0, radius: s * 28 / 128, gap: s * 12 / 128,
  quoteCY: s * 62 / 128, quoteW: s * quoteW / 128, sans: true, comma,
});

const CANDS = [
  { key: 'serif', name: 'SERIF  (current)', note: 'Garamond ball+tail', svg: s => svgFor(s) },
  { key: 'n1', name: 'SANS N1  block',   note: 'DejaVu-like, near-vertical right edge',
    svg: sans({ top: 6, bot: 94, topL: 26, topR: 68, botL: 0, botR: 60 }, 42) },
  { key: 'n3', name: 'SANS N3  slant',   note: 'Inter-like, stronger diagonal',
    svg: sans({ top: 6, bot: 94, topL: 40, topR: 74, botL: 0, botR: 50 }, 46) },
  { key: 'n4', name: 'SANS N4  rounded', note: 'soft corners, friendliest',
    svg: sans({ top: 11, bot: 89, topL: 28, topR: 58, botL: 5, botR: 48, round: 12 }, 42) },
];

const W = 1000;
const txt = (s, size, color, w = W, weight = 'normal') =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size + 8}">` +
    `<text x="0" y="${size}" font-family="DejaVu Sans, sans-serif" font-size="${size}" ` +
    `font-weight="${weight}" fill="${color}">${s}</text></svg>`
  );

(async () => {
  const comp = [];
  let y = 20;

  comp.push({ input: txt('Serif vs Sans quotes — matched ink weight (~9.6% at 128px)', 20, '#1c1d20', W, 'bold'), top: y, left: 24 });
  y += 32;
  comp.push({ input: txt('All four carry the same amount of white, so this compares letterform — not stroke weight.', 13, '#6b6b66'), top: y, left: 24 });
  y += 34;

  const COL = 236;

  // ── 大图一排 ──
  for (let i = 0; i < CANDS.length; i++) {
    const c = CANDS[i];
    const big = await sharp(Buffer.from(c.svg(128)), { density: 2048 }).resize(128, 128).png().toBuffer();
    comp.push({ input: big, top: y, left: 24 + i * COL });
    comp.push({ input: txt(c.name, 13, '#1c1d20', COL - 12, 'bold'), top: y + 138, left: 24 + i * COL });
    comp.push({ input: txt(c.note, 11, '#8a8880', COL - 12), top: y + 156, left: 24 + i * COL });
  }
  y += 190;

  // ── 工具栏真实尺寸：浅色 / 深色 ──
  for (const [label, bg, fg] of [['Light toolbar #DEE1E6', LIGHT, '#666'], ['Dark toolbar #292A2D', DARK, '#999']]) {
    comp.push({ input: txt(label, 12, fg), top: y, left: 24 });
    y += 18;

    const barH = 46, barW = W - 48;
    const inner = [];
    for (let i = 0; i < CANDS.length; i++) {
      const p16 = await sharp(Buffer.from(CANDS[i].svg(16)), { density: 2048 }).resize(16, 16).png().toBuffer();
      // 每个候选并排放三枚，模拟工具栏里挤在一起的样子
      for (let k = 0; k < 3; k++) {
        inner.push({ input: p16, top: 15, left: 20 + i * COL + k * 26 });
      }
    }
    const bar = await sharp({ create: { width: barW, height: barH, channels: 4, background: bg } })
      .composite(inner).png().toBuffer();
    comp.push({ input: bar, top: y, left: 24 });
    y += barH + 20;
  }

  // ── 16px 放大像素图 ──
  comp.push({ input: txt('16px, magnified 7x — what the toolbar actually rasterises', 12, '#666'), top: y, left: 24 });
  y += 20;
  for (let i = 0; i < CANDS.length; i++) {
    const p16 = await sharp(Buffer.from(CANDS[i].svg(16)), { density: 2048 }).resize(16, 16).png().toBuffer();
    const z = await sharp(p16).resize(112, 112, { kernel: 'nearest' }).png().toBuffer();
    comp.push({ input: z, top: y, left: 24 + i * COL });
  }
  y += 130;

  await sharp({ create: { width: W, height: y, channels: 4, background: PAPER } })
    .composite(comp).png().toFile(OUT);
  console.log('wrote', OUT, `${W}x${y}`);
})();
