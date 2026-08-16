/**
 * content.js 纯函数单元测试：
 *   meetsLengthThreshold / isPureURL / isPureNumber / isPureSymbol / truncateText
 *
 * 用语法提取拿到函数体（不执行浏览器代码），其中 meetsLengthThreshold 依赖
 * storage.js 的 CONFIG（MIN_CHINESE_CHARS=5 / MIN_ENGLISH_WORDS=3），
 * 这里注入从真实源码里提取的 CONFIG 对象，保持与线上一致。
 *
 * 所有 emoji/生僻字用 \u{...} 转义构造（避免源文件编码问题），
 * 其 UTF-16 code unit 结构完全确定：基本 emoji 2 个，ZWJ 序列每个成员各占 2 个。
 */

import { describe, it, expect } from 'vitest';
import { readSource, extractFunction, extractObjectLiteral } from './helpers/load-source.js';

const contentSource = readSource('content/content.js');
const contentCssSource = readSource('content/content.css');
const storageSource = readSource('utils/storage.js');

// 注入与 storage.js 顶层 CONFIG 同源的真实常量（当前为 5 / 3），避免测试里硬编码漂移
const CONFIG = extractObjectLiteral(storageSource, 'CONFIG');

// meetsLengthThreshold 的函数体引用 CONFIG（在浏览器里来自 storage.js 全局），
// 测试时通过 deps 注入同名参数，不改动函数实现
const { fn: meetsLengthThreshold } = extractFunction(contentSource, 'meetsLengthThreshold', { CONFIG });
const { fn: isPureURL } = extractFunction(contentSource, 'isPureURL');
const { fn: isPureNumber } = extractFunction(contentSource, 'isPureNumber');
const { fn: isPureSymbol } = extractFunction(contentSource, 'isPureSymbol');
const { fn: truncateText } = extractFunction(contentSource, 'truncateText');

const meets = (t) => meetsLengthThreshold(t, CONFIG);

// ── 代理对相关常量（code unit 结构确定） ──
const GRIN = '\u{1F600}';          // 😀 笑脸（2 个 code unit）
const MAN = '\u{1F468}';           // 👨（2）
const WOMAN = '\u{1F469}';         // 👩（2）
const GIRL = '\u{1F467}';          // 👧（2）
const ZWJ = '\u200D';              // 零宽连接符（1）
const FAMILY = MAN + ZWJ + WOMAN + ZWJ + GIRL; // 👨👩👧 家庭 emoji（8 个 code unit）
const RARE = '\u{20000}';          // 𠀀 补充平面生僻字（2）

describe('meetsLengthThreshold（加权混合：中文/5 + 英文/3 >= 1）', () => {
  it('纯中文达到 5 字通过（注释：纯中文需 ≥5 字）', () => {
    expect(meets('这是一个测试文本')).toBe(true); // 7 字
    expect(meets('五个中文字')).toBe(true);       // 5 字，恰好等于阈值
  });

  it('纯中文不足 5 字不通过', () => {
    expect(meets('四个字啊')).toBe(false);        // 4 字
    expect(meets('你好')).toBe(false);            // 2 字
  });

  it('纯英文达到 3 词通过（注释：纯英文需 ≥3 词）', () => {
    expect(meets('hello world test')).toBe(true); // 恰好 3 词
    expect(meets('one two three four')).toBe(true);
  });

  it('纯英文不足 3 词不通过', () => {
    expect(meets('hello world')).toBe(false);
    expect(meets('single')).toBe(false);
  });

  it('混合文本按比例加权', () => {
    // 2 中文(2/5) + 2 英文词(2/3) ≈ 1.07 ≥ 1
    expect(meets('你好 hello world')).toBe(true);
    // 2 中文(2/5) + 1 英文词(1/3) ≈ 0.73 < 1
    expect(meets('你好 hello')).toBe(false);
    // 1 中文(0.2) + 3 英文词(1.0) = 1.2 ≥ 1
    expect(meets('的 one two three')).toBe(true);
  });

  it('边界：恰好 2 中文 + 2 英文词（2/5 + 2/3 ≈ 1.07）通过', () => {
    expect(meets('测试 one two')).toBe(true);
  });

  it('数字/标点不计入权重', () => {
    expect(meets('12345 67890')).toBe(false);
    expect(meets('！！！')).toBe(false);
  });

  it('空串不通过', () => {
    expect(meets('')).toBe(false);
  });
});

