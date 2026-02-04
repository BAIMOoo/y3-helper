# Y3-Helper MCP Server 实现方案

## 1. 概述

本文档详细描述了在 y3-helper VSCode 扩展中集成 MCP (Model Context Protocol) Server 的完整实现方案。通过 MCP Server，Claude Code 可以自动化地启动游戏、获取日志、执行 Lua 代码，实现完整的开发-测试-调试闭环。

### 1.1 目标

- 让 Claude Code 能够自动启动 Y3 游戏
- 自动捕获游戏运行日志
- 支持在运行时执行 Lua 代码进行测试
- 实现完整的自动化开发流程

### 1.2 架构概览

```
MCPServer (主控制器)
├── StdioTransport (stdio 通信层)
├── MCPProtocol (JSON-RPC 协议处理)
├── ToolRegistry (工具注册表)
│   ├── launch_game (启动游戏)
│   ├── get_logs (获取日志)
│   ├── execute_lua (执行 Lua 代码)
│   └── stop_game (停止游戏)
└── GameSessionManager (游戏会话管理)
    └── 复用现有组件：GameLauncher、ConsoleServer、Client
```

## 2. 目录结构

```
src/
├── mcp/
│   ├── index.ts                 # MCP 模块导出
│   ├── server.ts                # MCP Server 核心实现
│   ├── transport.ts             # Stdio 传输层
│   ├── protocol.ts              # MCP 协议处理器
│   ├── gameSession.ts           # 游戏会话管理器
│   ├── logger.ts                # MCP 日志工具
│   ├── types.ts                 # 类型定义
│   └── tools/
│       ├── index.ts             # 工具注册表
│       ├── launchGame.ts        # launch_game 工具
│       ├── getLogs.ts           # get_logs 工具
│       ├── executeLua.ts        # execute_lua 工具
│       └── stopGame.ts          # stop_game 工具
├── extension.ts                 # 修改以初始化 MCP
└── ... (现有文件)
```

## 3. 核心组件设计

### 3.1 MCP Server (`src/mcp/server.ts`)

**职责**：
- 作为 MCP Server 的主入口
- 协调各个子组件
- 管理生命周期

**接口**：
```typescript
export class MCPServer extends vscode.Disposable {
    private transport: StdioTransport;
    private protocol: MCPProtocol;
    private toolRegistry: ToolRegistry;
    private sessionManager: GameSessionManager;

    constructor();
    async start(): Promise<void>;
    dispose(): void;
}
```

**实现要点**：
- 继承 `vscode.Disposable` 确保资源正确释放
- 按顺序初始化各个组件
- 启动 stdio 传输层

### 3.2 Game Session Manager (`src/mcp/gameSession.ts`)

**职责**：
- 管理游戏会话生命周期
- 自动捕获游戏日志
- 执行 Lua 代码
- 监控游戏状态

**核心数据结构**：
```typescript
export interface GameSession {
    id: string;                    // 会话唯一标识
    launcher: GameLauncher;        // 游戏启动器实例
    client?: Client;               // 游戏客户端连接
    logs: string[];                // 日志缓存
    status: 'launching' | 'running' | 'stopped';
    startTime: number;             // 启动时间戳
}
```

**关键方法**：
```typescript
export class GameSessionManager extends vscode.Disposable {
    // 启动游戏并创建会话
    async launchGame(options: LaunchOptions): Promise<GameSession>;

    // 获取当前会话
    getCurrentSession(): GameSession | undefined;

    // 获取指定会话
    getSession(id: string): GameSession | undefined;

    // 获取日志
    getLogs(sessionId?: string, limit?: number): string[];

    // 执行 Lua 代码
    async executeLua(code: string): Promise<string>;

    // 停止游戏
    async stopGame(sessionId?: string): Promise<void>;
}
```

**日志捕获机制**：
```typescript
private attachClient(session: GameSession, client: Client): void {
    session.client = client;
    session.status = 'running';

    // 拦截 print 方法捕获日志
    const originalPrint = client.print.bind(client);
    client.print = (msg: string) => {
        this.addLog(session, msg);  // 保存到会话日志
        return originalPrint(msg);   // 继续原有逻辑
    };
}
```

