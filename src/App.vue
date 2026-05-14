<script>
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { GutterMarker, gutter, keymap } from '@codemirror/view';
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

/**
 * 功能：
 * 为补全器提供一个可延迟读取的版本引用对象。
 *
 * 实现：
 * 自动补全源在组件初始化时只创建一次，因此不能在每次版本切换时重建。
 * 这里通过定义带 getter 的轻量包装对象，让补全器在真正运行时再去读取
 * 当前实例上的 `activeVersion`，从而实现“补全源单例，版本值动态变化”。
 *
 * 输入：
 * - `vm`：当前 `App` 组件实例。
 *
 * 输出：
 * - 返回一个带只读属性 `value` 的对象，读取时会返回当前激活的 ES 版本。
 */
function createVersionRef(vm) {
  return {
    /**
     * 功能：
     * 读取当前激活的 Elasticsearch 规则版本。
     *
     * 实现：
     * 通过访问组件实例上的 `activeVersion` 字段，把运行时状态暴露给补全器。
     *
     * 输入：
     * - 无。
     *
     * 输出：
     * - 返回字符串，例如 `es6`、`es7`、`es8`。
     */
    get value() {
      return vm.activeVersion;
    },
  };
}

class RequestRunMarker extends GutterMarker {
  /**
   * 功能：
   * 构造一个请求执行按钮对应的 gutter 标记对象。
   *
   * 实现：
   * 继承 CodeMirror 的 `GutterMarker`，并记录对应请求行的起始偏移，
   * 以便点击按钮时能准确反查要执行的请求块。
   *
   * 输入：
   * - `requestLineStart`：请求行在文档中的起始偏移；默认为 `null`。
   *
   * 输出：
   * - 返回 `RequestRunMarker` 实例。
   */
  constructor(requestLineStart = null) {
    super();
    this.requestLineStart = requestLineStart;
  }

  /**
   * 功能：
   * 把 gutter 标记渲染成真正可点击的按钮 DOM。
   *
   * 实现：
   * 创建一个按钮元素，挂上样式类、可访问性属性和三角图标，
   * 同时把请求行偏移写入 `data-request-line-start`，供点击事件读取。
   *
   * 输入：
   * - 无。
   *
   * 输出：
   * - 返回一个原生 `button` DOM 节点。
   */
  toDOM() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-request-run-button';
    button.title = 'Execute this request';
    button.setAttribute('aria-label', 'Execute this request');
    button.textContent = '▶';
    if (this.requestLineStart !== null) {
      button.dataset.requestLineStart = String(this.requestLineStart);
    }
    return button;
  }
}

const requestRunSpacerMarker = new RequestRunMarker();

/**
 * 功能：
 * 根据当前文档内容为每个请求块生成对应的 gutter 执行标记。
 *
 * 实现：
 * 先把整个文档交给 `parseConsoleRequests()` 解析，再遍历每个请求块，
 * 在请求行起点位置插入一个 `RequestRunMarker`。最终通过 `RangeSetBuilder`
 * 生成 CodeMirror 可消费的 marker 集合。
 *
 * 输入：
 * - `doc`：CodeMirror 文档对象。
 *
 * 输出：
 * - 返回一个 marker range set，供 gutter 状态字段使用。
 */
function buildRequestRunMarkers(doc) {
  const builder = new RangeSetBuilder();
  const parsed = parseConsoleRequests(doc.toString());

  for (const request of parsed.requests) {
    builder.add(request.requestLineStart, request.requestLineStart, new RequestRunMarker(request.requestLineStart));
  }

  return builder.finish();
}

const requestRunMarkerField = StateField.define({
  /**
   * 功能：
   * 在状态字段初始化时构建整份文档的请求执行标记集合。
   *
   * 实现：
   * 直接调用 `buildRequestRunMarkers()` 对当前文档做一次全量解析。
   *
   * 输入：
   * - `state`：CodeMirror 当前状态对象。
   *
   * 输出：
   * - 返回初始 marker 集合。
   */
  create(state) {
    return buildRequestRunMarkers(state.doc);
  },
  /**
   * 功能：
   * 在文档变化后更新请求执行标记集合。
   *
   * 实现：
   * 如果事务没有改动文档，则直接复用旧 marker；
   * 只有当文档内容变化时，才重新解析全文并生成新的 marker 集合。
   *
   * 输入：
   * - `markers`：旧的 marker 集合。
   * - `transaction`：CodeMirror 事务对象。
   *
   * 输出：
   * - 返回更新后的 marker 集合。
   */
  update(markers, transaction) {
    if (!transaction.docChanged) {
      return markers;
    }
    return buildRequestRunMarkers(transaction.state.doc);
  },
});

