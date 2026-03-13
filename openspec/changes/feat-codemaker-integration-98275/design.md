## Context

Y3Helper 是基于 webpack 构建的 VSCode 扩展，主要提供 Y3 游戏编辑器的开发辅助功能。CodeMaker 源码版是基于 pnpm monorepo + esbuild 的 AI 编程助手，包含 extension、webview、mock-server 三个包。

**集成目标**：将 CodeMaker 的 AI 功能完整集成到 Y3Helper 中，作为 Y3Helper 的内置功能模块。

### 现有架构对比

| 项目 | Y3Helper | CodeMaker |
|------|----------|-----------|
| 构建工具 | webpack | esbuild |
| 包管理 | npm | pnpm workspaces |
| WebView | 原生 HTML | React 18 + Chakra UI |
| 状态管理 | - | Zustand |
| 入口文件 | dist/extension.js | out/extension.js |

## Goals / Non-Goals

**Goals:**
- 将 CodeMaker 的 6 大功能模块集成到 Y3Helper
- 保持 Y3Helper 现有功能不受影响
- 统一构建流程，使用单一命令完成打包
- 用户安装 Y3Helper 后即可使用 AI 功能

**Non-Goals:**
- 不重写 CodeMaker 的核心逻辑，尽量复用现有代码
- 不修改 CodeMaker 的 WebView 技术栈
- 本阶段不实现自定义 AI 服务端配置界面

## Decisions

### Decision 1: 代码组织结构

**选择**：在 `src/` 下创建 `codemaker/` 目录，整体迁移 CodeMaker extension 代码

**目录结构**：
```
src/
├── codemaker/                    # CodeMaker 功能模块
│   ├── extension.ts              # CodeMaker 初始化入口
│   ├── commands/                 # 命令注册
│   ├── handlers/                 # 事件处理
│   │   ├── mcpHandlers/          # MCP 协议
│   │   ├── rulesHandler/         # 规则系统
│   │   └── skillsHandler/        # 技能系统
│   ├── provider/                 # Provider
│   │   ├── inlineCompletionItemProvider/  # 代码补全
│   │   └── webviewProvider/      # WebView
│   ├── http/                     # HTTP 请求
│   └── utils/                    # 工具函数
├── webview-ui/                   # React WebView 源码
│   ├── src/                      # 从 CodeMaker webview 迁移
│   └── vite.config.ts
└── ... (Y3Helper 现有代码)
```

**理由**：
- 模块化隔离，便于维护
- 保持 CodeMaker 代码的内聚性
- 易于追踪上游更新

### Decision 2: 构建配置

**选择**：混合构建策略

```
┌─────────────────────────────────────────────────────────────┐
│                     构建流程                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │   Vite      │    │   Webpack   │    │   输出      │    │
│  │ (WebView)   │───►│ (Extension) │───►│  dist/      │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│        │                   │                               │
│        ▼                   ▼                               │
│  webview-ui/dist/    extension.js                         │
│  (静态资源)          (主扩展)                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**构建步骤**：
1. `npm run build:webview` - Vite 构建 React WebView → `webview-ui/dist/`
2. `npm run compile` - Webpack 打包扩展 → `dist/extension.js`
3. WebView HTML 引用预构建的 JS/CSS 文件

**理由**：
- 保持 Y3Helper 现有的 webpack 构建流程
- 单独构建 WebView 避免 webpack 配置复杂化
- 预构建的 WebView 可以内联到扩展中

### Decision 3: WebView 集成方式

**选择**：预构建 + 内联资源

**实现**：
1. Vite 构建 WebView 到 `webview-ui/dist/`
2. Webpack 将 `webview-ui/dist/` 作为静态资源复制到 `dist/webview/`
3. WebviewProvider 读取本地 HTML/JS/CSS 文件

**代码示例**：
```typescript
// src/codemaker/provider/webviewProvider/index.ts
function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const webviewUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.js')
    );
    return `<!DOCTYPE html>
    <html>
    <head>
        <script type="module" src="${webviewUri}"></script>
    </head>
    <body>
        <div id="root"></div>
    </body>
    </html>`;
}
```

**理由**：
- 无需开发服务器，生产环境可直接使用
- 资源内联确保离线可用
- 与 Y3Helper 现有资源管理方式一致

### Decision 4: 命令前缀策略

**选择**：保持 `codemaker.` 前缀，同时添加 `y3-helper.ai.` 别名

**示例**：
```json
{
    "commands": [
        { "command": "codemaker.chat", "title": "CodeMaker: 打开对话" },
        { "command": "y3-helper.ai.chat", "title": "Y3助手: AI对话" }
    ]
}
```

**理由**：
- 保持 CodeMaker 命令兼容性
- 为 Y3Helper 用户提供统一的命名空间
- 支持快捷键绑定到任一命令

### Decision 5: AI 服务配置

**选择**：内嵌轻量 Mock + 配置项切换真实服务

**Mock 实现方式**：
- **不启动独立 Mock Server** - 无需子进程管理
- **内嵌 axios 拦截器** - 在请求层直接返回固定响应
- **固定回复** - Mock 模式下统一返回 "这是 Mock 响应，请配置真实 AI 服务后使用。"

**实现示意**：
```typescript
// src/codemaker/http/mockInterceptor.ts
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (isMockMode && error.code === 'ECONNREFUSED') {
      return Promise.resolve({
        data: { content: '这是 Mock 响应，请配置真实 AI 服务后使用。' }
      });
    }
    return Promise.reject(error);
  }
);
```

**配置项**：
```json
{
    "y3-helper.ai.serverUrl": {
        "type": "string",
        "default": "",
        "description": "AI 服务地址（留空使用内置 Mock）"
    },
    "y3-helper.ai.apiKey": {
        "type": "string",
        "default": "",
        "description": "API Key（如需要）"
    }
}
```

**工作模式**：
```
┌─────────────────────────────────────────────────────────────┐
│  启动时判断:                                                │
│                                                             │
│  serverUrl 为空?                                            │
│      ├── 是 → Mock 模式 (固定回复)                         │
│      └── 否 → 真实服务模式 (HTTP 请求到配置的 URL)         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**理由**：
- F5 启动即可使用，无需额外服务
- Mock 逻辑极简，不增加包体积
- 生产环境配置真实服务后无缝切换
- 符合 VSCode 扩展的配置习惯

