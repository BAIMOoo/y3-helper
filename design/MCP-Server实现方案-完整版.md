# Y3-Helper MCP Server 实现方案（完整版）

## 1. 概述

本文档详细描述了在 y3-helper VSCode 扩展中集成 MCP (Model Context Protocol) Server 的完整实现方案。通过 MCP Server，Claude Code 可以自动化地启动游戏、获取日志、执行 Lua 代码，实现完整的开发-测试-调试闭环。

### 1.1 目标

- 让 Claude Code 能够自动启动 Y3 游戏
- 自动捕获游戏运行日志
- 支持在运行时执行 Lua 代码进行测试
- 实现完整的自动化开发流程

### 1.2 最终架构设计

基于需求分析和技术讨论，我们采用**子进程桥接模式**：

```
Claude Code (通过 claude_desktop_config.json 配置)
    ↓ stdin/stdout (JSON-RPC 2.0)
MCP Server 子进程 (dist/mcp-server.js)
    ↓ Unix Socket (Linux/macOS) / Named Pipe (Windows)
VSCode 扩展 (IPC 服务器)
    ├── GameSessionManager (管理游戏会话)
    ├── GameLauncher (复用现有启动逻辑)
    ├── ConsoleServer (复用现有连接逻辑)
    ├── Client (拦截 print() 写入日志文件)
    └── 日志文件 (临时目录，供 MCP Server 读取)
```

### 1.3 核心设计决策

1. **子进程桥接模式**：MCP Server 作为轻量级子进程，仅负责协议转换（JSON-RPC ↔ IPC）
2. **Unix Socket/Named Pipe 通信**：跨平台的高性能 IPC 方案
3. **文件共享日志**：扩展将日志写入文件，MCP Server 读取文件，实现简单且持久化
4. **用户控制启动**：在侧边栏添加"启用 MCP Server"选项，用户勾选后启动 IPC 服务器
5. **复用现有逻辑**：最大化利用 GameLauncher、ConsoleServer、Client 等现有组件
6. **日志文件轮转**：最多保留 5 个日志文件，自动删除最旧的文件

## 2. 目录结构

### 2.1 新增文件结构

```
src/
├── mcp/
│   ├── index.ts                    # MCP 模块导出
│   ├── server.ts                   # MCP Server 子进程入口
│   ├── ipcClient.ts                # IPC 客户端（子进程侧）
│   ├── ipcServer.ts                # IPC 服务器（扩展侧）
│   ├── protocol.ts                 # MCP 协议处理（JSON-RPC）
│   ├── transport.ts                # Stdio 传输层
│   ├── gameSessionManager.ts       # 游戏会话管理器
│   ├── logManager.ts               # 日志文件管理器
│   ├── types.ts                    # 类型定义
│   └── tools/
│       ├── index.ts                # 工具注册表
│       ├── launchGame.ts           # launch_game 工具
│       ├── getLogs.ts              # get_logs 工具
│       ├── executeLua.ts           # execute_lua 工具
│       └── stopGame.ts             # stop_game 工具
├── mainMenu/
│   └── pages/
│       └── features.ts             # 修改：添加 MCP 开关
└── extension.ts                    # 修改：初始化 IPC 服务器
```

### 2.2 关键文件职责

| 文件 | 职责 |
|------|------|
| **server.ts** | MCP Server 子进程主入口，处理 stdin/stdout 通信 |
| **ipcServer.ts** | 扩展侧的 IPC 服务器，暴露 API 给子进程调用 |
| **ipcClient.ts** | 子进程侧的 IPC 客户端，调用扩展的 API |
| **gameSessionManager.ts** | 管理游戏会话生命周期，协调现有组件 |
| **logManager.ts** | 管理日志文件的写入和读取，支持文件轮转 |
| **protocol.ts** | 处理 MCP JSON-RPC 协议 |
| **transport.ts** | 处理 stdin/stdout 传输 |
| **tools/index.ts** | 工具注册表，管理所有可用工具 |

## 3. IPC 通信设计

### 3.1 Socket 路径约定

```typescript
// src/mcp/types.ts
export function getSocketPath(): string {
    const tmpDir = os.tmpdir();
    const socketName = process.platform === 'win32'
        ? '\\\\.\\pipe\\y3-helper-mcp'  // Windows Named Pipe
        : path.join(tmpDir, 'y3-helper-mcp.sock');  // Unix Socket
    return socketName;
}
```

### 3.2 IPC 消息格式

```typescript
// 请求格式
interface IPCRequest {
    id: string;                    // 请求 ID
    method: string;                // 方法名
    params?: any;                  // 参数
}

// 响应格式
interface IPCResponse {
    id: string;                    // 对应的请求 ID
    result?: any;                  // 成功结果
    error?: {                      // 错误信息
        code: number;
        message: string;
        data?: any;
    };
}
```

### 3.3 支持的 IPC 方法

- `launch_game` - 启动游戏
- `get_game_status` - 获取游戏状态（是否运行、会话 ID）
- `get_logs` - 获取日志
- `execute_lua` - 执行 Lua 代码
- `stop_game` - 停止游戏

### 3.4 通信流程示例

```
MCP Server 子进程                    VSCode 扩展
      |                                    |
      |------ IPCRequest(launch_game) --->|
      |                                    |--- GameLauncher.launch()
      |                                    |--- 等待 Client 连接
      |<----- IPCResponse(success) -------|
```

## 4. 日志管理机制

### 4.1 日志文件设计（支持轮转）

