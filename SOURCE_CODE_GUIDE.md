# dsl-kibana 源码说明

## 1. 项目定位

`dsl-kibana` 是一个基于 `Vue 2.5.2`、`Vite 2` 和 `CodeMirror 6` 的轻量前端控制台，用来复刻 Kibana Console 的核心交互体验：

- 在一个编辑器里书写多个 Elasticsearch 请求块
- 按 Kibana Console 的风格补全请求方法、路径、查询参数和 Body
- 直接向本地 Elasticsearch 发送请求并展示响应
- 按 `es6` / `es7` / `es8` 切换不同版本的补全规则

当前项目已经是一个自包含前端应用，运行时不再依赖本地 `kibana-7.6.0` 源码目录。补全规则使用仓库内已提交的 `src/kibanaConsoleData.generated.js`。

## 2. 目录结构

### 根目录关键文件

- `package.json`
  项目依赖、脚本和 Node 版本约束。当前要求 `Node 20.14.0`。
- `vite.config.js`
  Vite 配置，使用 `vite-plugin-vue2` 支持 Vue 2.5.x。
- `README.md`
  启动要求与环境说明。
- `SOURCE_CODE_GUIDE.md`
  本文档，面向维护者介绍代码结构和关键执行流程。

### `src/` 关键文件

- `main.js`
  Vue 应用入口，只负责挂载根组件。
- `App.vue`
  主界面组件，负责编辑器初始化、版本切换、请求块格式化、请求执行和响应展示。
- `kibanaConsoleParser.js`
  负责把编辑器文本切分成多个 Kibana Console 风格请求块，并根据偏移量定位当前请求。
- `kibanaConsoleAutocomplete.js`
  自动补全核心实现，包含请求行补全、URL 参数补全、Body 路径推导、规则编译和候选生成。
- `requestExecution.js`
  管理并发执行，确保“后一次执行”能取消前一次，并且旧响应不会覆盖新结果。
- `requestExecution.test.js`
  `requestExecution.js` 的单元测试。
- `requestMethods.js`
  维护支持的 HTTP 方法集合，以及严格/宽松两类请求行正则。
- `kibanaConsoleData.generated.js`
  生成好的 Kibana 补全元数据。它是数据产物，不建议手工修改。

### `scripts/`

- `verifyAutocomplete.mjs`
  用样例集直接调用补全引擎，做回归验证。
- `autocompleteSamples.json`
  自动补全验证样例。
- `auditStaticSuffixEndpoints.mjs`
  分析 endpoint pattern 中“动态段后接静态多段后缀”的路径，用来观察路径补全策略。
- `staticSuffixEndpointAudit.md`
  审计脚本的输出文件。

## 3. 运行时主流程

### 3.1 应用启动

入口在 `src/main.js`：

1. 导入 `Vue` 和根组件 `App.vue`
2. 创建 Vue 实例
3. 挂载到 `#app`

### 3.2 主界面初始化

`App.vue` 在 `mounted()` 中完成初始化：

1. 调用 `createKibanaCompletionSource()` 创建补全源
2. 创建左侧请求编辑器 `editorView`
3. 创建右侧结果面板 `resultView`

两个面板都使用 CodeMirror：

- 左侧是可编辑请求输入区
- 右侧是只读响应展示区

版本切换通过 `createVersionRef()` 暴露一个响应式引用，补全器初始化一次后，会在运行时读取当前的 `activeVersion`，而不是每次切换都重建整套补全逻辑。

### 3.3 请求块执行模型

编辑器支持一份文档里包含多个请求块。每个请求块请求行左侧都会渲染一个运行按钮：

- 点击 gutter 中的三角按钮，会执行对应请求块
- `Ctrl + Enter` 会执行当前光标所在请求块
- “Format Current Request” 只格式化当前请求块，不影响其他块

