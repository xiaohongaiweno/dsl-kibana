import fs from 'node:fs';
import path from 'node:path';
import { kibanaConsoleData } from '../src/kibanaConsoleData.generated.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outputPath = path.join(root, 'scripts', 'staticSuffixEndpointAudit.md');
const versions = ['es6', 'es7', 'es8'];

function isPlaceholder(segment) {
  return /^\{[^}]+\}$/.test(segment);
}

function collectVersionRows(version) {
  const api = kibanaConsoleData[version];
  const rows = [];

  for (const [name, endpoint] of Object.entries(api?.endpoints || {})) {
    for (const pattern of endpoint.patterns || []) {
      const segments = pattern.split('/').filter(Boolean);

      for (let index = 0; index < segments.length - 1; index += 1) {
        if (!isPlaceholder(segments[index])) {
          continue;
        }

        const suffixSegments = segments.slice(index + 1);
        if (suffixSegments.length < 2 || !suffixSegments.every(segment => !isPlaceholder(segment))) {
          continue;
        }

        rows.push({
          endpoint: name,
          methods: (endpoint.methods || []).join(', '),
          pattern,
          suffix: suffixSegments.join('/'),
          documentation: endpoint.documentation || '',
        });
        break;
      }
    }
  }

  rows.sort((a, b) => {
    if (a.suffix !== b.suffix) {
      return a.suffix.localeCompare(b.suffix);
    }
    if (a.endpoint !== b.endpoint) {
      return a.endpoint.localeCompare(b.endpoint);
    }
    return a.pattern.localeCompare(b.pattern);
  });

  return rows;
}

function buildMarkdown() {
  const lines = [
    '# Static Suffix Endpoint Audit',
    '',
    'Endpoints where a dynamic prefix segment is followed by a fully static multi-segment suffix.',
    'These are the paths most likely to benefit from one-shot completion such as `_validate/query`.',
    '',
  ];

  for (const version of versions) {
    const rows = collectVersionRows(version);
    lines.push(`## ${version.toUpperCase()} (${rows.length})`);
    lines.push('');
    lines.push('| Endpoint | Methods | Pattern | Static suffix | Documentation |');
    lines.push('| --- | --- | --- | --- | --- |');

    for (const row of rows) {
      lines.push(
        `| \`${row.endpoint}\` | \`${row.methods}\` | \`${row.pattern}\` | \`${row.suffix}\` | ${row.documentation} |`
      );
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

const markdown = buildMarkdown();
fs.writeFileSync(outputPath, markdown, 'utf8');
console.log(`Wrote ${outputPath}`);