```typescript
// src/mcp/logManager.ts
export class LogManager {
    private static readonly MAX_LOG_FILES = 5;
    private static readonly LOG_DIR = path.join(os.tmpdir(), 'y3-helper-logs');

    private logFilePath: string;
    private writeStream: fs.WriteStream;
    private maxLines: number = 10000;  // 单个文件最大行数

    constructor(sessionId: string) {
        // 确保日志目录存在
        if (!fs.existsSync(LogManager.LOG_DIR)) {
            fs.mkdirSync(LogManager.LOG_DIR, { recursive: true });
        }

        // 清理旧日志文件
        this.cleanupOldLogs();

        // 创建新日志文件
        const timestamp = Date.now();
        this.logFilePath = path.join(
            LogManager.LOG_DIR,
            `session-${sessionId}-${timestamp}.log`
        );
        this.writeStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
    }

    // 清理超过上限的旧日志文件
    private cleanupOldLogs(): void {
        const files = fs.readdirSync(LogManager.LOG_DIR)
            .filter(f => f.endsWith('.log'))
            .map(f => ({
                name: f,
                path: path.join(LogManager.LOG_DIR, f),
                mtime: fs.statSync(path.join(LogManager.LOG_DIR, f)).mtime.getTime()
            }))
            .sort((a, b) => b.mtime - a.mtime);  // 按修改时间降序

        // 删除超过上限的文件
        if (files.length >= LogManager.MAX_LOG_FILES) {
            const filesToDelete = files.slice(LogManager.MAX_LOG_FILES - 1);
            filesToDelete.forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                } catch (err) {
                    console.error(`Failed to delete old log: ${file.path}`, err);
                }
            });
        }
    }

    // 写入日志
    appendLog(message: string): void {
        const timestamp = new Date().toISOString();
        this.writeStream.write(`[${timestamp}] ${message}\n`);
    }

    // 读取最近 N 行日志
    async readLogs(limit: number = 100): Promise<string[]> {
        const content = await fs.promises.readFile(this.logFilePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        return lines.slice(-limit);
    }

    // 清理当前日志文件
    cleanup(): void {
        this.writeStream.close();
        // 注意：不删除文件，保留用于调试
    }

    // 静态方法：获取所有日志文件列表
    static getAllLogFiles(): string[] {
        if (!fs.existsSync(LogManager.LOG_DIR)) {
            return [];
        }
        return fs.readdirSync(LogManager.LOG_DIR)
            .filter(f => f.endsWith('.log'))
            .map(f => path.join(LogManager.LOG_DIR, f));
    }
}
```

### 4.2 Client.print() 拦截

```typescript
// src/mcp/gameSessionManager.ts
private attachClient(session: GameSession, client: Client): void {
    session.client = client;
    session.status = 'running';

    // 拦截 print 方法
    const originalPrint = client.print.bind(client);
    client.print = (msg: string) => {
        session.logManager.appendLog(msg);  // 写入文件
        return originalPrint(msg);           // 继续原有逻辑
    };
}
```

### 4.3 日志文件生命周期

- **创建**：游戏启动时创建日志文件
- **写入**：每次 Client.print() 调用时追加写入
- **读取**：MCP Server 通过 IPC 请求读取
- **清理**：游戏停止时关闭文件流，但保留文件用于调试
- **轮转**：创建新日志文件时，自动删除最旧的文件（保持最多 5 个）

### 4.4 改进点

1. **统一日志目录**：所有日志文件存放在 `{tmpdir}/y3-helper-logs/` 目录
2. **自动清理**：每次创建新日志文件时，检查并删除最旧的文件（保持最多 5 个）
3. **文件命名**：`session-{sessionId}-{timestamp}.log`，便于识别和排序
4. **保留历史**：游戏停止时不删除日志文件，方便事后调试

## 5. IPC 服务器实现（扩展侧）

### 5.1 IPC 服务器核心代码

```typescript
// src/mcp/ipcServer.ts
import * as net from 'net';
import { getSocketPath } from './types';
import { GameSessionManager } from './gameSessionManager';

export class IPCServer extends vscode.Disposable {
    private server?: net.Server;
    private sessionManager: GameSessionManager;
    private connections: Set<net.Socket> = new Set();

    constructor() {
        super(() => this.dispose());
        this.sessionManager = new GameSessionManager();
    }

    async start(): Promise<void> {
        const socketPath = getSocketPath();

        // 清理可能存在的旧 socket 文件
        if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
        }

        this.server = net.createServer((socket) => {
            this.connections.add(socket);
            this.handleConnection(socket);

            socket.on('close', () => {
                this.connections.delete(socket);
            });
        });

        await new Promise<void>((resolve, reject) => {
            this.server!.listen(socketPath, () => {
                console.log(`IPC Server listening on ${socketPath}`);
                resolve();
            });
            this.server!.on('error', reject);
        });
    }

    private handleConnection(socket: net.Socket): void {
        let buffer = '';

        socket.on('data', async (data) => {
            buffer += data.toString();

            // 处理完整的 JSON 消息（以换行符分隔）
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const request = JSON.parse(line);
                        const response = await this.handleRequest(request);
                        socket.write(JSON.stringify(response) + '\n');
                    } catch (err) {
                        const errorResponse = {
                            id: null,
                            error: {
                                code: -32700,
                                message: 'Parse error',
                                data: err instanceof Error ? err.message : String(err)
                            }
                        };
                        socket.write(JSON.stringify(errorResponse) + '\n');
                    }
                }
            }
        });
    }

    private async handleRequest(request: any): Promise<any> {
        const { id, method, params } = request;

        try {
            let result;

            switch (method) {
                case 'launch_game':
                    result = await this.sessionManager.launchGame(params);
                    break;
                case 'get_game_status':
                    result = this.sessionManager.getGameStatus();
                    break;
                case 'get_logs':
                    result = await this.sessionManager.getLogs(params);
                    break;
                case 'execute_lua':
                    result = await this.sessionManager.executeLua(params);
                    break;
                case 'stop_game':
                    result = await this.sessionManager.stopGame(params);
                    break;
                default:
                    throw new Error(`Unknown method: ${method}`);
            }

            return { id, result };
        } catch (err) {
            return {
                id,
                error: {
                    code: -32603,
                    message: err instanceof Error ? err.message : String(err)
                }
            };
        }
    }

    dispose(): void {
        // 关闭所有连接
        this.connections.forEach(socket => socket.destroy());
        this.connections.clear();

        // 关闭服务器
        if (this.server) {
            this.server.close();
        }

        // 清理 socket 文件
        const socketPath = getSocketPath();
        if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
        }

        // 清理会话管理器
        this.sessionManager.dispose();
    }
}
```