这套行为由 `parseConsoleRequests()` 提供请求块边界，再由 `App.vue` 中的 `getRequestBlock()`、`getCurrentRequestBlock()` 和 `normalizeRequestBlock()` 完成实际操作。

### 3.4 执行请求

`executeQuery()` 是主执行入口，流程如下：

1. 找到目标请求块
2. 尝试格式化该请求块中的 JSON Body
3. 用 `parseRequestLine()` 校验首行是否满足 `METHOD + URL`
4. 拼接目标地址，默认请求 `http://localhost:9200`
5. 通过 `requestExecution.startExecution()` 创建新的执行上下文
6. 创建 30 秒超时控制器
7. 用 `fetch()` 直接向 Elasticsearch 发请求
8. 将响应内容格式化为 JSON 或原始文本并写入右侧结果面板
9. 更新状态码、耗时和错误信息

这里有三个关键约束：

- 新请求会中断旧请求
- 只有最新一次执行允许更新 UI
- 超时、中断和普通失败会被区分成不同错误提示

`mergeAbortSignals()` 把“被新请求替代”和“超时”两类中断信号合并成一个 `fetch` 使用的 `AbortSignal`，让请求生命周期管理保持简单。

## 4. 请求解析模块

文件：`src/kibanaConsoleParser.js`

这个模块是“执行当前请求块”和“在当前请求上下文补全”的共同基础。它解决两个问题：

1. 一段文本中如何识别多个请求块
2. 光标当前位于哪个请求块

### `parseConsoleRequests(text)`

核心思路：

- 先统一换行符
- 逐行扫描文本
- 当一行满足严格请求行正则时，认为新请求开始
- 用 `computeBraceDepth()` 粗略追踪 `{}` / `[]` 的结构深度
- 当结构深度回到 0 且遇到空行时，认为当前请求结束

返回结果会保存：

- 全文标准化文本
- 每一行的起始偏移
- 每个请求块的起止位置
- 请求行位置
- 请求方法、原始路径、查询串
- Body 起止位置

`computeBraceDepth()` 不是严格 JSON 解析器。它的目的只是帮助判断“空行是否意味着 Body 已经结束”，因此只做轻量结构平衡计算。

### `findRequestAtOffset(parsed, offset)`

根据光标偏移返回当前请求，并补充：

- 当前是否位于请求行
- 当前请求的 Body 文本
- 光标在请求内的偏移
- 光标所在行号

### `parseRequestLine(line)`

把一行请求解析成：

- `method`
- `rawPath`
- `path`
- `queryString`

这个函数用于执行前校验，也被补全逻辑复用。

## 5. 自动补全模块

文件：`src/kibanaConsoleAutocomplete.js`

这是项目最核心、最复杂的文件。可以分成五层来理解。

### 5.1 请求行上下文识别

补全第一步是判断用户现在正在补什么：

- 还没形成请求块时，补 HTTP 方法
- 正在输入请求行时，补方法、路径、路径段、查询参数或查询参数值
- 位于 Body 时，补 JSON key、模板结构或特定值

相关函数：

- `getCurrentWord()`
- `parseRequestLineForCompletion()`
- `getLooseRequestLineInfo()`
- `getTopLevelRequestLineOverride()`

这里同时存在两套请求行解析规则：

- `createStrictRequestLineRegExp()` 用于“请求行已经成形”的解析
- `createLooseRequestLineRegExp()` 用于“用户还在打字中”的补全

这样才能在请求行尚未输入完整时持续给出路径建议。

### 5.2 Body 光标路径推导

Body 补全依赖 `parseBodyTokenPath(bodyText, offset)`。

它不是完整 JSON parser，而是一个面向编辑态的轻量流式状态机，用来在“半成品 JSON”里推导：

- 当前处于对象还是数组
- 当前是否期待输入 key
- 当前规则路径 `rulePath`
- 当前 token 路径 `tokenPath`
- 同一数组中已出现过哪些 token
- 当前嵌套深度

这使得补全在 JSON 尚未闭合、字符串尚未输完的情况下仍然可用。

