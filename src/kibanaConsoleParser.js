import { createStrictRequestLineRegExp } from './requestMethods.js';

const REQUEST_LINE_RE = createStrictRequestLineRegExp();

function getLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function getLineNumberForOffset(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid];
    const next = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.POSITIVE_INFINITY;
    if (offset < start) {
      high = mid - 1;
    } else if (offset >= next) {
      low = mid + 1;
    } else {
      return mid + 1;
    }
  }
  return lineStarts.length;
}

function computeBraceDepth(line) {
  // We only need a lightweight structural balance check to decide whether a blank
  // line ends the current request body, so this intentionally does not fully parse JSON.
  let depth = 0;
  let inString = false;
  let escape = false;

  for (const ch of line) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth += 1;
    if (ch === '}' || ch === ']') depth -= 1;
  }

  return depth;
}

export function parseConsoleRequests(text) {
  // Kibana Console allows multiple request blocks in one editor. This parser walks
  // line by line and records the byte range for each block so later features can
  // target "the request at the cursor" instead of the whole document.
  const normalized = text.replace(/\r\n?/g, '\n');
  const lineStarts = getLineStarts(normalized);
  const lines = normalized.split('\n');
  const requests = [];

  let current = null;
  let bodyDepth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const lineStart = lineStarts[index];
    const lineEnd = lineStart + line.length;
    const requestMatch = line.match(REQUEST_LINE_RE);

    if (requestMatch) {
      if (current) {
        current.end = lineStart > 0 ? lineStart - 1 : lineStart;
        requests.push(current);
      }

      const path = requestMatch[2];
      const [pathOnly, queryString = ''] = path.split('?');
      current = {
        start: lineStart,
        end: normalized.length,
        requestLineNumber: lineNumber,
        requestLineStart: lineStart,
        requestLineEnd: lineEnd,
        method: requestMatch[1].toUpperCase(),
        rawPath: path,
        path: pathOnly,
        queryString,
        bodyStart: lineEnd + 1,
        bodyEnd: lineEnd,
        lines: [line],
      };
      bodyDepth = 0;
      continue;
    }

    if (!current) {
      continue;
    }

    current.lines.push(line);
    current.bodyEnd = lineEnd;

    if (line.trim().length === 0 && bodyDepth <= 0) {
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
}

export function findRequestAtOffset(parsed, offset) {
  // Autocomplete and execution both work from cursor position, so we resolve the
  // active request once and carry the derived request/body metadata forward.
  const request =
    parsed.requests.find(item => offset >= item.start && offset <= item.end) ||
    parsed.requests[parsed.requests.length - 1] ||
    null;

  if (!request) {
    return null;
  }

  const lineNumber = getLineNumberForOffset(parsed.lineStarts, offset);
  const isRequestLine = lineNumber === request.requestLineNumber;
  const bodyText =
    request.bodyStart <= request.bodyEnd
      ? parsed.text.slice(request.bodyStart, request.bodyEnd)
      : '';

  return {
    ...request,
    isRequestLine,
    bodyText,
    offsetInRequest: offset - request.start,
    lineNumber,
  };
}

export function parseRequestLine(line) {
  // Request lines follow the Kibana Console convention: METHOD + URL [+ query string].
  const match = line.match(REQUEST_LINE_RE);
  if (!match) {
    return null;
  }

  const rawPath = match[2];
  const [path, queryString = ''] = rawPath.split('?');
  return {
    method: match[1].toUpperCase(),
    rawPath,
    path,
    queryString,
  };
}
