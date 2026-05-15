# dsl-kibana

一个将 Kibana Console 核心 DSL 能力剥离出来的轻量级 Elasticsearch DSL 控制台，适合中大型公司集成到自己的研发平台、运维平台、数据平台或搜索平台中。

## 项目定位

很多中大型公司已经有自己的：

- 自研前端框架
- 统一门户系统
- 登录与权限体系
- 审计与安全规范
- 内部研发或运维平台

如果只是为了提供一个 Elasticsearch DSL 调试能力，就把完整 Kibana 整体接入公司平台，通常会面临几个现实问题：

- 接入和改造工作量大
- 与公司现有框架和平台规范耦合成本高
- 只需要 DSL 控制台能力，却要承担整套 Kibana 的维护复杂度
- 性价比低，投入产出不划算
- 还需要额外承担权限控制、访问隔离和平台安全面的风险

`dsl-kibana` 的目标，就是把 Kibana Console 中最常用、最有生产力的 DSL 能力单独剥离出来，让团队能够更低成本地集成到自己的平台里。

## 核心价值

- 剥离 Kibana Console 的核心 DSL 能力，而不是整体引入 Kibana
- 降低企业平台集成成本，减少接入改造工作量
- 保留多请求块编辑与执行的高频生产力体验
- 提供接近 Kibana Console 的自动补全体验
- 支持 `ES6`、`ES7`、`ES8` 三套规则切换
- 更适合按公司自己的权限体系和界面规范做二次封装

## 功能特性

- 多请求块编辑，可在同一编辑器中维护多段 DSL 请求
- 单请求块执行，每个请求块左侧均可独立点击执行
- 快捷键执行，支持 `Ctrl + Enter`
- Kibana 风格自动补全
- 支持 HTTP 方法、路径、查询参数、参数值、JSON Body 补全
- 支持 `ES6`、`ES7`、`ES8` 规则切换
- 右侧结果面板展示响应内容、状态码和耗时
- 请求并发安全控制，保证新请求不会被旧响应覆盖

## 适用场景

- 集成到公司已有研发平台、运维平台或数据平台
- 在企业自有权限体系下提供 DSL 调试能力
- 搭建轻量级 Elasticsearch 内部查询控制台
- 本地快速调试 Elasticsearch DSL
- 教学演示 Elasticsearch 查询语句
- 学习 Kibana Console 自动补全与编辑器交互实现
- 作为前端工具项目继续二次开发

## 技术栈

- `Vue 2.5.2`
- `Vite 2`
- `CodeMirror 6`
- 浏览器原生 `fetch`

项目运行依赖仓库内已提交的 `src/kibanaConsoleData.generated.js`，不再依赖本地额外的 `kibana-7.6.0` 源码目录。

## 快速开始

### 环境要求

- `Node 20.14.0`

仓库已提供：

- `.nvmrc`
- `.node-version`

### 安装依赖

```bash
nvm use
npm install
```

### 启动开发环境

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

### 运行测试

```bash
npm test
```

## 使用方式

项目默认请求本地 Elasticsearch：

```text
http://localhost:9200
```

启动本地 ES 后，打开页面即可编写 DSL 请求，例如：

```http
GET /_search
{
  "query": {
    "match_all": {}
  }
}
```

你可以：

- 点击请求块左侧 `▶` 执行当前块
- 使用 `Ctrl + Enter` 执行当前光标所在请求块
- 点击 `JSON格式化` 仅格式化当前请求块
- 在 `ES6`、`ES7`、`ES8` 规则之间切换补全逻辑

## 为什么不直接集成完整 Kibana

对于企业平台集成场景，很多团队真正想要的并不是完整 Kibana，而是：

- 一块可写 DSL 的编辑器
- 一套路径和 Body 自动补全能力
- 一个请求执行入口
- 一个结果展示面板

如果为了这些核心能力而整体接入 Kibana，往往要额外处理：

- 平台接入适配
- 菜单和路由整合
- 登录与权限打通
- 安全控制和访问隔离
- 长期维护与升级成本

`dsl-kibana` 的价值就在这里：它把最核心的 DSL 控制台能力剥离出来，让你可以更低成本地把这部分能力嵌入公司自有平台。

## 更适合二次开发的原因

项目源码结构相对清晰，核心能力已经拆分：

- `src/App.vue`: 页面与主流程控制
- `src/kibanaConsoleParser.js`: 多请求块解析
- `src/requestExecution.js`: 请求执行与取消控制
- `src/kibanaConsoleAutocomplete.js`: 编辑器补全适配层
- `src/kibanaConsoleAutocompleteCore.js`: 补全规则核心算法

这让你更容易：

- 改造界面风格以适配公司平台
- 对接内部权限体系和审计逻辑
- 替换请求网关或代理层
- 增加企业自定义接口和补全规则
- 封装成内部平台组件或页面模块

## 仓库说明

- [SOURCE_CODE_GUIDE.md](./SOURCE_CODE_GUIDE.md): 源码导读
- [PROMOTION_USAGE_GUIDE.md](./PROMOTION_USAGE_GUIDE.md): 对外传播使用说明书

## Star 支持

如果这个项目对你有帮助，欢迎点一个 Star。

如果你也在做 Elasticsearch 工具平台、企业内部控制台或搜索研发基础设施建设，也欢迎交流。