**Client 监控机制**：
```typescript
private setupClientMonitoring(): void {
    // 每 500ms 检查是否有新的客户端连接
    setInterval(() => {
        if (this.currentSession && !this.currentSession.client) {
            const client = Client.allClients[Client.allClients.length - 1];
            if (client) {
                this.attachClient(this.currentSession, client);
            }
        }
    }, 500);
}
```

### 3.3 MCP Protocol Handler (`src/mcp/protocol.ts`)

**职责**：
- 处理 JSON-RPC 2.0 协议
- 路由请求到对应的处理器
- 格式化响应和错误

**支持的方法**：
- `initialize` - 初始化握手
- `tools/list` - 列出所有可用工具
- `tools/call` - 调用指定工具

**请求/响应格式**：
```typescript
// 请求
interface MCPRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: any;
}

// 响应
interface MCPResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}
```

### 3.4 Stdio Transport (`src/mcp/transport.ts`)

**职责**：
- 通过 stdin/stdout 与 Claude Code 通信
- 解析 JSON-RPC 消息
- 发送响应

**实现要点**：
```typescript
export class StdioTransport {
    async start(): Promise<void> {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        this.rl.on('line', async (line) => {
            const request = JSON.parse(line) as MCPRequest;
            const response = await this.protocol.handleRequest(request);
            this.send(response);
        });
    }

    private send(message: any): void {
        console.log(JSON.stringify(message));
    }
}
```

### 3.5 Tool Registry (`src/mcp/tools/index.ts`)

**职责**：
- 注册所有可用工具
- 分发工具调用
- 验证工具参数

**工具定义**：
```typescript
export interface Tool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

export interface ToolHandler {
    (args: any): Promise<any>;
}
```

## 4. 工具实现

### 4.1 launch_game 工具

**功能**：启动 Y3 游戏并等待连接

**参数**：
```typescript
{
    attach_debugger?: boolean;    // 是否附加调试器
    multi_mode?: boolean;         // 是否多开模式
    multi_players?: number[];     // 多开玩家 ID 列表
    tracy?: boolean;              // 是否启用 Tracy 性能分析
}
```

**返回值**：
```typescript
{
    success: boolean;
    session_id: string;           // 会话 ID
    status: string;               // 会话状态
    message: string;              // 状态消息
}
```

**实现流程**：
1. 构建启动参数（luaArgs、multi、tracy）
2. 调用 `GameLauncher.launch()`
3. 等待游戏连接（最多 30 秒）
4. 返回会话信息

### 4.2 get_logs 工具

**功能**：获取游戏控制台日志

**参数**：
```typescript
{
    session_id?: string;          // 会话 ID（可选，默认当前会话）
    limit?: number;               // 返回最近 N 条日志（默认 100）
}
```

**返回值**：
```typescript
{
    success: boolean;
    log_count: number;            // 日志条数
    logs: string;                 // 日志内容（换行分隔）
}
```

**实现要点**：
- 从 `GameSessionManager` 获取缓存的日志
- 支持限制返回条数
- 自动处理不存在的会话

### 4.3 execute_lua 工具

**功能**：在运行的游戏中执行 Lua 代码

**参数**：
```typescript
{
    code: string;                 // 要执行的 Lua 代码
    session_id?: string;          // 会话 ID（可选）
}
```

**返回值**：
```typescript
{
    success: boolean;
    output: string;               // 执行输出
}
```

**实现流程**：
1. 检查会话是否存在且已连接
2. 记录当前日志数量
3. 通过 `client.notify('command', { data: code })` 发送代码
4. 等待 1 秒收集输出
5. 返回新增的日志作为输出

**限制**：
- 需要游戏已连接
- 超时时间 30 秒
- 输出通过日志捕获（可能不完整）

### 4.4 stop_game 工具

**功能**：停止游戏会话

**参数**：
```typescript
{
    session_id?: string;          // 会话 ID（可选，默认当前会话）
}
```

**返回值**：
```typescript
{
    success: boolean;
    message: string;
}
```

**实现要点**：
- 断开客户端连接
- 更新会话状态为 'stopped'
- 清理当前会话引用

## 5. 与现有代码集成

