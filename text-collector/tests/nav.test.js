/**
 * nav.js 纯函数单元测试：normalizeNavConfig
 *
 * normalizeNavConfig 只做数据规范化（不触碰 chrome.* / DOM），可直接在 Node 环境跑。
 */

import { describe, it, expect } from 'vitest';
import { readSource, extractFunction } from './helpers/load-source.js';

const source = readSource('manager/nav.js');
const { fn: normalizeNavConfig } = extractFunction(source, 'normalizeNavConfig');

describe('normalizeNavConfig', () => {
  it('标准多栏配置：保留结构并 trim 空白', () => {
    const raw = {
      columns: [
        {
          title: ' 常用 ',
          links: [{ name: ' GitHub ', url: ' https://github.com ' }],
        },
      ],
    };
    expect(normalizeNavConfig(raw)).toEqual({
      columns: [
        { title: '常用', links: [{ name: 'GitHub', url: 'https://github.com' }] },
      ],
    });
  });

  it('栏标题缺失或非字符串 → 空字符串', () => {
    const res = normalizeNavConfig({
      columns: [
        { links: [{ name: 'A', url: 'https://a.com' }] },
        { title: 42, links: [{ name: 'B', url: 'https://b.com' }] },
      ],
    });
    expect(res.columns.map(c => c.title)).toEqual(['', '']);
  });

  it('顶层 links 兼容糖：视为单个无标题栏', () => {
    const res = normalizeNavConfig({
      links: [{ name: 'MDN', url: 'https://developer.mozilla.org' }],
    });
    expect(res).toEqual({
      columns: [
        { title: '', links: [{ name: 'MDN', url: 'https://developer.mozilla.org' }] },
      ],
    });
  });

  it('过滤非法链接：缺字段 / 非对象 / 空字符串', () => {
    const res = normalizeNavConfig({
      columns: [{
        title: 't',
        links: [
          { name: 'ok', url: 'https://ok.com' },
          { name: '', url: 'https://x.com' },
          { name: 'nourl' },
          { url: 'https://y.com' },
          null,
          'string-item',
          42,
        ],
      }],
    });
    expect(res.columns[0].links).toEqual([{ name: 'ok', url: 'https://ok.com' }]);
  });

  it('过滤非 http(s) 协议与非法 URL（javascript:/data:/chrome:/相对路径/乱串）', () => {
    const res = normalizeNavConfig({
      columns: [{
        title: 't',
        links: [
          { name: 'js', url: 'javascript:alert(1)' },
          { name: 'data', url: 'data:text/html,<b>x</b>' },
          { name: 'chrome', url: 'chrome://extensions' },
          { name: 'relative', url: '/path/only' },
          { name: 'garbage', url: 'not a url' },
          { name: 'ok', url: 'https://ok.com' },
        ],
      }],
    });
    expect(res.columns[0].links).toEqual([{ name: 'ok', url: 'https://ok.com' }]);
  });

  it('http 与 https 均放行', () => {
    const res = normalizeNavConfig({
      columns: [{
        title: 't',
        links: [
          { name: 's', url: 'https://a.com' },
          { name: 'p', url: 'http://b.com' },
        ],
      }],
    });
    expect(res.columns[0].links).toHaveLength(2);
  });

  it('无有效链接的栏整体移除；全部栏为空 → null', () => {
    const partial = normalizeNavConfig({
      columns: [
        { title: 'empty', links: [] },
        { title: 'bad', links: [{ name: 'x', url: 'javascript:x' }] },
        { title: 'good', links: [{ name: 'G', url: 'https://g.com' }] },
      ],
    });
    expect(partial.columns).toHaveLength(1);
    expect(partial.columns[0].title).toBe('good');

    expect(normalizeNavConfig({ columns: [{ title: 'e', links: [] }] })).toBeNull();
    expect(normalizeNavConfig({ columns: [] })).toBeNull();
  });

  it('根节点缺失或形状错误 → null', () => {
    expect(normalizeNavConfig(null)).toBeNull();
    expect(normalizeNavConfig(undefined)).toBeNull();
    expect(normalizeNavConfig('str')).toBeNull();
    expect(normalizeNavConfig(42)).toBeNull();
    expect(normalizeNavConfig([])).toBeNull();
    expect(normalizeNavConfig({})).toBeNull();
    expect(normalizeNavConfig({ columns: 'nope' })).toBeNull();
  });

  it('忽略栏与链接上的未知附加字段', () => {
    const res = normalizeNavConfig({
      extra: true,
      columns: [{
        title: 't',
        icon: '📌',
        links: [{ name: 'A', url: 'https://a.com', desc: 'unused' }],
      }],
    });
    expect(res).toEqual({
      columns: [{ title: 't', links: [{ name: 'A', url: 'https://a.com' }] }],
    });
  });
});
