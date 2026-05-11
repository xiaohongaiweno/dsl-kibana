const DEFAULT_HOST = 'http://localhost:9200';
const CACHE_TTL = 30000;

function uniqBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeIndices(indices) {
  if (!indices) return [];
  return Array.isArray(indices) ? indices : [indices];
}

function extractFieldsFromMapping(fieldName, fieldMapping = {}) {
  if (fieldMapping.enabled === false) {
    return [];
  }

  const fields = [];
  const fieldType = fieldMapping.type || 'object';
  fields.push({ name: fieldName, type: fieldType });

  if (fieldMapping.properties) {
    for (const [nestedName, nestedMapping] of Object.entries(fieldMapping.properties)) {
      for (const nestedField of extractFieldsFromMapping(nestedName, nestedMapping)) {
        fields.push({
          name: `${fieldName}.${nestedField.name}`,
          type: nestedField.type,
        });
      }
    }
  }

  if (fieldMapping.fields) {
    for (const [nestedName, nestedMapping] of Object.entries(fieldMapping.fields)) {
      for (const nestedField of extractFieldsFromMapping(nestedName, nestedMapping)) {
        fields.push({
          name: `${fieldName}.${nestedField.name}`,
          type: nestedField.type,
        });
      }
    }
  }

  return fields;
}

export function createEsMetadataService(esHost = DEFAULT_HOST) {
  const cache = {
    fetchedAt: 0,
    indices: [],
    aliases: new Map(),
    templates: [],
    fieldsByIndex: new Map(),
    typesByIndex: new Map(),
  };
  const listeners = new Set();
  let inFlightRefresh = null;
  let status = {
    state: 'idle',
    stale: false,
    lastSuccessAt: 0,
    lastAttemptAt: 0,
    lastError: null,
  };

  function emit() {
    const snapshot = {
      state: status.state,
      stale: status.stale,
      lastSuccessAt: status.lastSuccessAt,
      lastAttemptAt: status.lastAttemptAt,
      lastError: status.lastError,
    };

    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function setStatus(nextStatus) {
    status = {
      ...status,
      ...nextStatus,
    };
    emit();
  }

  async function refresh() {
    const now = Date.now();
    if (now - cache.fetchedAt < CACHE_TTL) {
      return cache;
    }

    if (inFlightRefresh) {
      return inFlightRefresh;
    }

    setStatus({
      state: 'loading',
      stale: cache.fetchedAt > 0,
      lastAttemptAt: now,
      lastError: null,
    });

    inFlightRefresh = (async () => {
      const [mappingResp, aliasResp, templateResp] = await Promise.allSettled([
        fetch(`${esHost}/_mapping`, { signal: AbortSignal.timeout(10000) }),
        fetch(`${esHost}/_alias`, { signal: AbortSignal.timeout(10000) }),
        fetch(`${esHost}/_template`, { signal: AbortSignal.timeout(10000) }),
      ]);

      const mappings =
        mappingResp.status === 'fulfilled' && mappingResp.value.ok ? await mappingResp.value.json() : null;
      const aliases =
        aliasResp.status === 'fulfilled' && aliasResp.value.ok ? await aliasResp.value.json() : null;
      const templates =
        templateResp.status === 'fulfilled' && templateResp.value.ok ? await templateResp.value.json() : null;

      if (!mappings && !aliases && !templates) {
        const failure = new Error('Failed to refresh Elasticsearch metadata');
        setStatus({
          state: cache.fetchedAt > 0 ? 'stale' : 'error',
          stale: cache.fetchedAt > 0,
          lastError: failure,
        });
        return cache;
      }

      if (mappings) {
        cache.indices = Object.keys(mappings);
        cache.fieldsByIndex = new Map();
        cache.typesByIndex = new Map();

        for (const [indexName, indexInfo] of Object.entries(mappings)) {
          const mappingRoot = indexInfo.mappings || {};
          const properties = mappingRoot.properties || {};
          const types = Object.keys(mappingRoot).filter(key => key !== 'properties' && !key.startsWith('_'));
          const fields = [];

          for (const [fieldName, fieldMapping] of Object.entries(properties)) {
            fields.push(...extractFieldsFromMapping(fieldName, fieldMapping));
          }

          cache.fieldsByIndex.set(indexName, uniqBy(fields, field => `${field.name}:${field.type}`));
          cache.typesByIndex.set(indexName, types);
        }
      }

      if (aliases) {
        cache.aliases = new Map();
        for (const [indexName, indexInfo] of Object.entries(aliases)) {
          const aliasObject = indexInfo.aliases || {};
          for (const aliasName of Object.keys(aliasObject)) {
            const current = cache.aliases.get(aliasName) || [];
            current.push(indexName);
            cache.aliases.set(aliasName, current);
          }
        }
      }

      if (templates) {
        cache.templates = Object.keys(templates);
      }

      cache.fetchedAt = now;
      setStatus({
        state: 'ready',
        stale: false,
        lastSuccessAt: now,
        lastError: null,
      });

      return cache;
    })();

    try {
      return await inFlightRefresh;
    } finally {
      inFlightRefresh = null;
    }
  }

  async function getIndices(includeAliases = true) {
    await refresh();
    const indices = [...cache.indices];
    if (includeAliases) {
      indices.push(...cache.aliases.keys());
    }
    return [...new Set(indices)].sort();
  }

  async function getTemplates() {
    await refresh();
    return [...cache.templates].sort();
  }

  async function getTypes(indices) {
    await refresh();
    const expandedIndices = expandAliases(normalizeIndices(indices));
    if (!expandedIndices.length) {
      return uniqBy(
        [...cache.typesByIndex.values()].flat().map(type => ({ name: type })),
        item => item.name
      ).map(item => item.name);
    }

    const result = [];
    for (const index of expandedIndices) {
      result.push(...(cache.typesByIndex.get(index) || []));
    }
    return [...new Set(result)].sort();
  }

  async function getFields(indices) {
    await refresh();
    const expandedIndices = expandAliases(normalizeIndices(indices));
    const targets = expandedIndices.length ? expandedIndices : cache.indices;
    const result = [];
    for (const index of targets) {
      result.push(...(cache.fieldsByIndex.get(index) || []));
    }
    return uniqBy(result, field => `${field.name}:${field.type}`).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  function expandAliases(indices) {
    const expanded = [];
    for (const index of indices) {
      const aliased = cache.aliases.get(index);
      if (aliased?.length) {
        expanded.push(...aliased);
      } else {
        expanded.push(index);
      }
    }
    return [...new Set(expanded)];
  }

  return {
    refresh,
    getIndices,
    getFields,
    getTypes,
    getTemplates,
    getStatus() {
      return { ...status };
    },
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...status });
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
