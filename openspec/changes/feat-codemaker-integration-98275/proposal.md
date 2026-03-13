## Why

[#98275](https://up1.pm.netease.com/v6/issues/98275)

Y3Helper 目前是 Y3 游戏编辑器的开发辅助工具，提供物编支持、游戏调试、ECA编译等功能。为了提升开发者的 AI 辅助编程体验，需要将 CodeMaker 源码版的功能集成到 Y3Helper 中，使所有 Y3Helper 用户都能直接使用 AI 编程助手功能，无需安装额外插件。

**参考代码库**: `H:\CodemakerOpenSource`

## What Changes

### 核心功能集成
- **AI 对话界面** - 流式输出的 Chat 界面，支持 Agent 模式
- **代码补全** - 行内智能补全建议（InlineCompletionItemProvider）
- **MCP 支持** - Model Context Protocol 工具调用（stdio / SSE / HTTP）
- **代码审查** - AI 辅助 Code Review
- **自定义规则** - 支持 `.codemaker/rules/` 目录下的 MDC 规则文件
- **自定义技能** - 可扩展的 Skill 系统

### 架构集成
- 将 CodeMaker 的 WebView（React 18 + Chakra UI）集成到 Y3Helper
- 整合两个扩展的命令系统
- 合并 package.json 的 contributes 配置
- 统一依赖管理

### 后端服务
- **BREAKING**: 需要配置 AI 服务后端（Mock Server 或真实 AI API）

## Capabilities

### New Capabilities
- `ai-chat`: AI 对话界面，支持流式输出和 Agent 模式
- `inline-completion`: 行内代码智能补全
- `mcp-integration`: MCP 协议支持，工具调用能力
- `code-review`: AI 辅助代码审查
- `rules-system`: 自定义规则系统（.codemaker/rules/）
- `skills-system`: 可扩展的技能系统

### Modified Capabilities
<!-- Y3Helper 现有功能暂不修改 -->

## Impact

### 代码影响
- `src/` - 新增 CodeMaker 相关模块
- `package.json` - 大量新增命令、配置、视图贡献点
- `webpack.config.js` - 需要支持 React WebView 构建

### 依赖影响
- 新增 React 18、Chakra UI、Zustand 等前端依赖
- 新增 tree-sitter（WASM）用于语法解析
- 新增 eventsource-parser 用于 SSE 解析

### 用户影响
- 用户需要配置 AI 服务端点（或使用内置 Mock）
- 新增侧边栏图标和快捷键
- 新增设置项用于配置 AI 功能