### 5.2 关键特性

1. **自动清理**：启动时删除旧的 socket 文件，避免冲突
2. **多连接支持**：虽然通常只有一个 MCP Server 连接，但支持多个客户端
3. **消息分帧**：使用换行符分隔 JSON 消息
4. **错误处理**：捕获并返回标准的 JSON-RPC 错误响应
5. **资源清理**：dispose 时关闭所有连接和 socket 文件

## 6. IPC 客户端实现（子进程侧）

### 6.1 IPC 客户端核心代码

```typescript
// src/mcp/ipcClient.ts
import * as net from 'net';
import { getSocketPath } from './types';

export class IPCClient {
    private socket?: net.Socket;
    private buffer: string = '';
    private pendingRequests: Map<string, {
        resolve: (value: any) => void;
        reject: (error: any) => void;
    }> = new Map();
    private requestId: number = 0;

    async connect(): Promise<void> {
        const socketPath = getSocketPath();

        return new Promise((resolve, reject) => {
            this.socket = net.createConnection(socketPath, () => {
                console.error('[MCP] Connected to IPC server');
                resolve();
            });

            this.socket.on('error', (err) => {
                console.error('[MCP] IPC connection error:', err);
                reject(err);
            });

            this.socket.on('data', (data) => {
                this.handleData(data);
            });

            this.socket.on('close', () => {
                console.error('[MCP] IPC connection closed');
                // 拒绝所有待处理的请求
                this.pendingRequests.forEach(({ reject }) => {
                    reject(new Error('Connection closed'));
                });
                this.pendingRequests.clear();
            });
        });
    }

    private handleData(data: Buffer): void {
        this.buffer += data.toString();

        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const response = JSON.parse(line);
                    this.handleResponse(response);
                } catch (err) {
                    console.error('[MCP] Failed to parse IPC response:', err);
                }
            }
        }
    }

    private handleResponse(response: any): void {
        const { id, result, error } = response;
        const pending = this.pendingRequests.get(id);

        if (pending) {
            this.pendingRequests.delete(id);
            if (error) {
                pending.reject(new Error(error.message));
            } else {
                pending.resolve(result);
            }
        }
    }

    async call(method: string, params?: any): Promise<any> {
        if (!this.socket) {
            throw new Error('Not connected to IPC server');
        }

        const id = String(++this.requestId);
        const request = { id, method, params };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });

            // 设置超时
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }, 30000);  // 30 秒超时

            // 发送请求
            this.socket!.write(JSON.stringify(request) + '\n', (err) => {
                if (err) {
                    clearTimeout(timeout);
                    this.pendingRequests.delete(id);
                    reject(err);
                }
            });

            // 清理超时定时器
            const originalResolve = resolve;
            const originalReject = reject;
            this.pendingRequests.set(id, {
                resolve: (value) => {
                    clearTimeout(timeout);
                    originalResolve(value);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    originalReject(error);
                }
            });
        });
    }

    disconnect(): void {
        if (this.socket) {
            this.socket.destroy();
            this.socket = undefined;
        }
    }
}
```

### 6.2 关键特性

1. **异步请求-响应**：使用 Promise 和请求 ID 映射实现异步调用
2. **超时处理**：每个请求 30 秒超时，避免无限等待
3. **消息分帧**：与服务器端一致，使用换行符分隔
4. **错误处理**：连接断开时拒绝所有待处理请求
5. **自动重连**：可以在外层实现重连逻辑

## 7. MCP Server 子进程入口

### 7.1 MCP Server 主入口

```typescript
// src/mcp/server.ts
import { StdioTransport } from './transport';
import { MCPProtocol } from './protocol';
import { IPCClient } from './ipcClient';
import { ToolRegistry } from './tools';

async function main() {
    try {
        console.error('[MCP] Starting MCP Server...');

        // 1. 连接到扩展的 IPC 服务器
        const ipcClient = new IPCClient();
        await ipcClient.connect();
        console.error('[MCP] Connected to VSCode extension');

        // 2. 初始化工具注册表
        const toolRegistry = new ToolRegistry(ipcClient);

        // 3. 初始化 MCP 协议处理器
        const protocol = new MCPProtocol(toolRegistry);

        // 4. 启动 stdio 传输层
        const transport = new StdioTransport(protocol);
        await transport.start();

        console.error('[MCP] MCP Server started successfully');

        // 处理进程退出
        process.on('SIGINT', () => {
            console.error('[MCP] Shutting down...');
            ipcClient.disconnect();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.error('[MCP] Shutting down...');
            ipcClient.disconnect();
            process.exit(0);
        });

    } catch (error) {
        console.error('[MCP] Failed to start MCP Server:', error);
        process.exit(1);
    }
}

// 启动服务器
main();
```

