# dsl-kibana 源码导读

## 1. 项目定位

`dsl-kibana` 是一个独立运行的前端控制台应用，目标是复刻 Kibana Console 的核心体验：

- 在同一编辑器中书写多个 Elasticsearch 请求块
- 按 Kibana Console 风格补全 HTTP 方法、路径、查询参数和 JSON Body
- 直接向本地 Elasticsearch 发送请求并展示响应
- 在 `es6`、`es7`、`es8` 三套规则之间切换

当前应用技术栈是：

- `Vue 2.5.2`
- `Vite 2`
- `CodeMirror 6`
- 浏览器原生 `fetch`

运行时和构建时都不依赖旁边的 `kibana-7.6.0/` 目录。补全所需的 Kibana 元数据已经固化在仓库内的 `src/kibanaConsoleData.generated.js` 中。

## 2. 仓库结构

当前工作区有两层目录需要区分：

- 工作区根目录：`/Users/workspace/es_workspace/dsl-kibana`
- 真正的前端项目目录：`/Users/workspace/es_workspace/dsl-kibana/dsl-kibana`

本文说的“项目根目录”，默认指第二层 `dsl-kibana/`。

### 2.1 项目根目录关键文件

- `package.json`
  定义依赖、Node 版本和脚本。当前要求 `Node 20.14.0`。
- `.nvmrc` / `.node-version`
  声明本地开发应使用的 Node 版本。
- `vite.config.js`
  Vite 配置，使用 `vite-plugin-vue2` 支持 Vue 2.5.x。
- `index.html`
  Vite 入口 HTML，挂载点是 `#app`。
- `README.md`
  运行说明。
- `SOURCE_CODE_GUIDE.md`
  本文档。

### 2.2 资源与产物目录

- `public/`
  静态资源目录，目前主要是图标文件。
- `dist/`
  构建输出目录。
- `node_modules/`
  依赖安装目录。

### 2.3 `src/` 核心源码

- `main.js`
  Vue 启动入口，只负责挂载 `App.vue`。
- `App.vue`
  主界面与主流程控制中心，负责：
  - 初始化两个 CodeMirror 编辑器
  - 版本切换
  - 当前请求块定位
  - 请求块格式化
  - 发起请求
  - 展示响应、状态码和耗时
- `kibanaConsoleParser.js`
  负责把整份文档拆成多个 Kibana Console 风格请求块，并按光标偏移定位当前请求。
- `requestMethods.js`
  HTTP 方法定义，以及严格/宽松两类请求行正则。
- `requestExecution.js`
  请求并发控制，保证“新请求取消旧请求，旧响应不能覆盖新响应”。
- `kibanaConsoleAutocomplete.js`
  CodeMirror 补全适配层，负责把编辑器上下文转换为补全请求，并把核心补全结果组装成 CodeMirror 可消费格式。
- `kibanaConsoleAutocompleteCore.js`
  自动补全核心实现，包含规则编译、路径匹配、Body 路径推导、候选生成、版本兼容处理等主要算法。
- `kibanaConsoleData.generated.js`
  已生成的 Kibana 补全元数据文件，不建议手工修改。
- `kibanaConsoleAutocomplete.test.js`
  补全逻辑的 Node 侧测试。
- `requestExecution.test.js`
  请求执行管理器测试。

### 2.4 当前未承载核心逻辑的目录

- `src/components/`
  当前基本未使用，主要逻辑仍集中在 `App.vue`。
- `src/assets/`
  当前没有实际承载关键业务资源。

## 3. 启动与运行模型

### 3.1 启动入口

入口在 `src/main.js`：

1. 导入 `Vue`
2. 导入根组件 `App.vue`
3. 创建 Vue 实例
4. 挂载到 `#app`

入口层没有做额外状态管理或路由组织，所有交互都在单页组件中完成。

### 3.2 页面结构

`App.vue` 把页面分成两块：