/**
 * 功能：
 * 创建左侧编辑器使用的“按请求块运行” gutter 扩展。
 *
 * 实现：
 * 组合状态字段和 gutter 定义：
 * - `markers()` 从状态字段读取当前 marker 集合；
 * - `initialSpacer()` 保证 gutter 宽度稳定；
 * - `click()` 从点击到的按钮上读取请求行偏移，并回调给外层执行逻辑。
 *
 * 输入：
 * - `onRunRequest`：点击某个请求块运行按钮时要调用的回调函数。
 *
 * 输出：
 * - 返回 CodeMirror 扩展数组，可直接加入编辑器配置。
 */
function createRequestRunGutter(onRunRequest) {
  return [
    requestRunMarkerField,
    gutter({
      class: 'cm-request-run-gutter',
      /**
       * 功能：
       * 向 gutter 提供当前所有请求块的标记集合。
       *
       * 实现：
       * 从 `requestRunMarkerField` 状态字段中取出已经计算好的 marker 集合。
       *
       * 输入：
       * - `view`：CodeMirror 编辑器视图。
       *
       * 输出：
       * - 返回 marker 集合。
       */
      markers(view) {
        return view.state.field(requestRunMarkerField);
      },
      /**
       * 功能：
       * 提供一个占位 spacer，用于让 gutter 在空内容时也保持预期宽度。
       *
       * 实现：
       * 直接返回预先创建好的空标记实例。
       *
       * 输入：
       * - 无。
       *
       * 输出：
       * - 返回一个 `RequestRunMarker` 实例。
       */
      initialSpacer() {
        return requestRunSpacerMarker;
      },
      domEventHandlers: {
        /**
         * 功能：
         * 响应 gutter 区域中的点击事件，并把点击定位到具体请求块执行。
         *
         * 实现：
         * 先确认事件目标是运行按钮，再读取按钮数据属性中的请求行起始偏移，
         * 最后调用外层传入的 `onRunRequest()`。如果点击目标无效，则返回 `false`
         * 交由 CodeMirror 继续处理。
         *
         * 输入：
         * - `view`：当前编辑器视图。
         * - `line`：当前 gutter 所在行对象，本实现未直接使用。
         * - `event`：原生点击事件。
         *
         * 输出：
         * - 返回布尔值；`true` 表示事件已被消费，`false` 表示未处理。
         */
        click(view, line, event) {
          const target = event.target;
          if (!(target instanceof HTMLElement)) {
            return false;
          }

          const button = target.closest('.cm-request-run-button');
          if (!button) {
            return false;
          }

          event.preventDefault();
          event.stopPropagation();

          const requestLineStart = Number(button.dataset.requestLineStart);
          if (Number.isNaN(requestLineStart)) {
            return false;
          }

          onRunRequest(requestLineStart);
          return true;
        },
      },
    }),
  ];
}

/**
 * 功能：
 * 创建请求编辑器或结果编辑器实例。
 *
 * 实现：
 * 两个面板都复用 CodeMirror：
 * - 左侧请求编辑器启用自动补全、可编辑能力和 gutter 运行按钮；
 * - 右侧结果面板沿用同一主题，但设置为只读。
 * 主题、键位、自动补全和换行行为统一在此集中配置。
 *
 * 输入：
 * - `parent`：编辑器挂载的父级 DOM 节点。
 * - `completionSource`：自动补全数据源函数。
 * - `readonly`：是否创建只读编辑器。
 * - `onRunRequest`：非只读模式下点击 gutter 运行按钮时的回调。
 *
 * 输出：
 * - 返回一个 `EditorView` 实例。
 */
function createEditor(parent, completionSource, readonly, onRunRequest) {
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
      '.cm-request-run-gutter': { width: '38px' },
      '.cm-request-run-button': {
        width: '24px',
        height: '24px',
        padding: '0',
        border: '1px solid rgba(120, 166, 255, 0.2)',
        borderRadius: '999px',
        background: 'rgba(120, 166, 255, 0.08)',
        color: '#9ec0ff',
        cursor: 'pointer',
        fontSize: '11px',
        lineHeight: '1',
        transition: 'transform 120ms ease, border-color 120ms ease, background-color 120ms ease',
      },
      '.cm-request-run-button:hover': {
        transform: 'translateX(1px)',
        borderColor: 'rgba(120, 166, 255, 0.44)',
        background: 'rgba(120, 166, 255, 0.16)',
      },
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
    extensions.push(createRequestRunGutter(onRunRequest));
  }

  return new EditorView({
    state: EditorState.create({
      doc: readonly ? '' : DEFAULT_QUERY,
      extensions,
    }),
    parent,
  });
}

