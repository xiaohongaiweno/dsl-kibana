# dsl-kibana 源码说明

## 1. 项目定位

`dsl-kibana` 是一个基于 `Vue 2.5.2`、`Vite` 和 `CodeMirror 6` 实现的轻量前端控制台，用来模拟 Kibana Console 的核心体验：

- 在单编辑器中编写 Elasticsearch 请求块
- 按 Kibana 风格对请求行和 JSON Body 做自动补全
- 直接向本地 Elasticsearch 发送请求并展示响应
- 按 ES6 / ES7 / ES8 切换不同版本的接口补全规则

这个项目的重点不在服务端，而在“编辑体验”和“补全规则编译”两部分。

## 2. 目录结构

### 根目录关键文件

- `package.json`
  依赖、脚本和 Node 版本约束。常用脚本有 `dev`、`build`、`test`、`test:autocomplete`。
- `vite.config.js`
  Vite 配置，使用 `vite-plugin-vue2` 兼容 Vue 2.5.x。
- `README.md`
  运行环境的简要说明。
- `SOURCE_CODE_GUIDE.md`
  本文档，面向维护者说明代码结构和执行流程。

### `src/` 关键文件

- `main.js`
  Vue 应用入口，负责挂载根组件。
- `App.vue`
  主界面组件，负责编辑器初始化、请求格式化、请求执行和结果展示。
- `kibanaConsoleParser.js`
  把编辑器文本拆分成多个 Kibana Console 风格请求块，并根据光标定位当前请求。
- `kibanaConsoleAutocomplete.js`
  自动补全核心实现，包含请求行补全、URL 参数补全、Body 路径推导、规则编译与候选生成。
- `requestExecution.js`
  管理请求并发关系，保证“最新一次执行”覆盖旧请求。
- `requestMethods.js`
  维护请求行识别所需的 HTTP 方法和正则构造函数。
- `kibanaConsoleData.generated.js`
  生成好的 Kibana 补全元数据，体积较大，属于数据文件，不建议手工修改。

### `scripts/`

- `verifyAutocomplete.mjs`
  用样例集验证自动补全输出。
- `auditStaticSuffixEndpoints.mjs`
  审计具有静态后缀路径的 endpoint，用于分析路径补全能力。
- `autocompleteSamples.json`
  自动补全测试样例输入。

## 3. 运行时主流程

### 3.1 应用启动

入口在 `src/main.js`：

1. 导入 Vue 和根组件 `App.vue`
2. 创建 Vue 实例
3. 挂载到 `#app`

### 3.2 主界面初始化

`App.vue` 在 `mounted()` 中完成两件事：

1. 调用 `createKibanaCompletionSource()` 创建自动补全源
2. 分别创建两个 CodeMirror 实例

- 左侧 `editorView`：可编辑，请求输入区
- 右侧 `resultView`：只读，响应结果区

版本切换不是重建补全器，而是通过 `createVersionRef()` 暴露当前 `activeVersion`，让补全逻辑在运行时读取当前版本。

### 3.3 执行当前请求

点击“Execute Current Request”或按 `Ctrl+Enter` 时，会触发 `executeQuery()`：

1. 调用 `normalizeCurrentRequestBlock()` 格式化当前请求块
2. 通过 `parseRequestLine()` 校验首行是否满足 `METHOD + URL`
3. 拼接目标 URL，默认请求 `http://localhost:9200`
4. 调用 `requestExecution.startExecution()` 创建一次新的执行上下文
5. 通过 `fetch()` 发送请求
6. 将响应文本格式化为 JSON 或原始文本写入右侧结果面板
7. 显示状态码、耗时和错误信息

并发控制的关键点：

- 新请求启动时，旧请求会被 `AbortController` 中断
- 只有“最新执行”的结果允许更新界面
- 组件销毁时会主动取消未完成请求

## 4. 请求解析模块

文件：`src/kibanaConsoleParser.js`

这个模块解决两个问题：

1. 一段文本中可能有多个请求块，如何切分
2. 光标位于哪个请求块中，如何快速定位

### `parseConsoleRequests(text)`

核心思路：

- 先统一换行符
- 逐行扫描文本
- 当一行满足严格请求行正则时，认为新请求开始
- 使用 `computeBraceDepth()` 追踪 Body 中 `{}`、`[]` 的结构深度
- 当结构深度回到 0 且遇到空行时，认为当前请求结束

输出结果里会保存：

- 请求块起止偏移
- 请求行位置
- 方法、路径、查询串
- Body 起止位置

### `findRequestAtOffset(parsed, offset)`

根据光标偏移返回当前请求，并补充：

- 当前是否位于请求行
- 当前请求的 Body 文本
- 光标位于第几行

这个函数是执行、格式化和自动补全的共同入口。

## 5. 自动补全模块

文件：`src/kibanaConsoleAutocomplete.js`

这是整个项目最核心、也最复杂的文件。可以按四层理解。

### 5.1 第一层：输入上下文识别

补全首先要判断“用户现在在补什么”：

- 没有任何请求块时：提示 HTTP 方法
- 在请求行上：提示方法、路径、路径占位符或 URL 参数
- 在 Body 中：提示 JSON Key、字段模板或特定值

涉及的关键函数：

- `parseConsoleRequests()`
- `findRequestAtOffset()`
- `getLooseRequestLineInfo()`
- `parseBodyTokenPath()`

其中 `parseBodyTokenPath()` 很重要。它不是完整 JSON 解析器，而是一个“面向编辑中状态”的轻量状态机，用来推导：

