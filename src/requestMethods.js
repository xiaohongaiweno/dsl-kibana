export const SUPPORTED_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMethodPattern(methods) {
  return methods.map(escapeRegExp).join('|');
}

export function createStrictRequestLineRegExp(methods = SUPPORTED_HTTP_METHODS) {
  return new RegExp(`^\\s*(${buildMethodPattern(methods)})\\s+(\\S+)(?:\\s*)$`, 'i');
}

export function createLooseRequestLineRegExp(methods = SUPPORTED_HTTP_METHODS) {
  return new RegExp(`^\\s*(${buildMethodPattern(methods)})(?:\\s+(\\S*))?(?:\\s*)$`, 'i');
}
