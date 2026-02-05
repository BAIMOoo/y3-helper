# Y3-Helper MCP Server 使用指南

## 目录

- [简介](#简介)
- [功能特性](#功能特性)
- [安装配置](#安装配置)
- [工具说明](#工具说明)
- [使用示例](#使用示例)
- [常见问题](#常见问题)

---

## 简介

Y3-Helper MCP Server 是一个基于 Model Context Protocol (MCP) 的服务，让 Claude Code 能够自动化控制 Y3 游戏的开发、测试和调试流程。

通过 MCP Server，Claude Code 可以：
- 🎮 自动启动和停止游戏
- 📊 实时监控游戏运行状态
- 📝 获取游戏控制台日志
- 💻 在运行时执行 Lua 代码
- 🔄 快速重启游戏（.rr）进行测试

这使得 Claude Code 能够实现完整的**开发-测试-调试循环**，无需手动操作。

---

## 功能特性

### 核心功能

| 功能 | 说明 |
|------|------|
| **游戏启动** | 自动启动 Y3 游戏，支持调试器附加、多开模式、Tracy 性能分析 |
| **状态监控** | 实时获取游戏运行状态、会话 ID、运行时长 |
| **日志获取** | 读取游戏控制台日志，支持指定行数 |
| **代码执行** | 在运行的游戏中执行 Lua 代码，立即查看结果 |
| **快速重启** | 执行 .rr 命令重新加载脚本，无需完全重启 |
| **游戏停止** | 优雅地关闭游戏进程 |

### 技术特点

- ✅ **跨权限通信**：使用 TCP Socket，支持管理员权限的 VSCode 与普通权限的 Claude Code 通信
- ✅ **自动重连**：快速重启时自动检测客户端重新连接
- ✅ **日志轮转**：自动管理日志文件，最多保留 5 个日志文件
- ✅ **会话管理**：完整的游戏会话生命周期管理

---

## 安装配置

### 前置要求

1. 已安装 Y3-Helper VSCode 扩展
2. 已安装 Claude Code CLI 工具
3. Node.js 环境（扩展已包含）

### 配置步骤

#### 步骤 1：启动 MCP Server（VSCode 侧）

1. 在 VSCode 中打开 Y3 项目
2. 打开 Y3-Helper 侧边栏
3. 展开 **"功能"** → **"MCP Server"**
4. 点击 **"启动 MCP Server"**

你应该会看到提示："MCP Server 已启动"

#### 步骤 2：配置 Claude Code（用户侧）

扩展安装后，`mcp-server.js` 文件位于 VSCode 扩展目录中。

**查找扩展安装路径：**

1. 在 VSCode 中按 `Ctrl+Shift+P`（macOS: `Cmd+Shift+P`）
2. 输入 "Developer: Open Extensions Folder"
3. 找到 `sumneko.y3-helper-1.21.6` 目录
4. MCP Server 文件位于该目录下的 `dist/mcp-server.js`

**常见安装路径：**

- **Windows**: `C:\Users\<用户名>\.vscode\extensions\sumneko.y3-helper-1.21.6\dist\mcp-server.js`
- **macOS**: `~/.vscode/extensions/sumneko.y3-helper-1.21.6/dist/mcp-server.js`
- **Linux**: `~/.vscode/extensions/sumneko.y3-helper-1.21.6/dist/mcp-server.js`

**配置命令：**

**Windows (WSL):**
```bash
claude mcp add -s user y3-helper -- node /mnt/c/Users/<用户名>/.vscode/extensions/sumneko.y3-helper-1.21.6/dist/mcp-server.js
```

**Windows (PowerShell):**
```powershell
claude mcp add -s user y3-helper -- node.exe "C:\Users\<用户名>\.vscode\extensions\sumneko.y3-helper-1.21.6\dist\mcp-server.js"
```

**macOS/Linux:**
```bash
claude mcp add -s user y3-helper -- node ~/.vscode/extensions/sumneko.y3-helper-1.21.6/dist/mcp-server.js
```

> **注意**：
> - 使用 `-s user` 参数配置为**用户级别全局配置**，在任何目录下都可用
> - 替换 `<用户名>` 为你的实际用户名
> - 版本号 `1.21.6` 可能会变化，请根据实际安装的版本调整
> - Windows 用户在 WSL 中使用 `node.exe`，在 PowerShell 中使用 `node`

#### 步骤 3：验证配置

运行以下命令验证 MCP Server 是否配置成功：

```bash
claude mcp list
```

你应该看到：
```
y3-helper: node.exe C:\Users\...\mcp-server.js - ✓ Connected
```

#### 步骤 4：在 Claude 终端中测试

打开一个新的 Claude 终端，输入：
```
/mcp
```

你应该能看到 6 个 y3-helper 工具：
- launch_game
- get_game_status
- get_logs
- execute_lua
- quick_restart
- stop_game

---

## 工具说明

### 1. launch_game - 启动游戏

**功能**：启动 Y3 游戏。

**参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `attach_debugger` | boolean | `false` | 是否附加调试器 |

**返回**：
```json
{
  "success": true,
  "session_id": "session_1234567890",
  "status": "running",
  "message": "Game launched successfully"
}
```

**注意**：如需多开模式、Tracy 性能分析等高级功能，请在 VSCode 的 Y3-Helper 配置中设置。

---

### 2. get_game_status - 获取游戏状态

**功能**：获取当前游戏运行状态。

**参数**：无

**返回**：
```json
{
  "running": true,
  "session_id": "session_1234567890",
  "status": "running",
  "uptime": 120000
}
```

---

### 3. get_logs - 获取游戏日志

**功能**：读取游戏控制台日志。

**参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `limit` | number | `100` | 返回最近 N 条日志 |

**返回**：
```json
{
  "success": true,
  "logs": [
    "[2024-02-04 10:30:15] Game started",
    "[2024-02-04 10:30:16] Loading scripts..."
  ]
}
```

---

### 4. execute_lua - 执行 Lua 代码

**功能**：在运行的游戏中执行 Lua 代码。

**参数**：

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `code` | string | ✅ | 要执行的 Lua 代码 |

**返回**：
```json
{
  "success": true,
  "output": "执行结果和输出"
}
```

---

### 5. quick_restart - 快速重启

**功能**：执行 `.rr` 命令，重新加载所有 Lua 脚本，无需完全重启游戏进程。

**参数**：无

**返回**：
```json
{
  "success": true,
  "message": "Game restarted successfully",
  "output": "重启过程的日志输出"
}
```

**特点**：
- 自动检测客户端断开和重连
- 保持游戏会话状态为 `running`
- 适用于代码修改后快速测试

---

### 6. stop_game - 停止游戏

**功能**：优雅地关闭游戏进程。

**参数**：无

**返回**：
```json
{
  "success": true,
  "message": "Game stopped"
}
```

**实现**：使用 `GameAPI.role_force_quit()` 强制退出玩家，确保游戏窗口正确关闭。

---

## 使用示例

### 示例 1：基本开发流程

```
用户：启动游戏

Claude：[调用 launch_game 工具]
游戏已成功启动！会话 ID: session_1234567890

用户：在游戏中打印 "Hello World"

Claude：[调用 execute_lua 工具，代码: print("Hello World")]
执行成功！输出：Hello World

用户：获取最近 20 条日志

Claude：[调用 get_logs 工具，limit: 20]
最近 20 条日志：
[2024-02-04 10:30:15] Game started
[2024-02-04 10:30:16] Loading scripts...
...
```

### 示例 2：代码修改后快速测试

```
用户：我修改了 main.lua 文件，帮我重新加载脚本并测试

Claude：好的，我来快速重启游戏重新加载脚本。
[调用 quick_restart 工具]
脚本已重新加载！现在可以测试新代码了。

用户：测试新功能是否正常

Claude：[调用 execute_lua 工具测试新功能]
测试结果：...
```

### 示例 3：调试流程

```
用户：启动游戏并附加调试器

Claude：[调用 launch_game 工具，attach_debugger: true]
游戏已启动，调试器已附加。

用户：检查某个变量的值

Claude：[调用 execute_lua 工具]
print(y3.game.some_variable)

[调用 get_logs 工具获取输出]
变量值为：...
```

### 示例 4：完整的开发循环

```
用户：帮我实现一个新功能：当玩家进入游戏时打印欢迎消息

Claude：好的，我来实现这个功能。

[Claude 修改代码文件]

现在让我启动游戏测试这个功能。
[调用 launch_game 工具]

游戏已启动。让我测试欢迎消息功能。
[调用 execute_lua 工具触发事件]

[调用 get_logs 工具查看输出]

功能测试成功！欢迎消息已正确显示。
```

---

## 常见问题

### Q1: 提示 "No MCP servers configured"

**原因**：MCP Server 未正确配置或配置为项目级别。

**解决方案**：
1. 确保使用 `-s user` 参数配置为用户级别
2. 重新运行配置命令
3. 关闭并重新打开 Claude 终端

### Q2: 提示 "Failed to connect"

**原因**：VSCode 扩展侧的 TCP Server 未启动。

**解决方案**：
1. 在 VSCode 中打开 Y3-Helper 侧边栏
2. 点击 "启动 MCP Server"
3. 确认看到 "MCP Server 已启动" 提示
4. 运行 `claude mcp list` 验证连接

### Q3: Windows UAC 弹窗问题

**原因**：游戏需要管理员权限，但 VSCode 以普通权限运行。

**解决方案**：
- **方案 1**：以管理员身份运行 VSCode（推荐）
- **方案 2**：取消游戏的管理员权限要求（如果游戏不需要）

> **注意**：MCP Server 使用 TCP Socket 通信，支持跨权限通信，因此管理员权限的 VSCode 可以与普通权限的 Claude Code 正常通信。

### Q4: quick_restart 后游戏状态显示已停止

**原因**：旧版本的 bug，已在最新版本修复。

**解决方案**：
1. 更新到最新版本的 Y3-Helper
2. 重新编译扩展：`npm run compile`
3. 重新加载 VSCode 窗口

### Q5: stop_game 无法关闭游戏窗口

**原因**：旧版本使用 `.exit` 命令，可能不可靠。

**解决方案**：
- 最新版本使用 `GameAPI.role_force_quit()` API，更可靠
- 更新到最新版本即可解决

### Q6: 如何查看 MCP Server 的日志？

**VSCode 侧**：
1. 打开输出面板（`Ctrl+Shift+U`）
2. 选择 "Y3-Helper" 频道
3. 查看 TCP Server 和游戏会话的日志

**Claude Code 侧**：
- MCP Server 的错误日志会输出到 stderr
- 可以在 Claude 终端中看到工具调用的结果

### Q7: 如何在不同项目中使用 MCP Server？

**解决方案**：
- 使用 `-s user` 配置为用户级别全局配置
- 在任何 Y3 项目目录下启动 Claude 都可以使用
- 只需在 VSCode 中打开对应项目并启动 MCP Server 即可

### Q8: 如何找到扩展的安装路径？

**方法 1：通过 VSCode 命令**
1. 在 VSCode 中按 `Ctrl+Shift+P`（macOS: `Cmd+Shift+P`）
2. 输入 "Developer: Open Extensions Folder"
3. 找到 `sumneko.y3-helper-1.21.6` 目录
4. 复制完整路径，MCP Server 位于 `dist/mcp-server.js`

**方法 2：手动查找**
- Windows: `C:\Users\<用户名>\.vscode\extensions\sumneko.y3-helper-1.21.6\`
- macOS/Linux: `~/.vscode/extensions/sumneko.y3-helper-1.21.6/`

**方法 3：通过命令行**
```bash
# Windows (PowerShell)
Get-ChildItem "$env:USERPROFILE\.vscode\extensions" | Where-Object Name -like "sumneko.y3-helper*"

# macOS/Linux
ls ~/.vscode/extensions | grep y3-helper
```

### Q9: 端口冲突怎么办？

**原因**：默认端口 25897 被占用。

**解决方案**：
1. 修改 `src/mcp/types.ts` 中的端口号
2. 重新编译：`npm run compile && npm run compile:mcp`
3. 重新配置 Claude Code MCP

---

## 技术架构

### 通信流程

```
┌─────────────────┐         TCP Socket          ┌──────────────────┐
│                 │      (127.0.0.1:25897)       │                  │
│  Claude Code    │◄────────────────────────────►│  VSCode 扩展     │
│  (MCP Client)   │                              │  (TCP Server)    │
│                 │                              │                  │
└─────────────────┘                              └──────────────────┘
                                                          │
                                                          │ 控制
                                                          ▼
                                                  ┌──────────────────┐
                                                  │                  │
                                                  │   Y3 游戏进程    │
                                                  │                  │
                                                  └──────────────────┘
```

### 组件说明

| 组件 | 职责 |
|------|------|
| **MCP Server** | 子进程，处理 Claude Code 的 MCP 请求 |
| **TCP Server** | VSCode 扩展侧，监听 TCP Socket，处理游戏控制 |
| **TCP Client** | MCP Server 侧，连接到 TCP Server |
| **GameSessionManager** | 管理游戏会话生命周期 |
| **LogManager** | 管理游戏日志文件，支持轮转 |

---

## 更新日志

### v1.22.0 (2024-02-04)

**新增功能**：
- ✨ 实现 MCP Server，支持 Claude Code 自动化控制游戏
- ✨ 添加 6 个 MCP 工具：launch_game、get_game_status、get_logs、execute_lua、quick_restart、stop_game
- ✨ 使用 TCP Socket 通信，支持跨权限通信

**改进**：
- 🔧 quick_restart 支持自动检测客户端重连
- 🔧 stop_game 使用 GameAPI.role_force_quit() 确保游戏正确关闭
- 🔧 launch_game 默认不附加调试器

**修复**：
- 🐛 修复 quick_restart 后游戏状态显示为已停止的问题
- 🐛 修复 stop_game 时 client.dispose() 错误
- 🐛 修复客户端断开检测逻辑

---

## 反馈与支持

如果你在使用过程中遇到问题或有改进建议，请：

1. 查看本文档的 [常见问题](#常见问题) 部分
2. 在 GitHub 仓库提交 Issue
3. 加入社区讨论

---

## 许可证

Y3-Helper 使用 MIT 许可证。详见 LICENSE 文件。
