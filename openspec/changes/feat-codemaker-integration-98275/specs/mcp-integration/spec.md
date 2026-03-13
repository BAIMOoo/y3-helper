## ADDED Requirements

### Requirement: MCP 服务器连接
系统 SHALL 支持连接 MCP (Model Context Protocol) 服务器。

#### Scenario: 配置 stdio MCP 服务器
- **GIVEN** 用户在 `.codemaker/mcp.json` 中配置了 stdio 类型的 MCP 服务器
- **WHEN** 扩展激活
- **THEN** 自动启动并连接到配置的 MCP 服务器

#### Scenario: 配置 SSE MCP 服务器
- **GIVEN** 用户配置了 SSE 类型的 MCP 服务器 URL
- **WHEN** 扩展激活
- **THEN** 通过 SSE 连接到 MCP 服务器

### Requirement: MCP 工具调用
系统 SHALL 支持在对话中调用 MCP 提供的工具。

#### Scenario: AI 调用 MCP 工具
- **GIVEN** MCP 服务器提供了某个工具（如 redmine 查询）
- **WHEN** AI 决定需要调用该工具
- **THEN** 系统自动执行工具调用
- **THEN** 将工具返回结果反馈给 AI 继续对话

### Requirement: MCP 工具列表展示
用户 SHALL 能够查看当前可用的 MCP 工具列表。

#### Scenario: 查看工具列表
- **WHEN** 用户在对话界面中查看可用工具
- **THEN** 显示所有已连接 MCP 服务器提供的工具
- **THEN** 每个工具显示名称和描述

### Requirement: MCP 连接状态
系统 SHALL 显示 MCP 服务器的连接状态。

#### Scenario: 连接成功
- **WHEN** MCP 服务器连接成功
- **THEN** 状态栏或界面显示连接成功标识

#### Scenario: 连接失败
- **WHEN** MCP 服务器连接失败
- **THEN** 显示错误信息
- **THEN** 提供重试选项

### Requirement: MCP 配置文件支持
系统 SHALL 读取项目中的 MCP 配置文件。

#### Scenario: 读取配置
- **GIVEN** 项目根目录存在 `.codemaker/mcp.json`
- **WHEN** 扩展激活或配置文件变更
- **THEN** 自动解析配置并连接 MCP 服务器