### 7.2 Stdio 传输层

```typescript
// src/mcp/transport.ts
import * as readline from 'readline';
import { MCPProtocol } from './protocol';

export class StdioTransport {
    private rl?: readline.Interface;

    constructor(private protocol: MCPProtocol) {}

    async start(): Promise<void> {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        this.rl.on('line', async (line) => {
            try {
                const request = JSON.parse(line);
                const response = await this.protocol.handleRequest(request);
                this.send(response);
            } catch (err) {
                console.error('[MCP] Failed to handle request:', err);
                this.send({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32700,
                        message: 'Parse error'
                    }
                });
            }
        });

        this.rl.on('close', () => {
            console.error('[MCP] Stdin closed, exiting...');
            process.exit(0);
        });
    }

    private send(message: any): void {
        // 使用 stdout 发送响应
        console.log(JSON.stringify(message));
    }
}
```

### 7.3 关键设计

1. **启动流程**：IPC 连接 → 工具注册 → 协议初始化 → Stdio 监听
2. **日志分离**：使用 `console.error` 输出调试日志（stderr），`console.log` 输出 MCP 响应（stdout）
3. **优雅退出**：处理 SIGINT/SIGTERM 信号，清理 IPC 连接
4. **错误处理**：启动失败时退出进程，返回非零状态码

## 8. GameSessionManager 实现

### 8.1 游戏会话管理器

```typescript
// src/mcp/gameSessionManager.ts
import * as vscode from 'vscode';
import { GameLauncher } from '../launchGame';
import { Client } from '../console/client';
import { LogManager } from './logManager';
import * as env from '../env';

interface GameSession {
    id: string;
    launcher: GameLauncher;
    client?: Client;
    logManager: LogManager;
    status: 'launching' | 'running' | 'stopped';
    startTime: number;
}

export class GameSessionManager extends vscode.Disposable {
    private currentSession?: GameSession;
    private clientCheckInterval?: NodeJS.Timeout;

    constructor() {
        super(() => this.dispose());
        this.startClientMonitoring();
    }

    // 启动游戏
    async launchGame(options: any = {}): Promise<any> {
        // 如果已有运行中的会话，先停止
        if (this.currentSession && this.currentSession.status !== 'stopped') {
            await this.stopGame();
        }

        // 等待环境就绪
        await env.editorReady();
        await env.mapReady();

        // 创建会话
        const sessionId = `session_${Date.now()}`;
        const logManager = new LogManager(sessionId);

        const session: GameSession = {
            id: sessionId,
            launcher: new GameLauncher(),
            logManager,
            status: 'launching',
            startTime: Date.now()
        };

        this.currentSession = session;

        try {
            // 构建启动参数
            const luaArgs: Record<string, string> = {};
            if (options.attach_debugger) {
                luaArgs['lua_wait_debugger'] = 'true';
            }

            // 启动游戏
            await session.launcher.launch(
                luaArgs,
                options.multi_mode || false,
                options.multi_players,
                options.tracy || false
            );

            // 等待客户端连接（最多 30 秒）
            const connected = await this.waitForClient(session, 30000);

            if (!connected) {
                session.status = 'stopped';
                return {
                    success: false,
                    session_id: sessionId,
                    status: 'stopped',
                    message: 'Game launched but client connection timeout'
                };
            }

            return {
                success: true,
                session_id: sessionId,
                status: session.status,
                message: 'Game launched successfully'
            };

        } catch (error) {
            session.status = 'stopped';
            throw error;
        }
    }

    // 等待客户端连接
    private async waitForClient(session: GameSession, timeout: number): Promise<boolean> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            if (session.client && session.status === 'running') {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        return false;
    }

    // 监控客户端连接
    private startClientMonitoring(): void {
        this.clientCheckInterval = setInterval(() => {
            if (this.currentSession &&
                this.currentSession.status === 'launching' &&
                !this.currentSession.client) {

                // 检查是否有新的客户端连接
                const latestClient = Client.allClients[Client.allClients.length - 1];
                if (latestClient) {
                    this.attachClient(this.currentSession, latestClient);
                }
            }
        }, 500);
    }

    // 附加客户端并拦截日志
    private attachClient(session: GameSession, client: Client): void {
        session.client = client;
        session.status = 'running';

        console.log(`[MCP] Client attached to session ${session.id}`);

        // 拦截 print 方法
        const originalPrint = client.print.bind(client);
        client.print = (msg: string) => {
            session.logManager.appendLog(msg);
            return originalPrint(msg);
        };

        // 监听客户端断开
        client.onDidDispose(() => {
            if (this.currentSession?.id === session.id) {
                session.status = 'stopped';
                console.log(`[MCP] Client disconnected from session ${session.id}`);
            }
        });
    }

    // 获取游戏状态
    getGameStatus(): any {
        if (!this.currentSession) {
            return {
                running: false,
                session_id: null,
                status: 'no_session'
            };
        }

        return {
            running: this.currentSession.status === 'running',
            session_id: this.currentSession.id,
            status: this.currentSession.status,
            uptime: Date.now() - this.currentSession.startTime
        };
    }

    // 获取日志
    async getLogs(params: any = {}): Promise<any> {
        if (!this.currentSession) {
            return {
                success: false,
                message: 'No active session'
            };
        }

        const limit = params.limit || 100;
        const logs = await this.currentSession.logManager.readLogs(limit);

        return {
            success: true,
            log_count: logs.length,
            logs: logs.join('\n')
        };
    }

    // 执行 Lua 代码
    async executeLua(params: any): Promise<any> {
        if (!this.currentSession || !this.currentSession.client) {
            return {
                success: false,
                message: 'Game not running or not connected'
            };
        }

        const { code } = params;
        if (!code) {
            return {
                success: false,
                message: 'No code provided'
            };
        }

        // 记录执行前的日志行数
        const logsBefore = await this.currentSession.logManager.readLogs(10000);
        const linesBefore = logsBefore.length;

        // 发送 Lua 代码
        this.currentSession.client.notify('command', { data: code });

        // 等待 1 秒收集输出
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 获取新增的日志
        const logsAfter = await this.currentSession.logManager.readLogs(10000);
        const newLogs = logsAfter.slice(linesBefore);

        return {
            success: true,
            output: newLogs.join('\n')
        };
    }

    // 停止游戏
    async stopGame(params: any = {}): Promise<any> {
        if (!this.currentSession) {
            return {
                success: false,
                message: 'No active session'
            };
        }

        const session = this.currentSession;

        // 断开客户端
        if (session.client) {
            session.client.dispose();
        }

        // 更新状态
        session.status = 'stopped';

        // 清理日志管理器
        session.logManager.cleanup();

        // 清除当前会话
        this.currentSession = undefined;

        return {
            success: true,
            message: 'Game stopped'
        };
    }

    dispose(): void {
        if (this.clientCheckInterval) {
            clearInterval(this.clientCheckInterval);
        }

        if (this.currentSession) {
            this.stopGame();
        }
    }
}
```

