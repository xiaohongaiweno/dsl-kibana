export const SUPPORTED_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];

export const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildMethodPattern = methods => methods.map(escapeRegExp).join('|');
const createRequestLineRegExp = (methods, allowEmptyPath) =>
  new RegExp(
    `^\\s*(${buildMethodPattern(methods)})${allowEmptyPath ? '(?:\\s+(\\S*))?' : '\\s+(\\S+)'}(?:\\s*)$`,
    'i'
  );

export const createStrictRequestLineRegExp = (methods = SUPPORTED_HTTP_METHODS) =>
  createRequestLineRegExp(methods, false);

export const createLooseRequestLineRegExp = (methods = SUPPORTED_HTTP_METHODS) =>
  createRequestLineRegExp(methods, true);
