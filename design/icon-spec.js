/**
 * 图标定稿参数 · 方向 D+A（实心品牌蓝底 + 白色衬线引号）
 *
 * 三个尺寸各自调参，不等比缩放：
 *  - 128 / 48：精细字形（球体 + 收尖尾），保留 Garamond 的书卷气
 *  - 16      ：加粗字形（球体 + 圆头描边尾），保证工具栏下可辨识
 */
const { buildIcon } = require('./build-icon.js');

// 精细字形的形状参数（128 / 48 共用，保证两个尺寸长得像同一个字）
const FINE = {
  cx: 34, cy: 64, r: 32,
  tipX: 88, tipY: 6,
  inx: 54, iny: 40,
  i1x: 72, i1y: 34,
  i2x: 82, i2y: 20,
  oex: 4.5, oey: 62,
  o1x: 58, o1y: 2,
  o2x: 12, o2y: 22,
};

// ── 无衬线字形（当前启用：N3 slant）──
// 参考 DejaVu Sans / Inter 的开引号 U+201C：顶边短、右边近垂直、底边宽（下重上轻）。
// 注意开引号是「下重上轻」，上宽下窄会读成 closing 99。
const SANS_SLANT   = { top: 6,  bot: 94, topL: 40, topR: 74, botL: 0, botR: 50 };            // quoteW 46

// 16px 专用：斜边在 16px 下抗锯齿会吃掉墨量（直接缩放只剩 7.4%，楔形仅 2~3px 宽）。
// 这里略收斜度 + 加宽 + 上下拉满，把墨量补回 ~9.8%，楔形实心部分稳定 3px。
const SANS_SLANT_16 = { top: 4, bot: 96, topL: 30, topR: 70, botL: 0, botR: 56 };            // quoteW 50

// ── 备选无衬线变体（未启用，留作对比）──
const SANS_BLOCK   = { top: 6,  bot: 94, topL: 26, topR: 68, botL: 0, botR: 60 };            // quoteW 42
const SANS_ROUNDED = { top: 11, bot: 89, topL: 28, topR: 58, botL: 5, botR: 48, round: 12 }; // quoteW 42

// ── 衬线字形（上一版，未启用；切回把 SPECS 的 comma 换成 FINE/BOLD 并去掉 sans）──

// 16px 加粗字形（C3：陡峭尾巴，凹口最清晰）
const BOLD = {
  cx: 34, cy: 70, r: 30,
  tailW: 28,
  sx: 30, sy: 48,
  qx: 72, qy: 2,
  ex: 74, ey: 22,
};

// 48/128 共用 SANS_SLANT，保证两个尺寸长得像同一个字；16 用补过墨量的 SANS_SLANT_16。
const SPECS = {
  128: { size: 128, pad: 0, radius: 28,  quoteW: 46,      gap: 12,        quoteCY: 62,   sans: true, comma: SANS_SLANT },
  48:  { size: 48,  pad: 0, radius: 11,  quoteW: 46*48/128, gap: 12*48/128, quoteCY: 62*48/128, sans: true, comma: SANS_SLANT },
  16:  { size: 16,  pad: 0, radius: 3.4, quoteW: 50*16/128, gap: 12*16/128, quoteCY: 62*16/128, sans: true, comma: SANS_SLANT_16 },
};

/** 生成指定尺寸的 SVG 字符串。 */
function svgFor(size, extra = {}) {
  const spec = SPECS[size];
  if (!spec) throw new Error(`no spec for size ${size}`);
  return buildIcon({ ...spec, ...extra });
}

module.exports = { SPECS, FINE, BOLD, SANS_BLOCK, SANS_SLANT, SANS_ROUNDED, svgFor };