### 8.2 关键功能

1. **会话生命周期管理**：创建、运行、停止
2. **客户端自动检测**：每 500ms 检查新连接
3. **日志拦截**：自动捕获 Client.print() 输出
4. **Lua 执行**：通过 Client.notify 发送代码，捕获输出
5. **状态查询**：返回游戏运行状态和运行时长

## 9. 工具注册和实现

### 9.1 工具注册表

```typescript
// src/mcp/tools/index.ts
import { IPCClient } from '../ipcClient';

export interface Tool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();

    constructor(private ipcClient: IPCClient) {
        this.registerTools();
    }

    private registerTools(): void {
        // 注册 launch_game 工具
        this.tools.set('launch_game', {
            name: 'launch_game',
            description: '启动 Y3 游戏。可以配置调试器、多开模式、性能分析等选项。',
            inputSchema: {
                type: 'object',
                properties: {
                    attach_debugger: {
                        type: 'boolean',
                        description: '是否附加调试器'
                    },
                    multi_mode: {
                        type: 'boolean',
                        description: '是否启用多开模式'
                    },
                    multi_players: {
                        type: 'array',
                        items: { type: 'number' },
                        description: '多开玩家 ID 列表'
                    },
                    tracy: {
                        type: 'boolean',
                        description: '是否启用 Tracy 性能分析'
                    }
                }
            }
        });

        // 注册 get_logs 工具
        this.tools.set('get_logs', {
            name: 'get_logs',
            description: '获取游戏控制台日志。返回最近的日志内容。',
            inputSchema: {
                type: 'object',
                properties: {
                    limit: {
                        type: 'number',
                        description: '返回最近 N 条日志，默认 100',
                        default: 100
                    }
                }
            }
        });

        // 注册 execute_lua 工具
        this.tools.set('execute_lua', {
            name: 'execute_lua',
            description: '在运行的游戏中执行 Lua 代码。代码会在游戏的 Lua 环境中执行，可以访问游戏 API。',
            inputSchema: {
                type: 'object',
                properties: {
                    code: {
                        type: 'string',
                        description: '要执行的 Lua 代码'
                    }
                },
                required: ['code']
            }
        });

        // 注册 stop_game 工具
        this.tools.set('stop_game', {
            name: 'stop_game',
            description: '停止当前运行的游戏会话。',
            inputSchema: {
                type: 'object',
                properties: {}
            }
        });

        // 注册 get_game_status 工具
        this.tools.set('get_game_status', {
            name: 'get_game_status',
            description: '获取游戏运行状态，包括是否运行、会话 ID、运行时长等信息。',
            inputSchema: {
                type: 'object',
                properties: {}
            }
        });
    }

    // 列出所有工具
    listTools(): Tool[] {
        return Array.from(this.tools.values());
    }

    // 调用工具
    async callTool(name: string, args: any): Promise<any> {
        if (!this.tools.has(name)) {
            throw new Error(`Unknown tool: ${name}`);
        }

        // 通过 IPC 调用扩展的方法
        const result = await this.ipcClient.call(name, args);
        return result;
    }
}
```

### 9.2 MCP 协议处理器

