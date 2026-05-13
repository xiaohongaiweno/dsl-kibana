<script>
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { createKibanaCompletionSource } from './kibanaConsoleAutocomplete.js';
import { parseConsoleRequests, parseRequestLine } from './kibanaConsoleParser.js';
import { createRequestExecutionManager } from './requestExecution.js';

const ES_HOST = 'http://localhost:9200';
const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_QUERY = `GET /_search
{
  "query": {
    "match_all": {}
  }
}`;

function createVersionRef(vm) {
  return {
    get value() {
      return vm.activeVersion;
    },
  };
}

function createEditor(parent, completionSource, readonly) {
  const extensions = [
    basicSetup,
    oneDark,
    autocompletion({ override: [completionSource], activateOnTypingDelay: 0 }),
    keymap.of([].concat(defaultKeymap, completionKeymap, [indentWithTab])),
    EditorView.lineWrapping,
    EditorView.theme({
      '&': { height: '100%', fontSize: '14px', backgroundColor: '#11161d', color: '#d6dde8' },
      '.cm-scroller': { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
      '.cm-content': { caretColor: '#93c5fd', padding: '18px 0' },
      '.cm-gutters': { backgroundColor: '#11161d', border: 'none', color: '#5f7085' },
      '.cm-activeLine': { backgroundColor: 'rgba(110, 168, 255, 0.08)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent' },
      '.cm-tooltip-autocomplete': {
        border: '1px solid rgba(255,255,255,0.08)',
        backgroundColor: '#0d131a',
        color: '#d6dde8',
      },
    }),
  ];

  if (readonly) {
    extensions.push(EditorState.readOnly.of(true));
  } else {
    extensions.push(EditorView.contentAttributes.of({ spellcheck: 'false' }));
  }

  return new EditorView({
    state: EditorState.create({
      doc: readonly ? '' : DEFAULT_QUERY,
      extensions,
    }),
    parent,
  });
}

function mergeAbortSignals(signals) {
  const controller = new AbortController();
  const activeSignals = signals.filter(Boolean);

  function onAbort(event) {
    if (!controller.signal.aborted) {
      controller.abort(event && event.target ? event.target.reason || event.target : new DOMException('Aborted', 'AbortError'));
    }
  }

  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason || new DOMException('Aborted', 'AbortError'));
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return controller.signal;
}

