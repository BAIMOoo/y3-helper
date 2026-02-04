import { StdioTransport } from './transport';
import { MCPProtocol } from './protocol';
import { TCPClient } from './tcpClient';
import { ToolRegistry } from './tools';

/**
 * MCP Server 主入口
 */
async function main() {
    try {
        console.error('[MCP] Starting MCP Server...');

        // 1. 连接到扩展的 TCP 服务器
        const tcpClient = new TCPClient();
        await tcpClient.connect();
        console.error('[MCP] Connected to VSCode extension');

        // 2. 初始化工具注册表
        const toolRegistry = new ToolRegistry(tcpClient);

        // 3. 初始化 MCP 协议处理器
        const protocol = new MCPProtocol(toolRegistry);

        // 4. 启动 stdio 传输层
        const transport = new StdioTransport(protocol);
        await transport.start();

        console.error('[MCP] MCP Server started successfully');

        // 处理进程退出
        process.on('SIGINT', () => {
            console.error('[MCP] Shutting down...');
            tcpClient.disconnect();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.error('[MCP] Shutting down...');
            tcpClient.disconnect();
            process.exit(0);
        });

    } catch (error) {
        console.error('[MCP] Failed to start MCP Server:', error);
        process.exit(1);
    }
}

// 启动服务器
main();