- 左侧请求编辑器
- 右侧响应结果面板

顶部有一个版本切换区，用于切换补全规则：

- `ES6`
- `ES7`
- `ES8`

左侧工具栏提供“JSON格式化”按钮，请求块左侧 gutter 上提供单块执行按钮 `▶`，同时支持 `Ctrl + Enter` 执行当前光标所在请求块。

## 4. App.vue 的职责

`App.vue` 是当前项目最重要的 UI 组件，既管理页面，也承担了主流程编排。

### 4.1 状态

`data()` 中主要维护这些状态：

- `requestExecution`
  请求执行管理器实例
- `editorView`
  左侧请求编辑器实例
- `resultView`
  右侧结果编辑器实例
- `completionSource`
  CodeMirror 自动补全源
- `isLoading`
  当前是否正在请求
- `error`
  错误提示
- `responseTime`
  响应耗时
- `statusCode`
  HTTP 状态码
- `activeVersion`
  当前启用的 ES 规则版本

### 4.2 初始化

`mounted()` 里会做三件事：

1. 通过 `createVersionRef(this)` 创建一个动态版本引用对象
2. 创建左侧可编辑 CodeMirror
3. 创建右侧只读 CodeMirror

这里的一个关键设计是：补全源只创建一次，但补全时读取的版本值是动态的。这样切换 `es6/es7/es8` 时不需要重建整套编辑器和补全器。

### 4.3 编辑器创建

`createEditor()` 统一创建左右两个编辑器实例。

共性配置：

- `basicSetup`
- `oneDark`
- 自动补全扩展
- 默认快捷键与 `Tab` 缩进
- 自动换行
- 自定义暗色主题

差异配置：

- 左侧请求编辑器：可编辑，带请求执行 gutter
- 右侧结果面板：只读

### 4.4 请求块运行按钮

请求块左侧的 `▶` 按钮不是普通 DOM 列表，而是 CodeMirror gutter 扩展：

- `RequestRunMarker`
  表示一个可点击的执行按钮
- `buildRequestRunMarkers(doc)`
  从整份文档里找出所有请求块，在每个请求行起点插入一个 marker
- `requestRunMarkerField`
  文档变化时重新计算整份 gutter 标记
- `createRequestRunGutter(onRunRequest)`
  把点击事件转发给外层执行逻辑

因此，只要文本里识别出了多个请求块，gutter 就会自动为每个请求块渲染一个运行按钮。

## 5. 请求块模型与解析

文件：`src/kibanaConsoleParser.js`

这是“多请求块编辑器”能够工作的基础模块。它既服务执行逻辑，也服务补全逻辑。

### 5.1 请求行规则

请求块的开始由严格请求行正则决定，正则来自 `requestMethods.js`：

- 支持方法：`GET`、`POST`、`PUT`、`DELETE`、`HEAD`
- 严格模式：必须是 `METHOD + URL`
- 宽松模式：允许用户还没把 URL 输完整时也能参与补全

### 5.2 `parseConsoleRequests(text)`

这是请求块解析主入口，主要流程：

1. 统一换行符为 `\n`
2. 逐行扫描文本
3. 命中严格请求行时，认为新请求块开始
4. 用 `computeBraceDepth()` 粗略跟踪 Body 中的 `{}` / `[]` 嵌套深度
5. 当结构深度回到 0 并遇到空行时，认为当前请求块结束

返回结构里会包含：

- 规范化后的全文
- 每一行的起始偏移
- 所有请求块
- 每个请求块的起止范围
- 请求行信息
- Body 起止位置

### 5.3 `findRequestAtOffset(parsed, offset)`

根据光标偏移定位当前请求块，并补充上下文：

- 当前是否位于请求行
- 当前请求的 `bodyText`
- 光标在请求块内的偏移
- 当前行号

这个函数是补全逻辑的关键输入。

### 5.4 `parseRequestLine(line)`

