/**
 * 参数化图标生成器 · 方向 D+A（实心品牌蓝底 + 白色衬线引号）
 *
 * 三个尺寸各自绘制，不做等比缩放：
 *  - 128 / 48：Garamond 风格的「球体 + 上扬收尖尾」精细字形（纯 fill 路径）
 *  - 16      ：球体 + 圆头粗描边尾（stroke + round cap 保证最小物理像素宽度）
 *
 * 所有字形都在 100×100 归一化坐标系内绘制，再缩放摆放到目标画布。
 */

// ── 品牌色（与 manager.css 的 --blue 同源）──
const BLUE = '#2F6FED';
const BLUE_TOP = '#3D7BF7';
const BLUE_BOT = '#2159D6';
const INK = '#ffffff';

const r2 = n => Math.round(n * 100) / 100;
const r4 = n => Math.round(n * 10000) / 10000;

/**
 * 精细字形（用于 48 / 128）。
 * 球体与尾巴是两个「同向顺时针」子路径，靠 fill-rule="nonzero" 自然并集；
 * 若两者绕向相反，重叠区会被判为洞（早期版本的 bug）。
 */
function glyphFine(p = {}) {
  const {
    cx = 34, cy = 64, r = 32,
    tipX = 88, tipY = 6,
    inx = 54, iny = 40,
    i1x = 72, i1y = 34,
    i2x = 82, i2y = 20,
    oex = 4.5, oey = 62,
    o1x = 58, o1y = 2,
    o2x = 12, o2y = 22,
  } = p;

  const ball =
    `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx - r} ${cy} Z`;

  const tail =
    `M ${tipX} ${tipY} ` +
    `C ${i2x} ${i2y}, ${i1x} ${i1y}, ${inx} ${iny} ` +
    `L ${oex} ${oey} ` +
    `C ${o2x} ${o2y}, ${o1x} ${o1y}, ${tipX} ${tipY} Z`;

  return `<path fill-rule="nonzero" d="${ball} ${tail}"/>`;
}

/**
 * 简化字形（用于 16）。
 * 尾巴改用「圆头描边」而不是收尖的填充楔形：round cap 保证尾巴在 16px 下
 * 至少有 stroke-width 对应的物理像素宽度，不会像三角形那样退化成两个点。
 */
function glyphBold(p = {}) {
  const {
    cx = 34, cy = 68, r = 30,
    tailW = 26,                       // 尾巴描边宽度（归一化单位）
    qx = 78, qy = 6,                  // 尾巴曲线控制点
    ex = 84, ey = 30,                 // 尾尖
    sx = 30, sy = 44,                 // 尾根（落在球体内，保证与球体连成一体）
  } = p;

  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}"/>` +
    `<path d="M ${sx} ${sy} Q ${qx} ${qy}, ${ex} ${ey}" fill="none" ` +
    `stroke="${INK}" stroke-width="${tailW}" stroke-linecap="round"/>`
  );
}

/**
 * 无衬线字形。
 * 参考 DejaVu Sans / Noto Sans / Inter 的开引号 U+201C 实际字形（见下）：
 *
 *   ┌──┐      短的顶边
 *   │  │
 *  ╱   │      左边斜切（chamfer），右边接近垂直
 * └────┘      宽而平的底边  ← 重量在底部
 *
 * 两个关键点（都是照着真字形量出来的，不是凭感觉）：
 *  1. **开引号是下重上轻**。上宽下窄读出来是「closing 99」，方向会反。
 *  2. 右边缘接近垂直，只有左上角被斜切；不是左右对称的锥形。
 *
 * 用四个角点参数化，便于在「块状(DejaVu)」与「斜切(Inter)」之间连续调节。
 * round > 0 时用等宽描边磨圆尖角（stroke-linejoin=round）。
 */
function glyphSans(p = {}) {
  const {
    top = 4,        // 顶边 y
    bot = 96,       // 底边 y
    topL = 30,      // 顶边左端 x（越大 → 左上角切得越狠）
    topR = 62,      // 顶边右端 x
    botL = 0,       // 底边左端 x
    botR = 52,      // 底边右端 x
    round = 0,      // 圆角量（0 = 尖角）
  } = p;

  const d =
    `M ${topL} ${top} ` +
    `L ${topR} ${top} ` +
    `L ${botR} ${bot} ` +
    `L ${botL} ${bot} Z`;

  const stroke = round > 0
    ? ` stroke="${INK}" stroke-width="${round}" stroke-linejoin="round"`
    : '';

  return `<path d="${d}"${stroke}/>`;
}

/**
 * 组装一枚完整图标的 SVG。
 */
function buildIcon(opts) {
  const {
    size,
    pad = 0,
    radius,
    quoteW,
    gap,
    quoteCY,
    gradient = true,
    bold = false,
    sans = false,     // true → 无衬线楔形字形
    comma = {},
  } = opts;

  const box = size - pad * 2;
  const s = quoteW / 100;
  const quoteH = 100 * s;
  const totalW = quoteW * 2 + gap;
  const x0 = (size - totalW) / 2;
  const y0 = quoteCY - quoteH / 2;
  const glyph = sans ? glyphSans(comma) : bold ? glyphBold(comma) : glyphFine(comma);

  const fill = gradient ? `url(#g${size})` : BLUE;
  const defs = gradient
    ? `\n  <defs>\n` +
      `    <linearGradient id="g${size}" x1="0" y1="${pad}" x2="0" y2="${size - pad}" gradientUnits="userSpaceOnUse">\n` +
      `      <stop offset="0" stop-color="${BLUE_TOP}"/>\n` +
      `      <stop offset="1" stop-color="${BLUE_BOT}"/>\n` +
      `    </linearGradient>\n  </defs>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs}
  <rect x="${pad}" y="${pad}" width="${box}" height="${box}" rx="${radius}" fill="${fill}"/>
  <g fill="${INK}">
    <g transform="translate(${r2(x0)} ${r2(y0)}) scale(${r4(s)})">${glyph}</g>
    <g transform="translate(${r2(x0 + quoteW + gap)} ${r2(y0)}) scale(${r4(s)})">${glyph}</g>
  </g>
</svg>
`;
}

module.exports = { buildIcon, glyphFine, glyphBold, glyphSans, BLUE, BLUE_TOP, BLUE_BOT };
