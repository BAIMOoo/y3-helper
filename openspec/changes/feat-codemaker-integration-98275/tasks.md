## Phase 1: 项目基础设施

### 1.1 代码目录结构搭建
- [ ] 创建 `src/codemaker/` 目录
- [ ] 创建子目录：`commands/`, `handlers/`, `provider/`, `http/`, `utils/`
- [ ] 创建 `src/webview-ui/` 目录用于 React WebView

### 1.2 依赖安装
- [ ] 安装 React 18 相关依赖：`react`, `react-dom`
- [ ] 安装 UI 框架：`@chakra-ui/react`, `@emotion/react`, `@emotion/styled`
- [ ] 安装状态管理：`zustand`
- [ ] 安装构建工具：`vite`, `@vitejs/plugin-react`
- [ ] 安装网络请求：`axios`, `eventsource-parser`

### 1.3 构建配置
- [ ] 创建 `src/webview-ui/vite.config.ts` 配置 WebView 构建
- [ ] 修改 `webpack.config.js` 添加 `src/codemaker/` 入口
- [ ] 添加 `copy-webpack-plugin` 配置复制 WebView 静态资源到 `dist/webview/`
- [ ] 在 `package.json` 中添加 `build:webview` 脚本
- [ ] 更新 `npm run compile` 命令，先构建 WebView 再构建 Extension

---

## Phase 2: CodeMaker Extension 代码迁移

### 2.1 HTTP 请求层
- [ ] 迁移 `packages/extension/src/http/` 到 `src/codemaker/http/`
- [ ] 创建 `mockInterceptor.ts` 实现内嵌 Mock 逻辑
- [ ] 修改 `configures.ts` 支持 `y3-helper.ai.serverUrl` 配置项

### 2.2 Provider 迁移
- [ ] 迁移 `webviewProvider/` 到 `src/codemaker/provider/webviewProvider/`
- [ ] 修改 `openWebviewPanel()` 方法，适配本地 WebView 资源路径
- [ ] 迁移 `inlineCompletionItemProvider/` 到 `src/codemaker/provider/`

### 2.3 Handlers 迁移
- [ ] 迁移 `mcpHandlers/` 到 `src/codemaker/handlers/mcpHandlers/`
- [ ] 迁移 `rulesHandler/` 到 `src/codemaker/handlers/rulesHandler/`
- [ ] 迁移 `skillsHandler/` 到 `src/codemaker/handlers/skillsHandler/`
- [ ] 迁移其他必要的 handlers（`logHandler`, `accessTokenHandler` 等）

### 2.4 Commands 迁移
- [ ] 迁移命令注册代码到 `src/codemaker/commands/`
- [ ] 修改命令前缀，添加 `y3-helper.ai.` 别名

### 2.5 Utils 迁移
- [ ] 迁移必要的工具函数到 `src/codemaker/utils/`
- [ ] 处理路径别名 `@/` 到相对路径的转换

### 2.6 入口文件
- [ ] 创建 `src/codemaker/extension.ts` 作为 CodeMaker 初始化入口
- [ ] 在 Y3Helper 主 `extension.ts` 中调用 CodeMaker 初始化

---

## Phase 3: WebView 迁移

### 3.1 React 代码迁移
- [ ] 迁移 `packages/webview/src/` 到 `src/webview-ui/src/`
- [ ] 修改 API 请求地址配置，支持 Mock 模式
- [ ] 调整 Chakra UI 主题配置

### 3.2 构建验证
- [ ] 运行 `npm run build:webview` 验证 WebView 构建成功
- [ ] 验证产出文件位于 `src/webview-ui/dist/`
- [ ] 验证 Webpack 正确复制到 `dist/webview/`

### 3.3 WebView 通信
- [ ] 验证 Extension ↔ WebView 的 postMessage 通信正常
- [ ] 验证 WebView 中 `acquireVsCodeApi()` 正常工作

---

## Phase 4: Y3Helper 集成

### 4.1 菜单入口
- [ ] 创建 `src/mainMenu/pages/aiAssistant.ts` AI助手节点
- [ ] 在 `mainMenu.ts` 中注册 AI助手节点
- [ ] 注册命令 `y3-helper.ai.openPanel`

### 4.2 package.json 配置
- [ ] 添加 `y3-helper.ai.openPanel` 命令声明
- [ ] 添加 `y3-helper.ai.serverUrl` 配置项
- [ ] 添加 `y3-helper.ai.apiKey` 配置项
- [ ] 添加 `y3-helper.ai.completionDelay` 配置项

### 4.3 快捷键绑定
- [ ] 配置代码补全快捷键 `Alt+\`
- [ ] 配置打开 AI 对话快捷键（可选）

---

## Phase 5: 功能验证

### 5.1 AI 对话功能
- [ ] F5 启动扩展，点击「AI助手」菜单
- [ ] 验证 WebView 面板在编辑器区域打开
- [ ] 验证 Mock 模式下发送消息收到固定响应
- [ ] 验证历史记录功能
- [ ] 验证模型选择 UI

### 5.2 代码补全功能
- [ ] 验证编辑代码时触发补全建议
- [ ] 验证 Tab 键接受补全
- [ ] 验证 Mock 模式下的补全响应

### 5.3 MCP 功能
- [ ] 创建测试用 `.codemaker/mcp.json` 配置
- [ ] 验证 MCP 连接状态显示
- [ ] 验证工具列表展示

### 5.4 规则和技能系统
- [ ] 创建测试用 `.codemaker/rules/test.md`
- [ ] 验证规则加载和热更新
- [ ] 创建测试用 `.codemaker/skills/test.md`
- [ ] 验证 Skill 加载和触发

---

## Phase 6: 打包发布准备

### 6.1 清理和优化
- [ ] 移除未使用的依赖
- [ ] 检查 `.vscodeignore` 排除不必要文件
- [ ] 验证打包后体积在合理范围

### 6.2 文档更新
- [ ] 更新 README.md 添加 AI 功能说明
- [ ] 添加配置项文档
- [ ] 添加常见问题说明

### 6.3 最终验证
- [ ] 运行 `vsce package` 打包
- [ ] 在新的 VSCode 窗口中安装测试
- [ ] 验证所有功能正常工作
