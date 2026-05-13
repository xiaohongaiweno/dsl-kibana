import { kibanaConsoleData } from './kibanaConsoleData.generated.js';
import { findRequestAtOffset, parseConsoleRequests, parseRequestLine } from './kibanaConsoleParser.js';
import { SUPPORTED_HTTP_METHODS, createLooseRequestLineRegExp } from './requestMethods.js';

const REQUEST_LINE_PREFIX_RE = createLooseRequestLineRegExp();

function getMethodCompletionResult(from, prefix) {
  if (!prefix || prefix.length < 1) {
    return {
      from,
      options: [],
    };
  }

  return {
    from,
    options: filterOptions(
      SUPPORTED_HTTP_METHODS.map(label => ({ label, type: 'keyword', detail: 'method' })),
      prefix
    ),
  };
}

function getCurrentWord(context) {
  return context.matchBefore(/[\w./{}\-]+/);
}

function parseRequestLineForCompletion(line) {
  const exact = parseRequestLine(line);
  if (exact) {
    return exact;
  }

  const match = line.match(REQUEST_LINE_PREFIX_RE);
  if (!match) {
    return null;
  }

  const rawPath = match[2] || '';
  const [path, queryString = ''] = rawPath.split('?');
  return {
    method: match[1].toUpperCase(),
    rawPath,
    path,
    queryString,
  };
}

function getLooseRequestLineInfo(text, cursor) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  const lineEndIndex = text.indexOf('\n', cursor);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const lineText = text.slice(lineStart, lineEnd);
  const parsedLine = parseRequestLineForCompletion(lineText);

  if (!parsedLine || !lineText.includes(' ')) {
    return null;
  }

  return {
    lineStart,
    lineEnd,
    lineText,
    parsedLine,
  };
}

function normalizePattern(pattern, version) {
  return version === 'es6' ? pattern : pattern.replace(/\/\{type\}(?=\/|$)/g, '');
}

function isVersionCompatiblePattern(pattern, version) {
  if (pattern.includes('/_mappings') || pattern.startsWith('_mappings')) {
    return version !== 'es6';
  }

  if (pattern.includes('/_mapping') || pattern.startsWith('_mapping')) {
    return version === 'es6' || !pattern.includes('{type}');
  }

  return true;
}

function getVersionCompatiblePatterns(patterns, version) {
  return (patterns || []).filter(pattern => isVersionCompatiblePattern(pattern, version));
}

