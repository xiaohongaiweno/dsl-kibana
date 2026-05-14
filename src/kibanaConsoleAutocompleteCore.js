import { kibanaConsoleData } from './kibanaConsoleData.generated.js';
import { escapeRegExp } from './requestMethods.js';

export const PATH_PARAM_RE = /^\{[^}]+\}$/;
export const BODY_VALID_FOR_RE = /^[^"{}\[\],:\n\r]*$/;

const BODY_WORD_RE = /[\w.-]+$/;
const QUOTED_KEY_RE = /[A-Za-z0-9_.-]+/;
const EMPTY_COMPONENTS = [];

/**
 * 功能：
 * 规范化 URL 路径，移除首尾多余的斜杠。
 *
 * 实现：
 * 通过正则统一裁掉开头和结尾的 `/`，便于后续按 segment 比较路径。
 *
 * 输入：
 * - `path`：原始路径字符串。
 *
 * 输出：
 * - 返回规范化后的路径字符串。
 */
export const normalizePath = path => path.replace(/^\/+|\/+$/g, '');

/**
 * 功能：
 * 根据 ES 版本把 endpoint pattern 转成当前版本可比较的路径形式。
 *
 * 实现：
 * ES7/ES8 不再使用 `/{type}` 这类旧式 type 路径，因此在这些版本下会把它移除；
 * ES6 则保持原始 pattern，不做改写。
 *
 * 输入：
 * - `pattern`：原始 endpoint pattern。
 * - `version`：当前规则版本。
 *
 * 输出：
 * - 返回版本归一化后的 pattern 字符串。
 */
export const normalizePattern = (pattern, version) =>
  version === 'es6' ? pattern : pattern.replace(/\/\{type\}(?=\/|$)/g, '');

/**
 * 功能：
 * 按前缀过滤补全候选项。
 *
 * 实现：
 * 当 `prefix` 为空时直接返回全部选项；
 * 否则执行不区分大小写的 startsWith 匹配。
 *
 * 输入：
 * - `options`：候选项数组。
 * - `prefix`：用户当前已输入的前缀。
 *
 * 输出：
 * - 返回过滤后的候选项数组。
 */
export const filterOptions = (options, prefix) =>
  !prefix ? options : options.filter(option => option.label.toLowerCase().startsWith(prefix.toLowerCase()));

const isVersionCompatiblePattern = (pattern, version) =>
  pattern.includes('/_mappings') || pattern.startsWith('_mappings')
    ? version !== 'es6'
    : pattern.includes('/_mapping') || pattern.startsWith('_mapping')
      ? version === 'es6' || !pattern.includes('{type}')
      : true;
const getVersionCompatiblePatterns = (patterns, version) =>
  (patterns || []).filter(pattern => isVersionCompatiblePattern(pattern, version));
const patternToRegex = pattern =>
  new RegExp(`^${escapeRegExp(pattern).replace(/\\\{[^}]+\\\}/g, '[^/]+')}$`);
const toArray = value => (Array.isArray(value) ? value : value == null ? [] : [value]);
const isPlainObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const isRawTemplate = value => isPlainObject(value) && value.__raw === true && typeof value.value === 'string';
const toTermItem = (item, meta) =>
  typeof item === 'string'
    ? { name: item, meta }
    : { name: String(item?.name ?? item?.label ?? item?.value ?? ''), meta: item?.meta || item?.type || meta };
const toFieldTerm = item =>
  typeof item === 'string'
    ? { name: item, meta: 'field' }
    : { name: String(item?.name ?? item?.label ?? item?.value ?? ''), meta: item?.type || item?.meta || 'field' };

/**
 * 功能：
 * 按优先方法名列表从元数据服务中懒加载动态候选数据。
 *
 * 实现：
 * 依次尝试调用 `metadataService` 上的指定方法；
 * 只要某个方法成功返回了非空数组，就立即采用该结果。
 * 异常会被吞掉，以保证补全流程不会因元数据读取失败而中断。
 *
 * 输入：
 * - `metadataService`：可选元数据服务对象。
 * - `methodNames`：候选加载方法名数组。
 *
 * 输出：
 * - 返回一个 Promise，resolve 为候选项数组。
 */
const loadMetadataItems = async (metadataService, methodNames) => {
  for (const methodName of methodNames) {
    const loader = metadataService?.[methodName];
    if (typeof loader !== 'function') continue;
    try {
      const result = await Promise.resolve(loader.call(metadataService));
      if (Array.isArray(result) && result.length) return result;
    } catch {}
  }
  return [];
};
const createMetadataListGenerator = (methodNames, fallbackItems, mapper) => async context => {
  const items = await loadMetadataItems(context.metadataService, methodNames);
  return items.length ? items.map(mapper) : fallbackItems;
};
const uniqBy = (items, key) => {
  const seen = new Set();
  return items.filter(item => {
    const id = typeof key === 'function' ? key(item) : item?.[key];
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};
const compareScore = (left, right) => {
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return right[index] - left[index];
  return 0;
};
const getCurrentLineInfo = context => {
  const doc = context.state.doc;
  if (typeof doc.lineAt === 'function') {
    const line = doc.lineAt(context.pos);
    const beforeCursor = line.text.slice(0, context.pos - line.from);
    return { lineStart: line.from, lineEnd: line.to, lineText: line.text, beforeCursor, indent: beforeCursor.match(/^\s*/)?.[0] || '' };
  }
  const text = typeof doc.toString === 'function' ? doc.toString() : String(doc || '');
  const lineStart = text.lastIndexOf('\n', Math.max(0, context.pos - 1)) + 1;
  const lineEndIndex = text.indexOf('\n', context.pos);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const beforeCursor = text.slice(lineStart, context.pos);
  return { lineStart, lineEnd, lineText: text.slice(lineStart, lineEnd), beforeCursor, indent: beforeCursor.match(/^\s*/)?.[0] || '' };
};
const getQuotedKeyPrefix = beforeCursor => {
  const quoteIndex = beforeCursor.lastIndexOf('"');
  if (quoteIndex < 0) return null;
  const keyContent = beforeCursor.slice(quoteIndex + 1);
  const matched = /["\n\r]/.test(keyContent) ? null : keyContent.match(QUOTED_KEY_RE);
  return matched ? { prefix: matched[0], fromOffset: quoteIndex } : null;
};
const buildTemplateInsertion = (template, lineIndent) => {
  if (isRawTemplate(template)) return { text: template.value.includes('\n') ? template.value.replace(/\n/g, `\n${lineIndent}`) : template.value };
  if (isPlainObject(template) && Object.keys(template).length === 0) return { text: `{\n${lineIndent}\n${lineIndent}}`, cursorOffset: 2 + lineIndent.length };
  if (Array.isArray(template) && template.length === 0) return { text: `[\n${lineIndent}\n${lineIndent}]`, cursorOffset: 2 + lineIndent.length };
  const json = JSON.stringify(template, null, 2);
  return { text: json.includes('\n') ? json.replace(/\n/g, `\n${lineIndent}`) : json };
};
const scorePattern = pattern => {
  const segments = normalizePath(pattern).split('/').filter(Boolean);
  const placeholderCount = segments.filter(segment => PATH_PARAM_RE.test(segment)).length;
  return [segments.length - placeholderCount, -placeholderCount, segments.length, pattern.length];
};

/**
 * 功能：
 * 找出与当前请求方法和路径最匹配的 endpoint 定义。
 *
 * 实现：
 * 遍历编译后的 endpoint 列表，先按版本过滤无效 pattern，
 * 再把 pattern 转成可匹配路径参数的正则。若同一 endpoint 有多个命中 pattern，
 * 会用静态段更多、占位符更少等规则计算得分，保留最优匹配并最终排序返回。
 *
 * 输入：
 * - `api`：编译后的 API 对象。
 * - `method`：HTTP 方法。
 * - `path`：当前请求路径。
 * - `version`：规则版本。
 *
 * 输出：
 * - 返回数组，元素形如 `[endpointName, endpoint]`。
 */
export const findMatchingEndpoints = (api, method, path, version) => {
  const normalizedPath = normalizePath(path);
  const matches = [];
  for (const [name, endpoint] of Object.entries(api.endpoints)) {
    if (endpoint.methods?.length && !endpoint.methods.includes(method)) continue;
    let bestScore = null;
    for (const pattern of endpoint.patterns || []) {
      if (!isVersionCompatiblePattern(pattern, version)) continue;
      const normalizedPattern = normalizePattern(pattern, version);
      if (!patternToRegex(normalizedPattern).test(normalizedPath)) continue;
      const score = scorePattern(normalizedPattern);
      if (!bestScore || compareScore(bestScore, score) > 0) bestScore = score;
    }
    if (bestScore) matches.push({ name, endpoint, score: bestScore });
  }
  matches.sort((left, right) => compareScore(left.score, right.score) || left.name.localeCompare(right.name));
  return matches.map(({ name, endpoint }) => [name, endpoint]);
};
const isEscaped = (text, index) => {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) count += 1;
  return count % 2 === 1;
};
const pushContainer = (stack, pendingKey, type) => {
  const active = stack.at(-1);
  const path = active ? [...active.path] : [];
  const tokenPath = active ? [...active.tokenPath] : [];
  if (pendingKey != null) path.push(pendingKey), tokenPath.push(pendingKey);
  tokenPath.push(type === 'object' ? '{' : '[');
  stack.push({ type, path, tokenPath, tokens: [] });
};

/**
 * 功能：
 * 解析请求体在指定 offset 处的 JSON 结构上下文。
 *
 * 实现：
 * 通过一个轻量级状态机顺序扫描请求体字符，持续维护：
 * - 当前容器栈；
 * - 是否处于字符串中；
 * - 当前 key 或数组字面量 token；
 * - 规则路径与 token 路径。
 * 结果可供补全器判断当前位置期待的是对象 key、数组值还是更深层结构。
 *
 * 输入：
 * - `bodyText`：请求体文本。
 * - `offset`：相对请求体起始位置的光标偏移。
 *
 * 输出：
 * - 返回对象，包含 `tokenPath`、`rulePath`、`expectingKey`、`activeType` 等上下文信息。
 */
export const parseBodyTokenPath = (bodyText, offset) => {
  const stack = [];
  let inString = false, currentString = '', expectingKey = false, pendingKey = null, justSawColon = false, currentLiteral = '';
  let walkedSomeBody = false;
  for (let index = 0; index < Math.min(offset, bodyText.length); index += 1) {
    const char = bodyText[index];
    if (!/\s/.test(char)) {
      walkedSomeBody = true;
    }
    if (inString) {
      if (char === '"' && !isEscaped(bodyText, index)) {
        inString = false;
        if (expectingKey) pendingKey = currentString, stack.at(-1)?.type === 'object' && stack.at(-1).tokens.push(currentString);
        else stack.at(-1)?.type === 'array' && stack.at(-1).tokens.push(currentString);
        currentString = '';
      } else currentString += char;
      continue;
    }
    if (char === '"') {
      inString = true;
      currentString = '';
      if (!stack.length || stack.at(-1).type === 'object') expectingKey = !justSawColon;
      currentLiteral = '';
      continue;
    }
    if (/\s/.test(char)) continue;
    if (char === '{' || char === '[') {
      pushContainer(stack, pendingKey, char === '{' ? 'object' : 'array');
      pendingKey = null;
      expectingKey = char === '{';
      justSawColon = false;
      currentLiteral = '';
      continue;
    }
    if (char === '}' || char === ']') {
      stack.pop();
      pendingKey = null;
      expectingKey = stack.at(-1)?.type === 'object';
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
      if (currentLiteral && stack.at(-1)?.type === 'array') stack.at(-1).tokens.push(currentLiteral);
      pendingKey = null;
      justSawColon = false;
      expectingKey = stack.at(-1)?.type === 'object';
      currentLiteral = '';
      continue;
    }
    if (stack.at(-1)?.type === 'array') currentLiteral += char;
  }

  // Match Kibana Console behavior: if we already traversed non-whitespace body content
  // but ended up outside any valid body scope, autocomplete should be suppressed.
  if (walkedSomeBody && stack.length === 0) {
    return null;
  }

  if (currentLiteral && stack.at(-1)?.type === 'array') stack.at(-1).tokens.push(currentLiteral);
  const active = stack.at(-1) || { type: 'object', path: [], tokenPath: [], tokens: [] };
  const tokenPath = [...active.tokenPath];
  if (active.type === 'array' && active.tokens.length) tokenPath.push(active.tokens);
  return { tokenPath, rulePath: [...active.path], expectingKey, otherTokenValues: active.tokens, activeType: active.type, nestingDepth: stack.length };
};

class AutocompleteComponent {
  constructor(name) { this.name = name; this.next = []; }
  getTerms() { return []; }
  match() { return { next: this.next }; }
}
class SharedComponent extends AutocompleteComponent {
  constructor(name, parent = null) { super(name); this._nextDict = {}; if (parent) parent.addComponent(this); }
  addComponent(component) { this._nextDict[component.name] = [...(this._nextDict[component.name] || []), component]; this.next = Object.values(this._nextDict).flat(); }
}
class ConstantComponent extends SharedComponent {
  constructor(name, parent = null, options = [name]) { super(name, parent); this.options = typeof options === 'string' ? [options] : options; }
  getTerms() { return this.options; }
  match(token) { return token === this.name ? super.match(token) : null; }
}
class SimpleParamComponent extends SharedComponent {
  match(token) { const result = super.match(token); result.context_values = { ...(result.context_values || {}), [this.name]: token }; return result; }
}
class ListComponent extends SharedComponent {
  constructor(name, list, parent = null, multiValued = true, allowNonValidValues = false, meta = name) {
    super(name, parent); this.listGenerator = Array.isArray(list) ? () => list : list; this.multiValued = multiValued; this.allowNonValidValues = allowNonValidValues; this.meta = meta;
  }
  async getTerms(context) {
    if (!this.multiValued && context.otherTokenValues?.length) return [];
    const chosen = toArray(context.otherTokenValues);
    const generated = await Promise.resolve(this.listGenerator(context));
    return (generated || []).filter(item => !chosen.includes(item)).map(item => (typeof item === 'string' ? { name: item, meta: this.meta } : item));
  }
  validateTokens(tokens, context) { return !this.multiValued && tokens.length > 1 ? false : this.allowNonValidValues ? true : tokens.every(token => this.listGenerator(context).includes(token)); }
  match(token, context) { const tokens = toArray(token); if (!this.validateTokens(tokens, context)) return null; const result = super.match(tokens, context); result.context_values = { ...(result.context_values || {}), [this.name]: tokens }; return result; }
}
class GlobalOnlyComponent extends SharedComponent {
  getTerms() { return null; }
  match(token, context) { const globalRules = context.globalComponentResolver(token, false); return { next: globalRules?.length ? [...globalRules] : [this] }; }
}
class ObjectComponent extends SharedComponent {
  constructor(name, constants, patternsAndWildCards) { super(name); this.constants = constants; this.patternsAndWildCards = patternsAndWildCards; }
  getTerms(context, editor) { return [...this.constants, ...this.patternsAndWildCards].flatMap(component => component.getTerms(context, editor) || []); }
  match(token, context, editor) {
    const next = [];
    this.constants.forEach(component => { const result = component.match(token, context, editor); if (result?.next) next.push(...result.next); });
    const globalRules = context.globalComponentResolver(token, false);
    if (globalRules) next.push(...globalRules);
    if (next.length) return { next };
    this.patternsAndWildCards.forEach(component => { const result = component.match(token, context, editor); if (result?.next) next.push(...result.next); });
    return { next };
  }
}
class ConditionalProxy extends SharedComponent {
  constructor(predicate, delegate) { super('__condition'); this.predicate = predicate; this.delegate = delegate; }
  getTerms(context, editor) { return this.predicate(context, editor) ? this.delegate.getTerms(context, editor) : null; }
  match(token, context, editor) { return this.predicate(context, editor) ? this.delegate.match(token, context, editor) : false; }
}
class ScopeResolver extends SharedComponent {
  constructor(link, compilingContext) { super('__scope_link'); this.link = typeof link === 'string' && link.startsWith('.') ? (link === '.' ? compilingContext.endpointId : `${compilingContext.endpointId}${link}`) : link; this.compilingContext = compilingContext; }
  resolveLinkToComponents(context, editor) {
    if (typeof this.link === 'function') return compileDescription(this.link(context, editor), this.compilingContext);
    const path = this.link.replace(/\./g, '{').split(/(\{)/);
    const endpoint = path[0];
    const components = endpoint === 'GLOBAL' ? context.globalComponentResolver(path[2]) : context.endpointComponentResolver(endpoint);
    return resolvePathToComponents(endpoint === 'GLOBAL' ? path.slice(3) : path.slice(1), context, editor, components);
  }
  getTerms(context, editor) { return this.resolveLinkToComponents(context, editor).flatMap(component => component.getTerms(context, editor) || []); }
  match(token, context, editor) {
    const next = [];
    this.resolveLinkToComponents(context, editor).forEach(component => { const result = component.match(token, context, editor); if (result?.next) next.push(...result.next); });
    return { next };
  }
}
class WalkingState {
  constructor(parentName, components, contextExtensionList, depth = 0, priority) { this.parentName = parentName; this.components = components; this.contextExtensionList = contextExtensionList; this.depth = depth; this.priority = priority; }
}

const passThroughContext = (context, extensionList) => {
  const scoped = Object.create(context);
  if (extensionList?.length) Object.assign(scoped, ...extensionList);
  return scoped;
};

/**
 * 功能：
 * 沿着 tokenPath 在编译后的补全规则图中前向行走。
 *
 * 实现：
 * 对每个 token 依次遍历当前所有候选状态和组件：
 * - 调用组件的 `match()` 判断是否可消费该 token；
 * - 把命中的下一批组件和上下文扩展累积到新状态里；
 * - 如果当前 token 没有任何命中，则保留原状态但清空组件，表示路径走不通。
 *
 * 输入：
 * - `tokenPath`：当前 JSON 结构对应的 token 路径。
 * - `walkingStates`：起始 walking state 列表。
 * - `context`：运行时上下文。
 * - `editor`：编辑器适配器。
 *
 * 输出：
 * - 返回 walking state 数组。
 */
const walkTokenPath = (tokenPath, walkingStates, context, editor) => {
  let states = tokenPath?.length ? walkingStates : [...walkingStates];
  for (const token of tokenPath || EMPTY_COMPONENTS) {
    const nextStates = [];
    for (const state of states) {
      const stateContext = passThroughContext(context, state.contextExtensionList);
      for (const component of state.components) {
        const result = component.match(token, stateContext, editor);
        if (!result?.next?.length) continue;
        const extensions = result.context_values ? [...state.contextExtensionList, result.context_values] : state.contextExtensionList;
        const priority = typeof result.priority === 'number' ? (typeof state.priority === 'number' ? Math.min(state.priority, result.priority) : result.priority) : state.priority;
        nextStates.push(new WalkingState(component.name, toArray(result.next), extensions, state.depth + 1, priority));
      }
    }
    states = nextStates.length ? nextStates : states.map(state => new WalkingState(state.parentName, [], state.contextExtensionList));
  }
  return states;
};
const resolvePathToComponents = (tokenPath, context, editor, components) =>
  walkTokenPath(tokenPath, [new WalkingState('ROOT', components, [])], context, editor).flatMap(state => state.components);
const getTemplate = description => {
  if (description?.__template !== undefined) return description.__raw && typeof description.__template === 'string' ? { __raw: true, value: description.__template } : description.__template;
  if (description?.__one_of) return getTemplate(description.__one_of[0]);
  if (description?.__any_of) return [];
  if (description?.__scope_link) return {};
  if (Array.isArray(description)) return description.length === 1 && typeof description[0] === 'object' ? (() => { const inner = getTemplate(description[0]); return inner != null ? [inner] : []; })() : [];
  return description && typeof description === 'object' ? {} : typeof description === 'string' && !PATH_PARAM_RE.test(description) ? description : description;
};
const getOptions = description => {
  const template = getTemplate(description);
  return template !== undefined ? { template } : {};
};

/**
 * 功能：
 * 把带花括号的占位符描述编译成可带动态候选的参数组件。
 *
 * 实现：
 * 根据占位符名称推断其语义类型，例如 `index`、`field`、`type`、`template`，
 * 并为这些类型绑定元数据列表加载器。若规则上还声明了模板，
 * 则会把模板附加到返回的 term 上，供插入时生成结构化片段。
 *
 * 输入：
 * - `value`：占位符原始字符串，例如 `{index}`。
 * - `compilingContext`：编译时上下文。
 * - `template`：可选插入模板。
 *
 * 输出：
 * - 返回一个补全组件实例。
 */
const createParametrizedComponent = (value, compilingContext, template) => {
  const name = value.slice(1, -1).toLowerCase();
  const factories = {
    index: () => new ListComponent(name, createMetadataListGenerator(['getIndices'], ['INDEX'], item => toTermItem(item, 'index')), null, false, true, 'index'),
    indices: () => new ListComponent(name, createMetadataListGenerator(['getIndices'], ['INDEX'], item => toTermItem(item, 'index')), null, true, true, 'index'),
    field: () => new ListComponent(name, createMetadataListGenerator(['getFields'], ['FIELD'], toFieldTerm), null, false, true, 'field'),
    fields: () => new ListComponent(name, createMetadataListGenerator(['getFields'], ['FIELD'], toFieldTerm), null, true, true, 'field'),
    type: () => new ListComponent(name, createMetadataListGenerator(['getTypes'], ['TYPE'], item => toTermItem(item, 'type')), null, false, true, 'type'),
    types: () => new ListComponent(name, createMetadataListGenerator(['getTypes'], ['TYPE'], item => toTermItem(item, 'type')), null, true, true, 'type'),
    template: () => new ListComponent(name, createMetadataListGenerator(['getTemplates'], ['TEMPLATE'], item => toTermItem(item, 'template')), null, true, true, 'template'),
    node: () => new ListComponent(name, ['_local', '_master', 'data:true', 'data:false', 'master:true', 'master:false'], null, false, true, 'node'),
    nodes: () => new ListComponent(name, ['_local', '_master', 'data:true', 'data:false', 'master:true', 'master:false'], null, true, true, 'node'),
    username: () => new ListComponent(name, ['USERNAME'], null, false, true, 'username'),
    user: () => new ListComponent(name, ['USERNAME'], null, false, true, 'username'),
  };
  const component = factories[name] ? factories[name](compilingContext) : new SimpleParamComponent(name);
  if (template === undefined) return component;
  const originalGetTerms = component.getTerms.bind(component);
  component.getTerms = async (context, editor) => (await Promise.resolve(originalGetTerms(context, editor)) || []).map(term => ({ ...(typeof term === 'object' ? term : { name: term }), template }));
  return component;
};
const compileCondition = (description, compiledObject) =>
  description.lines_regex
    ? new ConditionalProxy((context, editor) => new RegExp(description.lines_regex, 'm').test(editor.getLines(context.requestStartRow, editor.getCurrentPosition().lineNumber).join('\n')), compiledObject)
    : compiledObject;
const compileObject = (description, compilingContext) => {
  const objectComponent = new ConstantComponent('{');
  const constants = [], patterns = [];
  for (const [key, desc] of Object.entries(description)) {
    if (key.startsWith('__')) continue;
    const options = getOptions(desc);
    const component = PATH_PARAM_RE.test(key) ? createParametrizedComponent(key, compilingContext, options.template) : key === '*' ? new SharedComponent(key) : new ConstantComponent(key, null, [{ name: key, ...options }]);
    (PATH_PARAM_RE.test(key) || key === '*' ? patterns : constants).push(component);
    compileDescription(desc, compilingContext).forEach(subComponent => component.addComponent(subComponent));
  }
  objectComponent.addComponent(new ObjectComponent('inner', constants, patterns));
  return objectComponent;
};
const compileList = (listRule, compilingContext) => {
  const listComponent = new ConstantComponent('[');
  listRule.forEach(description => compileDescription(description, compilingContext).forEach(component => listComponent.addComponent(component)));
  return listComponent;
};

/**
 * 功能：
 * 把原始 autocomplete 规则描述递归编译成组件图。
 *
 * 实现：
 * 依据描述节点的类型分别处理：
 * - 数组规则编译为列表；
 * - 对象规则编译为对象树；
 * - `__scope_link`、`__one_of`、`__any_of`、`__condition` 等特殊语法
 *   会映射成对应的代理组件或分支结构。
 * 编译后的组件图会被请求体补全逻辑重复复用。
 *
 * 输入：
 * - `description`：原始规则描述节点。
 * - `compilingContext`：编译时上下文，包含 endpointId 等信息。
 *
 * 输出：
 * - 返回组件数组。
 */
const compileDescription = (description, compilingContext) => {
  if (Array.isArray(description)) return [compileList(description, compilingContext)];
  if (description && typeof description === 'object') {
    if (description.__scope_link) return [new ScopeResolver(description.__scope_link, compilingContext)];
    if (description.__any_of) return [compileList(description.__any_of, compilingContext)];
    if (description.__one_of) return description.__one_of.flatMap(item => compileDescription(item, compilingContext));
    const compiledObject = compileObject(description, compilingContext);
    return description.__condition ? [compileCondition(description.__condition, compiledObject)] : [compiledObject];
  }
  return [typeof description === 'string' && PATH_PARAM_RE.test(description) ? createParametrizedComponent(description, compilingContext) : new ConstantComponent(description)];
};
const compileBodyDescription = (endpointId, description) => compileDescription(description, { endpointId });
const extractRuleKeys = rule =>
  !rule || typeof rule !== 'object' || Array.isArray(rule)
    ? []
    : Object.entries(rule)
        .filter(([key]) => !key.startsWith('__'))
        .map(([key, value]) => ({ label: key.replace(/^\{|\}$/g, ''), type: PATH_PARAM_RE.test(key) ? 'variable' : 'property', detail: value && typeof value === 'object' && value.__template !== undefined ? 'template' : 'field', apply: `"${PATH_PARAM_RE.test(key) ? key.replace(/^\{|\}$/g, '') : key}": ` }));
const getNextRuleNode = (rule, segment) => {
  if (!rule || typeof rule !== 'object') return undefined;
  if (rule[segment] !== undefined) return rule[segment];
  if (rule['*'] !== undefined) return rule['*'];
  const patternKey = Object.keys(rule).find(key => PATH_PARAM_RE.test(key));
  return patternKey ? rule[patternKey] : undefined;
};
const walkRulePath = (rule, path, allowPartial = false) => {
  let current = rule;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return allowPartial ? current || null : null;
    const next = getNextRuleNode(current, segment);
    if (next === undefined) return allowPartial ? current : null;
    current = next;
  }
  return current;
};
const createCompiledApi = (api, version) => ({
  version,
  globals: Object.fromEntries(Object.entries(api.globals || {}).map(([name, rules]) => [name, compileBodyDescription(`GLOBAL.${name}`, rules)])),
  endpoints: Object.fromEntries(Object.entries(api.endpoints || {}).map(([name, endpoint]) => [name, { ...endpoint, patterns: getVersionCompatiblePatterns(endpoint.patterns, version), compiledBody: compileBodyDescription(name, endpoint.data_autocomplete_rules || {}) }])),
});
const compiledApis = { es6: createCompiledApi(kibanaConsoleData.es6, 'es6'), es7: createCompiledApi(kibanaConsoleData.es7, 'es7'), es8: createCompiledApi(kibanaConsoleData.es8 || kibanaConsoleData.es7, 'es8') };

/**
 * 功能：
 * 获取指定 ES 版本对应的编译后 API 规则集。
 *
 * 实现：
 * 模块加载时会预编译好 `es6`、`es7`、`es8` 三份规则，
 * 这里按版本名直接读取；若版本未知，则默认回退到 `es7`。
 *
 * 输入：
 * - `version`：目标版本字符串。
 *
 * 输出：
 * - 返回编译后的 API 对象。
 */
export const getCompiledApi = version => compiledApis[version] || compiledApis.es7;
const resolveTerms = async (components, runtimeContext, editorAdapter) => {
  const resolved = [];
  for (const component of components) (await Promise.resolve(component.getTerms(runtimeContext, editorAdapter) || [])).forEach(term => resolved.push(typeof term === 'object' ? term : { name: term }));
  return resolved;
};

/**
 * 功能：
 * 沿当前 tokenPath 补齐运行时上下文，并收集可展示的自动补全项。
 *
 * 实现：
 * 先在组件图中走一遍当前 tokenPath，得到一组候选 walking state；
 * 然后：
 * - 可选地把这些状态上的候选 terms 解析成 `autoCompleteSet`；
 * - 选出优先级最高的状态，把它累积的上下文扩展回填到 `context`。
 *
 * 输入：
 * - `tokenPath`：当前 JSON 结构 token 路径。
 * - `context`：待补充的运行时上下文对象。
 * - `editor`：编辑器适配器。
 * - `includeAutoComplete`：是否需要生成候选项。
 * - `components`：入口组件数组。
 *
 * 输出：
 * - 返回一个 Promise；副作用是修改传入的 `context`。
 */
const populateContextAsync = async (tokenPath, context, editor, includeAutoComplete, components) => {
  const walkStates = walkTokenPath(tokenPath, [new WalkingState('ROOT', components, [])], context, editor);
  if (includeAutoComplete) {
    const autoCompleteSet = [];
    for (const state of walkStates) autoCompleteSet.push(...(await resolveTerms(state.components, passThroughContext(context, state.contextExtensionList), editor)));
    context.autoCompleteSet = uniqBy(autoCompleteSet, 'name');
  }
  if (!walkStates.length) return;
  const selectedState = [...walkStates].sort((left, right) => (typeof left.priority === 'number' ? left.priority : Number.MAX_VALUE) - (typeof right.priority === 'number' ? right.priority : Number.MAX_VALUE)).find(state => state.components.length === 0) || walkStates[0];
  selectedState.contextExtensionList.forEach(extension => Object.assign(context, extension));
};
const getDynamicPathSuggestions = async (segmentName, metadataService) => {
  const loaders = {
    index: ['getIndices', 'index'],
    indices: ['getIndices', 'index'],
    field: ['getFields', 'field'],
    fields: ['getFields', 'field'],
    type: ['getTypes', 'type'],
    types: ['getTypes', 'type'],
    template: ['getTemplates', 'template'],
  };
  const config = loaders[segmentName];
  if (!config) return [];
  const items = await loadMetadataItems(metadataService, [config[0]]);
  return items.map(item => ({
    label: String(item?.name ?? item?.label ?? item?.value ?? item),
    type: 'constant',
    detail: config[1] === 'field' ? item?.type || 'field' : config[1],
  }));
};

/**
 * 功能：
 * 获取 URL 路径占位符的补全建议。
 *
 * 实现：
 * 优先读取 endpoint 上显式声明的 `url_components`；
 * 如果该占位符没有静态配置，则退回到基于元数据服务的动态建议生成。
 *
 * 输入：
 * - `endpoint`：当前匹配到的 endpoint，可为空。
 * - `segmentName`：路径占位符名称。
 * - `metadataService`：可选元数据服务。
 *
 * 输出：
 * - 返回一个 Promise，resolve 为补全候选项数组。
 */
export const getUrlComponentSuggestions = async (endpoint, segmentName, metadataService) => {
  const component = endpoint?.url_components?.[segmentName];
  if (Array.isArray(component)) return component.map(label => ({ label: String(label), type: 'constant', detail: 'path' }));
  if (component?.list && Array.isArray(component.list)) return component.list.map(label => ({ label: String(label), type: 'constant', detail: 'path' }));
  return getDynamicPathSuggestions(segmentName, metadataService);
};

/**
 * 功能：
 * 根据当前原始路径推断最后一个占位符段对应的参数名。
 *
 * 实现：
 * 把当前路径和 endpoint pattern 按段对齐比较，
 * 找出最后一个仍处于“待填写或刚开始填写”状态的占位符位置，
 * 并返回占位符名，供动态路径补全调用。
 *
 * 输入：
 * - `endpoint`：当前 endpoint 定义。
 * - `rawPath`：用户当前输入的原始路径。
 *
 * 输出：
 * - 返回占位符名称字符串，若未匹配到则返回 `null`。
 */
export const getPathPlaceholderInfo = (endpoint, rawPath) => {
  const pathParts = normalizePath(rawPath).split('/');
  for (const pattern of endpoint.patterns || []) {
    const patternParts = normalizePath(pattern).split('/');
    for (let index = 0; index < Math.min(patternParts.length, pathParts.length); index += 1) {
      if (!PATH_PARAM_RE.test(patternParts[index])) continue;
      if (pathParts[index] === patternParts[index] || (index === pathParts.length - 1 && rawPath.endsWith(patternParts[index])) || (!pathParts[index] && index >= pathParts.length - 1)) return patternParts[index].slice(1, -1);
    }
  }
  return null;
};
const buildBodyOption = (term, lineInfo, desiredIndent, isObjectKeyInsertionPoint) => {
  const label = term.name ?? term.label ?? '';
  const insertion = term.template !== undefined ? buildTemplateInsertion(term.template, desiredIndent) : null;
  const apply = insertion ? `"${label}": ${insertion.text}` : /^[_A-Z0-9]+$/i.test(label) && label !== '{' && label !== '[' ? `"${label}": ` : JSON.stringify(label);
  return {
    label,
    type: term.meta === 'value' ? 'constant' : 'property',
    detail: term.meta || 'field',
    apply,
    cursorOffset: typeof insertion?.cursorOffset === 'number' ? (isObjectKeyInsertionPoint ? desiredIndent.length : 0) + `"${label}": `.length + insertion.cursorOffset : undefined,
    editorApplyText: isObjectKeyInsertionPoint ? `${desiredIndent}${apply}` : apply,
    editorReplaceFrom: isObjectKeyInsertionPoint ? lineInfo.lineStart : undefined,
  };
};
const getFallbackRuleOptions = (endpointRule, rulePath, prefix) =>
  filterOptions(extractRuleKeys(walkRulePath(endpointRule, rulePath) ?? walkRulePath(endpointRule, rulePath, true) ?? endpointRule), prefix);
const createRuntimeContext = (api, request, bodyState, metadataService) => ({
  method: request.method,
  requestStartRow: request.requestLineNumber,
  otherTokenValues: bodyState.otherTokenValues,
  metadataService,
  endpointComponentResolver: name => api.endpoints[name]?.compiledBody || EMPTY_COMPONENTS,
  globalComponentResolver(name, throwOnMissing = true) {
    const result = api.globals[name];
    if (!result && throwOnMissing) throw new Error(`failed to resolve global components for ['${name}']`);
    return result;
  },
});
const createEditorAdapter = (context, request) => ({
  getCurrentPosition: () => ({ lineNumber: request.lineNumber }),
  getLines: (start, end) => context.state.doc.toString().split(/\r?\n/).slice(Math.max(0, start - 1), end),
});

/**
 * 功能：
 * 计算请求体区域在当前位置的自动补全结果。
 *
 * 实现：
 * 核心步骤如下：
 * 1. 解析请求体 tokenPath 和规则路径；
 * 2. 根据方法与路径找到最匹配的 endpoint 规则；
 * 3. 构造运行时上下文并填充动态候选集；
 * 4. 判断当前位置是在对象 key、普通值还是数组值场景；
 * 5. 生成带模板插入能力的补全项，并在必要时回退到规则 key 提示。
 *
 * 输入：
 * - `context`：CodeMirror 补全文本上下文。
 * - `request`：当前请求块对象。
 * - `version`：规则版本。
 * - `metadataService`：可选元数据服务。
 *
 * 输出：
 * - 返回一个 Promise，resolve 为请求体补全结果对象。
 */
export const getBodyCompletion = async (context, request, version, metadataService) => {
  const bodyState = parseBodyTokenPath(request.bodyText, Math.max(0, context.pos - request.bodyStart));
  if (!bodyState) {
    return { from: context.pos, options: [], validFor: BODY_VALID_FOR_RE };
  }
  const api = getCompiledApi(version);
  const endpointName = findMatchingEndpoints(api, request.method, request.path, version)[0]?.[0];
  const endpoint = endpointName ? api.endpoints[endpointName] : null;
  const endpointRule = endpoint?.data_autocomplete_rules || {};
  const runtimeContext = createRuntimeContext(api, request, bodyState, metadataService);
  await populateContextAsync(bodyState.tokenPath, runtimeContext, createEditorAdapter(context, request), true, endpoint ? endpoint.compiledBody : [new GlobalOnlyComponent('__global__')]);
  const lineInfo = getCurrentLineInfo(context);
  const currentWord = context.matchBefore(BODY_WORD_RE);
  const defaultPrefix = currentWord?.text || '';
  const defaultFrom = currentWord?.from ?? context.pos;
  const quotedKeyPrefix = lineInfo.beforeCursor.includes('"') ? getQuotedKeyPrefix(lineInfo.beforeCursor) : null;
  const trimmedBeforeCursor = lineInfo.beforeCursor.trimEnd();
  const isQuotedKeyInput = bodyState.activeType === 'object' && bodyState.expectingKey && lineInfo.beforeCursor.includes('"');
  const isPlainKeyInsertionPoint = bodyState.activeType === 'object' && bodyState.expectingKey && /^\s*[\w.-]*$/.test(lineInfo.beforeCursor);
  const isObjectKeyInsertionPoint = isQuotedKeyInput || isPlainKeyInsertionPoint;
  const prefix = isQuotedKeyInput && quotedKeyPrefix ? quotedKeyPrefix.prefix : defaultPrefix;
  const prefixFrom = isQuotedKeyInput && quotedKeyPrefix ? lineInfo.lineStart + quotedKeyPrefix.fromOffset : defaultFrom;
  if ((isObjectKeyInsertionPoint && prefix.length < 1) || trimmedBeforeCursor.endsWith(',')) return { from: context.pos, options: [] };
  const desiredIndent = bodyState.activeType === 'object' && bodyState.nestingDepth > 0 ? '  '.repeat(bodyState.nestingDepth) : lineInfo.indent;
  const options = filterOptions(
    (runtimeContext.autoCompleteSet || [])
      .map(term => buildBodyOption(term, lineInfo, desiredIndent, isObjectKeyInsertionPoint))
      .filter(option => option.label && option.label !== '{' && option.label !== '[')
      .filter(option => !(bodyState.activeType === 'object' && option.type === 'constant')),
    prefix
  );
  if (options.length) {
    return { from: prefixFrom, options, validFor: BODY_VALID_FOR_RE };
  }

  // Kibana Console does not fall back to top-level object keys from inside an array
  // when the current array token stream does not match any valid array element rule.
  if (bodyState.activeType === 'array') {
    return { from: prefixFrom, options: [], validFor: BODY_VALID_FOR_RE };
  }

  return {
    from: prefixFrom,
    options: getFallbackRuleOptions(endpointRule, bodyState.rulePath, prefix),
    validFor: BODY_VALID_FOR_RE,
  };
};
