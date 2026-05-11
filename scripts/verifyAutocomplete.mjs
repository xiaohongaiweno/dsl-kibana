import fs from 'node:fs';
import path from 'node:path';
import { getKibanaCompletions } from '../src/kibanaConsoleAutocomplete.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const samples = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts', 'autocompleteSamples.json'), 'utf8')
);

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

let failed = 0;

for (const sample of samples) {
  const result = await getKibanaCompletions({
    text: sample.text,
    cursor: sample.cursor,
    version: sample.version,
    metadataService,
  });

  const byLabel = new Map((result.options || []).map(option => [option.label, option]));
  const labels = (result.options || []).map(option => option.label);
  const missing = (sample.mustInclude || []).filter(label => !labels.includes(label));
  const unexpected = (sample.mustExclude || []).filter(label => labels.includes(label));
  const wrongFrom =
    typeof sample.expectFrom === 'number' && result.from !== sample.expectFrom
      ? { expected: sample.expectFrom, actual: result.from }
      : null;
  const entryMismatches = [];

  for (const [label, expected] of Object.entries(sample.mustContainEntries || {})) {
    const actual = byLabel.get(label);
    if (!actual) {
      entryMismatches.push(`${label}: missing entry`);
      continue;
    }

    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) {
        entryMismatches.push(
          `${label}.${key}: expected ${JSON.stringify(value)} got ${JSON.stringify(actual[key])}`
        );
      }
    }
  }

  if (missing.length || unexpected.length || wrongFrom || entryMismatches.length) {
    failed += 1;
    console.error(`FAIL ${sample.name}`);
    if (wrongFrom) {
      console.error(`  from: expected ${wrongFrom.expected}, got ${wrongFrom.actual}`);
    }
    if (missing.length) {
      console.error(`  missing: ${missing.join(', ')}`);
    }
    if (unexpected.length) {
      console.error(`  unexpected: ${unexpected.join(', ')}`);
    }
    if (entryMismatches.length) {
      console.error(`  mismatches: ${entryMismatches.join(' | ')}`);
    }
    console.error(`  labels: ${labels.slice(0, 30).join(', ')}`);
  } else {
    console.log(`PASS ${sample.name}`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log(`All ${samples.length} samples passed.`);
}