### 5.1 修改 `src/extension.ts`

```typescript
import * as mcp from './mcp';

class Helper {
    private mcpServer?: mcp.MCPServer;

    private async startMCPServer() {
        // 仅在 MCP 模式下启动
        if (process.env.Y3_HELPER_MCP_MODE === 'true') {
            this.mcpServer = new mcp.MCPServer();
            await this.mcpServer.start();
        }
    }

    public start() {
        // ... 现有代码 ...

        // 启动 MCP Server
        this.startMCPServer();
    }
}
```

### 5.2 MCP 模块导出 (`src/mcp/index.ts`)

```typescript
export { MCPServer } from './server';
export { GameSessionManager } from './gameSession';
export * from './types';
```

## 6. 配置文件

### 6.1 package.json 配置

```json
{
  "name": "y3-helper",
  "scripts": {
    "compile": "webpack --mode none",
    "compile:mcp": "webpack --config webpack.mcp.config.js",
    "watch": "webpack --mode none --watch",
    "watch:mcp": "webpack --config webpack.mcp.config.js --watch"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0"
  }
}
```

### 6.2 Webpack MCP 配置 (`webpack.mcp.config.js`)

```javascript
const path = require('path');

module.exports = {
  target: 'node',
  mode: 'production',
  entry: './src/mcp/server.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'mcp-server.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    plugins: [
      new (require('tsconfig-paths-webpack-plugin'))()
    ]
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: 'ts-loader'
      }
    ]
  }
};
```

### 6.3 Claude Code MCP 配置

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "y3-helper": {
      "command": "node",
      "args": [
        "C:/Users/BAIM/Desktop/y3-helper/dist/mcp-server.js"
      ],
      "env": {
        "Y3_HELPER_MCP_MODE": "true"
      }
    }
  }
}
```

## 7. 数据流

### 7.1 完整数据流图

```
Claude Code
    ↓ (stdin/stdout, JSON-RPC)
StdioTransport
    ↓ (解析 JSON)
MCPProtocol
    ↓ (路由请求)
ToolRegistry
    ↓ (调用工具)
Tool Handlers (launch_game, get_logs, etc.)
    ↓ (操作会话)
GameSessionManager
    ↓ (调用现有组件)
GameLauncher / ConsoleServer / Client
    ↓ (启动/通信)
Y3 Game Process
```

### 7.2 启动游戏流程

```
1. Claude Code 发送请求
   → {"jsonrpc":"2.0","id":1,"method":"tools/call",
      "params":{"name":"launch_game","arguments":{}}}

2. StdioTransport 接收并解析

3. MCPProtocol 路由到 ToolRegistry

4. ToolRegistry 调用 launch_game handler

5. GameSessionManager.launchGame()
   ├─ 创建 GameSession
   ├─ 调用 GameLauncher.launch()
   ├─ 等待 Client 连接
   └─ 拦截 Client.print() 捕获日志

6. 返回响应
   ← {"jsonrpc":"2.0","id":1,"result":{
      "content":[{"type":"text","text":"{\"success\":true,...}"}]}}
```

### 7.3 获取日志流程

```
1. 游戏运行时，Client.print() 被调用
   → 日志自动保存到 GameSession.logs[]

2. Claude Code 请求日志
   → {"method":"tools/call","params":{"name":"get_logs"}}

3. GameSessionManager.getLogs()
   → 从内存缓存返回日志

4. 返回日志内容
   ← {"result":{"logs":"[INFO] xxx\n[WARN] yyy\n..."}}
```

## 8. 错误处理

### 8.1 错误类型定义

```typescript
// src/mcp/types.ts
export class MCPError extends Error {
    constructor(
        message: string,
        public code: number = -32603,
        public data?: any
    ) {
        super(message);
        this.name = 'MCPError';
    }
}

// 错误码
export enum MCPErrorCode {
    PARSE_ERROR = -32700,
    INVALID_REQUEST = -32600,
    METHOD_NOT_FOUND = -32601,
    INVALID_PARAMS = -32602,
    INTERNAL_ERROR = -32603,

