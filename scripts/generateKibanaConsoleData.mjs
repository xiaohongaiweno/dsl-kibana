import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const FRONTEND_SRC = path.join(ROOT, 'frontend', 'src');
const KIBANA_ROOT = path.join(ROOT, 'kibana-7.6.0');

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function mergeDeep(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return deepClone(source);
  }

  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeDeep(result[key], value);
    } else {
      result[key] = deepClone(value);
    }
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => path.join(dirPath, file));
}

function loadSpecDir(specRoot) {
  const generatedDir = path.join(specRoot, 'generated');
  const overridesDir = path.join(specRoot, 'overrides');
  const generatedFiles = listJsonFiles(generatedDir);
  const overrideFiles = new Map(
    listJsonFiles(overridesDir).map(filePath => [path.basename(filePath), filePath])
  );

  const spec = {};
  for (const generatedFile of generatedFiles) {
    const base = readJson(generatedFile);
    const overrideFile = overrideFiles.get(path.basename(generatedFile));
    const merged = overrideFile ? mergeDeep(base, readJson(overrideFile)) : base;
    Object.assign(spec, merged);
  }

  return spec;
}

class Api {
  constructor(name) {
    this.name = name;
    this.globalRules = {};
    this.endpoints = {};
  }

  addGlobalAutocompleteRules(parentNode, rules) {
    this.globalRules[parentNode] = rules;
  }

  addEndpointDescription(endpoint, description = {}) {
    let copiedDescription = this.endpoints[endpoint] ? { ...this.endpoints[endpoint] } : {};
    let urlParamsDef;

    for (const pattern of description.patterns || []) {
      if (pattern.includes('{indices}')) {
        urlParamsDef = urlParamsDef || {};
        urlParamsDef.ignore_unavailable = '__flag__';
        urlParamsDef.allow_no_indices = '__flag__';
        urlParamsDef.expand_wildcards = ['open', 'closed'];
      }
    }

    if (urlParamsDef) {
      description.url_params = { ...(description.url_params || {}) };
      for (const [key, value] of Object.entries(urlParamsDef)) {
        if (!(key in description.url_params)) {
          description.url_params[key] = value;
        }
      }
    }

    copiedDescription = { ...copiedDescription, ...description };
    if (!copiedDescription.id) {
      copiedDescription.id = endpoint;
    }
    if (!copiedDescription.patterns) {
      copiedDescription.patterns = [endpoint];
    }
    if (!copiedDescription.methods) {
      copiedDescription.methods = ['GET'];
    }

    this.endpoints[endpoint] = copiedDescription;
  }

  asJson() {
    return {
      name: this.name,
      globals: this.globalRules,
      endpoints: this.endpoints,
    };
  }
}

const lodash = {
  defaults(target, ...sources) {
    const result = target;
    for (const source of sources) {
      if (!source) continue;
      for (const [key, value] of Object.entries(source)) {
        if (result[key] === undefined) {
          result[key] = value;
        }
      }
    }
    return result;
  },
  flatten(items) {
    return items.flat();
  },
  map(collection, iteratee) {
    if (Array.isArray(collection)) {
      return collection.map(iteratee);
    }
    return Object.keys(collection).map(key => iteratee(collection[key], key));
  },
};

function loadSourceModule(filePath, deps = {}) {
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/import _ from 'lodash';/g, 'const _ = __deps.lodash;');
  source = source.replace(/const _ = require\('lodash'\);/g, 'const _ = __deps.lodash;');
  source = source.replace(
    /import\s+\{([\s\S]*?)\}\s+from\s+'([^']+)';/g,
    (_, imports, specifier) => `const {${imports}} = __deps[${JSON.stringify(specifier)}];`
  );
  source = source.replace(
    /export default function\s+([A-Za-z0-9_]+)\s*\(/g,
    'module.default = function $1('
  );
  source = source.replace(/export default function\s*\(/g, 'module.default = function(');
  source = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, 'const $1 = module.$1 =');
  source = source.replace(
    /export function\s+([A-Za-z0-9_]+)\s*\(/g,
    'module.$1 = function $1('
  );
  source = source.replace(
    /export\s+\{\s*([A-Za-z0-9_]+)\s+as\s+default\s*\}\s+from\s+'([^']+)';/g,
    (_, exportName, specifier) => `module.default = __deps[${JSON.stringify(specifier)}].${exportName};`
  );

  const module = {};
  const runner = new Function('module', 'exports', '__deps', source);
  runner(module, module, { lodash, ...deps });
  return module;
}