export default {
  name: 'App',

  data() {
    const requestExecution = createRequestExecutionManager();

    return {
      requestExecution,
      editorView: null,
      resultView: null,
      completionSource: null,
      isLoading: false,
      error: '',
      responseTime: 0,
      statusCode: null,
      activeVersion: 'es7',
    };
  },

  computed: {
    versionLabel() {
      if (this.activeVersion === 'es6') return 'ES 6 rules';
      if (this.activeVersion === 'es8') return 'ES 8 rules';
      return 'ES 7 rules';
    },
  },

  mounted() {
    this.completionSource = createKibanaCompletionSource(createVersionRef(this));

    if (this.$refs.editorRef) {
      this.editorView = createEditor(this.$refs.editorRef, this.completionSource, false);
    }
    if (this.$refs.resultRef) {
      this.resultView = createEditor(this.$refs.resultRef, this.completionSource, true);
    }
  },

  beforeDestroy() {
    this.requestExecution.cancelActive();
    if (this.editorView) {
      this.editorView.destroy();
    }
    if (this.resultView) {
      this.resultView.destroy();
    }
  },

  methods: {
    updateResult(text) {
      if (!this.resultView) return;
      this.resultView.dispatch({
        changes: { from: 0, to: this.resultView.state.doc.length, insert: text },
      });
    },

    getCurrentRequestBlock() {
      if (!this.editorView) return '';
      const docText = this.editorView.state.doc.toString();
      const parsed = parseConsoleRequests(docText);
      const cursor = this.editorView.state.selection.main.head;
      const request = parsed.requests.find(item => cursor >= item.start && cursor <= item.end) || parsed.requests[0];

      if (!request) {
        return {
          text: docText.trim(),
          start: 0,
          end: docText.length,
        };
      }

      return {
        text: docText.slice(request.start, request.end).trim(),
        start: request.start,
        end: request.end,
      };
    },

    formatRequestBlock(requestText) {
      const lines = requestText.split(/\r?\n/);
      const requestLine = (lines[0] || '').trim();
      const bodyText = lines.slice(1).join('\n').trim();

      if (!bodyText) {
        return `${requestLine}\n`;
      }

      try {
        return `${requestLine}\n${JSON.stringify(JSON.parse(bodyText), null, 2)}`;
      } catch (error) {
        return requestText;
      }
    },

    normalizeCurrentRequestBlock() {
      if (!this.editorView) return '';
      const requestBlock = this.getCurrentRequestBlock();
      const formatted = this.formatRequestBlock(requestBlock.text);

      if (formatted !== requestBlock.text) {
        this.editorView.dispatch({
          changes: {
            from: requestBlock.start,
            to: requestBlock.end,
            insert: formatted,
          },
          selection: { anchor: requestBlock.start + formatted.length },
          scrollIntoView: true,
        });
      }

      return formatted.trim();
    },

    formatCurrentRequest() {
      const formatted = this.normalizeCurrentRequestBlock();
      if (formatted) {
        this.error = '';
      }
    },

    async executeQuery() {
      if (this.isLoading) {
        return;
      }

      const requestText = this.normalizeCurrentRequestBlock();
      if (!requestText) {
        this.error = 'Request cannot be empty';
        return;
      }

      const lines = requestText.split(/\r?\n/);
      const requestMeta = parseRequestLine(lines[0] || '');
      if (!requestMeta) {
        this.error = 'Request must start with METHOD + URL, for example: GET /_search';
        return;
      }

      const bodyText = lines.slice(1).join('\n').trim();
      const url = `${ES_HOST}${requestMeta.path.startsWith('/') ? requestMeta.path : `/${requestMeta.path}`}${
        requestMeta.queryString ? `?${requestMeta.queryString}` : ''
      }`;

      this.isLoading = true;
      this.error = '';
      this.statusCode = null;
      this.responseTime = 0;
      const startTime = performance.now();
      const execution = this.requestExecution.startExecution();
      const timeoutController = new AbortController();
      const timeoutId = window.setTimeout(() => {
        timeoutController.abort(new DOMException('Request timed out', 'TimeoutError'));
      }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: requestMeta.method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: bodyText || undefined,
          signal: mergeAbortSignals([execution.controller.signal, timeoutController.signal]),
        });

        if (!execution.isLatest()) {
          return;
        }

        this.responseTime = Math.round(performance.now() - startTime);
        this.statusCode = response.status;

        const text = await response.text();
        if (!execution.isLatest()) {
          return;
        }

        try {
          this.updateResult(JSON.stringify(JSON.parse(text), null, 2));
        } catch (error) {
          this.updateResult(text);
        }

        if (!response.ok) {
          this.error = `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (error) {
        if (!execution.isLatest()) {
          return;
        }

        if (error && (error.name === 'TimeoutError' || error.message === 'Request timed out')) {
          this.error = 'Request timed out';
        } else if (error && error.name === 'AbortError') {
          this.error = 'Request cancelled';
        } else {
          this.error = (error && error.message) || 'Request failed';
        }
        this.updateResult('{}');
      } finally {
        window.clearTimeout(timeoutId);
        execution.release();
        if (execution.isLatest()) {
          this.isLoading = false;
        }
      }
    },

    handleKeydown(event) {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        this.executeQuery();
      }
    },

    setVersion(version) {
      this.activeVersion = version;
    },
  },
};
</script>

<template>
  <div class="app" @keydown="handleKeydown">
    <header class="header">
      <div class="brand">
        <span class="brand-mark">Console</span>
        <div>
          <h1>Kibana DSL Console Migration</h1>
          <p>Single-editor request blocks with Kibana-style autocomplete</p>
        </div>
      </div>
      <div class="version-switcher">
        <button
          class="version-chip"
          :class="{ active: activeVersion === 'es6' }"
          @click="setVersion('es6')"
        >
          ES6
        </button>
        <button
          class="version-chip"
          :class="{ active: activeVersion === 'es7' }"
          @click="setVersion('es7')"
        >
          ES7
        </button>
        <button
          class="version-chip"
          :class="{ active: activeVersion === 'es8' }"
          @click="setVersion('es8')"
        >
          ES8
        </button>
      </div>
    </header>

    <main class="main">
      <div class="control-bar">
        <div class="control-actions">
          <button class="format-btn" @click="formatCurrentRequest" :disabled="isLoading">
            Format Current Request
          </button>
          <button class="execute-btn" @click="executeQuery" :disabled="isLoading">
            {{ isLoading ? 'Executing...' : 'Execute Current Request' }}
          </button>
        </div>
        <div class="control-note">
          Write requests in Kibana style: `GET /index/_search` followed by JSON body.
        </div>
      </div>

      <div class="workspace">
        <section class="editor-panel">
          <div class="panel-header">
            <div>
              <span class="panel-title">Request</span>
              <span class="panel-subtitle">{{ versionLabel }}</span>
            </div>
            <div class="panel-hint">
              <span>`Ctrl+Enter` executes the current request block</span>
            </div>
          </div>
          <div ref="editorRef" class="editor-container"></div>
        </section>

        <section class="result-panel">
          <div class="panel-header">
            <div class="result-heading">
              <span class="panel-title">Response</span>
              <div v-if="statusCode !== null" class="result-meta">
                <span :class="['status', statusCode < 400 ? 'success' : 'error']">
                  {{ statusCode }}
                </span>
                <span class="time">{{ responseTime }}ms</span>
              </div>
            </div>
          </div>
          <div ref="resultRef" class="editor-container"></div>
          <div v-if="error" class="error-message">{{ error }}</div>
        </section>
      </div>
    </main>
  </div>
</template>

<style>
:root {
  --bg: #091018;
  --panel: #11161d;
  --panel-strong: #161d26;
  --panel-soft: #1b2430;
  --line: rgba(255, 255, 255, 0.08);
  --text: #d6dde8;
  --muted: #7f90a4;
  --accent: #78a6ff;
  --accent-strong: #9ec0ff;
  --accent-warm: #ffd18b;
  --success: #7dd3a7;
  --error: #ff9b90;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  margin: 0;
  min-height: 100%;
  background:
    radial-gradient(circle at top left, rgba(120, 166, 255, 0.18), transparent 28%),
    radial-gradient(circle at top right, rgba(255, 209, 139, 0.1), transparent 24%),
    linear-gradient(180deg, #091018 0%, #0c1219 100%);
  color: var(--text);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--line);
  background: rgba(9, 16, 24, 0.84);
  backdrop-filter: blur(18px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 16px;
}

.brand-mark {
  padding: 8px 12px;
  border: 1px solid rgba(120, 166, 255, 0.36);
  border-radius: 999px;
  color: var(--accent-strong);
  background: rgba(120, 166, 255, 0.08);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 12px;
}

.brand h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.brand p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.version-switcher {
  display: flex;
  gap: 8px;
}

.version-chip {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font: inherit;
  padding: 8px 12px;
  border-radius: 999px;
  cursor: pointer;
}

.version-chip.active {
  color: var(--accent-strong);
  border-color: rgba(120, 166, 255, 0.4);
  background: rgba(120, 166, 255, 0.12);
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
}

.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}

.editor-panel,
.result-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 18px;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(20, 27, 35, 0.94), rgba(14, 20, 28, 0.96));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
}

.panel-title {
  font-size: 13px;
  color: var(--accent-warm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.panel-subtitle,
.panel-hint,
.control-note,
.time {
  color: var(--muted);
  font-size: 12px;
}

.panel-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.editor-container {
  flex: 1;
  min-height: 0;
}

.editor-container .cm-editor {
  height: 100%;
}

.control-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 4px;
}

.control-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.format-btn,
.execute-btn {
  border: 1px solid transparent;
  border-radius: 12px;
  font: inherit;
  cursor: pointer;
}

.format-btn {
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--line);
  color: var(--text);
}

.execute-btn {
  padding: 12px 18px;
  background: linear-gradient(135deg, #78a6ff, #8fd5ff);
  color: #091018;
  font-weight: 700;
}

.format-btn:disabled,
.execute-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.result-heading,
.result-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status {
  font-weight: 700;
}

.status.success {
  color: var(--success);
}

.status.error {
  color: var(--error);
}

.error-message {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 155, 144, 0.2);
  background: rgba(255, 155, 144, 0.08);
  color: var(--error);
  font-size: 13px;
}

@media (max-width: 900px) {
  .header,
  .control-bar,
  .panel-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .workspace {
    grid-template-columns: 1fr;
  }
}
</style>
