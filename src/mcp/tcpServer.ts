import * as vscode from 'vscode';
import * as net from 'net';
import * as http from 'http';
import * as crypto from 'crypto';
import * as tools from '../tools';
import { getTCPConfig, TCPRequest, TCPResponse } from './types';
import { GameSessionManager } from './gameSessionManager';

// MCP Streamable HTTP 端口
const MCP_HTTP_PORT = 8766;

/**
 * 会话状态
 */
interface MCPSession {
    id: string;
    createdAt: number;
    sseResponse?: http.ServerResponse;
}

/**
 * TCP 服务器（扩展侧）
 * 监听 TCP Socket，处理来自 MCP Server 子进程的请求
 * 同时提供 Streamable HTTP 接口供 Claude 直接连接
 */
export class TCPServer extends vscode.Disposable {
    private server?: net.Server;
    private httpServer?: http.Server;
    private sessionManager: GameSessionManager;
    private connections: Set<net.Socket> = new Set();
    private mcpSessions: Map<string, MCPSession> = new Map();

    constructor() {
        super(() => this.dispose());
        this.sessionManager = new GameSessionManager();
    }

    /**
     * 启动服务器（TCP + Streamable HTTP）
     */
    async start(): Promise<void> {
        // 1. 启动内部 TCP 服务器（用于与 mcp-server.js 子进程通信，兼容旧模式）
        await this.startTCPServer();
        
        // 2. 启动 Streamable HTTP 服务器（用于 Claude 直接连接）
        await this.startHTTPServer();
    }

    /**
     * 启动 TCP 服务器
     */
    private async startTCPServer(): Promise<void> {
        const config = getTCPConfig();

        this.server = net.createServer((socket) => {
            this.connections.add(socket);
            this.handleTCPConnection(socket);

            socket.on('close', () => {
                this.connections.delete(socket);
            });
        });

        await new Promise<void>((resolve, reject) => {
            this.server!.listen(config.port, config.host, () => {
                tools.log.info(`[MCP] TCP Server listening on ${config.host}:${config.port}`);
                resolve();
            });
            this.server!.on('error', reject);
        });
    }

