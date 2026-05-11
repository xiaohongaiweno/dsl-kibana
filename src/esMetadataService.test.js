import test from 'node:test';
import assert from 'node:assert/strict';
import { createEsMetadataService } from './esMetadataService.js';

function createJsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    },
  };
}

test('metadata refresh keeps previous cache when a later refresh fully fails', async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async url => {
    callCount += 1;
    if (callCount <= 3) {
      if (url.endsWith('/_mapping')) {
        return createJsonResponse({
          books: {
            mappings: {
              properties: {
                title: { type: 'text' },
              },
            },
          },
        });
      }

      if (url.endsWith('/_alias')) {
        return createJsonResponse({
          books: {
            aliases: {
              books_alias: {},
            },
          },
        });
      }

      return createJsonResponse({
        books_template: {},
      });
    }

    throw new Error('network down');
  };

  try {
    const service = createEsMetadataService('http://example.test');
    await service.refresh();

    assert.deepEqual(await service.getIndices(true), ['books', 'books_alias']);
    assert.equal(service.getStatus().state, 'ready');

    const originalNow = Date.now;
    Date.now = () => originalNow() + 31000;

    try {
      await service.refresh();
    } finally {
      Date.now = originalNow;
    }

    assert.deepEqual(await service.getIndices(true), ['books', 'books_alias']);
    assert.equal(service.getStatus().state, 'stale');
    assert.equal(service.getStatus().stale, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('metadata refresh deduplicates concurrent callers into one in-flight request', async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async url => {
    fetchCalls += 1;
    if (url.endsWith('/_mapping')) {
      return createJsonResponse({});
    }
    if (url.endsWith('/_alias')) {
      return createJsonResponse({});
    }
    return createJsonResponse({});
  };

  try {
    const service = createEsMetadataService('http://example.test');
    await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
    assert.equal(fetchCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