- 当前位于对象还是数组
- 当前是否期待输入 key
- 当前 JSON 路径
- 同级数组里已经出现过哪些值

这样即使用户正在输入半成品 JSON，也能给出较稳定的补全。

### 5.2 第二层：Kibana 元数据编译

补全数据来自 `kibanaConsoleData.generated.js`。原始结构偏描述性，不适合每次补全时直接遍历，因此模块启动时会执行：

- `createCompiledApi()`
- `compileDescription()`
- `compileObject()`
- `compileList()`

它们会把描述规则编译成一套可遍历的组件树。

组件体系大致包括：

- `ConstantComponent`
  固定关键字，如某个 JSON 字段名
- `ListComponent`
  一组可选值，如索引名、字段名或枚举值
- `SimpleParamComponent`
  路径占位符，如 `{index}`、`{field}`
- `ScopeResolver`
  解析跨规则引用，如全局规则或其他 endpoint 的共享片段
- `ObjectComponent`
  组织对象内部字段和通配模式

编译后的结果会缓存到：

- `compiledApis.es6`
- `compiledApis.es7`
- `compiledApis.es8`

这样切换版本时只需要切换引用，不需要重新编译大对象。

### 5.3 第三层：路径匹配和候选筛选

请求行补全依赖 endpoint 匹配：

- `findMatchingEndpoints(api, method, path, version)`

一个输入路径可能匹配多个模式，例如同时命中较泛和较精确的路径模板。这个函数会按以下原则排序：

- 静态段越多越优先
- 占位符越少越优先
- 段数更长的通常更具体
- 规范化后的路径更长时优先级更高

路径补全相关函数还有：

- `getEndpointPathOptions()`
- `getPathSegmentOptions()`
- `getRequestLinePathCompletions()`
- `getUrlParamOptions()`
- `getUrlParamValueOptions()`

它们负责分别补：

- endpoint 路径
- 当前路径段
- 查询参数名
- 查询参数值

### 5.4 第四层：Body 自动补全

Body 补全由 `getBodyCompletion()` 驱动，整体步骤如下：

1. 通过 `parseBodyTokenPath()` 识别光标所在 JSON 位置
2. 通过 `findMatchingEndpoints()` 找到最可能的 endpoint
3. 获取该 endpoint 编译后的 body 规则
4. 使用 `populateContextAsync()` 和 `walkTokenPath()` 在规则树上“走路径”
5. 收集当前上下文下可见的候选项
6. 结合输入前缀、缩进层级、模板插入策略生成最终补全项

这里有几个值得注意的设计：

- 允许在不完整 JSON 中补全
- 插入对象/数组模板时，会自动处理缩进
- 对象 key 的补全会改写整行，减少引号和冒号的手工输入
- 若规则树没有给出直接候选，会退回到最近可解析规则节点提取字段名

## 6. 请求执行模块

文件：`src/requestExecution.js`

这个模块很小，但很关键。它解决的是“用户快速连续点击执行”时的竞态问题。

### `createRequestExecutionManager()`

返回三个核心能力：

- `startExecution()`
  启动新请求，并自动中断旧请求
- `cancelActive()`
  主动取消当前请求
- `getLatestExecutionId()`
  获取当前最新执行编号

每次 `startExecution()` 都会生成新的 `executionId`。界面层通过 `isLatest()` 判断当前响应是否仍然有效，避免旧请求后返回覆盖新请求结果。

## 7. 版本兼容策略

项目支持 `es6`、`es7`、`es8` 三套规则，核心差异主要体现在 endpoint pattern 兼容上。

关键函数：

- `normalizePattern()`
- `isVersionCompatiblePattern()`
- `getVersionCompatiblePatterns()`

当前处理重点是 mapping/type 相关路径：

- ES6 仍保留部分 `/{type}` 风格路径
- ES7/ES8 会移除或规避这些过时路径

因此同样的请求输入，在不同版本下可能看到不同的路径补全结果。

## 8. 测试与验证

### 单元测试

`src/requestExecution.test.js` 目前覆盖：

- 新执行会中断旧执行
- `cancelActive()` 会中断当前执行

### 自动补全样例验证

`scripts/verifyAutocomplete.mjs` 会读取 `scripts/autocompleteSamples.json`，调用补全函数并检查：

- 必须出现的候选项
- 不应出现的候选项
- 补全替换起始位置 `from`
- 指定候选项的元数据

这是补全回归验证的主要脚本。

## 9. 修改建议

后续维护时建议优先遵守以下边界：

- 不直接手改 `src/kibanaConsoleData.generated.js`
  它是生成产物，应通过上游规则或生成流程更新。
- 修改补全逻辑时，优先补样例测试
  自动补全属于高分支逻辑，只看界面现象不容易覆盖边界。
- 保持解析器“轻量但稳定”
  `kibanaConsoleParser.js` 的目标不是严格 JSON 校验，而是为编辑体验服务。
- 把 UI 状态和补全规则分开
  `App.vue` 应尽量只负责界面与请求生命周期，复杂语义判断继续放在独立模块中。

## 10. 建议阅读顺序

第一次接手这个项目时，推荐按下面顺序阅读：

1. `src/App.vue`
2. `src/kibanaConsoleParser.js`
3. `src/requestExecution.js`
4. `src/kibanaConsoleAutocomplete.js`
5. `scripts/verifyAutocomplete.mjs`

这样先理解页面行为，再进入补全引擎，会更容易建立整体心智模型。
