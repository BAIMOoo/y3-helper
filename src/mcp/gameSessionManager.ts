import * as vscode from 'vscode';
import { GameLauncher } from '../launchGame';
import { Client } from '../console/client';
import { LogManager } from './logManager';
import { GameSession, MCPError, MCPErrorCode } from './types';
import * as env from '../env';
import * as tools from '../tools';

/**
 * 游戏会话管理器
 * 管理游戏会话生命周期、客户端监控、日志拦截
 */
export class GameSessionManager extends vscode.Disposable {
    private currentSession?: GameSession;
    private clientCheckInterval?: NodeJS.Timeout;

    constructor() {
        super(() => this.dispose());
        this.startClientMonitoring();
    }

    /**
     * 启动游戏
     */
    async launchGame(options: any = {}): Promise<any> {
        // 如果已有运行中的会话，先停止
        if (this.currentSession && this.currentSession.status !== 'stopped') {
            await this.stopGame();
        }

        // 等待环境就绪
        await env.env.editorReady();
        await env.env.mapReady();

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
            // MCP 自动启动游戏时不允许附加调试器
            const luaArgs: Record<string, string> = {};

            // 启动游戏
            await session.launcher.launch(
                luaArgs,
                options.multi_mode || false,
                options.multi_players,
                options.tracy || false
            );

            // 等待客户端连接（最多 60 秒，考虑到部分电脑启动较慢）
            const connected = await this.waitForClient(session, 60000);

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
            throw new MCPError(
                `游戏启动失败: ${error instanceof Error ? error.message : String(error)}`,
                MCPErrorCode.GAME_LAUNCH_FAILED,
                { originalError: error }
            );
        }
    }

    /**
     * 等待客户端连接
     */
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

    /**
     * 监控客户端连接
     */
    private startClientMonitoring(): void {
        this.clientCheckInterval = setInterval(() => {
            if (this.currentSession) {
                // 检查新客户端连接（启动或重启后）
                if ((this.currentSession.status === 'launching' || this.currentSession.status === 'restarting')
                    && !this.currentSession.client) {
                    const latestClient = Client.allClients[Client.allClients.length - 1];
                    if (latestClient) {
                        this.attachClient(this.currentSession, latestClient);
                    }
                }

                // 检查客户端断开
                if (this.currentSession.status === 'running' && this.currentSession.client) {
                    // 检查客户端是否还在 allClients 数组中
                    const clientExists = Client.allClients.includes(this.currentSession.client);
                    if (!clientExists) {
                        tools.log.info(`[MCP] Client disconnected from session ${this.currentSession.id}`);
                        this.currentSession.status = 'stopped';
                        this.currentSession.client = undefined;
                    }
                }

                // 检查重启后的重新连接
                if (this.currentSession.status === 'restarting' && this.currentSession.client) {
                    // 检查客户端是否断开
                    const clientExists = Client.allClients.includes(this.currentSession.client);
                    if (!clientExists) {
                        tools.log.info(`[MCP] Client disconnected during restart, waiting for reconnection...`);
                        this.currentSession.client = undefined;
                    }
                }
            }
        }, 500);
    }

    /**
     * 附加客户端并拦截日志
     */
    private attachClient(session: GameSession, client: Client): void {
        session.client = client;
        session.status = 'running';

        tools.log.info(`[MCP] Client attached to session ${session.id}`);

        // 拦截 print 方法
        const originalPrint = client.print.bind(client);
        client.print = (msg: string) => {
            session.logManager.appendLog(msg);
            return originalPrint(msg);
        };

        // 注意：Client 类没有 onDidDispose 方法
        // 客户端断开会通过 Client.allClients 数组的变化来检测
    }

    /**
     * 获取游戏状态
     */
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

    /**
     * 获取日志
     */
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

    /**
     * 执行 Lua 代码
     */
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

    /**
     * 快速重启游戏（.rr 命令）
     */
    async quickRestart(): Promise<any> {
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

        // 记录执行前的日志行数
        const logsBefore = await this.currentSession.logManager.readLogs(10000);
        const linesBefore = logsBefore.length;

        // 设置为重启状态
        this.currentSession.status = 'restarting';

        // 发送 .rr 命令
        this.currentSession.client.notify('command', { data: '.rr' });

        // 等待客户端重新连接（最多 10 秒）
        const reconnected = await this.waitForClient(this.currentSession, 10000);

        if (!reconnected) {
            this.currentSession.status = 'stopped';
            return {
                success: false,
                message: 'Game restart timeout - client did not reconnect'
            };
        }

        // 获取新增的日志
        const logsAfter = await this.currentSession.logManager.readLogs(10000);
        const newLogs = logsAfter.slice(linesBefore);

        return {
            success: true,
            message: 'Game restarted successfully',
            output: newLogs.join('\n')
        };
    }

    /**
     * 停止游戏
     */
    async stopGame(params: any = {}): Promise<any> {
        if (!this.currentSession) {
            return {
                success: false,
                message: 'No active session'
            };
        }

        const session = this.currentSession;

        // 通过 Lua 代码强制退出游戏
        if (session.client) {
            try {
                // 获取本地玩家并强制退出
                const luaCode = `
                    local player = y3.player:get_local()
                    if player then
                        GameAPI.role_force_quit(player.handle, '游戏已停止')
                    end
                `;
                session.client.notify('command', { data: luaCode });
                // 等待游戏关闭
                await new Promise(resolve => setTimeout(resolve, 1000));

                // 检查客户端是否还存在再 dispose
                if (session.client && typeof session.client.dispose === 'function') {
                    session.client.dispose();
                }
            } catch (err) {
                // 忽略错误，继续清理
            }
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

    /**
     * 清理资源
     */
    dispose(): void {
        if (this.clientCheckInterval) {
            clearInterval(this.clientCheckInterval);
        }

        if (this.currentSession) {
            this.stopGame();
        }
    }
}
