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

const uniqBy = (items, key) => {
  const seen = new Set();
  return items.filter(item => {
    const id = typeof key === 'function' ? key(item) : item?.[key];
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};
const getCurrentWord = context => context.matchBefore(REQUEST_WORD_RE);
const getMethodCompletionResult = (from, prefix) => ({
  from,
  options:
    prefix && prefix.length > 0
      ? filterOptions(SUPPORTED_HTTP_METHODS.map(label => ({ label, type: 'keyword', detail: 'method' })), prefix)
      : [],
});
const getTextLineInfo = (text, cursor) => {
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  const lineEndIndex = text.indexOf('\n', cursor);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const beforeCursor = text.slice(lineStart, cursor);
  return { lineStart, lineEnd, lineText: text.slice(lineStart, lineEnd), beforeCursor };
};
const parseRequestLineForCompletion = line => {
  const exact = parseRequestLine(line);
  if (exact) return exact;
  const match = line.match(REQUEST_LINE_PREFIX_RE);
  return match ? { method: match[1].toUpperCase(), rawPath: match[2] || '', ...splitRequestPath(match[2] || '') } : null;
};
const getLooseRequestLineInfo = (text, cursor) => {
  const lineInfo = getTextLineInfo(text, cursor);
  const parsedLine = parseRequestLineForCompletion(lineInfo.lineText);
  return parsedLine && lineInfo.lineText.includes(' ') ? { ...lineInfo, parsedLine } : null;
};
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
        return patternSegment && (PATH_PARAM_RE.test(patternSegment) || patternSegment === typedSegment);
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
const getTopLevelRequestLineOverride = async ({ text, cursor, request, compiledApi, version }) => {
  if (!request || request.isRequestLine || cursor < request.bodyStart) return null;
  const lineInfo = getTextLineInfo(text, cursor);
  if (parseBodyTokenPath(request.bodyText, Math.max(0, lineInfo.lineStart - request.bodyStart)).nestingDepth > 0) return null;
  const parsedLine = parseRequestLineForCompletion(lineInfo.lineText);
  if (parsedLine && lineInfo.lineText.includes(' ')) {
    return getRequestLinePathCompletions({ compiledApi, method: parsedLine.method, rawPath: parsedLine.rawPath, version, fallbackFrom: lineInfo.lineStart + lineInfo.lineText.indexOf(' ') + 1 });
  }
  if (!/^\s*[A-Za-z]*$/.test(lineInfo.beforeCursor)) return null;
  const prefix = lineInfo.beforeCursor.match(/[A-Za-z]+$/)?.[0] || '';
  return getMethodCompletionResult(cursor - prefix.length, prefix);
};
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

export const createKibanaCompletionSource = (versionRef, explicitMetadataService = null) => async context => {
  const docText = context.state.doc.toString();
  const parsed = parseConsoleRequests(docText);
  const request = findRequestAtOffset(parsed, context.pos);
  const version = versionRef.value || 'es7';
  const compiledApi = getCompiledApi(version);
  const metadataService = explicitMetadataService || versionRef.metadataService || null;
  if (!request) {
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

export const getKibanaCompletions = async ({ text, cursor, version = 'es7', metadataService = null }) =>
  createKibanaCompletionSource({ value: version, metadataService }, metadataService)({
    pos: cursor,
    state: { doc: { toString: () => text, line: number => ({ text: text.split(/\r?\n/)[number - 1] || '' }) } },
    matchBefore(regexp) {
      const match = text.slice(0, cursor).match(regexp);
      return match ? { from: cursor - match[0].length, to: cursor, text: match[0] } : null;
    },
  });