把请求行拆成：

- `method`
- `rawPath`
- `path`
- `queryString`

执行前校验与补全逻辑都会复用它。

## 6. 请求执行流程

`App.vue` 中的 `executeQuery()` 是真正的执行入口。

完整流程如下：

1. 根据 `requestLineStart` 或当前光标找到目标请求块
2. 对该请求块执行局部格式化
3. 校验首行是否满足 `METHOD + URL`
4. 提取请求体
5. 默认向 `http://localhost:9200` 发起请求
6. 通过 `requestExecution.startExecution()` 建立新的执行上下文
7. 创建 30 秒超时控制器
8. 用 `mergeAbortSignals()` 合并“被新请求替代”和“超时”两种中断信号
9. 使用 `fetch()` 发送请求
10. 如果它仍然是最新请求，则更新状态码、耗时和结果面板
11. 失败时区分超时、取消和普通错误

### 6.1 请求块级别执行

执行粒度不是整份文档，而是“当前请求块”：

- gutter 按钮执行指定请求块
- `Ctrl + Enter` 执行当前光标所在请求块
- “JSON格式化”只格式化当前请求块

这套行为由下面几个方法配合完成：

- `getRequestBlock()`
- `getCurrentRequestBlock()`
- `formatRequestBlock()`
- `normalizeRequestBlock()`
- `normalizeCurrentRequestBlock()`

### 6.2 请求并发控制

文件：`src/requestExecution.js`

`createRequestExecutionManager()` 提供三类能力：

- `startExecution()`
  启动新请求，并自动中断旧请求
- `cancelActive()`
  主动取消当前请求
- `getLatestExecutionId()`
  读取最新执行编号

`startExecution()` 返回的执行对象包含：

- `executionId`
- `controller`
- `isLatest()`
- `release()`

UI 层通过 `isLatest()` 保证：即使旧请求更晚返回，也不能覆盖新请求的结果。

### 6.3 中断信号合并

`mergeAbortSignals()` 的作用是把多个 `AbortSignal` 合并为一个统一信号，主要合并两类来源：

- 当前请求被新的请求取代
- 当前请求超过 30 秒超时

这样 `fetch()` 只需要消费一个信号，但 UI 仍然可以维护两类不同的取消来源。

## 7. 自动补全总体架构

自动补全分成两层：

- `kibanaConsoleAutocomplete.js`
  编辑器适配层
- `kibanaConsoleAutocompleteCore.js`
  规则与算法核心

这样的拆分让核心补全逻辑既能被 CodeMirror 调用，也能直接被 Node 测试调用。

## 8. `kibanaConsoleAutocomplete.js` 适配层

这个文件关注“当前编辑器里用户正在输入什么”，并把上下文转成具体的补全请求。

### 8.1 主要职责

- 识别当前光标是否位于请求行或 Body
- 识别用户是否正在输入 HTTP 方法
- 识别是否在补 URL 路径、路径占位符、查询参数名或参数值
- 把核心层返回的候选转换为 CodeMirror completion 结果
- 提供一个无 UI 的测试入口

### 8.2 关键函数

- `createKibanaCompletionSource(versionRef, explicitMetadataService)`
  给 CodeMirror 使用的异步补全源
- `getKibanaCompletions({ text, cursor, version, metadataService })`
  给测试和脚本使用的最小化补全入口
- `getRequestLineCompletion(...)`
  请求行补全主入口
- `getTopLevelRequestLineOverride(...)`
  处理 Body 外层看起来像新请求行时的特殊补全
- `getRequestLinePathCompletions(...)`
  请求路径补全入口

### 8.3 请求行补全识别

这里同时使用两类请求行解析：

- 严格解析：请求行已经成形时使用
- 宽松解析：用户正在输入半成品请求行时使用

对应方法：

- `parseRequestLine()`
- `parseRequestLineForCompletion()`
- `getLooseRequestLineInfo()`