### 5.3 Kibana 元数据编译

补全元数据来自 `kibanaConsoleData.generated.js`。原始结构偏描述性，不适合在每次键入时直接遍历，因此文件加载时会按 ES 版本预编译：

- `createCompiledApi()`
- `compileDescription()`
- `compileObject()`
- `compileList()`
- `compileBodyDescription()`

编译结果被缓存为：

- `compiledApis.es6`
- `compiledApis.es7`
- `compiledApis.es8`

因此版本切换时只是切换引用，不会重复编译整棵规则树。

### 5.4 组件树与规则解析

编译后的 Body 规则会变成一组可遍历组件。重要组件包括：

- `ConstantComponent`
  固定字段或固定值
- `ListComponent`
  一组候选值，支持多值、去重和上下文过滤
- `SimpleParamComponent`
  路径或规则中的参数占位符
- `ObjectComponent`
  组织对象内固定字段、模式字段和通配字段
- `ScopeResolver`
  解析跨 endpoint 或全局规则引用
- `ConditionalProxy`
  处理带条件的规则
- `GlobalOnlyComponent`
  当找不到 endpoint 时，只使用全局规则作为兜底

围绕这些组件，补全器会通过 `walkTokenPath()`、`populateContextAsync()` 和 `resolveTerms()` 沿当前 JSON 路径遍历规则树，并收集可见候选。

### 5.5 请求路径和查询参数补全

请求行补全的关键在 endpoint pattern 匹配。

#### `findMatchingEndpoints(api, method, path, version)`

一个输入路径可能匹配多个 endpoint pattern，这个函数会做排序，优先选择更具体的规则。排序依据包括：

- 静态段更多
- 占位符更少
- 路径段更长
- 规范化 pattern 更长

#### 其他关键函数

- `getEndpointPathOptions()`
  列出某个方法下所有 endpoint 路径
- `getPathSegmentOptions()`
  根据当前已输入路径段补当前段
- `getRequestLinePathCompletions()`
  组合路径段补全和 fallback 路径补全
- `getUrlParamOptions()`
  补查询参数名
- `getUrlParamValueOptions()`
  补查询参数值
- `getPathPlaceholderInfo()`
  判断当前命中的 pattern 是否落在路径占位符位置
- `getUrlComponentSuggestions()`
  如果某个占位符有预定义枚举值，则直接给出建议

这里还有一个比较实用的策略：

- 当 pattern 中动态段之后紧跟静态多段后缀时，补全器会尽量一次性补出整个静态后缀

例如它倾向于直接补出 `_validate/query` 这种完整后缀，而不是只补第一段。

### 5.6 Body 候选生成

`getBodyCompletion()` 是 Body 补全主入口，流程如下：

1. 根据光标位置计算 `bodyOffset`
2. 用 `parseBodyTokenPath()` 识别当前 JSON 上下文
3. 用 `findMatchingEndpoints()` 找最匹配的 endpoint
4. 从 endpoint 上取出 `compiledBody`
5. 用 `populateContextAsync()` 遍历规则树并收集候选
6. 根据当前行缩进、前缀、是否在 key 输入位等条件生成最终补全项

当前实现有几个值得注意的设计：

- 对象 key 补全时，会直接生成 `"key": ` 结构
- 如果规则自带模板，会拼出对象或数组模板并保留合理光标位置
- 插入时会按当前嵌套深度处理缩进
- 如果规则树当前节点没有直接候选，会回退到最近可解析规则节点提取字段名
- 补全项会通过 `withCursorAwareApply()` 自定义插入行为，以便同时控制替换范围和光标位置

### 5.7 对外暴露的两个入口

- `createKibanaCompletionSource(versionRef)`
  给 CodeMirror 使用的异步补全源
- `getKibanaCompletions({ text, cursor, version })`
  给脚本和自动化验证使用的无 UI 补全入口

