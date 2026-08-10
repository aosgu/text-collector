/**
 * 测试辅助：从扩展源码文件中提取纯函数，供 vitest 单测使用。
 *
 * 为什么不做成 ESM 直接 import？
 * storage.js / content.js 是给浏览器扩展（MV3）用的顶层脚本，靠全局变量互相引用
 * （content.js 直接调用 storage.js 里的 CONFIG / addSnippet），并且顶层还会访问
 * `chrome`、`document`、`window`、`crypto` 等浏览器 API。直接 import 会立刻执行
 * 这些浏览器代码。为了满足「不依赖浏览器 API」的测试要求，这里用语法扫描把注释里
 * 声明的纯函数体原文抽出来（不执行文件），再通过 `new Function` 拿到函数对象。
 *
 * 由于这些函数全部是 `function 名称(...)` 形式的顶层声明、且没有闭包依赖
 * （meetsLengthThreshold 只用 CONFIG，由调用方注入真实常量），该提取方式可靠。
 * 若将来函数签名变成箭头函数等写法，这里需要同步更新。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 读取扩展源码文本 */
export function readSource(relativePath) {
  return readFileSync(path.join(EXTENSION_DIR, relativePath), 'utf8');
}

/**
 * 提取单个函数体。按源码中的声明顺序收集每个顶层函数，逐个用 `new Function` 做语法
 * 校验，返回第一个能独立编译通过的（即无闭包引用的纯函数），并把函数的参数名一并返回。
 *
 * @param {string} source 源码文本
 * @param {string} fnName 目标函数名
 * @param {Record<string, any>} [deps] 函数体引用的外部常量（如 CONFIG），
 *        以追加参数的形式注入，使函数体里的自由变量可解析（不改变原实现代码）。
 * @returns {{ params: string[], body: string, fn: Function }}
 */
export function extractFunction(source, fnName, deps = {}) {
  const candidates = [];
  const declRe = /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = declRe.exec(source)) !== null) {
    if (m[1] !== fnName) continue;
    const params = m[2].split(',').map(s => s.trim()).filter(Boolean);
    const body = matchBraces(source, m.index + m[0].length - 1);
    if (body === null) {
      throw new Error(`[test-helper] 无法定位 ${fnName} 的函数体（括号不匹配？）`);
    }
    candidates.push({ params, body });
  }
  if (candidates.length === 0) {
    throw new Error(`[test-helper] 在源码中找不到函数声明 ${fnName}（当前只支持 function 声明写法）`);
  }

  for (const cand of candidates) {
    try {
      // deps 作为尾随参数注入：函数体里的自由变量名（如 CONFIG）会被同名参数遮蔽。
      // 仅当候选函数能独立编译（无其他闭包依赖）时才可用。
      const fn = new Function(...cand.params, ...Object.keys(deps), cand.body); // eslint-disable-line no-new-func
      return { ...cand, fn };
    } catch (_) {
      // 该候选依赖外部闭包变量（如 addSnippet 引用 getUrlKey 等），无法独立编译，
      // 跳过并尝试下一个候选；纯函数都会落在第一个候选。
    }
  }
  throw new Error(
    `[test-helper] ${fnName} 依赖外部闭包变量，无法作为纯函数独立加载。` +
    `若它确实应是纯函数，请检查其函数体。`
  );
}

/**
 * 提取文件顶层的对象字面量（如 `const CONFIG = { ... }`），求值为真实对象。
 * 仅用于纯数据对象（值都是字面量），用于向依赖 CONFIG 的纯函数注入与线上一致的常量。
 */
export function extractObjectLiteral(source, constName) {
  const declRe = new RegExp(`const\\s+${constName}\\s*=\\s*\\{`);
  const m = declRe.exec(source);
  if (!m) throw new Error(`[test-helper] 在源码中找不到 const ${constName} = { ... }`);
  const openIndex = source.indexOf('{', m.index);
  const literal = matchBraces(source, openIndex);
  if (literal === null) throw new Error(`[test-helper] ${constName} 对象字面量括号不匹配`);
  return new Function(`return ${literal}`)(); // eslint-disable-line no-new-func
}

/**
 * 从 `{` 起始的下标开始，返回与之配对的完整函数体（含首尾大括号）。
 * 逐字符跳过字符串字面量与正则字面量，防止 `}` 出现在字符串/正则中导致误判。
 */
function matchBraces(source, openIndex) {
  let depth = 0;
  let i = openIndex;
  let inString = null;   // null | '"' | "'" | '`' | '${'
  let inRegex = false;
  let inRegexClass = false; // 正则字符类 [...] 内
  let escaped = false;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (inString) {
      if (escaped) { escaped = false; }
      else if (ch === '\\') { escaped = true; }
      else if (ch === inString) { inString = null; }
      else if (ch === '$' && next === '{' && inString === '`') { inString = '${'; }
      i++;
      continue;
    }
    if (inString === '${') {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) inString = '`';
      }
      i++;
      continue;
    }
    if (inRegex) {
      if (escaped) { escaped = false; }
      else if (ch === '\\') { escaped = true; }
      else if (ch === '[') { inRegexClass = true; }
      else if (ch === ']' && inRegexClass) { inRegexClass = false; }
      else if (ch === '/' && !inRegexClass) { inRegex = false; }
      i++;
      continue;
    }

    if (ch === '/' && next === '/') { // 行注释
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') { // 块注释
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; i++; continue; }
    if (ch === '/' && isRegexStart(source, i)) { inRegex = true; inRegexClass = false; i++; continue; }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openIndex, i + 1);
      i++;
      continue;
    }
    i++;
  }
  return null;
}

/** 粗略判断当前位置是否开启正则字面量（前一非空白字符不能是标识符/数字/右括号） */
function isRegexStart(source, index) {
  let j = index - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  if (j < 0) return true;
  return !/[A-Za-z0-9_$)\]]/.test(source[j]);
}
