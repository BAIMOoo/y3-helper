## ADDED Requirements

### Requirement: 行内代码补全触发
系统 SHALL 在用户编写代码时自动触发智能补全建议。

#### Scenario: 自动触发补全
- **GIVEN** 用户正在编辑代码文件
- **WHEN** 用户停止输入达到配置的延迟时间（默认 0.3 秒）
- **THEN** 系统分析当前代码上下文
- **THEN** 以灰色文字显示补全建议

### Requirement: 补全建议接受
用户 SHALL 能够通过快捷键接受补全建议。

#### Scenario: 接受完整建议
- **GIVEN** 界面显示补全建议
- **WHEN** 用户按 Tab 键
- **THEN** 补全内容插入到编辑器

#### Scenario: 接受部分建议（按词）
- **GIVEN** 界面显示补全建议
- **WHEN** 用户按 Ctrl+Right（或配置的快捷键）
- **THEN** 插入建议的下一个单词

#### Scenario: 拒绝建议
- **GIVEN** 界面显示补全建议
- **WHEN** 用户按 Escape 或继续输入其他内容
- **THEN** 补全建议消失

### Requirement: 手动触发补全
用户 SHALL 能够手动触发代码补全。

#### Scenario: 快捷键触发
- **WHEN** 用户按 Alt+\ （或配置的快捷键）
- **THEN** 立即请求并显示补全建议

### Requirement: 补全延迟配置
用户 SHALL 能够配置补全触发的延迟时间。

#### Scenario: 调整延迟
- **GIVEN** 用户在设置中修改 `y3-helper.ai.completionDelay`
- **WHEN** 用户编写代码
- **THEN** 按照新的延迟时间触发补全

### Requirement: 多行补全支持
系统 SHALL 支持多行代码的补全建议。

#### Scenario: 显示多行建议
- **WHEN** AI 返回多行补全建议
- **THEN** 所有行以灰色预览形式显示
- **THEN** 用户可以一次性接受所有行

### Requirement: Mock 模式补全
系统 SHALL 在 Mock 模式下提供简单的补全响应。

#### Scenario: Mock补全响应
- **GIVEN** 未配置真实 AI 服务
- **WHEN** 触发代码补全
- **THEN** 返回固定的示例补全（如 `// TODO: 实现此功能`）