describe('isPureURL（仅 http/https/ftp/file、全 ASCII 可见字符、长度 > 10）', () => {
  it('合法纯 URL 通过', () => {
    expect(isPureURL('https://example.com/article/1')).toBe(true);
    expect(isPureURL('http://example.com')).toBe(true);
    expect(isPureURL('ftp://files.example.com/a')).toBe(true);
    expect(isPureURL('file:///tmp/test.txt')).toBe(true);
  });

  it('长度边界：>10 才通过（注释：长度 > 10 的纯 URL）', () => {
    expect(isPureURL('https://a.b')).toBe(true);  // 11 字符（单字母域名也通过）
    expect(isPureURL('https://ab')).toBe(false);  // 10 字符
    expect(isPureURL('http://a.bc')).toBe(true);  // 11 字符
    expect(isPureURL('http://abc')).toBe(false);  // 10 字符
  });

  it('URL 里混了中文 → 普通文本（注释：含中文/emoji 一律按普通文本处理）', () => {
    expect(isPureURL('https://example.com/中文路径')).toBe(false);
    expect(isPureURL(`https://例子.com/a`)).toBe(false);
  });

  it('URL 里混了 emoji → 普通文本', () => {
    expect(isPureURL(`https://example.com/a${GRIN}b`)).toBe(false);
    expect(isPureURL(`https://example.com/${GRIN}/a`)).toBe(false);
  });

  it('URL 里混了中文标点/全角符号 → 普通文本', () => {
    expect(isPureURL('https://example.com/a，b')).toBe(false);
    expect(isPureURL('https://example.com/a。b')).toBe(false);
  });

  it('URL 里混了空格 → 普通文本（空格在 URL 中通常编码为 %20）', () => {
    expect(isPureURL('https://example.com/a b')).toBe(false);
    expect(isPureURL('https://example.com/a  b')).toBe(false);
  });

  it('包含链接的普通句子不误判为 URL', () => {
    expect(isPureURL('看这里 https://example.com 详情')).toBe(false);
    expect(isPureURL('https://example.com 和其他文字')).toBe(false);
  });

  it('非 http/https/ftp/file 协议不通过', () => {
    expect(isPureURL('javascript:alert(1)')).toBe(false);
    expect(isPureURL('mailto:test@example.com')).toBe(false);
    expect(isPureURL('chrome-extension://abc')).toBe(false);
  });

  it('首尾空白被 trim 后仍可识别；纯空白不通过', () => {
    expect(isPureURL('  https://example.com/a  ')).toBe(true);
    expect(isPureURL('   ')).toBe(false);
  });
});

describe('isPureNumber（仅数字，含小数点、逗号）', () => {
  it('纯数字通过', () => {
    expect(isPureNumber('12345')).toBe(true);
    expect(isPureNumber('0')).toBe(true);
  });

  it('含小数点、逗号、千分位通过（注释：含小数点、逗号）', () => {
    expect(isPureNumber('3.14')).toBe(true);
    expect(isPureNumber('1,000,000')).toBe(true);
    expect(isPureNumber('12,345.67')).toBe(true);
  });

  it('含空白（换行分隔的数字）通过', () => {
    expect(isPureNumber('12 34')).toBe(true);
    expect(isPureNumber('1,234\n5,678')).toBe(true);
  });

  it('实现允许小数点重复出现（[\\d.,\\s] 不校验格式）', () => {
    expect(isPureNumber('12.3.4')).toBe(true);
  });

  it('混入非数字字符（字母/符号/中文）不通过', () => {
    expect(isPureNumber('12a34')).toBe(false);
    expect(isPureNumber('12-34')).toBe(false);
    expect(isPureNumber('12-3.4')).toBe(false);
    expect(isPureNumber('12%')).toBe(false);
    expect(isPureNumber('十二十三')).toBe(false);
    expect(isPureNumber('1,000元')).toBe(false);
  });

  it('空串不通过', () => {
    expect(isPureNumber('')).toBe(false);
  });
});