function loadEs6Api() {
  const api = new Api('es6');
  const coreSpec = loadSpecDir(
    path.join(KIBANA_ROOT, 'src', 'legacy', 'core_plugins', 'console', 'server', 'api_server', 'spec')
  );
  const xpackSpec = loadSpecDir(
    path.join(
      KIBANA_ROOT,
      'x-pack',
      'legacy',
      'plugins',
      'console_extensions',
      'spec'
    )
  );

  for (const [endpoint, description] of Object.entries({ ...coreSpec, ...xpackSpec })) {
    api.addEndpointDescription(endpoint, description);
  }

  const es6Root = path.join(
    KIBANA_ROOT,
    'src',
    'legacy',
    'core_plugins',
    'console',
    'server',
    'api_server',
    'es_6_0'
  );

  const templatesModule = loadSourceModule(path.join(es6Root, 'query', 'templates.js'));
  const queryDslModule = loadSourceModule(path.join(es6Root, 'query', 'dsl.js'), {
    './templates': templatesModule,
  });
  const aliasesModule = loadSourceModule(path.join(es6Root, 'aliases.js'));
  const aggregationsModule = loadSourceModule(path.join(es6Root, 'aggregations.js'));
  const documentModule = loadSourceModule(path.join(es6Root, 'document.js'));
  const filterModule = loadSourceModule(path.join(es6Root, 'filter.js'));
  const globalsModule = loadSourceModule(path.join(es6Root, 'globals.js'));
  const ingestModule = loadSourceModule(path.join(es6Root, 'ingest.js'));
  const mappingsModule = loadSourceModule(path.join(es6Root, 'mappings.js'));
  const reindexModule = loadSourceModule(path.join(es6Root, 'reindex.js'));
  const searchModule = loadSourceModule(path.join(es6Root, 'search.js'));

  aliasesModule.default(api);
  aggregationsModule.default(api);
  documentModule.default(api);
  filterModule.default(api);
  globalsModule.default(api);
  ingestModule.register(api);
  mappingsModule.default(api);
  queryDslModule.queryDsl(api);
  reindexModule.default(api);
  searchModule.default(api);

  const xpackIngestModule = loadSourceModule(
    path.join(
      KIBANA_ROOT,
      'x-pack',
      'legacy',
      'plugins',
      'console_extensions',
      'spec',
      'ingest',
      'index.js'
    )
  );
  for (const processor of xpackIngestModule.processors || []) {
    ingestModule.addProcessorDefinition(processor);
  }

  return api.asJson();
}

function stripTypePatterns(endpoint) {
  const next = deepClone(endpoint);
  next.patterns = (next.patterns || []).filter(pattern => !pattern.includes('{type}'));
  if (next.url_params && Object.prototype.hasOwnProperty.call(next.url_params, 'type')) {
    delete next.url_params.type;
  }
  return next;
}

function loadEs7Api(es6Api) {
  const es7 = deepClone(es6Api);
  es7.name = 'es7';
  es7.endpoints = Object.fromEntries(
    Object.entries(es7.endpoints)
      .map(([endpoint, description]) => [endpoint, stripTypePatterns(description)])
      .filter(([, description]) => (description.patterns || []).length > 0)
  );
  return es7;
}

function patchEndpoint(api, endpointName, patch) {
  if (!api.endpoints[endpointName]) {
    api.endpoints[endpointName] = { id: endpointName, patterns: [endpointName], methods: ['GET'] };
  }
  api.endpoints[endpointName] = mergeDeep(api.endpoints[endpointName], patch);
}

function createEs8SearchAugmentation() {
  return {
    data_autocomplete_rules: {
      fields: {
        '__template': ['FIELD'],
        '__any_of': [
          '{field}',
          {
            '__template': {
              field: 'FIELD',
              format: 'strict_date_optional_time_nanos',
            },
            field: '{field}',
            format: '',
          },
        ],
      },
      knn: {
        '__template': {
          field: 'VECTOR_FIELD',
          query_vector: [0.1, 0.2, 0.3],
          k: 10,
          num_candidates: 100,
        },
        field: '{field}',
        query_vector: [''],
        k: 10,
        num_candidates: 100,
        boost: 1,
        similarity: 0.75,
        filter: {
          '__one_of': [
            { '__scope_link': 'GLOBAL.filter' },
            [{ '__scope_link': 'GLOBAL.filter' }],
          ],
        },
      },
      min_score: 0.5,
      pit: {
        '__template': {
          id: 'PIT_ID',
          keep_alive: '1m',
        },
        id: '',
        keep_alive: '1m',
      },
      retriever: {
        standard: {
          '__template': {
            query: {
              match_all: {},
            },
          },
          query: {},
          filter: {
            '__scope_link': 'GLOBAL.filter',
          },
        },
        knn: {
          '__template': {
            field: 'VECTOR_FIELD',
            query_vector: [0.1, 0.2, 0.3],
            k: 10,
            num_candidates: 100,
          },
          field: '{field}',
          query_vector: [''],
          k: 10,
          num_candidates: 100,
          filter: {
            '__one_of': [
              { '__scope_link': 'GLOBAL.filter' },
              [{ '__scope_link': 'GLOBAL.filter' }],
            ],
          },
        },
        rrf: {
          '__template': {
            retrievers: [
              {
                standard: {
                  query: {
                    match: {
                      FIELD: 'TEXT',
                    },
                  },
                },
              },
              {
                knn: {
                  field: 'VECTOR_FIELD',
                  query_vector: [0.1, 0.2, 0.3],
                  k: 10,
                  num_candidates: 100,
                },
              },
            ],
            rank_window_size: 50,
            rank_constant: 20,
          },
          retrievers: [
            {
              '__one_of': [
                {
                  standard: {
                    query: {},
                  },
                },
                {
                  knn: {
                    field: '{field}',
                    query_vector: [''],
                    k: 10,
                    num_candidates: 100,
                  },
                },
              ],
            },
          ],
          rank_window_size: 50,
          rank_constant: 20,
        },
      },
      runtime_mappings: {
        '__template': {
          FIELD: {
            type: 'keyword',
            script: {
              source: "emit('value')",
            },
          },
        },
        '{field}': {
          type: {
            '__one_of': ['boolean', 'composite', 'date', 'double', 'geo_point', 'ip', 'keyword', 'long', 'lookup'],
          },
          script: {
            '__template': {
              source: "emit('value')",
            },
            source: '',
          },
          format: '',
        },
      },
      search_after: {
        '__template': [0],
        '__any_of': ['', 0, true],
      },
      seq_no_primary_term: true,
      terminate_after: 1000,
      track_scores: true,
      ext: {
        '__template': {},
      },
    },
    url_params: {
      include_named_queries_score: '__flag__',
      source: '',
      source_content_type: ['application/json'],
    },
  };
}

