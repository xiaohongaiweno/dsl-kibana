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

  assert.ok(labels.includes('message'));
  assert.ok(labels.includes('user.id'));
  assert.ok(labels.includes('@timestamp'));
  assert.equal(byLabel.get('message')?.detail, 'text');
  assert.equal(byLabel.get('user.id')?.detail, 'keyword');
  assert.equal(byLabel.get('@timestamp')?.detail, 'date');
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