describe('isPureSymbol（仅标点符号和空白）', () => {
  it('ASCII 标点与空白通过', () => {
    expect(isPureSymbol('!!!')).toBe(true);
    expect(isPureSymbol('...')).toBe(true);
    expect(isPureSymbol(' \n\t')).toBe(true);
  });

  it('中文全角标点通过（\\p{P} 覆盖）', () => {
    expect(isPureSymbol('，。！？')).toBe(true);
    expect(isPureSymbol('《》「」')).toBe(true);
    expect(isPureSymbol('（@#￥）')).toBe(true);
    expect(isPureSymbol('——')).toBe(true);
  });

  it('emoji 与特殊符号通过（注释：\\p{S} 支持所有 Unicode 符号）', () => {
    expect(isPureSymbol(`${GRIN}`)).toBe(true);
    expect(isPureSymbol('★')).toBe(true);
    expect(isPureSymbol('©')).toBe(true);
  });

  it('混入文字（中文/英文/数字）不通过', () => {
    expect(isPureSymbol('!!!文字')).toBe(false);
    expect(isPureSymbol('hello!')).toBe(false);
    expect(isPureSymbol('123!')).toBe(false);
    expect(isPureSymbol('1,234')).toBe(false); // 数字不属于 P/S
    expect(isPureSymbol('。你好。')).toBe(false);
  });

  it('空串不通过', () => {
    expect(isPureSymbol('')).toBe(false);
  });
});