### Decision 6: AI助手入口方式

**选择**：在 Y3Helper 菜单中添加入口，点击后在编辑器区域打开 WebView 面板（标签页形式）

**用户体验**：
```
┌────┬───────────────────────────────────────────────────────────────┐
│ Y3 │  ┌──────────────────┐  ┌─────────────────────────────────┐   │
│    │  │ Y3Helper 主菜单  │  │ 🤖 AI助手                    × │   │
│    │  │ ├── 功能        │  ├─────────────────────────────────┤   │
│    │  │ ├── 地图管理    │  │                                 │   │
│    │  │ ├── 插件列表    │  │   CodeMaker 对话界面           │   │
│    │  │ └── 🤖 AI助手 ──┼──►  (React WebView)               │   │
│    │  │                  │  │                                 │   │
│    │  └──────────────────┘  └─────────────────────────────────┘   │
└────┴───────────────────────────────────────────────────────────────┘
```

**实现方式**：
```typescript
// src/mainMenu/pages/aiAssistant.ts
export class AI助手 extends TreeNode {
    constructor() {
        super(l10n.t('AI助手'), {
            iconPath: new vscode.ThemeIcon('hubot'),
            command: {
                command: 'y3-helper.ai.openPanel',
                title: l10n.t('打开AI助手'),
            },
        });
    }
}

// 命令实现：调用 CodeMaker 的 openWebviewPanel
vscode.commands.registerCommand('y3-helper.ai.openPanel', () => {
    webviewProvider.openWebviewPanel(vscode.ViewColumn.One);
});
```

**优势**：
- 在编辑器区域打开，像普通标签页一样
- 可以和代码文件并排查看
- 可以拖动到任意位置
- 复用 CodeMaker 现有的 `openWebviewPanel` 实现
- 符合 Y3Helper 插件的交互风格

**package.json 配置**：
```json
{
    "contributes": {
        "commands": [{
            "command": "y3-helper.ai.openPanel",
            "title": "Y3助手: 打开AI对话",
            "icon": "$(hubot)"
        }]
    }
}
```

## Risks / Trade-offs

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 包体积显著增大 | 下载和加载变慢 | 延迟加载 CodeMaker 模块 |
| React 依赖冲突 | 构建失败 | WebView 独立构建 |
| 上游 CodeMaker 更新 | 难以同步 | 保持目录结构一致，定期合并 |
| Mock Server 无法发布 | 用户无法使用 | 提供远程 Mock 或引导配置真实服务 |

## Open Questions

- [x] ~~是否需要将 Mock Server 作为独立进程启动？~~ → **已决定：内嵌 axios 拦截器，无需独立进程**
- [x] ~~是否需要支持切换 AI 模型？~~ → **已确认：需要支持，复用 CodeMaker 源码版自带的模型切换功能**
- [ ] 代码补全功能是否会与 Y3Helper 现有的 Lua 补全冲突？ → **待验证，先搁置**
