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
