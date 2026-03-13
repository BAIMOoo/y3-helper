## ADDED Requirements

### Requirement: 代码审查触发
用户 SHALL 能够对选中的代码或文件发起 AI 代码审查。

#### Scenario: 审查选中代码
- **GIVEN** 用户在编辑器中选中了一段代码
- **WHEN** 用户通过右键菜单选择「AI 代码审查」
- **THEN** 将选中代码发送给 AI 进行审查
- **THEN** 在对话界面中显示审查结果

#### Scenario: 审查当前文件
- **WHEN** 用户通过命令面板执行「Y3助手: 审查当前文件」
- **THEN** 将整个文件内容发送给 AI 审查
- **THEN** 显示审查结果和改进建议

### Requirement: 审查结果展示
系统 SHALL 以结构化方式展示代码审查结果。

#### Scenario: 显示问题列表
- **WHEN** AI 返回审查结果
- **THEN** 以列表形式显示发现的问题
- **THEN** 每个问题包含：问题描述、严重程度、建议修复

#### Scenario: 定位问题代码
- **WHEN** 用户点击某个问题
- **THEN** 编辑器自动跳转到对应的代码位置
- **THEN** 高亮显示问题代码行

### Requirement: 一键修复
用户 SHALL 能够一键应用 AI 建议的修复方案。

#### Scenario: 应用修复
- **GIVEN** 审查结果中包含修复建议
- **WHEN** 用户点击「应用修复」按钮
- **THEN** 自动将修复后的代码应用到编辑器
- **THEN** 用户可以撤销修改

### Requirement: 差异对比
系统 SHALL 支持修复前后的差异对比预览。

#### Scenario: 预览差异
- **WHEN** 用户点击「预览修复」
- **THEN** 以 diff 视图显示原代码和修复后代码的差异
- **THEN** 用户可以选择接受或拒绝修改
