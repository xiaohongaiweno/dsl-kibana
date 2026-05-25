import test from 'node:test';
import assert from 'node:assert/strict';
import { getKibanaCompletions } from './kibanaConsoleAutocomplete.js';

const metadataService = {
  async getIndices() {
    return ['foo', 'bar', 'logs-2024'];
  },
  async getFields() {
    return [
      { name: 'message', type: 'text' },
      { name: 'user.id', type: 'keyword' },
      { name: '@timestamp', type: 'date' },
    ];
  },
  async getTypes() {
    return ['_doc', 'legacy_type'];
  },
  async getTemplates() {
    return ['tpl_logs', 'tpl_metrics'];
  },
};

const getLabels = options => options.map(option => option.label);
const getOptionMap = options => new Map(options.map(option => [option.label, option]));

test('sort array suggestions use metadataService fields', async () => {
  const result = await getKibanaCompletions({
    text: 'GET /_search\n{\n  "sort": [\n    ',
    cursor: 29,
    version: 'es7',
    metadataService,
  });

  const labels = getLabels(result.options || []);
  const byLabel = getOptionMap(result.options || []);

  assert.deepEqual(labels, []);
  assert.equal(byLabel.size, 0);
});

test('template path placeholder suggestions use metadataService templates', async () => {
  const text = 'GET /_template/{template}';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es7',
    metadataService,
  });

  const labels = getLabels(result.options || []);
  const byLabel = getOptionMap(result.options || []);

  assert.ok(labels.includes('tpl_logs'));
  assert.ok(labels.includes('tpl_metrics'));
  assert.equal(byLabel.get('tpl_logs')?.detail, 'template');
  assert.equal(byLabel.get('tpl_logs')?.type, 'constant');
});

test('index path placeholder suggestions use metadataService indices', async () => {
  const text = 'GET /{index}';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es7',
    metadataService,
  });

  const labels = getLabels(result.options || []);

  assert.ok(labels.includes('foo'));
  assert.ok(labels.includes('bar'));
  assert.ok(labels.includes('logs-2024'));
});

test('es6 type path placeholder suggestions use metadataService types', async () => {
  const text = 'GET /foo/{type}';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es6',
    metadataService,
  });

  const labels = getLabels(result.options || []);

  assert.ok(labels.includes('_doc'));
  assert.ok(labels.includes('legacy_type'));
});

test('invalid array body content does not trigger root object completions', async () => {
  const text = 'POST /xiao/_search\n[qu]';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length - 1,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('text after a closed array does not trigger body completions', async () => {
  const text = 'POST /xiao/_search\n[]a';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('space inside an empty object does not trigger top-level body completions', async () => {
  const text = 'POST /xiao/_search\n{ }';
  const result = await getKibanaCompletions({
    text,
    cursor: text.lastIndexOf(' ') + 1,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('space inside a nested empty object does not trigger body completions', async () => {
  const text = 'POST /xiao/_search\n{ "query": { } }';
  const result = await getKibanaCompletions({
    text,
    cursor: text.lastIndexOf(' }') + 1,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('typing a key prefix inside an object still returns matching completions', async () => {
  const text = 'POST /xiao/_search\n{ q';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es7',
    metadataService,
  });

  assert.ok(getLabels(result.options || []).includes('query'));
});

test('array value with only whitespace does not trigger completions', async () => {
  const text = 'GET /_search\n{\n  "query": {\n    "multi_match": {\n      "query": "",\n      "fields": [ \n    }\n  }\n}';
  const result = await getKibanaCompletions({
    text,
    cursor: text.indexOf('[ ') + 2,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('array value prefix still returns matching completions', async () => {
  const text = 'GET /_search\n{\n  "query": {\n    "multi_match": {\n      "query": "",\n      "fields": [ m\n    }\n  }\n}';
  const result = await getKibanaCompletions({
    text,
    cursor: text.indexOf('[ m') + 3,
    version: 'es7',
    metadataService,
  });

  assert.ok(getLabels(result.options || []).includes('message'));
});

test('array value after comma with only whitespace does not trigger completions', async () => {
  const text = 'GET /_search\n{\n  "query": {\n    "multi_match": {\n      "query": "",\n      "fields": [ "message", \n    }\n  }\n}';
  const result = await getKibanaCompletions({
    text,
    cursor: text.indexOf(', ') + 2,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('quoted key input inside an object still returns matching completions', async () => {
  const text = 'POST /xiao/_search\n{ "qu';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es7',
    metadataService,
  });

  assert.ok(getLabels(result.options || []).includes('query'));
});

test('cluster namespace path does not get polluted by index placeholder explain endpoint', async () => {
  const text = 'GET /_cluster/_e';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es7',
    metadataService,
  });

  assert.ok(!getLabels(result.options || []).includes('_explain'));
});

test('index path still suggests explain endpoint after concrete index name', async () => {
  const text = 'GET /logs-2024/_e';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es7',
    metadataService,
  });

  assert.ok(getLabels(result.options || []).includes('_explain'));
});

test('space inside a quoted string value does not trigger sibling object completions', async () => {
  const text = 'GET /_search\n{\n  "query": {\n    "term": {\n      "FIELD": {\n        "value": "ab cd"\n      }\n    }\n  }\n}';
  const result = await getKibanaCompletions({
    text,
    cursor: text.indexOf('ab cd') + 3,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('punctuation inside a quoted string value does not trigger sibling object completions', async () => {
  const text = 'GET /_search\n{\n  "query": {\n    "term": {\n      "FIELD": {\n        "value": "ab,cd"\n      }\n    }\n  }\n}';
  const result = await getKibanaCompletions({
    text,
    cursor: text.indexOf('ab,cd') + 3,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('mismatched closing bracket inside an object does not fall back to root completions', async () => {
  const text = 'GET /_search\n{\n  "query": {\n    ]\n  }\n}';
  const result = await getKibanaCompletions({
    text,
    cursor: text.indexOf(']') + 1,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('mismatched closing brace inside an array does not fall back to root completions', async () => {
  const text = 'GET /_search\n{\n  "sort": [\n    }\n  ]\n}';
  const result = await getKibanaCompletions({
    text,
    cursor: text.indexOf('}') + 1,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('partial invalid array token does not trigger root object completions', async () => {
  const text = 'POST /xiao/_search\n[qu';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es7',
    metadataService,
  });

  assert.deepEqual(getLabels(result.options || []), []);
});

test('second request block still gets method completions after first body closes', async () => {
  const text = 'GET /_search\n{}\n\nPO';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es7',
    metadataService,
  });

  const labels = getLabels(result.options || []);

  assert.ok(labels.includes('POST'));
});

test('new top-level line gets method completions instead of reusing later request block', async () => {
  const text = 'g\nGET /_search\n{\n  "query": {\n    "match_all": {}\n  }\n}';
  const result = await getKibanaCompletions({
    text,
    cursor: 1,
    version: 'es7',
    metadataService,
  });

  const labels = getLabels(result.options || []);

  assert.ok(labels.includes('GET'));
  assert.ok(!labels.includes('aggs'));
});

test('standalone json body does not get method completions inside object', async () => {
  const text = '{\n  g';
  const result = await getKibanaCompletions({
    text,
    cursor: text.length,
    version: 'es7',
    metadataService,
  });

  assert.ok(!getLabels(result.options || []).includes('GET'));
});