后者会模拟最小化编辑器上下文，因此可以在 Node 脚本中直接跑回归测试。

## 6. 请求执行模块

文件：`src/requestExecution.js`

这个模块很小，但非常关键。它负责处理“用户连续执行多个请求”时的竞态问题。

### `createRequestExecutionManager()`

返回三个核心能力：

- `startExecution()`
  启动新执行，并中断旧执行
- `cancelActive()`
  主动取消当前执行
- `getLatestExecutionId()`
  读取当前最新执行编号

`startExecution()` 会返回一个执行对象，其中包含：

- `executionId`
- `controller`
- `isLatest()`
- `release()`

界面层通过 `isLatest()` 保证旧请求即使晚返回，也不会覆盖新请求的结果。

## 7. 版本兼容策略

项目支持 `es6`、`es7`、`es8` 三套补全规则。版本兼容主要体现在 endpoint pattern 过滤和规范化上。

关键函数：

- `normalizePattern()`
- `isVersionCompatiblePattern()`
- `getVersionCompatiblePatterns()`
- `getCompiledApi()`

当前实现重点处理的是 mapping/type 相关的历史差异：

- `es6` 会保留部分 `/{type}` 风格路径
- `es7` / `es8` 会规避或归一化这类旧路径

所以同一段输入在不同版本下，可能看到不同的路径候选和 Body 规则。

## 8. 脚本与测试

### 8.1 单元测试

`src/requestExecution.test.js` 当前覆盖：

- 新执行会中断旧执行
- `cancelActive()` 会中断当前执行

运行方式：

```bash
npm test
```

### 8.2 自动补全回归验证

`scripts/verifyAutocomplete.mjs` 会：

1. 读取 `scripts/autocompleteSamples.json`
2. 通过 `getKibanaCompletions()` 直接调用补全逻辑
3. 校验候选列表是否满足样例约束

样例目前可验证：

- 必须出现的候选项
- 不应出现的候选项
- 补全起始位置 `from`
- 指定候选项的元数据字段

脚本里使用的是内置假数据服务，用于模拟索引、字段、type 和模板等枚举值，因此不依赖浏览器环境。

运行方式：

```bash
npm run test:autocomplete
```

### 8.3 静态后缀路径审计

`scripts/auditStaticSuffixEndpoints.mjs` 会扫描生成数据中的 endpoint pattern，找出“动态段后面跟静态多段后缀”的路径，并输出到 `scripts/staticSuffixEndpointAudit.md`。

这个脚本主要用来分析和调试路径补全策略，不参与运行时逻辑。

运行方式：

```bash
npm run audit:static-suffix
```

## 9. 维护建议

- 不要手改 `src/kibanaConsoleData.generated.js`
  它是生成产物，应该通过上游数据源或生成流程更新。
- 修改补全逻辑时，优先补 `autocompleteSamples.json`
  补全逻辑分支很多，只靠手测很容易漏边界。
- 保持解析器“轻量但稳定”
  `kibanaConsoleParser.js` 的目标不是严格 JSON 校验，而是服务编辑体验和请求块识别。
- 尽量把语义判断放在独立模块
  `App.vue` 更适合管理 UI 和请求生命周期，不适合承载越来越多的补全规则细节。
- 注意执行逻辑是“当前请求块粒度”
  修改格式化、补全或运行行为时，不要误伤同文档中的其他请求块。
- 修改版本兼容逻辑时，至少同时检查 ES6 和 ES7/ES8
  当前很多差异都是通过 pattern 过滤和规范化间接实现的。

## 10. 建议阅读顺序

第一次接手这个项目时，建议按下面顺序阅读：

1. `src/App.vue`
2. `src/kibanaConsoleParser.js`
3. `src/requestExecution.js`
4. `src/kibanaConsoleAutocomplete.js`
5. `scripts/verifyAutocomplete.mjs`

这样可以先建立页面交互和请求块模型，再进入补全引擎的规则编译与路径匹配细节。
