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

// 16px 加粗字形（C3：陡峭尾巴，凹口最清晰）
const BOLD = {
  cx: 34, cy: 70, r: 30,
  tailW: 28,
  sx: 30, sy: 48,
  qx: 72, qy: 2,
  ex: 74, ey: 22,
};

const SPECS = {
  128: { size: 128, pad: 0, radius: 28, quoteW: 42, gap: 10, quoteCY: 62, comma: FINE },
  48:  { size: 48,  pad: 0, radius: 11, quoteW: 16, gap: 3.6, quoteCY: 23.5, comma: FINE },
  16:  { size: 16,  pad: 0, radius: 3.4, quoteW: 6,  gap: 1.5, quoteCY: 7.8, bold: true, comma: BOLD },
};

/** 生成指定尺寸的 SVG 字符串。 */
function svgFor(size, extra = {}) {
  const spec = SPECS[size];
  if (!spec) throw new Error(`no spec for size ${size}`);
  return buildIcon({ ...spec, ...extra });
}

module.exports = { SPECS, FINE, BOLD, svgFor };
