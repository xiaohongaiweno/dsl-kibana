import { findRequestAtOffset, parseConsoleRequests, parseRequestLine, splitRequestPath } from './kibanaConsoleParser.js';
import { SUPPORTED_HTTP_METHODS, createLooseRequestLineRegExp } from './requestMethods.js';
import {
  PATH_PARAM_RE,
  filterOptions,
  getBodyCompletion,
  getCompiledApi,
  getPathPlaceholderInfo,
  getUrlComponentSuggestions,
  normalizePath,
  normalizePattern,
  findMatchingEndpoints,
  parseBodyTokenPath,
} from './kibanaConsoleAutocompleteCore.js';

const REQUEST_LINE_PREFIX_RE = createLooseRequestLineRegExp();
const REQUEST_WORD_RE = /[\w./{}-]+/;

/**
 * 功能：
 * 按指定键去重补全候选项，避免同一建议重复出现。
 *
 * 实现：
 * 用 `Set` 记录已经输出过的键值，只保留首次出现的项；
 * `key` 既支持传属性名，也支持传取值函数。
 *
 * 输入：
 * - `items`：候选项数组。
 * - `key`：去重键或键提取函数。
 *
 * 输出：
 * - 返回去重后的新数组。
 */
const uniqBy = (items, key) => {
  const seen = new Set();
  return items.filter(item => {
    const id = typeof key === 'function' ? key(item) : item?.[key];
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/**
 * 功能：
 * 提取光标前当前“单词”范围，供方法名、路径段等前缀补全复用。
 *
 * 实现：
 * 直接委托 CodeMirror 的 `matchBefore()`，
 * 使用适配请求场景的 `REQUEST_WORD_RE` 查找光标前最近一个 token。
 *
 * 输入：
 * - `context`：CodeMirror 补全文本上下文。
 *
 * 输出：
 * - 返回匹配结果对象，或 `null`。
 */
const getCurrentWord = context => context.matchBefore(REQUEST_WORD_RE);

/**
 * 功能：
 * 生成 HTTP 方法补全结果。
 *
 * 实现：
 * 把支持的方法列表映射成补全项，并按当前前缀做过滤；
 * 如果没有任何前缀，则返回空候选，避免在任意位置过度打扰输入。
 *
 * 输入：
 * - `from`：补全替换起点。
 * - `prefix`：当前已输入的方法前缀。
 *
 * 输出：
 * - 返回符合 CodeMirror 规范的补全结果对象。
 */
const getMethodCompletionResult = (from, prefix) => ({
  from,
  options:
    prefix && prefix.length > 0
      ? filterOptions(SUPPORTED_HTTP_METHODS.map(label => ({ label, type: 'keyword', detail: 'method' })), prefix)
      : [],
});

/**
 * 功能：
 * 提取光标所在行的边界和前缀文本信息。
 *
 * 实现：
 * 通过全文字符串和光标 offset 反查当前行起止位置，
 * 并返回整行文本以及“光标前内容”，供请求行补全逻辑复用。
 *
 * 输入：
 * - `text`：全文字符串。
 * - `cursor`：当前光标 offset。
 *
 * 输出：
 * - 返回对象 `{ lineStart, lineEnd, lineText, beforeCursor }`。
 */
const getTextLineInfo = (text, cursor) => {
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  const lineEndIndex = text.indexOf('\n', cursor);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const beforeCursor = text.slice(lineStart, cursor);
  return { lineStart, lineEnd, lineText: text.slice(lineStart, lineEnd), beforeCursor };
};

/**
 * 功能：
 * 以“宽松模式”解析请求行，兼容用户尚未输入完整路径的中间态。
 *
 * 实现：
 * 先尝试使用严格解析结果；
 * 如果失败，再退回到允许空路径的前缀正则，以支持输入过程中的自动补全。
 *
 * 输入：
 * - `line`：当前行文本。
 *
 * 输出：
 * - 返回请求行结构化对象，或 `null`。
 */
const parseRequestLineForCompletion = line => {
  const exact = parseRequestLine(line);
  if (exact) return exact;
  const match = line.match(REQUEST_LINE_PREFIX_RE);
  return match ? { method: match[1].toUpperCase(), rawPath: match[2] || '', ...splitRequestPath(match[2] || '') } : null;
};

/**
 * 功能：
 * 在全文和光标位置基础上，推导出“可能是请求行”的补全文本上下文。
 *
 * 实现：
 * 先定位当前行，再用宽松请求行解析尝试识别方法与路径；
 * 只有当当前行已经包含空格，说明用户进入了“路径输入阶段”，才返回有效结果。
 *
 * 输入：
 * - `text`：全文字符串。
 * - `cursor`：当前光标 offset。
 *
 * 输出：
 * - 返回带 `parsedLine` 的行信息对象，或 `null`。
 */
const getLooseRequestLineInfo = (text, cursor) => {
  const lineInfo = getTextLineInfo(text, cursor);
  const parsedLine = parseRequestLineForCompletion(lineInfo.lineText);
  return parsedLine && lineInfo.lineText.includes(' ') ? { ...lineInfo, parsedLine } : null;
};
const isInsideStandaloneJsonContainer = (text, lineStart) => parseBodyTokenPath(text, lineStart)?.nestingDepth > 0;
const getEndpointPathOptions = (api, method, version) =>
  uniqBy(
    Object.values(api.endpoints)
      .filter(endpoint => !endpoint.methods?.length || endpoint.methods.includes(method))
      .flatMap(endpoint => (endpoint.patterns || []).map(pattern => `/${normalizePattern(pattern, version)}`))
      .sort()
      .map(label => ({ label, type: 'text', detail: 'endpoint' })),
    'label'
  );
const getUrlParamOptions = (api, request, version) => {
  const params = new Map();
  findMatchingEndpoints(api, request.method, request.path, version).forEach(([, endpoint]) =>
    Object.entries(endpoint.url_params || {}).forEach(([label, value]) => params.set(label, value))
  );
  return [...params.entries()].map(([label, value]) => ({
    label,
    type: 'property',
    detail: Array.isArray(value) ? 'param' : value === '__flag__' ? 'flag' : 'param',
    value,
  }));
};
const getUrlParamValueOptions = (api, request, paramName, version) => {
  const values = new Map();
  findMatchingEndpoints(api, request.method, request.path, version).forEach(([, endpoint]) => {
    const value = endpoint.url_params?.[paramName];
    if (Array.isArray(value)) value.forEach(item => values.set(String(item), { label: String(item), type: 'constant', detail: 'value' }));
    else if (value === '__flag__') ['true', 'false'].forEach(label => values.set(label, { label, type: 'constant', detail: 'value' }));
  });
  return [...values.values()];
};
const extractLastUrlParamName = rawPath => {
  const query = rawPath.split('?')[1];
  return query ? (query.split('&').pop() || '').split('=')[0] || null : null;
};
const withCursorAwareApply = options =>
  options.map(option =>
    typeof option.apply !== 'string' || (typeof option.cursorOffset !== 'number' && option.editorApplyText == null)
      ? option
      : {
          ...option,
          apply(view, completion, from, to) {
            const replaceFrom = option.editorReplaceFrom ?? from;
            const insertText = option.editorApplyText || option.apply;
            const anchor = typeof option.cursorOffset === 'number' ? replaceFrom + option.cursorOffset : replaceFrom + insertText.length;
            view.dispatch(view.state.update({ changes: { from: replaceFrom, to, insert: insertText }, selection: { anchor }, scrollIntoView: true }));
          },
        }
  );
const getLastPathSegmentPrefix = rawPath => {
  const segment = rawPath.split('?')[0].split('/').pop() || '';
  return PATH_PARAM_RE.test(segment) ? '' : segment.replace(/^\{|\}$/g, '');
};
const getLastRawPathSegment = rawPath => rawPath.split('?')[0].split('/').pop() || '';
const parsePathCompletionContext = rawPath => {
  const pathOnly = rawPath.split('?')[0];
  const stripped = pathOnly.replace(/^\/+/, '');
  const segments = stripped ? stripped.split('/').filter((segment, index, array) => segment || index < array.length - 1) : [];
  const endsWithSlash = pathOnly.endsWith('/');
  return { pathOnly, fixedSegments: endsWithSlash ? segments : segments.slice(0, -1), segmentPrefix: endsWithSlash ? '' : segments.at(-1) || '' };
};
const buildStaticPathSuffix = (patternSegments, startIndex) => {
  const suffix = [];
  for (let index = startIndex; index < patternSegments.length; index += 1) {
    const segment = patternSegments[index];
    if (!segment || PATH_PARAM_RE.test(segment)) return null;
    suffix.push(segment);
  }
  return suffix.length ? suffix.join('/') : null;
};
const matchesFixedPathSegment = (typedSegment, patternSegment, index) => {
  if (!patternSegment) return false;
  if (!PATH_PARAM_RE.test(patternSegment)) return patternSegment === typedSegment;
  // Leading `_` denotes top-level REST namespaces like `/_cluster` and should
  // not be swallowed by root placeholders such as `/{index}`.
  if (index === 0 && typedSegment.startsWith('_')) return false;
  return true;
};

/**
 * 功能：
 * 为路径当前段生成候选项，包括静态段和动态占位符建议。
 *
 * 实现：
 * 把用户当前输入的路径拆成“已固定段 + 当前段前缀”，
 * 再遍历所有 endpoint pattern：
 * - 固定段匹配时，优先给出下一个静态段；
 * - 如果下一个段是占位符，则从元数据服务或 endpoint 配置中拉取动态建议。
 *
 * 输入：
 * - `api`：当前版本编译后的 API 规则集。
 * - `method`：HTTP 方法。
 * - `rawPath`：当前输入中的原始路径。
 * - `version`：规则版本。
 * - `metadataService`：可选的动态元数据服务。
 *
 * 输出：
 * - 返回对象 `{ fromOffset, prefix, options }`。
 */
const getPathSegmentOptions = async (api, method, rawPath, version, metadataService) => {
  const pathContext = parsePathCompletionContext(rawPath);
  if (pathContext.fixedSegments.length === 0) return { fromOffset: pathContext.pathOnly.length, prefix: pathContext.pathOnly, options: [] };
  const suggestions = [];
  for (const [, endpoint] of Object.entries(api.endpoints)) {
    if (endpoint.methods?.length && !endpoint.methods.includes(method)) continue;
    for (const pattern of endpoint.patterns || []) {
      const patternSegments = normalizePath(normalizePattern(pattern, version)).split('/').filter(Boolean);
      if (patternSegments.length < pathContext.fixedSegments.length + 1) continue;
      const fixedMatches = pathContext.fixedSegments.every((typedSegment, index) => {
        const patternSegment = patternSegments[index];
        return matchesFixedPathSegment(typedSegment, patternSegment, index);
      });
      if (!fixedMatches) continue;
      const currentPatternSegment = patternSegments[pathContext.fixedSegments.length];
      if (!currentPatternSegment) continue;
      if (PATH_PARAM_RE.test(currentPatternSegment)) {
        suggestions.push(
          ...(await getUrlComponentSuggestions(endpoint, currentPatternSegment.slice(1, -1), metadataService)).map(
            option => ({ ...option, apply: option.label })
          )
        );
        continue;
      }
      const staticSuffix = pathContext.segmentPrefix.length > 0 ? buildStaticPathSuffix(patternSegments, pathContext.fixedSegments.length) : null;
      suggestions.push({ label: staticSuffix || currentPatternSegment, type: 'text', detail: 'endpoint', apply: staticSuffix || currentPatternSegment });
    }
  }
  return { fromOffset: pathContext.segmentPrefix.length, prefix: pathContext.segmentPrefix, options: uniqBy(filterOptions(suggestions, pathContext.segmentPrefix), 'label') };
};

/**
 * 功能：
 * 生成请求行路径部分的补全结果。
 *
 * 实现：
 * 优先尝试“按当前路径段补全”，如果没有更细粒度的建议，
 * 则退回到当前方法可用的 endpoint 路径列表做前缀匹配。
 *
 * 输入：
 * - `compiledApi`：编译后的 API 数据。
 * - `method`：HTTP 方法。
 * - `rawPath`：原始路径输入。
 * - `version`：规则版本。
 * - `fallbackFrom`：兜底补全的替换起点。
 * - `metadataService`：可选元数据服务。
 *
 * 输出：
 * - 返回 CodeMirror 所需的补全结果对象。
 */
const getRequestLinePathCompletions = async ({
  compiledApi,
  method,
  rawPath,
  version,
  fallbackFrom,
  metadataService,
}) => {
  const segmentCompletion = await getPathSegmentOptions(compiledApi, method, rawPath, version, metadataService);
  return segmentCompletion.options.length ? { from: fallbackFrom + rawPath.length - segmentCompletion.fromOffset, options: segmentCompletion.options } : { from: fallbackFrom, options: filterOptions(getEndpointPathOptions(compiledApi, method, version), rawPath) };
};

/**
 * 功能：
 * 在请求体顶层区域里识别“用户实际上在写下一条请求行”的场景。
 *
 * 实现：
 * 当光标不在当前请求的真正 body 嵌套结构内时，
 * 允许把当前行重新解释为请求行，从而在多请求块编辑场景里继续提供方法/路径补全。
 *
 * 输入：
 * - `text`：全文字符串。
 * - `cursor`：当前光标 offset。
 * - `request`：当前命中的请求块。
 * - `compiledApi`：编译后的 API 数据。
 * - `version`：规则版本。
 *
 * 输出：
 * - 返回请求行补全结果对象，或 `null`。
 */
const getTopLevelRequestLineOverride = async ({ text, cursor, request, compiledApi, version }) => {
  if (!request || request.isRequestLine || cursor < request.bodyStart) return null;
  const lineInfo = getTextLineInfo(text, cursor);
  const bodyStateAtLineStart = parseBodyTokenPath(
    request.bodyText,
    Math.max(0, lineInfo.lineStart - request.bodyStart)
  );
  if (bodyStateAtLineStart?.nestingDepth > 0) return null;
  const parsedLine = parseRequestLineForCompletion(lineInfo.lineText);
  if (parsedLine && lineInfo.lineText.includes(' ')) {
    return getRequestLinePathCompletions({ compiledApi, method: parsedLine.method, rawPath: parsedLine.rawPath, version, fallbackFrom: lineInfo.lineStart + lineInfo.lineText.indexOf(' ') + 1 });
  }
  if (!/^\s*[A-Za-z]*$/.test(lineInfo.beforeCursor)) return null;
  const prefix = lineInfo.beforeCursor.match(/[A-Za-z]+$/)?.[0] || '';
  return getMethodCompletionResult(cursor - prefix.length, prefix);
};

/**
 * 功能：
 * 计算正式请求行上的自动补全结果。
 *
 * 实现：
 * 根据光标所处位置区分三类场景：
 * - 方法补全；
 * - 路径补全；
 * - URL 查询参数名和值补全。
 * 对动态路径占位符会结合 endpoint 规则和元数据服务给出更精确建议。
 *
 * 输入：
 * - `context`：CodeMirror 补全文本上下文。
 * - `docText`：全文字符串。
 * - `request`：当前请求块。
 * - `compiledApi`：编译后的 API 数据。
 * - `version`：规则版本。
 * - `metadataService`：可选元数据服务。
 *
 * 输出：
 * - 返回补全结果对象。
 */
const getRequestLineCompletion = async ({ context, docText, request, compiledApi, version, metadataService }) => {
  const lineText = context.state.doc.line(request.requestLineNumber).text;
  const parsedLine = parseRequestLineForCompletion(lineText);
  const currentWord = getCurrentWord(context);
  const pathStart = request.requestLineStart + lineText.indexOf(' ') + 1;
  if (!parsedLine || !lineText.includes(' ') || context.pos < pathStart) return getMethodCompletionResult(currentWord?.from ?? context.pos, currentWord?.text || '');
  if (parsedLine.rawPath.includes('?')) {
    const beforeCursor = docText.slice(request.requestLineStart, context.pos);
    const lastSegment = beforeCursor.split(/[?&]/).pop() || '';
    if (lastSegment.includes('=')) {
      const prefix = lastSegment.split('=').pop() || '';
      return { from: context.pos - prefix.length, options: filterOptions(getUrlParamValueOptions(compiledApi, { ...request, ...parsedLine }, extractLastUrlParamName(beforeCursor), version), prefix) };
    }
    return { from: context.pos - lastSegment.length, options: filterOptions(getUrlParamOptions(compiledApi, { ...request, ...parsedLine }, version), lastSegment).map(option => ({ ...option, apply: `${option.label}=` })) };
  }
  const rawSegment = getLastRawPathSegment(parsedLine.rawPath);
  if (PATH_PARAM_RE.test(rawSegment)) {
    const suggestions = await getUrlComponentSuggestions(null, rawSegment.slice(1, -1), metadataService);
    if (suggestions.length) return { from: context.pos, options: suggestions };
  }
  const endpoint = findMatchingEndpoints(compiledApi, parsedLine.method, parsedLine.path, version)[0]?.[1];
  const placeholderName = endpoint ? getPathPlaceholderInfo(endpoint, parsedLine.rawPath) : null;
  if (placeholderName) {
    const segmentPrefix = getLastPathSegmentPrefix(parsedLine.rawPath);
    const suggestions = await getUrlComponentSuggestions(endpoint, placeholderName, metadataService);
    if (suggestions.length) return { from: context.pos - segmentPrefix.length, options: filterOptions(suggestions, segmentPrefix) };
  }
  return getRequestLinePathCompletions({ compiledApi, method: parsedLine.method, rawPath: parsedLine.rawPath, version, fallbackFrom: pathStart, metadataService });
};

/**
 * 功能：
 * 创建 Kibana Console 风格的 CodeMirror 自动补全数据源。
 *
 * 实现：
 * 每次触发补全时先解析全文请求块和当前光标位置，
 * 再根据所处区域分流到：
 * - 空白处/半成品请求行的方法补全；
 * - 正式请求行的路径或参数补全；
 * - 请求体中的 JSON 结构补全。
 * 版本信息通过 `versionRef` 在运行时动态读取。
 *
 * 输入：
 * - `versionRef`：带 `value` 属性的版本引用对象。
 * - `explicitMetadataService`：可选元数据服务。
 *
 * 输出：
 * - 返回一个异步补全源函数，可直接给 CodeMirror 使用。
 */
export const createKibanaCompletionSource = (versionRef, explicitMetadataService = null) => async context => {
  const docText = context.state.doc.toString();
  const parsed = parseConsoleRequests(docText);
  const request = findRequestAtOffset(parsed, context.pos);
  const version = versionRef.value || 'es7';
  const compiledApi = getCompiledApi(version);
  const metadataService = explicitMetadataService || versionRef.metadataService || null;
  if (!request) {
    const lineInfo = getTextLineInfo(docText, context.pos);
    if (isInsideStandaloneJsonContainer(docText, lineInfo.lineStart)) return { from: context.pos, options: [] };
    const looseRequestLine = getLooseRequestLineInfo(docText, context.pos);
    if (looseRequestLine) {
      return getRequestLinePathCompletions({
        compiledApi,
        method: looseRequestLine.parsedLine.method,
        rawPath: looseRequestLine.parsedLine.rawPath,
        version,
        fallbackFrom: looseRequestLine.lineStart + looseRequestLine.lineText.indexOf(' ') + 1,
        metadataService,
      });
    }
    const currentWord = getCurrentWord(context);
    return getMethodCompletionResult(currentWord?.from ?? context.pos, currentWord?.text || '');
  }
  const requestLineOverride = await getTopLevelRequestLineOverride({ text: docText, cursor: context.pos, request, compiledApi, version });
  if (requestLineOverride) return requestLineOverride;
  if (request.isRequestLine) return getRequestLineCompletion({ context, docText, request, compiledApi, version, metadataService });
  const bodyCompletion = await getBodyCompletion(context, request, version, metadataService);
  return { ...bodyCompletion, options: withCursorAwareApply(bodyCompletion.options || []) };
};

/**
 * 功能：
 * 以纯函数形式暴露自动补全能力，便于测试和非编辑器场景复用。
 *
 * 实现：
 * 为传入的文本和光标位置临时构造一个最小化的 CodeMirror 上下文对象，
 * 然后复用正式补全源完成整套补全计算。
 *
 * 输入：
 * - `text`：全文字符串。
 * - `cursor`：光标 offset。
 * - `version`：可选规则版本，默认 `es7`。
 * - `metadataService`：可选元数据服务。
 *
 * 输出：
 * - 返回一个 Promise，resolve 为补全结果对象。
 */
export const getKibanaCompletions = async ({ text, cursor, version = 'es7', metadataService = null }) =>
  createKibanaCompletionSource({ value: version, metadataService }, metadataService)({
    pos: cursor,
    state: { doc: { toString: () => text, line: number => ({ text: text.split(/\r?\n/)[number - 1] || '' }) } },
    matchBefore(regexp) {
      const beforeCursor = text.slice(0, cursor);
      const match = beforeCursor.match(new RegExp(`${regexp.source}$`, regexp.flags));
      return match ? { from: cursor - match[0].length, to: cursor, text: match[0] } : null;
    },
  });