function createEs8SearchTemplateAugmentation() {
  return {
    data_autocomplete_rules: {
      params: {
        '__template': {
          PARAM_NAME: 'VALUE',
        },
        PARAM_NAME: '',
      },
    },
  };
}

function createEs8RenderSearchTemplateAugmentation() {
  return {
    data_autocomplete_rules: {
      '__one_of': [
        {
          id: '',
          params: {
            '__template': {
              PARAM_NAME: 'VALUE',
            },
            PARAM_NAME: '',
          },
        },
        {
          source: '',
          params: {
            '__template': {
              PARAM_NAME: 'VALUE',
            },
            PARAM_NAME: '',
          },
        },
      ],
    },
  };
}

function createEs8AsyncSearchEndpoint() {
  return {
    documentation: 'https://www.elastic.co/guide/en/elasticsearch/reference/8.19/async-search.html',
    methods: ['GET', 'POST'],
    patterns: ['_async_search', '{indices}/_async_search'],
    url_params: {
      wait_for_completion_timeout: '',
      keep_alive: '',
      keep_on_completion: '__flag__',
      batched_reduce_size: '',
      ccs_minimize_roundtrips: '__flag__',
      allow_partial_search_results: '__flag__',
      ignore_unavailable: '__flag__',
      allow_no_indices: '__flag__',
      expand_wildcards: ['open', 'closed', 'hidden', 'none', 'all'],
      routing: '',
      preference: '',
      request_cache: '__flag__',
      search_type: ['query_then_fetch', 'dfs_query_then_fetch'],
      typed_keys: '__flag__',
    },
    data_autocomplete_rules: createEs8SearchAugmentation().data_autocomplete_rules,
  };
}

function loadEs8Api(es7Api) {
  const es8 = deepClone(es7Api);
  es8.name = 'es8';

  patchEndpoint(es8, 'search', createEs8SearchAugmentation());
  patchEndpoint(es8, 'search_template', createEs8SearchTemplateAugmentation());
  patchEndpoint(es8, 'render_search_template', createEs8RenderSearchTemplateAugmentation());
  patchEndpoint(es8, 'async_search.submit', createEs8AsyncSearchEndpoint());
  patchEndpoint(es8, 'knn_search', {
    documentation: 'https://www.elastic.co/guide/en/elasticsearch/reference/8.19/knn-search-api.html',
    methods: ['GET', 'POST'],
    patterns: ['_knn_search', '{indices}/_knn_search'],
    url_params: {
      routing: '',
      ignore_unavailable: '__flag__',
      allow_no_indices: '__flag__',
      expand_wildcards: ['open', 'closed', 'hidden', 'none', 'all'],
    },
    data_autocomplete_rules: {
      knn: {
        '__template': {
          field: 'VECTOR_FIELD',
          query_vector: [0.1, 0.2, 0.3],
          k: 10,
          num_candidates: 100,
        },
        field: '{field}',
        query_vector: [''],
        k: 10,
        num_candidates: 100,
        filter: {
          '__one_of': [
            { '__scope_link': 'GLOBAL.filter' },
            [{ '__scope_link': 'GLOBAL.filter' }],
          ],
        },
      },
      filter: {
        '__scope_link': 'GLOBAL.filter',
      },
      _source: {
        '__one_of': [
          '{field}',
          ['{field}'],
        ],
      },
      fields: {
        '__template': ['FIELD'],
        '__any_of': ['{field}'],
      },
    },
  });

  return es8;
}

const es6 = loadEs6Api();
const es7 = loadEs7Api(es6);
const es8 = loadEs8Api(es7);
const outputPath = path.join(FRONTEND_SRC, 'kibanaConsoleData.generated.js');
const fileContents = `export const kibanaConsoleData = ${JSON.stringify(
  { es6, es7, es8 },
  null,
  2
)};\n`;

fs.writeFileSync(outputPath, fileContents);
console.log(`Generated ${path.relative(ROOT, outputPath)}`);