    /**
     * 启动 Streamable HTTP 服务器
     */
    private async startHTTPServer(): Promise<void> {
        this.httpServer = http.createServer((req, res) => {
            this.handleHTTPRequest(req, res);
        });

        await new Promise<void>((resolve, reject) => {
            this.httpServer!.listen(MCP_HTTP_PORT, '127.0.0.1', () => {
                tools.log.info(`[MCP] Streamable HTTP Server listening on http://127.0.0.1:${MCP_HTTP_PORT}/mcp`);
                resolve();
            });
            this.httpServer!.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    tools.log.warn(`[MCP] Port ${MCP_HTTP_PORT} is in use, Streamable HTTP disabled`);
                    resolve(); // 不阻止启动
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * 处理 HTTP 请求
     */
    private async handleHTTPRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // 设置 CORS 头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = req.url || '/';

        try {
            if (url === '/mcp' || url.startsWith('/mcp?')) {
                switch (req.method) {
                    case 'POST':
                        await this.handleMCPPost(req, res);
                        break;
                    case 'GET':
                        await this.handleMCPGet(req, res);
                        break;
                    case 'DELETE':
                        await this.handleMCPDelete(req, res);
                        break;
                    default:
                        res.writeHead(405, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Method not allowed' }));
                }
            } else if (url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'ok',
                    transport: 'streamable-http',
                    port: MCP_HTTP_PORT,
                    activeSessions: this.mcpSessions.size
                }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        } catch (err) {
            tools.log.error('[MCP] HTTP request error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    }

    /**
     * 处理 MCP POST 请求
     */
    private async handleMCPPost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        
        try {
            const request = JSON.parse(body);
            tools.log.info(`[MCP] Received: ${request.method}`);
            
            let sessionId = req.headers['mcp-session-id'] as string;
            
            // 处理 MCP 协议请求
            const response = await this.handleMCPProtocol(request, sessionId, (newSessionId) => {
                sessionId = newSessionId;
            });
            
            res.setHeader('Content-Type', 'application/json');
            if (sessionId) {
                res.setHeader('Mcp-Session-Id', sessionId);
            }
            
            res.writeHead(200);
            res.end(JSON.stringify(response));
            
        } catch (err) {
            tools.log.error('[MCP] POST error:', err);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' }
            }));
        }
    }

    /**
     * 处理 MCP GET 请求（SSE 连接）
     */
    private async handleMCPGet(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const sessionId = req.headers['mcp-session-id'] as string;
        
        if (!sessionId || !this.mcpSessions.has(sessionId)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Mcp-Session-Id': sessionId
        });

        const session = this.mcpSessions.get(sessionId)!;
        session.sseResponse = res;

        res.write(`event: open\ndata: {"status": "connected"}\n\n`);

        req.on('close', () => {
            if (session.sseResponse === res) {
                session.sseResponse = undefined;
            }
        });

        // 心跳
        const heartbeat = setInterval(() => {
            if (session.sseResponse === res) {
                try { res.write(`: heartbeat\n\n`); } catch { clearInterval(heartbeat); }
            } else {
                clearInterval(heartbeat);
            }
        }, 30000);
    }

    /**
     * 处理 MCP DELETE 请求
     */
    private async handleMCPDelete(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const sessionId = req.headers['mcp-session-id'] as string;
        
        if (sessionId && this.mcpSessions.has(sessionId)) {
            const session = this.mcpSessions.get(sessionId)!;
            if (session.sseResponse) {
                try { session.sseResponse.end(); } catch {}
            }
            this.mcpSessions.delete(sessionId);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'session terminated' }));
    }

    /**
     * 处理 MCP 协议请求
     */
    private async handleMCPProtocol(
        request: any, 
        sessionId: string | undefined,
        onNewSession: (id: string) => void
    ): Promise<any> {
        const { id, method, params } = request;

        // 处理 initialize
        if (method === 'initialize') {
            const newSessionId = crypto.randomUUID();
            this.mcpSessions.set(newSessionId, { id: newSessionId, createdAt: Date.now() });
            onNewSession(newSessionId);
            
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: {
                        name: 'y3-helper',
                        version: '1.0.0'
                    }
                }
            };
        }

        // 验证会话
        if (!sessionId || !this.mcpSessions.has(sessionId)) {
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32600, message: 'Invalid session' }
            };
        }

        // 处理 notifications/initialized
        if (method === 'notifications/initialized') {
            return { jsonrpc: '2.0', id, result: {} };
        }

        // 处理 tools/list
        if (method === 'tools/list') {
            return {
                jsonrpc: '2.0',
                id,
                result: {
                    tools: [
                        { name: 'launch_game', description: '启动游戏', inputSchema: { type: 'object', properties: {} } },
                        { name: 'get_game_status', description: '获取游戏状态', inputSchema: { type: 'object', properties: {} } },
                        { name: 'execute_lua', description: '执行 Lua 代码', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
                        { name: 'quick_restart', description: '快速重启游戏', inputSchema: { type: 'object', properties: {} } },
                        { name: 'stop_game', description: '停止游戏', inputSchema: { type: 'object', properties: {} } },
                        { name: 'get_logs', description: '获取游戏日志', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
                        { name: 'capture_screenshot', description: '截图', inputSchema: { type: 'object', properties: {} } }
                    ]
                }
            };
        }

        // 处理 tools/call
        if (method === 'tools/call') {
            const toolName = params?.name;
            const toolArgs = params?.arguments || {};
            
            try {
                let result;
                switch (toolName) {
                    case 'launch_game':
                        result = await this.sessionManager.launchGame(toolArgs);
                        break;
                    case 'get_game_status':
                        result = this.sessionManager.getGameStatus();
                        break;
                    case 'execute_lua':
                        result = await this.sessionManager.executeLua(toolArgs);
                        break;
                    case 'quick_restart':
                        result = await this.sessionManager.quickRestart();
                        break;
                    case 'stop_game':
                        result = await this.sessionManager.stopGame(toolArgs);
                        break;
                    case 'get_logs':
                        result = await this.sessionManager.getLogs(toolArgs);
                        break;
                    case 'capture_screenshot':
                        result = await this.sessionManager.captureScreenshot();
                        break;
                    default:
                        return {
                            jsonrpc: '2.0',
                            id,
                            error: { code: -32601, message: `Unknown tool: ${toolName}` }
                        };
                }
                
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
                    }
                };
            } catch (err) {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
                        isError: true
                    }
                };
            }
        }

        return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` }
        };
    }

    /**
     * 读取请求体
     */
    private readBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });
    }

    /**
     * 处理 TCP 客户端连接（兼容旧模式）
     */
    private handleTCPConnection(socket: net.Socket): void {
        let buffer = '';

        socket.on('data', (data) => {
            buffer += data.toString();

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const request = JSON.parse(line) as TCPRequest;
                        this.handleTCPRequest(request).then(response => {
                            socket.write(JSON.stringify(response) + '\n');
                        });
                    } catch (err) {
                        const errorResponse: TCPResponse = {
                            id: '',
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

        socket.on('error', (err) => {
            tools.log.error('[TCP Server] Socket error:', err);
        });
    }

    /**
     * 处理 TCP 请求
     */
    private async handleTCPRequest(request: TCPRequest): Promise<TCPResponse> {
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
                case 'quick_restart':
                    result = await this.sessionManager.quickRestart();
                    break;
                case 'capture_screenshot':
                    result = await this.sessionManager.captureScreenshot();
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

    /**
     * 清理资源
     */
    dispose(): void {
        // 关闭 MCP 会话
        this.mcpSessions.forEach(session => {
            if (session.sseResponse) {
                try { session.sseResponse.end(); } catch {}
            }
        });
        this.mcpSessions.clear();

        // 关闭 TCP 连接
        this.connections.forEach(socket => socket.destroy());
        this.connections.clear();

        // 关闭服务器
        this.server?.close();
        this.httpServer?.close();

        // 清理会话管理器
        this.sessionManager.dispose();
    }
}