/**
 * 功能：
 * 把多个 `AbortSignal` 合并成一个统一的中断信号。
 *
 * 实现：
 * 新建一个内部 `AbortController`，然后监听传入的每个信号：
 * - 如果某个信号已经中断，则立刻同步中断合并信号；
 * - 如果后续某个信号触发中断，则把原因透传给合并控制器。
 * 这样一次请求就能同时受“被新请求替代”和“客户端超时”两类机制控制。
 *
 * 输入：
 * - `signals`：可能包含 `AbortSignal` 或空值的数组。
 *
 * 输出：
 * - 返回一个新的 `AbortSignal`，可直接传给 `fetch()`。
 */
function mergeAbortSignals(signals) {
  const controller = new AbortController();
  const activeSignals = signals.filter(Boolean);

  /**
   * 功能：
   * 把任意一个上游 signal 的中断原因转发到合并控制器。
   *
   * 实现：
   * 当某个监听到的 signal 触发 `abort` 事件时，
   * 如果合并信号尚未中断，就读取事件目标中的 `reason` 并中断内部控制器。
   *
   * 输入：
   * - `event`：中断事件对象。
   *
   * 输出：
   * - 无；副作用是可能中断合并控制器。
   */
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
    /**
     * 功能：
     * 定义组件的全部响应式状态。
     *
     * 实现：
     * 初始化请求执行管理器、左右编辑器实例引用、补全源、加载状态、错误信息、
     * 响应耗时、状态码以及当前 ES 版本。
     *
     * 输入：
     * - 无。
     *
     * 输出：
     * - 返回一个对象，作为 Vue 组件的响应式数据源。
     */
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
    /**
     * 功能：
     * 生成当前版本在界面中显示的可读标签。
     *
     * 实现：
     * 根据 `activeVersion` 返回对应说明文本，供面板标题区展示。
     *
     * 输入：
     * - 无；依赖组件当前状态 `activeVersion`。
     *
     * 输出：
     * - 返回字符串，例如 `ES 6 rules`、`ES 7 rules`、`ES 8 rules`。
     */
    versionLabel() {
      if (this.activeVersion === 'es6') return 'ES 6 rules';
      if (this.activeVersion === 'es8') return 'ES 8 rules';
      return 'ES 7 rules';
    },
  },

  mounted() {
    /**
     * 功能：
     * 在组件挂载后初始化补全源和两个 CodeMirror 编辑器。
     *
     * 实现：
     * 先用 `createVersionRef(this)` 创建动态版本引用，再创建：
     * - 左侧可编辑请求区；
     * - 右侧只读结果区。
     * 左侧编辑器会把 gutter 的点击事件转发到 `executeQuery()`。
     *
     * 输入：
     * - 无。
     *
     * 输出：
     * - 无；副作用是创建并保存编辑器实例。
     */
    this.completionSource = createKibanaCompletionSource(createVersionRef(this));

    if (this.$refs.editorRef) {
      this.editorView = createEditor(this.$refs.editorRef, this.completionSource, false, lineStart => {
        this.executeQuery({ requestLineStart: lineStart });
      });
    }
    if (this.$refs.resultRef) {
      this.resultView = createEditor(this.$refs.resultRef, this.completionSource, true);
    }
  },

  beforeDestroy() {
    /**
     * 功能：
     * 在组件销毁前清理请求和编辑器资源。
     *
     * 实现：
     * 先取消当前活动请求，再分别销毁左右两个 CodeMirror 实例，
     * 避免异步请求和编辑器事件在组件卸载后继续存活。
     *
     * 输入：
     * - 无。
     *
     * 输出：
     * - 无；副作用是释放资源。
     */
    this.requestExecution.cancelActive();
    if (this.editorView) {
      this.editorView.destroy();
    }
    if (this.resultView) {
      this.resultView.destroy();
    }
  },

  methods: {
    /**
     * 功能：
     * 用新的文本覆盖右侧响应结果面板。
     *
     * 实现：
     * 如果结果编辑器已创建，就通过一次 dispatch 把全文替换成新内容。
     *
     * 输入：
     * - `text`：待显示的响应文本。
     *
     * 输出：
     * - 无；副作用是更新只读结果编辑器中的内容。
     */
    updateResult(text) {
      if (!this.resultView) return;
      this.resultView.dispatch({
        changes: { from: 0, to: this.resultView.state.doc.length, insert: text },
      });
    },

    /**
     * 功能：
     * 根据请求行偏移或光标偏移，找出目标请求块并返回其文本和范围。
     *
     * 实现：
     * 先解析全文请求块：
     * - 若传入 `requestLineStart`，则优先按请求行起点精确匹配；
     * - 否则若传入 `offset`，则按光标所在范围匹配；
     * - 若都未命中，则回退到第一块请求。
     * 如果全文没有任何可识别请求块，则退回整个文档文本。
     *
     * 输入：
     * - `target`：可选目标对象，支持：
     *   - `requestLineStart`：请求行起始偏移；
     *   - `offset`：任意文档偏移。
     *
     * 输出：
     * - 返回对象：
     *   - `text`：请求块文本；
     *   - `start`：请求块起始偏移；
     *   - `end`：请求块结束偏移。
     */
    getRequestBlock(target = {}) {
      if (!this.editorView) return '';
      const docText = this.editorView.state.doc.toString();
      const parsed = parseConsoleRequests(docText);
      const { requestLineStart, offset } = target;

      let request = null;
      if (typeof requestLineStart === 'number') {
        request = parsed.requests.find(item => item.requestLineStart === requestLineStart) || null;
      }

      if (!request && typeof offset === 'number') {
        request = parsed.requests.find(item => offset >= item.start && offset <= item.end) || null;
      }

      if (!request) {
        request = parsed.requests[0] || null;
      }

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

    getCurrentRequestBlock() {
      /**
       * 功能：
       * 取得当前光标所在的请求块。
       *
       * 实现：
       * 从编辑器选区读取当前光标偏移，再复用 `getRequestBlock()` 完成解析。
       * 这与 Kibana Console 的交互模型一致，即执行和格式化都作用于“当前块”。
       *
       * 输入：
       * - 无。
       *
       * 输出：
       * - 返回当前请求块对象；若编辑器未初始化则返回空字符串。
       */
      if (!this.editorView) return '';
      return this.getRequestBlock({ offset: this.editorView.state.selection.main.head });
    },

    /**
     * 功能：
     * 格式化单个请求块文本，重点整理其 JSON 请求体。
     *
     * 实现：
     * 拆分出请求首行和 body：
     * - 如果没有 body，仅保留规范化后的请求行；
     * - 如果 body 可被 JSON.parse 成功解析，则按 2 空格缩进重新序列化；
     * - 如果 body 不是合法 JSON，则保持原样返回，避免破坏用户输入。
     *
     * 输入：
     * - `requestText`：单个请求块文本。
     *
     * 输出：
     * - 返回格式化后的请求块字符串。
     */
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

    /**
     * 功能：
     * 把指定请求块格式化后写回编辑器，同时尽量保持选区位置合理。
     *
     * 实现：
     * 先调用 `formatRequestBlock()` 得到新文本；
     * 如果文本发生变化，则只替换该请求块对应范围，不影响周围其他请求块。
     * 可选的 `selectionAnchor` 用于控制格式化后光标锚点位置。
     *
     * 输入：
     * - `requestBlock`：待格式化的请求块对象。
     * - `selectionAnchor`：可选，格式化后要设置的光标位置。
     *
     * 输出：
     * - 返回规范化后的请求块对象，包含最新的 `text`、`start`、`end`。
     */
    normalizeRequestBlock(requestBlock, selectionAnchor = null) {
      if (!this.editorView || !requestBlock) return '';
      const formatted = this.formatRequestBlock(requestBlock.text);

      if (formatted !== requestBlock.text) {
        this.editorView.dispatch({
          changes: {
            from: requestBlock.start,
            to: requestBlock.end,
            insert: formatted,
          },
          selection: { anchor: selectionAnchor === null ? requestBlock.start + formatted.length : selectionAnchor },
          scrollIntoView: true,
        });
      }

      return {
        text: formatted.trim(),
        start: requestBlock.start,
        end: requestBlock.start + formatted.length,
      };
    },

    /**
     * 功能：
     * 格式化当前光标所在请求块，并返回格式化后的文本。
     *
     * 实现：
     * 先定位当前请求块，再复用 `normalizeRequestBlock()` 执行实际写回。
     *
     * 输入：
     * - 无。
     *
     * 输出：
     * - 返回格式化后的请求块文本；若无结果则返回空字符串。
     */
    normalizeCurrentRequestBlock() {
      if (!this.editorView) return '';
      const requestBlock = this.getCurrentRequestBlock();
      const normalized = this.normalizeRequestBlock(requestBlock);
      return normalized ? normalized.text : '';
    },

    /**
     * 功能：
     * 响应工具栏上的“格式化当前请求”操作。
     *
     * 实现：
     * 调用 `normalizeCurrentRequestBlock()`，如果格式化成功则顺带清空旧错误提示。
     *
     * 输入：
     * - 无。
     *
     * 输出：
     * - 无；副作用是更新编辑器内容和错误状态。
     */
    formatCurrentRequest() {
      const formatted = this.normalizeCurrentRequestBlock();
      if (formatted) {
        this.error = '';
      }
    },

    /**
     * 功能：
     * 执行指定请求块，或在未指定时执行当前光标所在请求块。
     *
     * 实现：
     * 整体流程如下：
     * 1. 定位目标请求块；
     * 2. 对其做局部格式化；
     * 3. 解析请求行，提取方法与路径；
     * 4. 组装目标 URL 和请求体；
     * 5. 通过 `requestExecution` 创建新的执行上下文并取消旧请求；
     * 6. 建立超时控制器，与执行中断信号合并；
     * 7. 用 `fetch()` 向本地 Elasticsearch 发送请求；
     * 8. 只允许最新请求更新耗时、状态码、结果面板和错误提示。
     *
     * 输入：
     * - `target`：可选目标对象，支持 `requestLineStart`，用于执行某个特定请求块。
     *
     * 输出：
     * - 返回一个 Promise。
     * - 成功时副作用是更新界面中的结果文本、状态码和耗时；
     * - 失败时副作用是更新错误提示并把结果面板重置为 `{}`。
     */
    async executeQuery(target = {}) {
      const requestBlock =
        typeof target.requestLineStart === 'number'
          ? this.getRequestBlock({ requestLineStart: target.requestLineStart })
          : this.getCurrentRequestBlock();

      if (!requestBlock || !requestBlock.text) {
        this.error = 'Request cannot be empty';
        return;
      }

      const normalizedRequest = this.normalizeRequestBlock(requestBlock, requestBlock.start);
      const requestText = normalizedRequest ? normalizedRequest.text : '';
      if (!requestText) {
        this.error = 'Request cannot be empty';
        return;
      }

      if (this.editorView) {
        this.editorView.focus();
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

    /**
     * 功能：
     * 处理组件根节点上的按键事件，支持快捷键执行当前请求块。
     *
     * 实现：
     * 当用户按下 `Ctrl + Enter` 时阻止默认行为，并调用 `executeQuery()`。
     *
     * 输入：
     * - `event`：键盘事件对象。
     *
     * 输出：
     * - 无；副作用是可能触发请求执行。
     */
    handleKeydown(event) {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        this.executeQuery();
      }
    },

    /**
     * 功能：
     * 切换当前激活的 ES 规则版本。
     *
     * 实现：
     * 直接更新响应式状态 `activeVersion`，补全逻辑会在下次运行时通过版本引用读取新值。
     *
     * 输入：
     * - `version`：目标版本字符串，例如 `es6`、`es7`、`es8`。
     *
     * 输出：
     * - 无；副作用是更新版本状态并影响后续补全结果。
     */
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
          <h1>ES DSL 控制台</h1>
          <p>支持多DSL语句块请求</p>
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
      <div class="workspace">
        <section class="editor-panel">
          <div class="panel-header">
            <div class="editor-toolbar">
              <button class="format-btn" @click="formatCurrentRequest" :disabled="isLoading">
                JSON格式化
              </button>
              <div class="editor-heading">
                <span class="panel-title">DSL请求</span>
                <span class="panel-subtitle">{{ versionLabel }}</span>
              </div>
            </div>
            <div class="panel-hint">
              <span>点击 <span class="hint-run-icon">▶</span> 发送请求</span>
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
.time {
  color: var(--muted);
  font-size: 12px;
}

.panel-subtitle {
  font-size: 11px;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
}

.editor-heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.panel-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.hint-run-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin: 0 2px;
  border: 1px solid rgba(120, 166, 255, 0.2);
  border-radius: 999px;
  background: rgba(120, 166, 255, 0.08);
  color: #9ec0ff;
  font-size: 10px;
  line-height: 1;
  vertical-align: middle;
}

.editor-container {
  flex: 1;
  min-height: 0;
}

.editor-container .cm-editor {
  height: 100%;
}

.format-btn {
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

.format-btn:disabled {
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
  .panel-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .workspace {
    grid-template-columns: 1fr;
  }
}
</style>
