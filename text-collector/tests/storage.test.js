/**
 * storage.js 纯函数单元测试：getUrlKey / getDomain
 *
 * 两个函数都只用内置 URL API，不触碰 chrome.* 存储，可直接在 Node 环境跑。
 * 注意：以下用例依据 Node（与 Chromium 一致）的 WHATWG URL 实现断言
 * （如 hostname 会小写化、IDN 转 punycode、默认端口不进入 origin）。
 */

import { describe, it, expect } from 'vitest';
import { readSource, extractFunction } from './helpers/load-source.js';

const source = readSource('utils/storage.js');
const { fn: getUrlKey } = extractFunction(source, 'getUrlKey');
const { fn: getDomain } = extractFunction(source, 'getDomain');
const { fn: filterOrderRecords } = extractFunction(source, 'filterOrderRecords');

describe('getUrlKey', () => {
  it('常规 URL：origin + pathname（忽略 query 与 hash）', () => {
    expect(getUrlKey('https://example.com/articles/1?ref=nav&lang=zh#section'))
      .toBe('https://example.com/articles/1');
    expect(getUrlKey('https://example.com/a?q=1'))
      .toBe('https://example.com/a');
  });

  it('根路径返回 origin + "/"', () => {
    expect(getUrlKey('https://example.com'))
      .toBe('https://example.com/');
  });

  it('保留非默认端口，去掉默认端口', () => {
    expect(getUrlKey('https://example.com:8443/a'))
      .toBe('https://example.com:8443/a');
    expect(getUrlKey('https://example.com:443/a'))
      .toBe('https://example.com/a');
  });

  it('query/hash 不同但 origin+pathname 相同的 URL 视为同一 key', () => {
    expect(getUrlKey('https://example.com/path?v=1#x'))
      .toBe(getUrlKey('https://example.com/path?v=2#y'));
  });

  it('非法 URL：原样返回；空/undefined 返回 "unknown"', () => {
    expect(getUrlKey('not a url')).toBe('not a url');
    expect(getUrlKey('')).toBe('unknown');
    expect(getUrlKey(undefined)).toBe('unknown');
  });

  it('路径中的 % 编码原样保留', () => {
    expect(getUrlKey('https://example.com/a%20b'))
      .toBe('https://example.com/a%20b');
  });
});

describe('getDomain', () => {
  it('普通域名', () => {
    expect(getDomain('https://example.com/a')).toBe('example.com');
    expect(getDomain('http://sub.example.com:8080/x')).toBe('sub.example.com');
  });

  it('大写 hostname 被规范化（小写）', () => {
    expect(getDomain('https://EXAMPLE.com/x')).toBe('example.com');
  });

  it('IDN 中文域名转为 punycode', () => {
    expect(getDomain('https://例子.测试/')).toBe('xn--fsqu00a.xn--0zwm56d');
  });

  it('IPv6 字面量（hostname 带方括号）', () => {
    expect(getDomain('https://[::1]:8080/x')).toBe('[::1]');
  });

  it('非法 URL 返回 "unknown"', () => {
    expect(getDomain('随便什么文字')).toBe('unknown');
    expect(getDomain('')).toBe('unknown');
  });
});

describe('filterOrderRecords', () => {
  const sampleOrder = ['1', '2', '3', '4'];
  const sampleRecords = {
    'snip_1': { id: '1', text: 'normal unsaved', saved: false },
    'snip_2': { id: '2', text: 'saved note', saved: true },
    'snip_3': { id: '3', text: 'cleared from home but saved', saved: true, clearedFromHome: true },
    'snip_4': { id: '4', text: 'normal note 2' }
  };

  it('home 筛选：保留未在首页清零的记录（clearedFromHome !== true）', () => {
    const res = filterOrderRecords(sampleOrder, sampleRecords, 'home');
    expect(res).toEqual(['1', '2', '4']);
  });

  it('saved 筛选：只保留 saved === true 的记录', () => {
    const res = filterOrderRecords(sampleOrder, sampleRecords, 'saved');
    expect(res).toEqual(['2', '3']);
  });

  it('all 筛选：返回原完整顺序列表', () => {
    const res = filterOrderRecords(sampleOrder, sampleRecords, 'all');
    expect(res).toEqual(sampleOrder);
  });

  it('防错处理：非法 input 或空记录映射', () => {
    expect(filterOrderRecords(null, sampleRecords, 'home')).toEqual([]);
    expect(filterOrderRecords(['1', '99'], sampleRecords, 'home')).toEqual(['1']);
  });

  it('多主题采集与清空分流场景：首页清空后采集新主题，首页列表与导出仅包含新主题，不夹带历史已收藏记录', () => {
    // 1. 主题A采集了 1 和 2，其中 2 为已收藏。清空前，首页全集展示 ['1', '2']
    const beforeClearOrder = ['1', '2'];
    const beforeClearRecords = {
      'snip_1': { id: '1', text: 'topic A note 1', saved: false },
      'snip_2': { id: '2', text: 'topic A note 2 (saved)', saved: true }
    };
    expect(filterOrderRecords(beforeClearOrder, beforeClearRecords, 'home')).toEqual(['1', '2']);

    // 2. 在首页执行「清空全部」后：未收藏的 '1' 被彻底删除；已收藏的 '2' 设置 clearedFromHome = true
    const afterClearOrder = ['2'];
    const afterClearRecords = {
      'snip_2': { id: '2', text: 'topic A note 2 (saved)', saved: true, clearedFromHome: true }
    };
    // 此时首页完全清空（0 条）
    expect(filterOrderRecords(afterClearOrder, afterClearRecords, 'home')).toEqual([]);
    // 「已保存」页签仍然保留 '2'
    expect(filterOrderRecords(afterClearOrder, afterClearRecords, 'saved')).toEqual(['2']);

    // 3. 之后采集新的主题B（记录 5 和 6）
    const topicBOrder = ['6', '5', '2'];
    const topicBRecords = {
      ...afterClearRecords,
      'snip_5': { id: '5', text: 'topic B note 1', saved: false },
      'snip_6': { id: '6', text: 'topic B note 2 (saved)', saved: true }
    };
    // 首页筛选及一键导出（filter = 'home'）：仅包含主题B的数据 ['6', '5']，不会夹带已清空的主题A收藏记录
    expect(filterOrderRecords(topicBOrder, topicBRecords, 'home')).toEqual(['6', '5']);
    // 切至「已保存」页签，可查看跨主题的全部历史收藏 ['6', '2']
    expect(filterOrderRecords(topicBOrder, topicBRecords, 'saved')).toEqual(['6', '2']);
  });
});