    // 自定义错误码
    GAME_NOT_RUNNING = -32001,
    GAME_LAUNCH_FAILED = -32002,
    LUA_EXECUTION_FAILED = -32003,
    SESSION_NOT_FOUND = -32004,
}
```

### 8.2 错误处理策略

**工具层**：
```typescript
try {
    // 工具逻辑
    const result = await doSomething();
    return { success: true, ...result };
} catch (error) {
    if (error instanceof MCPError) {
        throw error;
    }
    throw new MCPError(
        error instanceof Error ? error.message : String(error),
        MCPErrorCode.INTERNAL_ERROR,
        { originalError: error }
    );
}
```

**协议层**：
```typescript
async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    try {
        // 处理请求
        return { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
        return this.errorResponse(
            request.id,
            error instanceof MCPError ? error.code : -32603,
            error instanceof Error ? error.message : String(error)
        );
    }
}
```

## 9. 日志机制

### 9.1 MCP Logger (`src/mcp/logger.ts`)

```typescript
import * as tools from '../tools';

export class MCPLogger {
    static info(message: string, ...args: any[]): void {
        tools.log.info(`[MCP] ${message}`, ...args);
    }

    static error(message: string, error?: any): void {
        tools.log.error(`[MCP] ${message}`, error);
    }

    static debug(message: string, ...args: any[]): void {
        if (process.env.MCP_DEBUG === 'true') {
            tools.log.info(`[MCP DEBUG] ${message}`, ...args);
        }
    }
}
```

### 9.2 日志使用

```typescript
// 在关键位置添加日志
MCPLogger.info('MCP Server started');
MCPLogger.info('Game session created', { sessionId: session.id });
MCPLogger.error('Failed to launch game', error);
MCPLogger.debug('Received request', request);
```

## 10. 测试策略

### 10.1 手动测试

**测试 MCP Server 基本功能**：
```bash
# 启动 MCP Server
Y3_HELPER_MCP_MODE=true node dist/mcp-server.js

# 发送初始化请求
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node dist/mcp-server.js

# 列出工具
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node dist/mcp-server.js
```

**测试工具调用**：
```bash
# 启动游戏
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"launch_game","arguments":{}}}' | node dist/mcp-server.js

# 获取日志
echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_logs","arguments":{"limit":10}}}' | node dist/mcp-server.js
```

### 10.2 集成测试

使用 Claude Code 进行端到端测试：

1. **测试启动游戏**
   - 要求 Claude 启动游戏
   - 验证游戏成功启动
   - 验证日志被捕获

2. **测试日志获取**
   - 游戏运行时产生日志
   - 要求 Claude 获取日志
   - 验证日志内容正确

3. **测试 Lua 执行**
   - 要求 Claude 执行简单的 Lua 代码（如 `print("test")`）
   - 验证输出被捕获

4. **测试停止游戏**
   - 要求 Claude 停止游戏
   - 验证游戏进程结束

### 10.3 测试检查清单

- [ ] MCP Server 能够正常启动
- [ ] 能够响应 `initialize` 请求
- [ ] 能够列出所有工具
- [ ] `launch_game` 能够启动游戏
- [ ] 游戏连接后日志被自动捕获
- [ ] `get_logs` 能够返回正确的日志
- [ ] `execute_lua` 能够执行代码并返回输出
- [ ] `stop_game` 能够停止游戏
- [ ] 多开模式正常工作
- [ ] 错误处理正确
- [ ] 日志记录完整

## 11. 实现步骤

### 阶段 1：基础框架

1. **创建目录结构**
   - 创建 `src/mcp/` 目录
   - 创建所有必要的文件

2. **实现核心组件**
   - `MCPServer` 类
   - `StdioTransport` 类
   - `MCPProtocol` 类
   - `MCPLogger` 类

3. **集成到扩展**
   - 修改 `src/extension.ts`
   - 添加 MCP 模式检测

4. **配置构建**
   - 创建 `webpack.mcp.config.js`
   - 更新 `package.json` 脚本

### 阶段 2：会话管理

1. **实现 GameSessionManager**
   - 会话创建和管理
   - Client 监控机制
   - 日志拦截和缓存

2. **实现 ToolRegistry**
   - 工具注册机制
   - 工具调用分发

3. **测试基础功能**
   - 手动测试 MCP Server 启动
   - 测试协议通信

### 阶段 3：工具实现

1. **实现 launch_game 工具**
   - 参数处理
   - 游戏启动
   - 连接等待

2. **实现 get_logs 工具**
   - 日志查询
   - 限制处理

3. **实现 execute_lua 工具**
   - Lua 代码执行
   - 输出捕获

4. **实现 stop_game 工具**
   - 游戏停止
   - 资源清理

### 阶段 4：测试和优化

1. **手动测试**
   - 测试每个工具
   - 测试错误场景

2. **集成测试**
   - 配置 Claude Code
   - 端到端测试

3. **优化和修复**
   - 修复发现的问题
   - 性能优化
   - 文档完善

## 12. 依赖安装

```bash
# 安装 MCP SDK
npm install @modelcontextprotocol/sdk

