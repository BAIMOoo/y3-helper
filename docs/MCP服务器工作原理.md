MCP 服务器工作原理
1. 架构概览

┌─────────────────────────────────────────────────────────────┐
│                      Claude AI (客户端)                      │
│  - 接收用户指令                                               │
│  - 决策需要使用哪个工具                                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ JSON-RPC 2.0 (stdio)
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                   MCP Server (中间层)                        │
│  [server.ts] → [protocol.ts] → [tools/index.ts]            │
│  - 接收 AI 的工具调用请求                                     │
│  - 解析 JSON-RPC 协议                                        │
│  - 路由到对应的工具                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │ TCP Socket
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              VSCode Extension (实际执行层)                   │
│  - 启动游戏                                                  │
│  - 执行 Lua 代码                                             │
│  - 获取日志                                                  │
│  - 控制游戏会话                                              │
└─────────────────────────────────────────────────────────────┘

2. AI 如何知道使用什么工具？
关键在于 工具描述（Tool Description）。查看 tools/index.ts:30-107：


// 每个工具都有清晰的描述
this.tools.set('launch_game', {
    name: 'launch_game',
    description: '启动 Y3 游戏。',  // ← AI 通过这个理解工具用途
    inputSchema: {
        type: 'object',
        properties: {
            attach_debugger: {
                type: 'boolean',
                description: '是否附加调试器',  // ← 参数说明
                default: false
            }
        }
    }
});
AI 的决策流程：

初始化阶段 - AI 调用 tools/list 获取所有可用工具
理解能力 - AI 读取每个工具的 description 和 inputSchema
用户请求 - 用户说："帮我启动游戏"
智能匹配 - AI 分析：
"启动游戏" → 匹配到 launch_game 工具的描述
需要调试器吗？→ 检查 attach_debugger 参数
调用工具 - AI 发送 tools/call 请求：

{
  "method": "tools/call",
  "params": {
    "name": "launch_game",
    "arguments": { "attach_debugger": false }
  }
}

3. 完整的调用流程
以"启动游戏"为例：


用户: "帮我启动游戏并附加调试器"
  ↓
Claude AI 分析:
  - 关键词: "启动游戏" → launch_game 工具
  - 关键词: "附加调试器" → attach_debugger: true
  ↓
发送 JSON-RPC 请求 (通过 stdio):
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "launch_game",
      "arguments": { "attach_debugger": true }
    }
  }
  ↓
MCP Server 接收 (protocol.ts:84-102):
  - 解析请求
  - 调用 toolRegistry.callTool('launch_game', {...})
  ↓
ToolRegistry 转发 (tools/index.ts:120-128):
  - 通过 TCP 发送到 VSCode Extension
  - await tcpClient.call('launch_game', args)
  ↓
VSCode Extension 执行:
  - 实际启动游戏进程
  - 附加调试器
  - 返回结果
  ↓
结果返回给 AI:
  {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
      "content": [
        { "type": "text", "text": "游戏已启动，调试器已附加" }
      ]
    }
  }
  ↓
AI 回复用户: "✅ 游戏已成功启动，调试器已附加"

4. 为什么 AI 能做出正确决策？
这是 大语言模型的核心能力：

语义理解 - AI 理解自然语言和工具描述的语义关联
上下文推理 - 根据对话上下文判断用户意图
参数推断 - 从用户话语中提取参数值
工具组合 - 可以连续调用多个工具完成复杂任务
示例对比：

用户说法	AI 推理	调用工具
"启动游戏"	简单启动	launch_game({attach_debugger: false})
"启动游戏并调试"	需要调试器	launch_game({attach_debugger: true})
"游戏日志有什么？"	查看日志	get_logs({limit: 100})
"在游戏里执行 print('hello')"	执行代码	execute_lua({code: "print('hello')"})

5. 关键设计要点
查看当前注册的 6 个工具 (tools/index.ts:30-108)：

✅ launch_game - 启动游戏
✅ get_logs - 获取日志
✅ execute_lua - 执行 Lua 代码
✅ stop_game - 停止游戏
✅ get_game_status - 获取状态
✅ quick_restart - 快速重启
每个工具的 description 都是 AI 理解工具用途的唯一依据，所以描述必须：

清晰明确
包含关键词
说明使用场景
描述参数含义
总结：MCP 服务器本质上是一个 工具注册中心 + RPC 路由器，AI 通过读取工具描述来理解能力边界，然后根据用户意图智能选择和调用工具。这就是为什么 AI 能"知道"什么时候该用什么工具