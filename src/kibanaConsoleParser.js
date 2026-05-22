import { createStrictRequestLineRegExp } from './requestMethods.js';

const REQUEST_LINE_RE = createStrictRequestLineRegExp();

/**
 * 功能：
 * 拆分请求路径中的主体路径和查询字符串部分。
 *
 * 实现：
 * 以第一个 `?` 为分界，把原始路径分成 `path` 与 `queryString`；
 * 如果不存在查询参数，则查询串返回空字符串。
 *
 * 输入：
 * - `rawPath`：形如 `/_search?q=test` 的原始路径字符串。
 *
 * 输出：
 * - 返回对象 `{ path, queryString }`。
 */
export const splitRequestPath = rawPath => {
  const [path, queryString = ''] = rawPath.split('?');
  return { path, queryString };
};

/**
 * 功能：
 * 预计算整段文本中每一行的起始偏移量。
 *
 * 实现：
 * 扫描全文并记录每个换行符后的下一个字符位置，
 * 这样后续就能在“字符偏移”与“行号”之间高效互转。
 *
 * 输入：
 * - `text`：标准化后的全文字符串。
 *
 * 输出：
 * - 返回数组，数组元素表示每一行的起始 offset。
 */
const getLineStarts = text => {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
};

/**
 * 功能：
 * 根据字符偏移量反查其所在的行号。
 *
 * 实现：
 * 基于 `getLineStarts()` 生成的有序偏移数组做二分查找，
 * 以避免在大文本里频繁线性扫描。
 *
 * 输入：
 * - `lineStarts`：每行起始偏移数组。
 * - `offset`：目标字符偏移量。
 *
 * 输出：
 * - 返回 1-based 行号。
 */
const getLineNumberForOffset = (lineStarts, offset) => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid];
    const next = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (offset < start) high = mid - 1;
    else if (offset >= next) low = mid + 1;
    else return mid + 1;
  }
  return lineStarts.length;
};

/**
 * 功能：
 * 估算单行文本对 JSON 花括号/方括号层级的净变化量。
 *
 * 实现：
 * 顺序扫描整行字符，忽略字符串字面量内部的括号，
 * 只统计真正结构性 `{`、`}`、`[`、`]` 对层级深度的影响。
 *
 * 输入：
 * - `line`：单行请求体文本。
 *
 * 输出：
 * - 返回整数；正数表示进入更深层级，负数表示退出层级。
 */
const computeBraceDepth = line => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{' || char === '[') depth += 1;
    if (char === '}' || char === ']') depth -= 1;
  }
  return depth;
};

/**
 * 功能：
 * 根据请求行匹配结果构造统一的请求块描述对象。
 *
 * 实现：
 * 从正则匹配结果中提取方法和路径信息，同时初始化请求块的起止范围、
 * 请求体范围和原始行列表等字段，为后续解析循环持续补全该对象做准备。
 *
 * 输入：
 * - `match`：请求行正则匹配结果。
 * - `lineNumber`：请求行所在的 1-based 行号。
 * - `lineStart`：请求行起始偏移。
 * - `lineEnd`：请求行结束偏移。
 * - `textLength`：全文长度。
 *
 * 输出：
 * - 返回一个请求块对象。
 */
const createRequest = (match, lineNumber, lineStart, lineEnd, textLength) => {
  const rawPath = match[2];
  const { path, queryString } = splitRequestPath(rawPath);
  return {
    start: lineStart,
    end: textLength,
    requestLineNumber: lineNumber,
    requestLineStart: lineStart,
    requestLineEnd: lineEnd,
    method: match[1].toUpperCase(),
    rawPath,
    path,
    queryString,
    bodyStart: lineEnd + 1,
    bodyEnd: lineEnd,
    lines: [],
  };
};

/**
 * 功能：
 * 把 Console 文本解析为多个可独立执行的请求块。
 *
 * 实现：
 * 先统一换行符，再逐行扫描：
 * - 遇到合法请求行时开始一个新请求块；
 * - 在已有请求块内部持续收集 body；
 * - 当遇到空行且花括号层级已闭合时，认为当前请求块结束。
 * 最终返回全文、行偏移索引以及所有请求块元信息。
 *
 * 输入：
 * - `text`：编辑器中的完整 DSL 文本。
 *
 * 输出：
 * - 返回对象 `{ text, lineStarts, requests }`。
 */
export const parseConsoleRequests = text => {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lineStarts = getLineStarts(normalized);
  const lines = normalized.split('\n');
  const requests = [];
  let current = null;
  let bodyDepth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineStart = lineStarts[index];
    const lineEnd = lineStart + line.length;
    const requestMatch = line.match(REQUEST_LINE_RE);

    if (requestMatch) {
      if (current) {
        current.end = lineStart > 0 ? lineStart - 1 : lineStart;
        requests.push(current);
      }
      current = createRequest(requestMatch, index + 1, lineStart, lineEnd, normalized.length);
      current.lines.push(line);
      bodyDepth = 0;
      continue;
    }

    if (!current) continue;

    current.lines.push(line);
    current.bodyEnd = lineEnd;
    if (!line.trim() && bodyDepth <= 0) {
      current.end = lineStart;
      requests.push(current);
      current = null;
      bodyDepth = 0;
      continue;
    }
    bodyDepth += computeBraceDepth(line);
  }

  if (current) {
    current.end = normalized.length;
    requests.push(current);
  }

  return { text: normalized, lineStarts, requests };
};

/**
 * 功能：
 * 根据光标偏移定位当前所在的请求块，并补充执行期常用信息。
 *
 * 实现：
 * 在已解析请求列表中查找包含目标 offset 的请求块，
 * 若没有精确命中则退化为最后一个请求块。随后补充：
 * - 当前是否位于请求行；
 * - 请求体文本；
 * - 在请求块内部的相对偏移；
 * - 对应行号。
 *
 * 输入：
 * - `parsed`：`parseConsoleRequests()` 的返回结果。
 * - `offset`：目标字符偏移。
 *
 * 输出：
 * - 返回带增强字段的请求块对象；若不存在请求块则返回 `null`。
 */
export const findRequestAtOffset = (parsed, offset) => {
  const request = parsed.requests.find(item => offset >= item.start && offset <= item.end) || null;
  if (!request) return null;
  const lineNumber = getLineNumberForOffset(parsed.lineStarts, offset);
  return {
    ...request,
    isRequestLine: lineNumber === request.requestLineNumber,
    bodyText: request.bodyStart <= request.bodyEnd ? parsed.text.slice(request.bodyStart, request.bodyEnd) : '',
    offsetInRequest: offset - request.start,
    lineNumber,
  };
};

/**
 * 功能：
 * 解析单行请求头，提取方法、路径和查询字符串。
 *
 * 实现：
 * 使用严格请求行正则校验输入；只有完全符合 `METHOD /path` 形式时，
 * 才会返回结构化结果，否则返回 `null`。
 *
 * 输入：
 * - `line`：单行请求文本。
 *
 * 输出：
 * - 返回对象 `{ method, rawPath, path, queryString }`，或 `null`。
 */
export const parseRequestLine = line => {
  const match = line.match(REQUEST_LINE_RE);
  if (!match) return null;
  const rawPath = match[2];
  const { path, queryString } = splitRequestPath(rawPath);
  return {
    method: match[1].toUpperCase(),
    rawPath,
    path,
    queryString,
  };
};