function patternToRegex(pattern) {
  return new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}/g, '[^/]+')}$`
  );
}

function normalizePath(path) {
  return path.replace(/^\/+|\/+$/g, '');
}

function findMatchingEndpoints(api, method, path, version) {
  const normalizedPath = normalizePath(path);
  const matches = [];

  for (const [name, endpoint] of Object.entries(api.endpoints)) {
    if (endpoint.methods?.length && !endpoint.methods.includes(method)) {
      continue;
    }

    let bestPattern = null;
    let bestScore = null;

    for (const pattern of endpoint.patterns || []) {
      if (!isVersionCompatiblePattern(pattern, version)) {
        continue;
      }

      const normalizedPattern = normalizePattern(pattern, version);
      if (!patternToRegex(normalizedPattern).test(normalizedPath)) {
        continue;
      }

      const segments = normalizePath(normalizedPattern)
        .split('/')
        .filter(Boolean);
      const placeholderCount = segments.filter(segment => /^\{[^}]+\}$/.test(segment)).length;
      const staticCount = segments.length - placeholderCount;
      const score = [staticCount, -placeholderCount, segments.length, normalizedPattern.length];

      if (
        !bestScore ||
        score[0] > bestScore[0] ||
        (score[0] === bestScore[0] && score[1] > bestScore[1]) ||
        (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] > bestScore[2]) ||
        (score[0] === bestScore[0] &&
          score[1] === bestScore[1] &&
          score[2] === bestScore[2] &&
          score[3] > bestScore[3])
      ) {
        bestPattern = pattern;
        bestScore = score;
      }
    }

    if (bestPattern) {
      matches.push({ name, endpoint, score: bestScore });
    }
  }

  matches.sort((a, b) => {
    for (let index = 0; index < a.score.length; index += 1) {
      if (a.score[index] !== b.score[index]) {
        return b.score[index] - a.score[index];
      }
    }
    return a.name.localeCompare(b.name);
  });

  return matches.map(({ name, endpoint }) => [name, endpoint]);
}

function getEndpointPathOptions(api, method, version) {
  const patterns = new Set();
  for (const endpoint of Object.values(api.endpoints)) {
    if (endpoint.methods?.length && !endpoint.methods.includes(method)) continue;
    for (const pattern of endpoint.patterns || []) {
      patterns.add(`/${normalizePattern(pattern, version)}`);
    }
  }
  return [...patterns].sort().map(label => ({ label, type: 'text', detail: 'endpoint' }));
}

function filterOptions(options, prefix) {
  if (!prefix) return options;
  const lowered = prefix.toLowerCase();
  return options.filter(option => option.label.toLowerCase().startsWith(lowered));
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function getCurrentLineInfo(context) {
  const doc = context.state.doc;
  let beforeCursor = '';
  let lineStart = 0;

  if (typeof doc.lineAt === 'function') {
    const line = doc.lineAt(context.pos);
    lineStart = line.from;
    beforeCursor = line.text.slice(0, context.pos - line.from);
  } else {
    const text = typeof doc.toString === 'function' ? doc.toString() : String(doc || '');
    lineStart = text.lastIndexOf('\n', Math.max(0, context.pos - 1)) + 1;
    beforeCursor = text.slice(lineStart, context.pos);
  }

  return {
    lineStart,
    beforeCursor,
    indent: beforeCursor.match(/^\s*/)?.[0] || '',
  };
}

function getLineInfoFromText(text, cursor) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  const lineEndIndex = text.indexOf('\n', cursor);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const lineText = text.slice(lineStart, lineEnd);
  const beforeCursor = text.slice(lineStart, cursor);

  return {
    lineStart,
    lineEnd,
    lineText,
    beforeCursor,
  };
}

function getBodyCompletionValidFor() {
  return /^[^"{}\[\],:\n\r]*$/;
}

function getQuotedKeyPrefix(beforeCursor) {
  const quoteIndex = beforeCursor.lastIndexOf('"');
  if (quoteIndex < 0) {
    return null;
  }

  const keyContent = beforeCursor.slice(quoteIndex + 1);
  if (/["\n\r]/.test(keyContent)) {
    return null;
  }

  const asciiMatch = keyContent.match(/[A-Za-z0-9_.-]+/);
  if (!asciiMatch) {
    return null;
  }

  const prefix = asciiMatch[0];
  return {
    prefix,
    fromOffset: quoteIndex,
  };
}

function buildTemplateInsertion(template, lineIndent) {
  if (isPlainObject(template) && Object.keys(template).length === 0) {
    const text = `{\n${lineIndent}\n${lineIndent}}`;
    return {
      text,
      cursorOffset: 2 + lineIndent.length,
    };
  }

  if (Array.isArray(template) && template.length === 0) {
    const text = `[\n${lineIndent}\n${lineIndent}]`;
    return {
      text,
      cursorOffset: 2 + lineIndent.length,
    };
  }

  const json = JSON.stringify(template, null, 2);
  return {
    text: json.includes('\n') ? json.replace(/\n/g, `\n${lineIndent}`) : json,
  };
}

function uniqOptionsByLabel(options) {
  return options.filter(
    (option, index, array) => array.findIndex(item => item.label === option.label) === index
  );
}

function getUrlParamOptions(api, request, version) {
  const params = new Map();
  for (const [, endpoint] of findMatchingEndpoints(api, request.method, request.path, version)) {
    for (const [param, value] of Object.entries(endpoint.url_params || {})) {
      params.set(param, value);
    }
  }
  return [...params.entries()].map(([label, value]) => ({
    label,
    type: 'property',
    detail: Array.isArray(value) ? 'param' : value === '__flag__' ? 'flag' : 'param',
    value,
  }));
}

function getUrlParamValueOptions(api, request, paramName, version) {
  const values = new Map();
  for (const [, endpoint] of findMatchingEndpoints(api, request.method, request.path, version)) {
    const value = endpoint.url_params?.[paramName];
    if (Array.isArray(value)) {
      for (const item of value) {
        values.set(String(item), { label: String(item), type: 'constant', detail: 'value' });
      }
    } else if (value === '__flag__') {
      values.set('true', { label: 'true', type: 'constant', detail: 'value' });
      values.set('false', { label: 'false', type: 'constant', detail: 'value' });
    }
  }
  return [...values.values()];
}

function extractLastUrlParamName(rawPath) {
  const query = rawPath.split('?')[1];
  if (!query) return null;
  const tail = query.split('&').pop() || '';
  return tail.split('=')[0] || null;
}

function isEscaped(text, index) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function parseBodyTokenPath(bodyText, offset) {
  const stack = [];
  let inString = false;
  let currentString = '';
  let expectingKey = false;
  let pendingKey = null;
  let justSawColon = false;
  let currentLiteral = '';

  for (let index = 0; index < Math.min(offset, bodyText.length); index += 1) {
    const char = bodyText[index];

    if (inString) {
      if (char === '"' && !isEscaped(bodyText, index)) {
        inString = false;
        if (expectingKey) {
          pendingKey = currentString;
          if (stack.length && stack[stack.length - 1].type === 'object') {
            stack[stack.length - 1].tokens.push(currentString);
          }
        } else if (stack.length && stack[stack.length - 1].type === 'array') {
          stack[stack.length - 1].tokens.push(currentString);
        }
        currentString = '';
      } else {
        currentString += char;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      currentString = '';
      if (!stack.length || stack[stack.length - 1].type === 'object') {
        expectingKey = !justSawColon;
      }
      currentLiteral = '';
      continue;
    }

    if (/\s/.test(char)) continue;

    if (char === '{') {
      const path = stack.length ? [...stack[stack.length - 1].path] : [];
      const tokenPath = stack.length ? [...stack[stack.length - 1].tokenPath] : [];
      if (pendingKey != null) {
        path.push(pendingKey);
        tokenPath.push(pendingKey);
      }
      tokenPath.push('{');
      stack.push({ type: 'object', path, tokenPath, tokens: [] });
      pendingKey = null;
      expectingKey = true;
      justSawColon = false;
      currentLiteral = '';
      continue;
    }

    if (char === '[') {
      const path = stack.length ? [...stack[stack.length - 1].path] : [];
      const tokenPath = stack.length ? [...stack[stack.length - 1].tokenPath] : [];
      if (pendingKey != null) {
        path.push(pendingKey);
        tokenPath.push(pendingKey);
      }
      tokenPath.push('[');
      stack.push({ type: 'array', path, tokenPath, tokens: [] });
      pendingKey = null;
      expectingKey = false;
      justSawColon = false;
      currentLiteral = '';
      continue;
    }

    if (char === '}' || char === ']') {
      stack.pop();
      pendingKey = null;
      expectingKey = stack.length ? stack[stack.length - 1].type === 'object' : false;
      justSawColon = false;
      currentLiteral = '';
      continue;
    }

    if (char === ':') {
      justSawColon = true;
      expectingKey = false;
      currentLiteral = '';
      continue;
    }

    if (char === ',') {
      if (currentLiteral && stack.length && stack[stack.length - 1].type === 'array') {
        stack[stack.length - 1].tokens.push(currentLiteral);
      }
      pendingKey = null;
      justSawColon = false;
      expectingKey = stack.length ? stack[stack.length - 1].type === 'object' : false;
      currentLiteral = '';
      continue;
    }

    if (stack.length && stack[stack.length - 1].type === 'array') {
      currentLiteral += char;
    }
  }

  if (currentLiteral && stack.length && stack[stack.length - 1].type === 'array') {
    stack[stack.length - 1].tokens.push(currentLiteral);
  }

  const active = stack[stack.length - 1] || { type: 'object', path: [], tokenPath: [], tokens: [] };
  const tokenPath = [...active.tokenPath];
  if (active.type === 'array' && active.tokens.length) {
    tokenPath.push(active.tokens);
  }

  return {
    tokenPath,
    rulePath: [...active.path],
    expectingKey,
    otherTokenValues: active.tokens,
    activeType: active.type,
    nestingDepth: stack.length,
  };
}

class AutocompleteComponent {
  constructor(name) {
    this.name = name;
    this.next = [];
  }

  getTerms() {
    return [];
  }

  match() {
    return { next: this.next };
  }
}

class SharedComponent extends AutocompleteComponent {
  constructor(name, parent) {
    super(name);
    this._nextDict = {};
    this._parent = parent || null;
    if (parent) {
      parent.addComponent(this);
    }
  }

  getComponent(name) {
    return (this._nextDict[name] || [undefined])[0];
  }

  addComponent(component) {
    const current = this._nextDict[component.name] || [];
    current.push(component);
    this._nextDict[component.name] = current;
    this.next = Object.values(this._nextDict).flat();
  }
}

class ConstantComponent extends SharedComponent {
  constructor(name, parent, options) {
    super(name, parent);
    this.options = typeof options === 'string' ? [options] : options || [name];
  }

  getTerms() {
    return this.options;
  }

  addOption(options) {
    const nextOptions = Array.isArray(options) ? options : [options];
    this.options = [...new Set([...this.options, ...nextOptions])];
  }

  match(token, context, editor) {
    if (token !== this.name) {
      return null;
    }
    return super.match(token, context, editor);
  }
}

class SimpleParamComponent extends SharedComponent {
  match(token, context, editor) {
    const result = super.match(token, context, editor);
    result.context_values = result.context_values || {};
    result.context_values[this.name] = token;
    return result;
  }
}

class ListComponent extends SharedComponent {
  constructor(name, list, parent, multiValued = true, allowNonValidValues = false, meta = name) {
    super(name, parent);
    this.listGenerator = Array.isArray(list) ? () => list : list;
    this.multiValued = multiValued;
    this.allowNonValidValues = allowNonValidValues;
    this.meta = meta;
  }

  async getTerms(context) {
    if (!this.multiValued && context.otherTokenValues?.length) {
      return [];
    }
    const alreadySet = Array.isArray(context.otherTokenValues)
      ? context.otherTokenValues
      : context.otherTokenValues
        ? [context.otherTokenValues]
        : [];
    const generated = await Promise.resolve(this.listGenerator(context));
    return (generated || [])
      .filter(item => !alreadySet.includes(item))
      .map(item => (typeof item === 'string' ? { name: item, meta: this.meta } : item));
  }

  validateTokens(tokens) {
    if (!this.multiValued && tokens.length > 1) {
      return false;
    }
    if (this.allowNonValidValues) {
      return true;
    }
    const allowed = this.listGenerator();
    return tokens.every(token => allowed.includes(token));
  }

  getContextKey() {
    return this.name;
  }

  match(token, context, editor) {
    const tokens = Array.isArray(token) ? token : [token];
    if (!this.allowNonValidValues && !this.validateTokens(tokens, context, editor)) {
      return null;
    }
    const result = super.match(tokens, context, editor);
    result.context_values = result.context_values || {};
    result.context_values[this.getContextKey()] = tokens;
    return result;
  }
}

class GlobalOnlyComponent extends SharedComponent {
  getTerms() {
    return null;
  }

  match(token, context) {
    const result = { next: [] };
    const globalRules = context.globalComponentResolver(token, false);
    if (globalRules) {
      result.next.push(...globalRules);
    }
    if (!result.next.length) {
      result.next = [this];
    }
    return result;
  }
}

class ObjectComponent extends SharedComponent {
  constructor(name, constants, patternsAndWildCards) {
    super(name);
    this.constants = constants;
    this.patternsAndWildCards = patternsAndWildCards;
  }

  getTerms(context, editor) {
    return [...this.constants, ...this.patternsAndWildCards].flatMap(component =>
      component.getTerms(context, editor) || []
    );
  }

  match(token, context, editor) {
    const result = { next: [] };
    for (const component of this.constants) {
      const componentResult = component.match(token, context, editor);
      if (componentResult?.next) {
        result.next.push(...componentResult.next);
      }
    }

    const globalRules = context.globalComponentResolver(token, false);
    if (globalRules) {
      result.next.push(...globalRules);
    }

    if (result.next.length) {
      return result;
    }

    for (const component of this.patternsAndWildCards) {
      const componentResult = component.match(token, context, editor);
      if (componentResult?.next) {
        result.next.push(...componentResult.next);
      }
    }

    return result;
  }
}

class ConditionalProxy extends SharedComponent {
  constructor(predicate, delegate) {
    super('__condition');
    this.predicate = predicate;
    this.delegate = delegate;
  }

  getTerms(context, editor) {
    return this.predicate(context, editor) ? this.delegate.getTerms(context, editor) : null;
  }

  match(token, context, editor) {
    return this.predicate(context, editor) ? this.delegate.match(token, context, editor) : false;
  }
}

class ScopeResolver extends SharedComponent {
  constructor(link, compilingContext) {
    super('__scope_link');
    if (typeof link === 'string' && link.startsWith('.')) {
      link = link === '.' ? compilingContext.endpointId : `${compilingContext.endpointId}${link}`;
    }
    this.link = link;
    this.compilingContext = compilingContext;
  }

  resolveLinkToComponents(context, editor) {
    if (typeof this.link === 'function') {
      return compileDescription(this.link(context, editor), this.compilingContext);
    }

    let path = this.link.replace(/\./g, '{').split(/(\{)/);
    const endpoint = path[0];
    let components;

    if (endpoint === 'GLOBAL') {
      const term = path[2];
      components = context.globalComponentResolver(term);
      path = path.slice(3);
    } else {
      components = context.endpointComponentResolver(endpoint);
      path = path.slice(1);
    }

    return resolvePathToComponents(path, context, editor, components);
  }

  getTerms(context, editor) {
    return this.resolveLinkToComponents(context, editor).flatMap(component =>
      component.getTerms(context, editor) || []
    );
  }

  match(token, context, editor) {
    const result = { next: [] };
    for (const component of this.resolveLinkToComponents(context, editor)) {
      const componentResult = component.match(token, context, editor);
      if (componentResult?.next) {
        result.next.push(...componentResult.next);
      }
    }
    return result;
  }
}

class WalkingState {
  constructor(parentName, components, contextExtensionList, depth = 0, priority) {
    this.parentName = parentName;
    this.components = components;
    this.contextExtensionList = contextExtensionList;
    this.depth = depth;
    this.priority = priority;
  }
}

function passThroughContext(context, extensionList) {
  const result = Object.create(context);
  if (extensionList) {
    Object.assign(result, ...extensionList);
  }
  return result;
}

function walkTokenPath(tokenPath, walkingStates, context, editor) {
  if (!tokenPath || tokenPath.length === 0) {
    return walkingStates;
  }

  const token = tokenPath[0];
  const nextWalkingStates = [];

  for (const state of walkingStates) {
    const contextForState = passThroughContext(context, state.contextExtensionList);
    for (const component of state.components) {
      const result = component.match(token, contextForState, editor);
      if (!result || !result.next || result.next.length === 0) continue;

      const next = Array.isArray(result.next) ? result.next : [result.next];
      const extensionList = result.context_values
        ? [...state.contextExtensionList, result.context_values]
        : state.contextExtensionList;
      const priority =
        typeof result.priority === 'number'
          ? typeof state.priority === 'number'
            ? Math.min(state.priority, result.priority)
            : result.priority
          : state.priority;

      nextWalkingStates.push(
        new WalkingState(component.name, next, extensionList, state.depth + 1, priority)
      );
    }
  }

  if (!nextWalkingStates.length) {
    return walkingStates.map(state => new WalkingState(state.parentName, [], state.contextExtensionList));
  }

  return walkTokenPath(tokenPath.slice(1), nextWalkingStates, context, editor);
}

function populateContext(tokenPath, context, editor, includeAutoComplete, components) {
  return { tokenPath, context, editor, includeAutoComplete, components };
}

function resolvePathToComponents(tokenPath, context, editor, components) {
  const walkStates = walkTokenPath(tokenPath, [new WalkingState('ROOT', components, [])], context, editor);
  return walkStates.flatMap(state => state.components);
}

function getTemplate(description) {
  if (description?.__template !== undefined) {
    if (description.__raw && typeof description.__template === 'string') {
      return { __raw: true, value: description.__template };
    }
    return description.__template;
  }
  if (description?.__one_of) {
    return getTemplate(description.__one_of[0]);
  }
  if (description?.__any_of) {
    return [];
  }
  if (description?.__scope_link) {
    return {};
  }
  if (Array.isArray(description)) {
    if (description.length === 1 && typeof description[0] === 'object') {
      const inner = getTemplate(description[0]);
      return inner != null ? [inner] : [];
    }
    return [];
  }
  if (description && typeof description === 'object') {
    return {};
  }
  if (typeof description === 'string' && !/^\{.*\}$/.test(description)) {
    return description;
  }
  return description;
}

function getOptions(description) {
  const template = getTemplate(description);
  return template !== undefined ? { template } : {};
}

function createParametrizedComponent(value, compilingContext, template) {
  const name = value.slice(1, -1).toLowerCase();

  let component;
  if (name === 'index' || name === 'indices') {
    component = new ListComponent(name, ['INDEX'], null, name === 'indices', true, 'index');
  } else if (name === 'field' || name === 'fields') {
    component = new ListComponent(name, ['FIELD'], null, name === 'fields', true, 'field');
  } else if (name === 'type' || name === 'types') {
    component = new ListComponent(name, ['TYPE'], null, name === 'types', true, 'type');
  } else if (name === 'template') {
    component = new ListComponent(name, ['TEMPLATE'], null, true, true, 'template');
  } else if (name === 'node' || name === 'nodes') {
    component = new ListComponent(
      name,
      ['_local', '_master', 'data:true', 'data:false', 'master:true', 'master:false'],
      null,
      name === 'nodes',
      true,
      'node'
    );
  } else if (name === 'username' || name === 'user') {
    component = new ListComponent(name, ['USERNAME'], null, false, true, 'username');
  } else {
    component = new SimpleParamComponent(name);
  }

  if (template !== undefined) {
    const originalGetTerms = component.getTerms.bind(component);
    component.getTerms = async function wrappedGetTerms(context, editor) {
      const terms = await Promise.resolve(originalGetTerms(context, editor));
      return (terms || []).map(term => {
        const item = typeof term === 'object' ? term : { name: term };
        return { ...item, template };
      });
    };
  }

  return component;
}

function compileCondition(description, compiledObject) {
  if (description.lines_regex) {
    return new ConditionalProxy((context, editor) => {
      const lines = editor.getLines(context.requestStartRow, editor.getCurrentPosition().lineNumber).join('\n');
      return new RegExp(description.lines_regex, 'm').test(lines);
    }, compiledObject);
  }
  return compiledObject;
}

function compileObject(objDescription, compilingContext) {
  const objectComponent = new ConstantComponent('{');
  const constants = [];
  const patterns = [];

  for (const [key, desc] of Object.entries(objDescription)) {
    if (key.startsWith('__')) continue;
    const options = getOptions(desc);
    let component;
    if (/^\{.*\}$/.test(key)) {
      component = createParametrizedComponent(key, compilingContext, options.template);
      patterns.push(component);
    } else if (key === '*') {
      component = new SharedComponent(key);
      patterns.push(component);
    } else {
      component = new ConstantComponent(key, null, [{ name: key, ...options }]);
      constants.push(component);
    }

    for (const subComponent of compileDescription(desc, compilingContext)) {
      component.addComponent(subComponent);
    }
  }

  objectComponent.addComponent(new ObjectComponent('inner', constants, patterns));
  return objectComponent;
}

function compileList(listRule, compilingContext) {
  const listComponent = new ConstantComponent('[');
  for (const desc of listRule) {
    for (const component of compileDescription(desc, compilingContext)) {
      listComponent.addComponent(component);
    }
  }
  return listComponent;
}

function compileDescription(description, compilingContext) {
  if (Array.isArray(description)) {
    return [compileList(description, compilingContext)];
  }

  if (description && typeof description === 'object') {
    if (description.__scope_link) {
      return [new ScopeResolver(description.__scope_link, compilingContext)];
    }
    if (description.__any_of) {
      return [compileList(description.__any_of, compilingContext)];
    }
    if (description.__one_of) {
      return description.__one_of.flatMap(desc => compileDescription(desc, compilingContext));
    }

    const compiledObject = compileObject(description, compilingContext);
    if (description.__condition) {
      return [compileCondition(description.__condition, compiledObject)];
    }
    return [compiledObject];
  }

  if (typeof description === 'string' && /^\{.*\}$/.test(description)) {
    return [createParametrizedComponent(description, compilingContext)];
  }

  return [new ConstantComponent(description)];
}

function compileBodyDescription(endpointId, description) {
  return compileDescription(description, { endpointId });
}

function extractRuleKeys(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return [];
  }
  const keys = [];
  for (const [key, value] of Object.entries(rule)) {
    if (key.startsWith('__')) continue;
    keys.push({
      label: key.replace(/^\{|\}$/g, ''),
      type: key.startsWith('{') ? 'variable' : 'property',
      detail: value && typeof value === 'object' && value.__template !== undefined ? 'template' : 'field',
      apply: `"${key.startsWith('{') ? key.replace(/^\{|\}$/g, '') : key}": `,
    });
  }
  return keys;
}

function getRuleAtPath(rule, path) {
  let current = rule;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return null;
    if (current[segment] !== undefined) {
      current = current[segment];
      continue;
    }
    if (current['*'] !== undefined) {
      current = current['*'];
      continue;
    }
    const patternKey = Object.keys(current).find(key => /^\{[^}]+\}$/.test(key));
    if (patternKey) {
      current = current[patternKey];
      continue;
    }
    return null;
  }
  return current;
}

function getNearestExistingRuleAtPath(rule, path) {
  let current = rule;
  for (const segment of path) {
    if (!current || typeof current !== 'object') {
      return null;
    }
    if (current[segment] !== undefined) {
      current = current[segment];
      continue;
    }
    if (current['*'] !== undefined) {
      current = current['*'];
      continue;
    }
    const patternKey = Object.keys(current).find(key => /^\{[^}]+\}$/.test(key));
    if (patternKey) {
      current = current[patternKey];
      continue;
    }
    return current;
  }
  return current;
}

function createCompiledApi(api, version) {
  const compiled = {
    version,
    globals: {},
    endpoints: {},
  };

  for (const [globalName, rules] of Object.entries(api.globals || {})) {
    compiled.globals[globalName] = compileBodyDescription(`GLOBAL.${globalName}`, rules);
  }

  for (const [endpointName, endpoint] of Object.entries(api.endpoints || {})) {
    compiled.endpoints[endpointName] = {
      ...endpoint,
      patterns: getVersionCompatiblePatterns(endpoint.patterns, version),
      compiledBody: compileBodyDescription(endpointName, endpoint.data_autocomplete_rules || {}),
    };
  }

  return compiled;
}

const compiledApis = {
  es6: createCompiledApi(kibanaConsoleData.es6, 'es6'),
  es7: createCompiledApi(kibanaConsoleData.es7, 'es7'),
  es8: createCompiledApi(kibanaConsoleData.es8 || kibanaConsoleData.es7, 'es8'),
};

function getCompiledApi(version) {
  return compiledApis[version] || compiledApis.es7;
}

function globalsOnlyAutocompleteComponents() {
  return [new GlobalOnlyComponent('__global__')];
}

async function resolveTerms(components, runtimeContext, editorAdapter) {
  const resolved = [];
  for (const component of components) {
    const terms = component.getTerms(runtimeContext, editorAdapter) || [];
    const awaited = await Promise.resolve(terms);
    for (const term of awaited || []) {
      resolved.push(typeof term === 'object' ? term : { name: term });
    }
  }
  return resolved;
}

async function populateContextAsync(tokenPath, context, editor, includeAutoComplete, components) {
  const walkStates = walkTokenPath(tokenPath, [new WalkingState('ROOT', components, [])], context, editor);

  if (includeAutoComplete) {
    const autoCompleteSet = [];
    for (const state of walkStates) {
      const contextForState = passThroughContext(context, state.contextExtensionList);
      const terms = await resolveTerms(state.components, contextForState, editor);
      autoCompleteSet.push(...terms);
    }
    context.autoCompleteSet = autoCompleteSet.filter(
      (term, index, array) => array.findIndex(item => item.name === term.name) === index
    );
  }

  if (!walkStates.length) return;

  const selectedState =
    [...walkStates]
      .sort((a, b) => {
        const aPriority = typeof a.priority === 'number' ? a.priority : Number.MAX_VALUE;
        const bPriority = typeof b.priority === 'number' ? b.priority : Number.MAX_VALUE;
        return aPriority - bPriority;
      })
      .find(state => state.components.length === 0) || walkStates[0];

  for (const extension of selectedState.contextExtensionList) {
    Object.assign(context, extension);
  }
}

async function getBodyCompletion(context, api, request) {
  const bodyOffset = Math.max(0, context.pos - request.bodyStart);
  const bodyState = parseBodyTokenPath(request.bodyText, bodyOffset);
  const matching = findMatchingEndpoints(api, request.method, request.path, request.version);
  const endpointName = matching[0]?.[0];
  const endpoint = endpointName ? api.endpoints[endpointName] : null;
  const endpointRule = endpoint?.data_autocomplete_rules || {};

  const runtimeContext = {
    method: request.method,
    requestStartRow: request.requestLineNumber,
    otherTokenValues: bodyState.otherTokenValues,
    endpointComponentResolver(name) {
      return api.endpoints[name]?.compiledBody || [];
    },
    globalComponentResolver(name, throwOnMissing = true) {
      const result = api.globals[name];
      if (!result && throwOnMissing) {
        throw new Error(`failed to resolve global components for ['${name}']`);
      }
      return result;
    },
  };

  const editorAdapter = {
    getCurrentPosition() {
      return { lineNumber: request.lineNumber };
    },
    getLines(start, end) {
      const lines = context.state.doc.toString().split(/\r?\n/);
      return lines.slice(Math.max(0, start - 1), end);
    },
  };

  const components = endpoint ? endpoint.compiledBody : globalsOnlyAutocompleteComponents();
  await populateContextAsync(bodyState.tokenPath, runtimeContext, editorAdapter, true, components);

  const lineInfo = getCurrentLineInfo(context);
  const currentWord = context.matchBefore(/[\w.-]+$/);
  const defaultPrefix = currentWord ? currentWord.text : '';
  const defaultFrom = currentWord ? currentWord.from : context.pos;
  const quotedKeyPrefix = lineInfo.beforeCursor.includes('"') ? getQuotedKeyPrefix(lineInfo.beforeCursor) : null;
  const trimmedBeforeCursor = lineInfo.beforeCursor.trimEnd();
  const isQuotedKeyInput =
    bodyState.activeType === 'object' &&
    bodyState.expectingKey &&
    lineInfo.beforeCursor.includes('"');
  const isPlainKeyInsertionPoint =
    bodyState.activeType === 'object' &&
    bodyState.expectingKey &&
    /^\s*[\w.-]*$/.test(lineInfo.beforeCursor);
  const isObjectKeyInsertionPoint =
    isQuotedKeyInput || isPlainKeyInsertionPoint;
  const prefix = isQuotedKeyInput && quotedKeyPrefix ? quotedKeyPrefix.prefix : defaultPrefix;
  const prefixFrom =
    isQuotedKeyInput && quotedKeyPrefix ? lineInfo.lineStart + quotedKeyPrefix.fromOffset : defaultFrom;
  const justAfterComma = trimmedBeforeCursor.endsWith(',');
  const shouldSuppressAutoBodySuggestions = isObjectKeyInsertionPoint && prefix.length < 1;

  if (shouldSuppressAutoBodySuggestions || justAfterComma) {
    return {
      from: context.pos,
      options: [],
    };
  }

  const desiredIndent =
    bodyState.activeType === 'object' && bodyState.nestingDepth > 0
      ? '  '.repeat(bodyState.nestingDepth)
      : lineInfo.indent;
  let options = (runtimeContext.autoCompleteSet || []).map(term => {
    const label = term.name ?? term.label ?? '';
    const template = term.template;
    const insertion =
      template !== undefined
        ? buildTemplateInsertion(template, desiredIndent)
        : null;
    const apply = insertion
      ? `"${label}": ${insertion.text}`
      : /^[_A-Z0-9]+$/i.test(label) && label !== '{' && label !== '['
        ? `"${label}": `
        : JSON.stringify(label);
    const shouldNormalizeLine = isObjectKeyInsertionPoint;
    const editorApplyText = shouldNormalizeLine ? `${desiredIndent}${apply}` : apply;
    const editorReplaceFrom = shouldNormalizeLine ? lineInfo.lineStart : undefined;
    return {
      label,
      type: term.meta === 'value' ? 'constant' : 'property',
      detail: term.meta || 'field',
      apply,
      cursorOffset:
        typeof insertion?.cursorOffset === 'number'
          ? (shouldNormalizeLine ? desiredIndent.length : 0) + `"${label}": `.length + insertion.cursorOffset
          : undefined,
      editorApplyText,
      editorReplaceFrom,
    };
  });

  if (!options.length) {
    const nearestRule =
      getRuleAtPath(endpointRule, bodyState.rulePath) ??
      getNearestExistingRuleAtPath(endpointRule, bodyState.rulePath);
    options = extractRuleKeys(nearestRule || endpointRule);
  }

  let filteredOptions = filterOptions(
    options
      .filter(option => option.label && option.label !== '{' && option.label !== '[')
      .filter(option => !(bodyState.activeType === 'object' && option.type === 'constant')),
    prefix
  );

  if (!filteredOptions.length) {
    const nearestRule =
      getRuleAtPath(endpointRule, bodyState.rulePath) ??
      getNearestExistingRuleAtPath(endpointRule, bodyState.rulePath);
    filteredOptions = filterOptions(
      extractRuleKeys(nearestRule || endpointRule),
      prefix
    );
  }

  return {
    from: prefixFrom,
    options: filteredOptions,
    validFor: getBodyCompletionValidFor(),
  };
}

function getUrlComponentSuggestions(endpoint, segmentName) {
  const component = endpoint?.url_components?.[segmentName];
  if (!component) return [];
  if (Array.isArray(component)) {
    return component.map(label => ({ label: String(label), type: 'constant', detail: 'path' }));
  }
  if (component?.list && Array.isArray(component.list)) {
    return component.list.map(label => ({ label: String(label), type: 'constant', detail: 'path' }));
  }
  return [];
}

function getPathPlaceholderInfo(endpoint, rawPath) {
  const normalized = normalizePath(rawPath);
  for (const pattern of endpoint.patterns || []) {
    const normalizedPattern = normalizePath(pattern);
    const patternParts = normalizedPattern.split('/');
    const pathParts = normalized.split('/');
    for (let i = 0; i < Math.min(patternParts.length, pathParts.length); i += 1) {
      const part = patternParts[i];
      if (
        /^\{[^}]+\}$/.test(part) &&
        (pathParts[i] === part ||
          (i === pathParts.length - 1 && rawPath.endsWith(part)) ||
          (!pathParts[i] && i >= pathParts.length - 1))
      ) {
        return part.slice(1, -1);
      }
    }
  }
  return null;
}

function withCursorAwareApply(options) {
  return options.map(option => {
    if (
      typeof option.apply !== 'string' ||
      (typeof option.cursorOffset !== 'number' && option.editorApplyText == null)
    ) {
      return option;
    }

    return {
      ...option,
      apply(view, completion, from, to) {
        const replaceFrom = option.editorReplaceFrom ?? from;
        const insertText = option.editorApplyText || option.apply;
        const anchor =
          typeof option.cursorOffset === 'number' ? replaceFrom + option.cursorOffset : replaceFrom + insertText.length;
        view.dispatch(
          view.state.update({
            changes: { from: replaceFrom, to, insert: insertText },
            selection: { anchor },
            scrollIntoView: true,
          })
        );
      },
    };
  });
}

function getLastPathSegmentPrefix(rawPath) {
  const pathOnly = rawPath.split('?')[0];
  const segment = pathOnly.split('/').pop() || '';
  if (/^\{[^}]*\}$/.test(segment)) {
    return '';
  }
  return segment.replace(/^\{|\}$/g, '');
}

function parsePathCompletionContext(rawPath) {
  const pathOnly = rawPath.split('?')[0];
  const stripped = pathOnly.replace(/^\/+/, '');
  const segments = stripped ? stripped.split('/').filter((segment, index, array) => segment || index < array.length - 1) : [];
  const endsWithSlash = pathOnly.endsWith('/');

  return {
    hasLeadingSlash: pathOnly.startsWith('/'),
    pathOnly,
    fixedSegments: endsWithSlash ? segments : segments.slice(0, -1),
    segmentPrefix: endsWithSlash ? '' : (segments[segments.length - 1] || ''),
  };
}

function buildStaticPathSuffix(patternSegments, startIndex) {
  const suffixSegments = [];

  for (let index = startIndex; index < patternSegments.length; index += 1) {
    const segment = patternSegments[index];
    if (!segment || /^\{[^}]+\}$/.test(segment)) {
      return null;
    }
    suffixSegments.push(segment);
  }

  return suffixSegments.length ? suffixSegments.join('/') : null;
}

async function getPathSegmentOptions(api, method, rawPath, version) {
  const context = parsePathCompletionContext(rawPath);
  if (context.fixedSegments.length === 0) {
    return {
      fromOffset: context.pathOnly.length,
      prefix: context.pathOnly,
      options: [],
    };
  }
  const suggestions = [];

  for (const [, endpoint] of Object.entries(api.endpoints)) {
    if (endpoint.methods?.length && !endpoint.methods.includes(method)) continue;

    for (const pattern of endpoint.patterns || []) {
      const normalizedPattern = normalizePattern(pattern, version);
      const patternSegments = normalizePath(normalizedPattern)
        .split('/')
        .filter(Boolean);

      if (patternSegments.length < context.fixedSegments.length + 1) {
        continue;
      }

      let matches = true;
      for (let index = 0; index < context.fixedSegments.length; index += 1) {
        const typedSegment = context.fixedSegments[index];
        const patternSegment = patternSegments[index];
        if (!patternSegment) {
          matches = false;
          break;
        }
        if (/^\{[^}]+\}$/.test(patternSegment)) {
          continue;
        }
        if (patternSegment !== typedSegment) {
          matches = false;
          break;
        }
      }

      if (!matches) continue;

      const currentPatternSegment = patternSegments[context.fixedSegments.length];
      if (!currentPatternSegment) continue;

      if (/^\{[^}]+\}$/.test(currentPatternSegment)) {
        const placeholderName = currentPatternSegment.slice(1, -1);
        const dynamicOptions = getUrlComponentSuggestions(endpoint, placeholderName);
        suggestions.push(
          ...dynamicOptions.map(option => ({
            ...option,
            apply: option.label,
          }))
        );
        continue;
      }

      const staticSuffix =
        context.segmentPrefix.length > 0
          ? buildStaticPathSuffix(patternSegments, context.fixedSegments.length)
          : null;

      suggestions.push({
        label: staticSuffix || currentPatternSegment,
        type: 'text',
        detail: 'endpoint',
        apply: staticSuffix || currentPatternSegment,
      });
    }
  }

  return {
    fromOffset: context.segmentPrefix.length,
    prefix: context.segmentPrefix,
    options: uniqOptionsByLabel(filterOptions(suggestions, context.segmentPrefix)),
  };
}

async function getRequestLinePathCompletions({
  compiledApi,
  method,
  rawPath,
  version,
  fallbackFrom,
}) {
  const pathSegmentCompletion = await getPathSegmentOptions(compiledApi, method, rawPath, version);
  if (pathSegmentCompletion.options.length) {
    return {
      from: fallbackFrom + rawPath.length - pathSegmentCompletion.fromOffset,
      options: pathSegmentCompletion.options,
    };
  }

  return {
    from: fallbackFrom,
    options: filterOptions(getEndpointPathOptions(compiledApi, method, version), rawPath),
  };
}

async function getTopLevelRequestLineOverride({
  text,
  cursor,
  request,
  compiledApi,
  version,
}) {
  if (!request || request.isRequestLine || cursor < request.bodyStart) {
    return null;
  }

  const lineInfo = getLineInfoFromText(text, cursor);
  const bodyOffsetAtLineStart = Math.max(0, lineInfo.lineStart - request.bodyStart);
  const bodyStateAtLineStart = parseBodyTokenPath(request.bodyText, bodyOffsetAtLineStart);

  if (bodyStateAtLineStart.nestingDepth > 0) {
    return null;
  }

  const parsedLine = parseRequestLineForCompletion(lineInfo.lineText);
  if (parsedLine && lineInfo.lineText.includes(' ')) {
    return getRequestLinePathCompletions({
      compiledApi,
      method: parsedLine.method,
      rawPath: parsedLine.rawPath,
      version,
      fallbackFrom: lineInfo.lineStart + lineInfo.lineText.indexOf(' ') + 1,
    });
  }

  if (!/^\s*[A-Za-z]*$/.test(lineInfo.beforeCursor)) {
    return null;
  }

  const prefixMatch = lineInfo.beforeCursor.match(/[A-Za-z]+$/);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  return getMethodCompletionResult(cursor - prefix.length, prefix);
}

export function createKibanaCompletionSource(versionRef) {
  return async context => {
    const docText = context.state.doc.toString();
    const parsed = parseConsoleRequests(docText);
    const request = findRequestAtOffset(parsed, context.pos);
    const version = versionRef.value || 'es7';
    const compiledApi = getCompiledApi(version);

    if (!request) {
      const looseRequestLine = getLooseRequestLineInfo(docText, context.pos);
      if (looseRequestLine) {
        return getRequestLinePathCompletions({
          compiledApi,
          method: looseRequestLine.parsedLine.method,
          rawPath: looseRequestLine.parsedLine.rawPath,
          version,
          fallbackFrom: looseRequestLine.lineStart + looseRequestLine.lineText.indexOf(' ') + 1,
        });
      }

      const currentWord = getCurrentWord(context);
      return getMethodCompletionResult(currentWord ? currentWord.from : context.pos, currentWord?.text || '');
    }

    request.version = version;

    const requestLineOverride = await getTopLevelRequestLineOverride({
      text: docText,
      cursor: context.pos,
      request,
      compiledApi,
      version,
    });
    if (requestLineOverride) {
      return requestLineOverride;
    }

    if (request.isRequestLine) {
      const lineText = context.state.doc.line(request.requestLineNumber).text;
      const parsedLine = parseRequestLineForCompletion(lineText);
      const currentWord = getCurrentWord(context);

      if (!parsedLine || !lineText.includes(' ') || context.pos < request.requestLineStart + lineText.indexOf(' ')) {
        return getMethodCompletionResult(currentWord ? currentWord.from : context.pos, currentWord?.text || '');
      }

      if (parsedLine.rawPath.includes('?')) {
        const beforeCursor = docText.slice(request.requestLineStart, context.pos);
        const lastSegment = beforeCursor.split(/[?&]/).pop() || '';
        if (lastSegment.includes('=')) {
          const paramName = extractLastUrlParamName(beforeCursor);
          const prefix = lastSegment.split('=').pop() || '';
          return {
            from: context.pos - prefix.length,
            options: filterOptions(
              getUrlParamValueOptions(compiledApi, { ...request, ...parsedLine }, paramName, version),
              prefix
            ),
          };
        }

        return {
          from: context.pos - lastSegment.length,
          options: filterOptions(
            getUrlParamOptions(compiledApi, { ...request, ...parsedLine }, version),
            lastSegment
          ).map(option => ({
            ...option,
            apply: `${option.label}=`,
          })),
        };
      }

      const matching = findMatchingEndpoints(compiledApi, parsedLine.method, parsedLine.path, version);
      const placeholderName = matching.length ? getPathPlaceholderInfo(matching[0][1], parsedLine.rawPath) : null;
      if (placeholderName) {
        const suggestions = getUrlComponentSuggestions(matching[0][1], placeholderName);
        if (suggestions.length) {
          const segmentPrefix = getLastPathSegmentPrefix(parsedLine.rawPath);
          return {
            from: context.pos - segmentPrefix.length,
            options: filterOptions(suggestions, segmentPrefix),
          };
        }
      }

      return getRequestLinePathCompletions({
        compiledApi,
        method: parsedLine.method,
        rawPath: parsedLine.rawPath,
        version,
        fallbackFrom: request.requestLineStart + lineText.indexOf(' ') + 1,
      });
    }

    const bodyCompletion = await getBodyCompletion(context, compiledApi, request);
    return {
      ...bodyCompletion,
      options: withCursorAwareApply(bodyCompletion.options || []),
    };
  };
}
