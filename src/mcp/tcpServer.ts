import * as vscode from 'vscode';
import * as net from 'net';
import * as tools from '../tools';
import { getTCPConfig, TCPRequest, TCPResponse } from './types';
import { GameSessionManager } from './gameSessionManager';

/**
 * TCP 服务器（扩展侧）
 * 监听 TCP Socket，处理来自 MCP Server 子进程的请求
 */
export class TCPServer extends vscode.Disposable {
    private server?: net.Server;
    private sessionManager: GameSessionManager;
    private connections: Set<net.Socket> = new Set();

    constructor() {
        super(() => this.dispose());
        this.sessionManager = new GameSessionManager();
    }

    /**
     * 启动 TCP 服务器
     */
    async start(): Promise<void> {
        const config = getTCPConfig();

        this.server = net.createServer((socket) => {
            this.connections.add(socket);
            this.handleConnection(socket);

            socket.on('close', () => {
                this.connections.delete(socket);
            });
        });

        await new Promise<void>((resolve, reject) => {
            this.server!.listen(config.port, config.host, () => {
                tools.log.info(`[TCP Server] Listening on ${config.host}:${config.port}`);
                resolve();
            });
            this.server!.on('error', reject);
        });
    }

    /**
     * 处理客户端连接
     */
    private handleConnection(socket: net.Socket): void {
        let buffer = '';

        socket.on('data', (data) => {
            buffer += data.toString();

            // 处理完整的 JSON 消息（以换行符分隔）
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const request = JSON.parse(line) as TCPRequest;
                        this.handleRequest(request).then(response => {
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
    private async handleRequest(request: TCPRequest): Promise<TCPResponse> {
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
        // 关闭所有连接
        this.connections.forEach(socket => socket.destroy());
        this.connections.clear();

        // 关闭服务器
        if (this.server) {
            this.server.close();
        }

        // 清理会话管理器
        this.sessionManager.dispose();
    }
}
