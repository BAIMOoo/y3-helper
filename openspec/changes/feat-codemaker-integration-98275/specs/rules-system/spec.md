## ADDED Requirements

### Requirement: 规则文件加载
系统 SHALL 自动加载项目中的规则文件。

#### Scenario: 加载规则文件
- **GIVEN** 项目根目录存在 `.codemaker/rules/` 目录
- **WHEN** 扩展激活或规则文件变更
- **THEN** 自动读取并解析所有 `.md` 规则文件
- **THEN** 规则内容注入到 AI 对话的系统提示中

### Requirement: 规则文件格式
系统 SHALL 支持 Markdown 格式的规则文件。

#### Scenario: 解析规则文件
- **GIVEN** 规则文件为 `.md` 格式
- **WHEN** 系统解析规则文件
- **THEN** 提取文件中的规则内容
- **THEN** 支持 frontmatter 元数据（如 `name`, `description`）

### Requirement: 规则优先级
系统 SHALL 支持规则的优先级配置。

#### Scenario: 多规则合并
- **GIVEN** 存在多个规则文件
- **WHEN** 构建 AI 提示时
- **THEN** 按文件名或配置的优先级顺序合并规则

### Requirement: 规则热更新
系统 SHALL 支持规则文件的热更新。

#### Scenario: 规则变更
- **GIVEN** 规则文件已加载
- **WHEN** 用户修改规则文件内容
- **THEN** 系统自动重新加载规则
- **THEN** 新规则立即生效于后续对话

### Requirement: 规则目录结构
系统 SHALL 支持嵌套的规则目录结构。

#### Scenario: 子目录规则
- **GIVEN** 规则存放在 `.codemaker/rules/subdir/rule.md`
- **WHEN** 系统扫描规则
- **THEN** 递归加载所有子目录中的规则文件