```typescript
// src/mcp/protocol.ts
import { ToolRegistry } from './tools';

export class MCPProtocol {
    private serverInfo = {
        name: 'y3-helper',
        version: '1.0.0'
    };

    constructor(private toolRegistry: ToolRegistry) {}

    async handleRequest(request: any): Promise<any> {
        const { jsonrpc, id, method, params } = request;

        if (jsonrpc !== '2.0') {
            return this.errorResponse(id, -32600, 'Invalid Request');
        }

        try {
            let result;

            switch (method) {
                case 'initialize':
                    result = await this.handleInitialize(params);
                    break;

                case 'tools/list':
                    result = await this.handleToolsList();
                    break;

                case 'tools/call':
                    result = await this.handleToolsCall(params);
                    break;

                default:
                    return this.errorResponse(id, -32601, `Method not found: ${method}`);
            }

            return {
                jsonrpc: '2.0',
                id,
                result
            };

        } catch (error) {
            return this.errorResponse(
                id,
                -32603,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    private async handleInitialize(params: any): Promise<any> {
        return {
            protocolVersion: '2024-11-05',
            serverInfo: this.serverInfo,
            capabilities: {
                tools: {}
            }
        };
    }

    private async handleToolsList(): Promise<any> {
        const tools = this.toolRegistry.listTools();
        return { tools };
    }

    private async handleToolsCall(params: any): Promise<any> {
        const { name, arguments: args } = params;

        if (!name) {
            throw new Error('Tool name is required');
        }

        const result = await this.toolRegistry.callTool(name, args || {});

        // 将结果包装为 MCP 格式
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }
            ]
        };
    }

    private errorResponse(id: any, code: number, message: string): any {
        return {
            jsonrpc: '2.0',
            id,
            error: {
                code,
                message
            }
        };
    }
}
```

### 9.3 关键设计

1. **工具定义**：符合 MCP 规范的 JSON Schema
2. **IPC 桥接**：工具调用直接转发到扩展的 IPC 服务器
3. **协议处理**：实现 MCP 标准方法（initialize、tools/list、tools/call）
4. **结果包装**：将 IPC 结果包装为 MCP 的 content 格式

## 10. VSCode 扩展集成

### 10.1 修改 extension.ts

```typescript
// src/extension.ts
import * as mcp from './mcp';

class Helper {
    private ipcServer?: mcp.IPCServer;

    // 启动 IPC 服务器
    private async startIPCServer() {
        try {
            this.ipcServer = new mcp.IPCServer();
            await this.ipcServer.start();
            console.log('[Y3-Helper] IPC Server started for MCP');
        } catch (error) {
            console.error('[Y3-Helper] Failed to start IPC Server:', error);
            vscode.window.showErrorMessage('启动 MCP IPC 服务器失败');
        }
    }

    // 停止 IPC 服务器
    private stopIPCServer() {
        if (this.ipcServer) {
            this.ipcServer.dispose();
            this.ipcServer = undefined;
            console.log('[Y3-Helper] IPC Server stopped');
        }
    }

    public start() {
        // ... 现有代码 ...

        // 注册命令
        this.registerCommands();

        // 延迟初始化其他模块
        setTimeout(() => {
            this.init();
        }, 0);
    }

    private registerCommands() {
        // ... 现有命令 ...

        // 注册 MCP 控制命令
        vscode.commands.registerCommand('y3-helper.startMCPServer', async () => {
            if (this.ipcServer) {
                vscode.window.showInformationMessage('MCP Server 已经在运行');
                return;
            }
            await this.startIPCServer();
            vscode.window.showInformationMessage('MCP Server 已启动');
        });

        vscode.commands.registerCommand('y3-helper.stopMCPServer', () => {
            if (!this.ipcServer) {
                vscode.window.showInformationMessage('MCP Server 未运行');
                return;
            }
            this.stopIPCServer();
            vscode.window.showInformationMessage('MCP Server 已停止');
        });
    }
}
```

### 10.2 修改侧边栏 UI

```typescript
// src/mainMenu/pages/features.ts
import * as vscode from 'vscode';

export class FeaturesPage {
    // ... 现有代码 ...

    private createMCPSection(): TreeNode {
        return {
            label: 'MCP Server',
            icon: '🔌',
            children: [
                {
                    label: '启动 MCP Server',
                    icon: '▶️',
                    command: 'y3-helper.startMCPServer',
                    tooltip: '启动 MCP Server，允许 Claude Code 连接'
                },
                {
                    label: '停止 MCP Server',
                    icon: '⏹️',
                    command: 'y3-helper.stopMCPServer',
                    tooltip: '停止 MCP Server'
                },
                {
                    label: '查看 Socket 路径',
                    icon: '📍',
                    command: 'y3-helper.showMCPSocketPath',
                    tooltip: '显示 IPC Socket 文件路径'
                }
            ]
        };
    }

    // 在现有的功能列表中添加 MCP 部分
    getChildren(): TreeNode[] {
        return [
            // ... 现有节点 ...
            this.createMCPSection()
        ];
    }
}

// 添加显示 Socket 路径的命令
vscode.commands.registerCommand('y3-helper.showMCPSocketPath', () => {
    const socketPath = mcp.getSocketPath();
    vscode.window.showInformationMessage(
        `MCP Socket 路径: ${socketPath}`,
        '复制路径'
    ).then(selection => {
        if (selection === '复制路径') {
            vscode.env.clipboard.writeText(socketPath);
            vscode.window.showInformationMessage('已复制到剪贴板');
        }
    });
});
```

### 10.3 MCP 模块导出

```typescript
// src/mcp/index.ts
export { IPCServer } from './ipcServer';
export { IPCClient } from './ipcClient';
export { GameSessionManager } from './gameSessionManager';
export { LogManager } from './logManager';
export { getSocketPath } from './types';
export * from './types';
```

### 10.4 关键改动

1. **命令注册**：添加启动/停止 MCP Server 的命令
2. **侧边栏集成**：在功能页面添加 MCP 控制面板
3. **生命周期管理**：扩展激活时不自动启动，由用户手动控制
4. **状态提示**：通过消息提示用户 MCP Server 的状态

## 11. 构建配置和部署

### 11.1 Webpack MCP 配置