# 安装类型定义（如果需要）
npm install --save-dev @types/node
```

## 13. 使用示例

### 13.1 Claude Code 工作流

```
用户: 帮我实现一个功能，在游戏中显示玩家的金币数量

Claude:
1. 我先启动游戏来测试
   [调用 launch_game 工具]
   ✓ 游戏已启动，会话 ID: session_1234567890

2. 我来执行测试代码
   [调用 execute_lua 工具]
   代码: print("玩家金币:", y3.player.get_gold(1))

3. 检查执行结果
   [调用 get_logs 工具]
   日志显示: [INFO] 玩家金币: 1000

4. 功能已验证，现在我来实现完整的代码...
```

### 13.2 调试流程

```
用户: 我的代码报错了，帮我看看

Claude:
1. 启动游戏重现问题
   [调用 launch_game 工具]

2. 执行你的代码
   [调用 execute_lua 工具]

3. 查看错误日志
   [调用 get_logs 工具]

4. 发现问题：xxx 变量未定义
   让我修复这个问题...
```

## 14. 注意事项

### 14.1 性能考虑

- 日志缓存限制为 10000 条，避免内存溢出
- Client 监控间隔 500ms，平衡响应速度和性能
- Lua 执行超时 30 秒，避免无限等待

### 14.2 安全考虑

- 仅在 `Y3_HELPER_MCP_MODE=true` 时启动 MCP Server
- 不暴露敏感的系统操作
- 限制 Lua 代码执行权限（依赖游戏沙箱）

### 14.3 兼容性

- 需要 Node.js 18+
- 需要 VSCode 1.96.0+
- 需要 Y3 编辑器已安装

## 15. 故障排查

### 15.1 MCP Server 无法启动

**症状**：Claude Code 无法连接到 y3-helper

**检查**：
1. 确认 `dist/mcp-server.js` 已生成
2. 确认 Claude Code 配置文件路径正确
3. 查看 VSCode 输出面板的 MCP 日志

### 15.2 游戏启动失败

**症状**：`launch_game` 返回失败

**检查**：
1. 确认编辑器路径配置正确
2. 确认地图路径存在
3. 查看 `GameLauncher` 的错误日志

### 15.3 日志未捕获

**症状**：`get_logs` 返回空

**检查**：
1. 确认游戏已连接（`Client` 存在）
2. 确认 `Client.print()` 拦截生效
3. 检查 `GameSessionManager` 的日志

### 15.4 Lua 执行无响应

**症状**：`execute_lua` 超时

**检查**：
1. 确认游戏正在运行
2. 确认 Lua 代码语法正确
3. 检查游戏控制台是否有错误

## 16. 未来扩展

### 16.1 可能的新工具

- `restart_game` - 重启游戏
- `reload_script` - 热重载脚本
- `get_game_state` - 获取游戏状态
- `set_breakpoint` - 设置断点
- `watch_variable` - 监视变量

### 16.2 功能增强

- 支持多个并发会话
- 日志过滤和搜索
- 性能监控集成
- 自动化测试框架

## 17. 参考资料

- [Model Context Protocol 规范](https://modelcontextprotocol.io/)
- [MCP SDK 文档](https://github.com/modelcontextprotocol/typescript-sdk)
- [VSCode Extension API](https://code.visualstudio.com/api)
- [Y3-Helper 现有架构](../CLAUDE.md)
