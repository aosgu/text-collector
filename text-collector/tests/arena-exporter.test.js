/**
 * arena-exporter.test.js — Arena 对话导出（content/arena-exporter.js）纯函数单测
 *
 * DOM 提取链路（extractConversation / extractCard / blockMd 等）依赖浏览器 API，
 * 与项目「Node 环境、无浏览器 API」的测试约定一致地不做提取，仅覆盖
 * cleanTitle 这一含微妙边界的纯函数（序号锚定剥离）。
 */

import { describe, it, expect } from 'vitest';
import { readSource, extractFunction } from './helpers/load-source.js';

const source = readSource('content/arena-exporter.js');
const { fn: cleanTitle } = extractFunction(source, 'cleanTitle');

describe('cleanTitle — 引用来源标题序号剥离', () => {
  // 实测站点把序号直接粘在标题开头（无分隔符）
  it('剥离与实际序号匹配的粘连数字前缀', () => {
    expect(cleanTitle('1Genetic risk and ...', 'fallback', 1)).toBe('Genetic risk and ...');
    expect(cleanTitle('12遗传风险评分...', 'fallback', 12)).toBe('遗传风险评分...');
  });

  it('剥离带分隔符的序号形态（1. / (3) / 12 空格）', () => {
    expect(cleanTitle('1. Wikipedia 糖尿病', 'fallback', 1)).toBe('Wikipedia 糖尿病');
    expect(cleanTitle('(3) 某来源', 'fallback', 3)).toBe('某来源');
    expect(cleanTitle('12 遗传风险评分', 'fallback', 12)).toBe('遗传风险评分');
  });

  it('保留以数字开头的真实标题（序号不匹配或为更长数字串）', () => {
    // "2024 …"：序号 2 剥离后须紧跟数字（0），正则负向断言拒绝 → 完整保留
    expect(cleanTitle('2024 糖尿病指南', 'fallback', 2)).toBe('2024 糖尿病指南');
    // 序号与开头数字不一致 → 不剥离
    expect(cleanTitle('50 个城市排行', 'fallback', 3)).toBe('50 个城市排行');
    expect(cleanTitle('正常标题', 'fallback', 7)).toBe('正常标题');
  });

  it('去掉尾部 URL 文本；全空时回退 href', () => {
    expect(cleanTitle('1标题 https://example.com/a', 'fallback', 1)).toBe('标题');
    expect(cleanTitle('   ', 'https://fallback', 1)).toBe('https://fallback');
  });

  it('未提供 ordinal 时不做序号剥离', () => {
    expect(cleanTitle('1Genetic risk', 'fallback')).toBe('1Genetic risk');
  });
});