这样做的目的是让补全在“用户还没把命令输完整”时就开始工作。

### 8.4 URL 补全

这个文件会处理四种 URL 相关场景：

- 补 HTTP 方法
- 补 endpoint 路径
- 补查询参数名
- 补查询参数值

对应函数包括：

- `getEndpointPathOptions()`
- `getUrlParamOptions()`
- `getUrlParamValueOptions()`
- `getPathSegmentOptions()`

如果当前路径段是占位符，比如 `{index}`、`{template}`、`{type}`，会进一步从 metadata service 拿到真实候选值。

## 9. `kibanaConsoleAutocompleteCore.js` 核心层

这是项目里最复杂的文件，承担补全规则的真正解析与计算。

可以把它拆成五块理解。

### 9.1 基础工具与版本兼容

核心工具函数包括：

- `normalizePath()`
  统一处理路径首尾 `/`
- `normalizePattern(pattern, version)`
  按 ES 版本归一化 endpoint pattern
- `filterOptions()`
  按前缀过滤候选
- `findMatchingEndpoints(api, method, path, version)`
  找出与当前路径最匹配的 endpoint

当前版本兼容重点处理的是 mapping/type 历史差异：

- `es6` 保留部分 `/{type}` 风格路径
- `es7` / `es8` 会对这类路径做过滤或归一化

因此同一段输入在不同版本下可能看到不同的路径候选和 Body 规则。

### 9.2 Body 光标路径推导

`parseBodyTokenPath(bodyText, offset)` 是 Body 补全的关键函数。

它不是严格 JSON parser，而是一个面向编辑态的轻量状态机，用来在“JSON 还没写完”的情况下推断：

- 当前在对象还是数组中
- 当前是否正在输入 key
- 当前规则路径 `rulePath`
- 当前 token 路径 `tokenPath`
- 同一数组中已输入过哪些 token
- 当前嵌套深度

这个设计很重要，因为补全必须在半成品 JSON 中也能工作。

### 9.3 Kibana 元数据编译

补全原始数据来自 `kibanaConsoleData.generated.js`。原始结构更偏“描述数据”，不适合每次按键都直接遍历，所以核心层会先编译并缓存。

主要编译函数：

- `createCompiledApi()`
- `compileDescription()`
- `compileObject()`
- `compileList()`
- `compileBodyDescription()`

编译结果按版本缓存，版本切换时只切引用，不重复做全量编译。

### 9.4 组件树与规则匹配

Body 规则会被编译成一组可遍历组件，主要包括：

- `ConstantComponent`
  固定字段或固定值
- `ListComponent`
  列表候选，支持多值与去重
- `SimpleParamComponent`
  参数占位符组件
- `ObjectComponent`
  对象结构组件
- `ScopeResolver`
  解析跨作用域引用
- `ConditionalProxy`
  处理条件规则
- `GlobalOnlyComponent`
  当 endpoint 规则无法命中时使用全局规则兜底

围绕这些组件，补全器会沿 `tokenPath` 遍历规则树并收集当前可见候选。

### 9.5 路径与参数候选

`findMatchingEndpoints()` 会对所有可能命中的 endpoint 做排序，优先选择更具体的规则。排序依据主要是：

- 静态段更多
- 占位符更少
- 路径段更多
- 规范化后的 pattern 更长

这里还有一个很实用的路径补全策略：

- 当动态段后面紧跟静态多段后缀时，补全器会尽量一次性补全整个静态后缀

例如更倾向补出 `_validate/query`，而不是只补第一段。

### 9.6 Body 候选生成

Body 补全主入口是 `getBodyCompletion()`，大致流程：

1. 计算 `bodyOffset`
2. 用 `parseBodyTokenPath()` 获得当前 JSON 上下文
3. 用 `findMatchingEndpoints()` 找到当前请求最匹配的 endpoint
4. 取出 endpoint 对应的 `compiledBody`
5. 遍历规则树收集候选
6. 结合当前缩进、前缀和位置生成最终补全项

