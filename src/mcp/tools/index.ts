import { TCPClient } from '../tcpClient';

/**
 * 工具定义接口
 */
export interface Tool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

/**
 * 工具注册表
 * 管理所有可用的 MCP 工具
 */
export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();

    constructor(private tcpClient: TCPClient) {
        this.registerTools();
    }

    /**
     * 注册所有工具
     */
    private registerTools(): void {
        // 注册 launch_game 工具
        this.tools.set('launch_game', {
            name: 'launch_game',
            description: '启动 Y3 游戏。',
            inputSchema: {
                type: 'object',
                properties: {
                    attach_debugger: {
                        type: 'boolean',
                        description: '是否附加调试器',
                        default: false
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

        // 注册 quick_restart 工具
        this.tools.set('quick_restart', {
            name: 'quick_restart',
            description: '快速重启游戏（.rr 命令）。重新加载所有 Lua 脚本，无需完全重启游戏进程。适用于代码修改后快速测试。',
            inputSchema: {
                type: 'object',
                properties: {}
            }
        });
    }

    /**
     * 列出所有工具
     */
    listTools(): Tool[] {
        return Array.from(this.tools.values());
    }

    /**
     * 调用工具
     */
    async callTool(name: string, args: any): Promise<any> {
        if (!this.tools.has(name)) {
            throw new Error(`Unknown tool: ${name}`);
        }

        // 通过 TCP 调用扩展的方法
        const result = await this.tcpClient.call(name, args);
        return result;
    }
}
