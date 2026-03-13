## ADDED Requirements

### Requirement: Skill 文件加载
系统 SHALL 自动加载项目中的 Skill 文件。

#### Scenario: 加载 Skill 文件
- **GIVEN** 项目根目录存在 `.codemaker/skills/` 目录
- **WHEN** 扩展激活或 Skill 文件变更
- **THEN** 自动读取并解析所有 `.md` Skill 文件
- **THEN** Skill 可在对话中被调用

### Requirement: Skill 文件格式
系统 SHALL 支持 Markdown 格式的 Skill 定义文件。

#### Scenario: 解析 Skill 文件
- **GIVEN** Skill 文件包含 frontmatter 元数据
- **WHEN** 系统解析 Skill 文件
- **THEN** 提取 `name`, `description` 等元数据
- **THEN** 提取 Skill 的执行指令和模板

### Requirement: Skill 触发
系统 SHALL 支持通过关键词或命令触发 Skill。

#### Scenario: 关键词触发
- **GIVEN** Skill 定义了触发关键词（如 `description` 中的描述）
- **WHEN** 用户消息匹配 Skill 描述
- **THEN** AI 自动调用对应的 Skill

#### Scenario: 命令触发
- **WHEN** 用户使用 `use_skill` 工具指定 Skill 名称
- **THEN** 加载并执行对应的 Skill 指令

### Requirement: Skill 列表展示
用户 SHALL 能够查看当前可用的 Skill 列表。

#### Scenario: 查看 Skill 列表
- **WHEN** 用户请求查看可用 Skill
- **THEN** 显示所有已加载的 Skill
- **THEN** 每个 Skill 显示名称和描述

### Requirement: Skill 热更新
系统 SHALL 支持 Skill 文件的热更新。

#### Scenario: Skill 变更
- **GIVEN** Skill 文件已加载
- **WHEN** 用户修改 Skill 文件内容
- **THEN** 系统自动重新加载 Skill
- **THEN** 新 Skill 内容立即生效

### Requirement: 内置 Skill
系统 SHALL 提供一组内置的常用 Skill。

#### Scenario: 使用内置 Skill
- **GIVEN** 系统内置了 `brainstorming`, `debugging` 等 Skill
- **WHEN** 用户请求使用这些 Skill
- **THEN** 可以直接调用，无需用户额外配置
