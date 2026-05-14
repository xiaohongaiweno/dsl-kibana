import { createStrictRequestLineRegExp } from './requestMethods.js';

const REQUEST_LINE_RE = createStrictRequestLineRegExp();

export const splitRequestPath = rawPath => {
  const [path, queryString = ''] = rawPath.split('?');
  return { path, queryString };
};

const getLineStarts = text => {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
};

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

export const findRequestAtOffset = (parsed, offset) => {
  const request =
    parsed.requests.find(item => offset >= item.start && offset <= item.end) ||
    parsed.requests.at(-1) ||
    null;
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