```javascript
// webpack.mcp.config.js
const path = require('path');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

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
            new TsconfigPathsPlugin({
                configFile: './tsconfig.json'
            })
        ]
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.json'
                    }
                }
            }
        ]
    },
    node: {
        __dirname: false,
        __filename: false
    }
};
```

### 11.2 修改 package.json

```json
{
  "name": "y3-helper",
  "scripts": {
    "compile": "webpack --mode none",
    "compile:mcp": "webpack --config webpack.mcp.config.js",
    "watch": "webpack --mode none --watch",
    "watch:mcp": "webpack --config webpack.mcp.config.js --watch",
    "vscode:prepublish": "npm run compile && npm run compile:mcp"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0"
  },
  "devDependencies": {
    "tsconfig-paths-webpack-plugin": "^4.0.0"
  }
}
```

### 11.3 Claude Code 配置文件

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "y3-helper": {
      "command": "node",
      "args": [
        "C:/Users/BAIM/Desktop/y3-helper/dist/mcp-server.js"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**Linux/macOS**: `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "y3-helper": {
      "command": "node",
      "args": [
        "/path/to/y3-helper/dist/mcp-server.js"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### 11.4 部署步骤

1. **安装依赖**
   ```bash
   npm install
   ```

2. **编译 MCP Server**
   ```bash
   npm run compile:mcp
   ```

3. **启动 VSCode 扩展**
   - 在 VSCode 中打开 y3-helper 项目
   - 按 F5 启动扩展开发宿主

4. **启动 MCP Server（在扩展中）**
   - 打开侧边栏 Y3-Helper 视图
   - 点击 "MCP Server" → "启动 MCP Server"

5. **配置 Claude Code**
   - 编辑 `claude_desktop_config.json`
   - 添加 y3-helper MCP 服务器配置
   - 重启 Claude Code

6. **验证连接**
   - 在 Claude Code 中输入：`请列出可用的工具`
   - 应该能看到 launch_game、get_logs 等工具

### 11.5 关键配置

1. **独立编译**：MCP Server 单独编译为 `dist/mcp-server.js`
2. **路径解析**：使用 tsconfig-paths-webpack-plugin 支持路径别名
3. **Node 环境**：target: 'node'，保留 __dirname 和 __filename
4. **外部依赖**：vscode 模块标记为 external（虽然 MCP Server 不直接使用）

## 12. 错误处理和测试策略

### 12.1 错误类型定义

```typescript
// src/mcp/types.ts
export enum MCPErrorCode {
    // JSON-RPC 标准错误码
    PARSE_ERROR = -32700,
    INVALID_REQUEST = -32600,
    METHOD_NOT_FOUND = -32601,
    INVALID_PARAMS = -32602,
    INTERNAL_ERROR = -32603,

    // Y3-Helper 自定义错误码
    GAME_NOT_RUNNING = -32001,
    GAME_LAUNCH_FAILED = -32002,
    LUA_EXECUTION_FAILED = -32003,
    SESSION_NOT_FOUND = -32004,
    IPC_CONNECTION_FAILED = -32005,
    CLIENT_NOT_CONNECTED = -32006,
}

export class MCPError extends Error {
    constructor(
        message: string,
        public code: number = MCPErrorCode.INTERNAL_ERROR,
        public data?: any
    ) {
        super(message);
        this.name = 'MCPError';
    }
}
```

### 12.2 错误处理示例

```typescript
// src/mcp/gameSessionManager.ts (补充错误处理)
async launchGame(options: any = {}): Promise<any> {
    try {
        // ... 现有代码 ...

        await session.launcher.launch(
            luaArgs,
            options.multi_mode || false,
            options.multi_players,
            options.tracy || false
        );

    } catch (error) {
        session.status = 'stopped';

        // 包装为 MCPError
        throw new MCPError(
            `游戏启动失败: ${error instanceof Error ? error.message : String(error)}`,
            MCPErrorCode.GAME_LAUNCH_FAILED,
            { originalError: error }
        );
    }
}

async executeLua(params: any): Promise<any> {
    if (!this.currentSession) {
        throw new MCPError(
            '没有活动的游戏会话',
            MCPErrorCode.SESSION_NOT_FOUND
        );
    }

    if (!this.currentSession.client) {
        throw new MCPError(
            '游戏客户端未连接',
            MCPErrorCode.CLIENT_NOT_CONNECTED
        );
    }

    // ... 执行逻辑 ...
}
```

### 12.3 测试策略

#### 手动测试 - IPC 通信

```bash
# 测试 IPC 服务器连接
node -e "
const net = require('net');
const os = require('os');
const path = require('path');

const socketPath = process.platform === 'win32'
    ? '\\\\\\\\.\\\\pipe\\\\y3-helper-mcp'
    : path.join(os.tmpdir(), 'y3-helper-mcp.sock');

const client = net.createConnection(socketPath, () => {
    console.log('Connected to IPC server');

    // 测试 get_game_status
    const request = {
        id: '1',
        method: 'get_game_status',
        params: {}
    };

    client.write(JSON.stringify(request) + '\\n');
});

client.on('data', (data) => {
    console.log('Response:', data.toString());
    client.end();
});

client.on('error', (err) => {
    console.error('Error:', err);
});
"
```

#### 手动测试 - MCP Server

```bash
# 测试 MCP Server 基本功能
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node dist/mcp-server.js

# 测试工具列表
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node dist/mcp-server.js

# 测试启动游戏
echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"launch_game","arguments":{}}}' | node dist/mcp-server.js
```

#### 集成测试清单

- [ ] **IPC 服务器启动**
  - 扩展激活后，手动启动 MCP Server
  - 验证 Socket 文件创建成功
  - 验证可以通过 Socket 连接

- [ ] **MCP Server 连接**
  - 配置 Claude Code
  - 验证 MCP Server 可以连接到 IPC 服务器
  - 验证 initialize 握手成功

- [ ] **工具调用 - launch_game**
  - 通过 Claude Code 调用 launch_game
  - 验证游戏成功启动
  - 验证客户端连接成功
  - 验证返回正确的会话 ID

- [ ] **工具调用 - get_logs**
  - 游戏运行时产生日志
  - 调用 get_logs 获取日志
  - 验证日志内容正确
  - 验证 limit 参数生效

- [ ] **工具调用 - execute_lua**
  - 执行简单的 Lua 代码（如 `print("test")`）
  - 验证输出被捕获
  - 验证错误处理（语法错误、运行时错误）

- [ ] **工具调用 - stop_game**
  - 调用 stop_game
  - 验证游戏进程结束
  - 验证会话状态更新

- [ ] **日志文件管理**
  - 创建多个游戏会话
  - 验证日志文件数量不超过 5 个
  - 验证最旧的文件被删除

- [ ] **错误场景**
  - 游戏未启动时调用 execute_lua
  - 重复启动游戏
  - IPC 连接断开后的行为
  - Socket 文件被删除后的恢复

#### 调试技巧

```typescript
// 在 MCP Server 中启用详细日志
// src/mcp/server.ts
process.env.MCP_DEBUG = 'true';

