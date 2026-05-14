export const SUPPORTED_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];

/**
 * 功能：
 * 对正则表达式中的特殊字符做转义，确保普通文本可安全拼接进正则。
 *
 * 实现：
 * 使用全局替换，把 `.`、`*`、`?`、`[]`、`()` 等具有正则语义的字符
 * 统一替换为带反斜杠的字面量形式。
 *
 * 输入：
 * - `text`：需要转义的原始字符串。
 *
 * 输出：
 * - 返回转义后的字符串，可安全用于 `RegExp` 构造。
 */
export const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildMethodPattern = methods => methods.map(escapeRegExp).join('|');
const createRequestLineRegExp = (methods, allowEmptyPath) =>
  new RegExp(
    `^\\s*(${buildMethodPattern(methods)})${allowEmptyPath ? '(?:\\s+(\\S*))?' : '\\s+(\\S+)'}(?:\\s*)$`,
    'i'
  );

/**
 * 功能：
 * 创建用于严格匹配 Kibana Console 请求行的正则表达式。
 *
 * 实现：
 * 要求请求行至少包含“HTTP 方法 + 空格 + 路径”，
 * 因此适合用于真正执行请求前的合法性校验和精确解析。
 *
 * 输入：
 * - `methods`：可选的 HTTP 方法列表，默认使用 `SUPPORTED_HTTP_METHODS`。
 *
 * 输出：
 * - 返回一个 `RegExp` 实例。
 */
export const createStrictRequestLineRegExp = (methods = SUPPORTED_HTTP_METHODS) =>
  createRequestLineRegExp(methods, false);

/**
 * 功能：
 * 创建用于宽松匹配请求行前缀的正则表达式。
 *
 * 实现：
 * 与严格版本相比，这里允许路径部分暂时为空，
 * 适合在用户输入中的“半成品请求行”场景下做自动补全判断。
 *
 * 输入：
 * - `methods`：可选的 HTTP 方法列表，默认使用 `SUPPORTED_HTTP_METHODS`。
 *
 * 输出：
 * - 返回一个 `RegExp` 实例。
 */
export const createLooseRequestLineRegExp = (methods = SUPPORTED_HTTP_METHODS) =>
  createRequestLineRegExp(methods, true);