describe('truncateText（UTF-16 code unit 截断，绝不在代理对中间切断）', () => {
  it('不超过上限原样返回', () => {
    expect(truncateText('hello', 5)).toBe('hello');
    expect(truncateText('hello', 10)).toBe('hello');
    expect(truncateText('你好', 2)).toBe('你好');
  });

  it('maxLength <= 0 返回空串', () => {
    expect(truncateText('hello', 0)).toBe('');
    expect(truncateText('hello', -1)).toBe('');
  });

  it('普通 BMP 字符直接截断', () => {
    expect(truncateText('hello world', 5)).toBe('hello');
    expect(truncateText('abcdefghij', 7)).toBe('abcdefg');
    expect(truncateText('中文测试文本', 3)).toBe('中文测');
  });

  it('截断点正好落在 emoji 代理对中间 → 回退 1 个 code unit（注释场景）', () => {
    // 'a😀b' = a(0) D83D(1) DE00(2) b(3)；maxLength=2 的截断点恰好把 D83D/DE00 拆开
    expect(truncateText(`a${GRIN}b`, 2)).toBe('a'); // 回退后丢弃半个 emoji，不留孤立代理
    // 结果绝不能以孤立高位代理结尾
    const out = truncateText(`a${GRIN}b`, 2);
    expect(out.charCodeAt(out.length - 1)).not.toBeGreaterThanOrEqual(0xD800);
  });

  it('截断点恰好落在代理对之后则完整保留 emoji', () => {
    expect(truncateText(`a${GRIN}b`, 3)).toBe(`a${GRIN}`); // 3 个 code unit：完整 emoji
    expect(truncateText(`a${GRIN}b`, 4)).toBe(`a${GRIN}b`);
  });

  it('截断点落在低位代理上时无需回退（完整对仍在）', () => {
    expect(truncateText(`${GRIN}x`, 2)).toBe(`${GRIN}`); // D83D DE00，end-1 是低位代理
  });

  it('从代理对中间开始截断（第 1 个 code unit 就是高位代理）', () => {
    expect(truncateText(`${GRIN}abc`, 1)).toBe(''); // end=1 → 高位代理 → 回退到 0
  });

  it('连续多个 emoji（多个代理对）逐个回退', () => {
    const three = GRIN + GRIN + GRIN; // 6 个 code unit
    expect(three.length).toBe(6);
    expect(truncateText(three, 6)).toBe(three);
    expect(truncateText(three, 5)).toBe(GRIN + GRIN); // 5 -> 回退到 4
    expect(truncateText(three, 3)).toBe(GRIN);        // 3 -> 回退到 2
  });

  it('ZWJ 连接的家庭 emoji（8 个 code unit）不会被切成孤立代理', () => {
    expect(FAMILY.length).toBe(8);
    const s = 'A' + FAMILY + 'B';
    // maxLength=8 的截断点正好落在家庭 emoji 中间的代理对里 → 回退 1 个 code unit
    expect(truncateText(s, 8)).toBe(s.slice(0, 7));
    expect(truncateText(s, 8).length).toBe(7);
    // maxLength=9 完整保留整个家庭 emoji
    expect(truncateText(s, 9)).toBe('A' + FAMILY);
  });

  it('补充平面生僻字（代理对）同样安全', () => {
    expect(RARE.length).toBe(2);
    expect(truncateText(`a${RARE}b`, 3)).toBe(`a${RARE}`); // 完整保留
    expect(truncateText(`a${RARE}b`, 2)).toBe('a');        // 截断点落在对中间 → 回退
  });

  it('不变量：任意截断结果都不以孤立高位代理结尾（低位代理只可能作为完整代理对出现）', () => {
    const samples = [
      `a${GRIN}b`, `${GRIN}abc`, GRIN.repeat(4),
      'A' + FAMILY + 'B', `a${RARE}b`, 'normal text here',
    ];
    for (const s of samples) {
      for (let max = 1; max <= s.length; max++) {
        const out = truncateText(s, max);
        expect(out.length).toBeLessThanOrEqual(max);
        if (out.length > 0) {
          const last = out.charCodeAt(out.length - 1);
          // 最后一位绝不能在孤立高位代理区间 [0xD800, 0xDBFF]
          expect(last < 0xD800 || last > 0xDBFF).toBe(true);
        }
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Toast 宿主样式契约（回归：圆角矩形外灰色直角背景 bug）
//
// 历史 Bug：toast 是 10px 圆角的白色卡片，但宿主 #text-collector-toast-host
// 同时写了 `overflow: hidden !important` 与 `contain: layout style paint !important`。
// paint 包含（contain:paint）/ overflow:hidden 会把子元素绘制裁剪到宿主盒内，
// toast 的 box-shadow（0 12px 32px 深色模糊）被裁成与宿主等大的直角矩形灰底，
// 在圆角三角形缺口处露出灰色，视觉上就是"圆角矩形外面套了一层灰色直角矩形"。
// 修复 = 宿主去掉 overflow:hidden、contain 去掉 paint（保留 layout style）。
//
// 本文件其余用例提取纯函数运行；宿主样式不是函数，而是内联 cssText 数组与
// content.css 规则两份"事实"。这里做源码级静态提取（不执行浏览器代码），断言：
//   1) 两处都不得声明 overflow: hidden（会裁掉 toast 阴影）；
//   2) 两处 contain 都不得含 paint/strict/content（同样裁剪子元素绘制）;
//   3) 两处属性集保持同步（项目契约：inline 与 css 双源一致，防漂移）。
// ══════════════════════════════════════════════════════════════════════

/** 提取 content.js 中 host.style.cssText = [...] 数组里的全部声明字符串 */
function extractHostInlineDecls(source) {
  const m = source.match(/host\.style\.cssText\s*=\s*\[([\s\S]*?)\]\.join\(';'\)/);
  if (!m) throw new Error('[test] 未找到 host.style.cssText = [...] 数组');
  const decls = [];
  const re = /'([^']*)'/g;
  let mm;
  while ((mm = re.exec(m[1])) !== null) decls.push(mm[1]);
  if (decls.length === 0) throw new Error('[test] cssText 数组为空');
  return decls;
}

/** 提取 content.css 中 #text-collector-toast-host { ... } 主规则（排除 ::before/::after） */
function extractHostCssRule(source) {
  const m = source.match(/#text-collector-toast-host\s*\{([^}]*)\}/);
  if (!m) throw new Error('[test] 未找到 #text-collector-toast-host 规则');
  return m[1].replace(/\/\*[\s\S]*?\*\//g, ''); // 去掉注释
}

/** 把声明列表解析为 { 属性: 值 }（剥离 !important、分号、首尾空白，属性小写） */
function parseDecls(decls) {
  const out = {};
  for (const d of decls) {
    const idx = d.indexOf(':');
    if (idx === -1) continue;
    const prop = d.slice(0, idx).trim().toLowerCase();
    const val = d.slice(idx + 1)
      .replace(/!important/g, '')
      .replace(/;+$/, '')
      .trim()
      .replace(/\s+/g, ' ');
    out[prop] = val;
  }
  return out;
}

/** contain 值是否引入"绘制裁剪"（paint / strict / content 均会裁剪子元素绘制） */
function containClipsPaint(value) {
  if (!value) return false;
  const tokens = value.toLowerCase().split(/\s+/);
  if (tokens.includes('paint') || tokens.includes('strict') || tokens.includes('content')) {
    return true;
  }
  return false;
}

describe('Toast 宿主样式契约（圆角外灰色直角背景 bug 回归）', () => {
  const inlineDecls = extractHostInlineDecls(contentSource);
  const inlineStyle = parseDecls(inlineDecls);
  const cssRuleBody = extractHostCssRule(contentCssSource);
  const cssStyle = parseDecls(cssRuleBody.split(';').map(s => s.trim()).filter(Boolean));

  it('宿主不得声明 overflow:hidden —— 会裁掉 toast 的 box-shadow', () => {
    expect(inlineStyle.overflow ?? '').not.toBe('hidden');
    expect(cssStyle.overflow ?? '').not.toBe('hidden');
  });

  it('宿主 contain 不得包含绘制裁剪（paint / strict / content）', () => {
    expect(containClipsPaint(inlineStyle.contain)).toBe(false);
    expect(containClipsPaint(cssStyle.contain)).toBe(false);
  });

  it('clip / clip-path 不得主动裁剪宿主', () => {
    // clip:auto 与 clip-path:none 是不裁剪的安全值
    const safeClip = (v) => !v || v === 'auto' || v === 'none';
    expect(safeClip(inlineStyle.clip)).toBe(true);
    expect(safeClip(inlineStyle['clip-path'])).toBe(true);
    expect(safeClip(cssStyle.clip)).toBe(true);
    expect(safeClip(cssStyle['clip-path'])).toBe(true);
  });

  it('inline cssText 与 content.css 宿主规则属性集保持同步（防双源漂移）', () => {
    const inlineKeys = Object.keys(inlineStyle).sort();
    const cssKeys = Object.keys(cssStyle).sort();
    expect(inlineKeys).toEqual(cssKeys);
    for (const k of cssKeys) {
      expect(inlineStyle[k], `属性 ${k} 在 inline 与 css 中不一致`).toBe(cssStyle[k]);
    }
  });

  it('宿主几何仍被钉死在右上角小容器（防止防御回退）', () => {
    for (const style of [inlineStyle, cssStyle]) {
      expect(style.position).toBe('fixed');
      expect(style.top).toBe('16px');
      expect(style.right).toBe('16px');
      expect(style['z-index']).toBe('2147483647');
      expect(style.background).toBe('transparent');
      expect(style['pointer-events']).toBe('none');
    }
  });
});