// 在 IPC 服务器中添加日志
// src/mcp/ipcServer.ts
private handleRequest(request: any): Promise<any> {
    console.error('[IPC] Request:', JSON.stringify(request));
    const result = await this.actualHandleRequest(request);
    console.error('[IPC] Response:', JSON.stringify(result));
    return result;
}
```

## 13. 使用示例

### 13.1 开发新功能的完整流程

```
用户: 帮我实现一个功能，在游戏中显示玩家的金币数量

Claude Code:
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

Claude Code:
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

- 日志文件最多 5 个，单个文件最多 10000 行
- Client 监控间隔 500ms，平衡响应速度和性能
- Lua 执行超时 30 秒，避免无限等待
- IPC 请求超时 30 秒

### 14.2 安全考虑

- Socket 文件默认权限，仅当前用户可访问
- execute_lua 可以执行任意 Lua 代码，依赖游戏沙箱保护
- 不暴露敏感的系统操作
- 日志可能包含游戏数据，定期清理

### 14.3 兼容性

- 需要 Node.js 18+
- 需要 VSCode 1.96.0+
- 需要 Y3 编辑器已安装
- 跨平台支持：Windows (Named Pipe)、Linux/macOS (Unix Socket)

### 14.4 故障排查

#### MCP Server 无法启动

**症状**：Claude Code 无法连接到 y3-helper

**检查**：
1. 确认 `dist/mcp-server.js` 已生成
2. 确认 Claude Code 配置文件路径正确
3. 查看 stderr 输出的错误信息

#### IPC 连接失败

**症状**：MCP Server 启动后无法连接到扩展

**检查**：
1. 确认扩展中已启动 IPC 服务器
2. 检查 Socket 文件是否存在
3. 查看 VSCode 输出面板的日志

#### 游戏启动失败

**症状**：`launch_game` 返回失败

**检查**：
1. 确认编辑器路径配置正确
2. 确认地图已打开
3. 查看 GameLauncher 的错误日志

#### 日志未捕获

**症状**：`get_logs` 返回空

**检查**：
1. 确认游戏客户端已连接
2. 检查 Client.print() 拦截是否生效
3. 查看日志文件是否创建

## 15. 未来扩展

### 15.1 可能的新工具

- `restart_game` - 重启游戏
- `reload_script` - 热重载脚本
- `get_game_state` - 获取游戏状态快照
- `watch_variable` - 监视变量变化
- `set_breakpoint` - 设置断点

### 15.2 功能增强

- 支持多个并发游戏会话
- 日志过滤和搜索功能
- 性能监控数据采集
- 自动重连机制
- 更详细的错误提示
- 进度反馈（启动游戏时）

## 16. 参考资料

- [Model Context Protocol 规范](https://modelcontextprotocol.io/)
- [MCP SDK 文档](https://github.com/modelcontextprotocol/typescript-sdk)
- [VSCode Extension API](https://code.visualstudio.com/api)
- [Y3-Helper 现有架构](../CLAUDE.md)

---

## 附录：完整数据流

```
用户在 Claude Code 中发送请求
    ↓
Claude Code 调用 y3-helper MCP Server
    ↓ (stdin/stdout, JSON-RPC)
MCP Server 子进程 (dist/mcp-server.js)
    ├─ StdioTransport 接收请求
    ├─ MCPProtocol 解析 JSON-RPC
    └─ ToolRegistry 路由到工具
        ↓ (Unix Socket / Named Pipe)
IPC Client 调用扩展 API
    ↓
VSCode 扩展 IPC Server
    ├─ 接收 IPC 请求
    └─ GameSessionManager 处理
        ├─ launch_game → GameLauncher.launch()
        ├─ get_logs → LogManager.readLogs()
        ├─ execute_lua → Client.notify()
        └─ stop_game → Client.dispose()
            ↓
Y3 Game Process
    ├─ 通过 ConsoleServer 连接
    ├─ Client.print() 被拦截
    └─ 日志写入文件
        ↓
日志文件 ({tmpdir}/y3-helper-logs/)
    ├─ 最多 5 个文件
    ├─ 自动轮转删除旧文件
    └─ MCP Server 读取返回给 Claude Code
```