当前实现有几个值得注意的行为：

- key 补全会直接生成 `"key": `
- 模板型候选会自动带出对象/数组骨架
- 插入时会根据当前缩进调整换行格式
- 数组候选会考虑去重和上下文限制
- 插入行为通过 `withCursorAwareApply()` 自定义，以便精确控制替换范围和光标位置

### 9.7 Metadata Service 扩展点

核心补全支持通过 metadata service 提供动态候选值，比如：

- 索引名
- 字段名
- type
- template

当前测试里模拟的方法包括：

- `getIndices()`
- `getFields()`
- `getTypes()`
- `getTemplates()`

这意味着补全内核既支持仓库内的静态规则，也支持运行时注入真实集群元数据。

## 10. 测试

项目当前测试通过 Node 原生测试运行器执行：

```bash
npm test
```

### 10.1 `src/requestExecution.test.js`

当前覆盖点：

- 启动新执行时会中断旧执行
- `cancelActive()` 会中断当前执行

### 10.2 `src/kibanaConsoleAutocomplete.test.js`

当前覆盖点主要围绕 metadata service 驱动的补全：

- `sort` 数组里的字段候选来自 `getFields()`
- `{template}` 占位符候选来自 `getTemplates()`
- `{index}` 占位符候选来自 `getIndices()`
- ES6 下 `{type}` 占位符候选来自 `getTypes()`

这些测试的价值不只是校验候选是否出现，也是在验证：

- 核心补全逻辑可在 Node 环境独立运行
- 运行时动态元数据确实能接到补全链路中

## 11. 与 `kibana-7.6.0/` 的关系

工作区里存在一个平级目录 `kibana-7.6.0/`。它对理解项目有帮助，但不是当前应用的直接运行依赖。

可以把它理解成：

- 一个历史参考源码库
- 规则数据和交互设计的来源背景
- 调研 Kibana Console 原始实现时可用的对照目录

但对当前前端项目来说：

- 构建不引用它
- 运行不读取它
- 自动补全依赖的是已经提交到仓库的 `src/kibanaConsoleData.generated.js`

所以如果只是维护 `dsl-kibana` 的页面、执行逻辑或补全逻辑，通常不需要先改 `kibana-7.6.0/`。

## 12. 维护建议

- 不要手改 `src/kibanaConsoleData.generated.js`
  它是生成产物，手改会让后续追溯和再生成变得困难。
- 改补全逻辑时，优先补测试
  补全分支很多，只靠浏览器手测很容易漏边界。
- 保持解析器轻量
  `kibanaConsoleParser.js` 的目标不是完整 JSON 校验器，而是服务请求块识别和编辑体验。
- 谨慎继续把逻辑塞进 `App.vue`
  当前它已经同时承载 UI、编辑器装配、格式化和执行流程，后续如果继续扩展，优先考虑拆模块。
- 注意执行粒度是“单请求块”
  修改格式化、执行或补全行为时，不要误伤同一文档中的其他请求块。
- 改版本兼容逻辑时，至少同时验证 ES6 和 ES7/ES8
  很多差异不是写死在 UI 层，而是通过 pattern 过滤与归一化间接体现的。

## 13. 建议阅读顺序

第一次接手这个项目，推荐按下面顺序阅读：

1. `src/App.vue`
2. `src/kibanaConsoleParser.js`
3. `src/requestExecution.js`
4. `src/kibanaConsoleAutocomplete.js`
5. `src/kibanaConsoleAutocompleteCore.js`
6. `src/kibanaConsoleAutocomplete.test.js`

这条顺序更符合真实排障路径：

- 先理解页面怎么驱动请求块
- 再理解请求块如何被解析
- 再看请求如何执行与取消
- 最后再进入自动补全适配层与核心规则层
