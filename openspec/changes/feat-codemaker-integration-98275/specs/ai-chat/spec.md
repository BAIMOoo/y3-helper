## ADDED Requirements

### Requirement: AI对话界面入口
用户 SHALL 能够通过 Y3Helper 侧边栏菜单中的「AI助手」节点打开对话界面。

#### Scenario: 用户点击AI助手菜单
- **GIVEN** Y3Helper 扩展已激活
- **WHEN** 用户点击 Y3Helper 菜单中的「AI助手」节点
- **THEN** 在编辑器区域打开一个新的 WebView 标签页
- **THEN** 标签页标题显示「AI助手」
- **THEN** 如果已存在打开的 AI助手标签页，则聚焦到该标签页

### Requirement: 对话消息发送
用户 SHALL 能够在对话界面中输入消息并发送给 AI。

#### Scenario: 用户发送消息
- **GIVEN** AI助手对话界面已打开
- **WHEN** 用户在输入框中输入消息并按回车或点击发送按钮
- **THEN** 消息显示在对话历史中
- **THEN** 界面显示加载状态
- **THEN** AI 响应以流式方式逐字显示

### Requirement: 流式响应展示
系统 SHALL 支持 SSE (Server-Sent Events) 流式响应的实时展示。

#### Scenario: 接收流式响应
- **GIVEN** 用户已发送消息
- **WHEN** AI 服务返回流式响应
- **THEN** 响应内容实时逐字追加显示
- **THEN** 代码块支持语法高亮
- **THEN** Markdown 内容正确渲染

### Requirement: 对话历史管理
用户 SHALL 能够查看和管理对话历史记录。

#### Scenario: 查看历史记录
- **WHEN** 用户点击历史记录按钮
- **THEN** 显示历史对话列表
- **THEN** 用户可以选择加载某条历史记录

#### Scenario: 新建对话
- **WHEN** 用户点击新建对话按钮
- **THEN** 清空当前对话内容
- **THEN** 开始新的对话会话

### Requirement: 模型选择
用户 SHALL 能够选择不同的 AI 模型进行对话。

#### Scenario: 切换AI模型
- **WHEN** 用户点击模型选择器
- **THEN** 显示可用模型列表
- **WHEN** 用户选择某个模型
- **THEN** 后续对话使用选中的模型

### Requirement: Mock 模式支持
系统 SHALL 在未配置真实 AI 服务时自动启用 Mock 模式。

#### Scenario: Mock模式响应
- **GIVEN** 未配置 `y3-helper.ai.serverUrl`
- **WHEN** 用户发送消息
- **THEN** 系统返回固定响应「这是 Mock 响应，请配置真实 AI 服务后使用。」
- **THEN** 响应以流式方式显示（模拟真实体验）

### Requirement: 代码操作支持
用户 SHALL 能够对 AI 响应中的代码块执行操作。

#### Scenario: 复制代码
- **WHEN** 用户点击代码块的复制按钮
- **THEN** 代码内容复制到剪贴板

#### Scenario: 插入代码到编辑器
- **WHEN** 用户点击代码块的插入按钮
- **THEN** 代码插入到当前活动编辑器的光标位置

#### Scenario: 应用代码差异
- **WHEN** AI 响应包含代码修改建议
- **THEN** 用户可以预览差异
- **THEN** 用户可以一键应用修改
