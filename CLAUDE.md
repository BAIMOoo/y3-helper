# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 重要规则

**始终使用中文回复用户。**

## 项目概述

Y3-Helper 是一个用于 Y3 游戏编辑器（又名 CliCli）的 VSCode 扩展。它提供开发辅助功能，包括游戏启动、物编数据管理、Lua 调试、ECA 转 Lua 编译，以及用于批量修改的插件系统。

**发布者**: sumneko
**扩展依赖**: 需要 `sumneko.lua` 扩展

## 构建命令

```bash
npm run compile          # 开发构建 (webpack --mode none)
npm run watch            # 监听模式，用于开发
npm run lint             # ESLint 检查 (src/**/*.ts)
npm run pretest          # 编译 + lint
npm run test             # 通过 @vscode/test-electron 运行集成测试
npm run feasibility_test # 运行可行性测试
npm run vscode:prepublish # 生产构建，用于发布
```

## 开发流程

1. 运行 `npm install` 安装依赖
2. 按 `Ctrl+Shift+B` 启动监听模式编译
3. 按 `F5` 启动扩展开发宿主进行测试

## 架构

### 入口点
- `src/extension.ts` - 主激活点，注册命令并初始化子系统
- `src/y3-helper.ts` - 为插件导出的公共 API（重新导出 tools、env、table、excel 模块）

### 核心子系统

| 模块 | 用途 |
|------|------|
| `src/env.ts` | 环境检测 - 查找 Y3 编辑器、地图、项目配置 |
| `src/mainMenu/` | 侧边栏 UI 树视图和导航页面 |
| `src/editorTable/` | 物编数据管理（单位、技能、物品等） |
| `src/editorTable/excel/` | 物编数据的 Excel 文件导入/导出 |
| `src/editorTable/languageFeature/` | 物编 JSON 文件的语言功能 |
| `src/console/` | 游戏控制台通信（客户端/服务器/终端） |
| `src/luaLanguage/` | Lua 语言支持（补全、定义、悬停、内联提示） |
| `src/metaBuilder/` | 生成自定义事件、UI、属性的 TypeScript/Lua 元数据 |
| `src/ecaCompiler/` | 将 ECA（事件-条件-动作）可视化脚本编译为 Lua |
| `src/plugin/` | 用户插件系统 - 运行地图目录中的 JavaScript 脚本 |
| `src/customDefine/` | 自定义定义管理（事件、UI、字体、属性） |
| `src/tools/` | 工具函数（fs、json、lua 解析、日志、下载） |

### 初始化流程
`activate()` → `Helper.start()` → 注册命令 → 通过 `setTimeout` 初始化子系统：
- mainMenu、metaBuilder、debug、console、editorTable、plugin、globalScript、luaLanguage、ecaCompiler

### 路径别名 (tsconfig.json)
- `y3-helper` → `./src/y3-helper`
- `map-declare` → `./src/map-declare`

## 关键模式

### 本地化
使用 `@vscode/l10n`，模式为 `l10n.t('中文字符串')`。本地化文件位于 `l10n/` 和 `package.nls*.json`。

### 物编类型
定义在 `src/helper_meta/editor/` - unit（单位）、ability（技能）、item（物品）、modifier（魔法效果）、projectile（投射物）、decoration（装饰物）、destructible（可破坏物）、sound（声音）、tech（科技）。

### 插件系统
插件是位于用户地图 `script/y3-helper/plugin/` 目录中的 JavaScript 文件。它们通过 `y3-helper` 模块导出访问扩展 API。

## ESLint 配置
- 解析器: `@typescript-eslint/parser`
- 忽略: `out/`、`dist/`、`3rd/`、`**/*.d.ts`、`template/`
- 主要规则: semi (warn)、curly (warn)、eqeqeq (warn)、no-throw-literal (warn)

## 输出目录
- `dist/` - Webpack 打包输出（生产环境）
- `out/` - TypeScript 编译输出（用于测试）
- `tmp/types/` - 生成的声明文件

## 核心功能流程

### "启动游戏"功能流程

用户点击侧边栏"启动游戏"按钮（快捷键 `Shift + F5`）的完整执行流程：

#### 1. UI 入口
- 文件：`src/mainMenu/pages/features.ts:158-243`
- 触发命令：`y3-helper.launchGame`

#### 2. 命令处理
- 文件：`src/extension.ts:202-245`
- 读取配置：tracy、attachWhenLaunch、multiMode、debugPlayers
- 构建 luaArgs 参数
- 创建 `GameLauncher` 实例

#### 3. 启动流程（`src/launchGame.ts:33-106`）

```
┌─────────────────────────────────────────────────────────┐
│ 1. 等待环境就绪                                          │
│    env.editorReady() / env.mapReady()                   │
├─────────────────────────────────────────────────────────┤
│ 2. 验证路径                                              │
│    - projectUri (项目路径)                               │
│    - editorExeUri (编辑器可执行文件)                      │
│    - map (选中的地图)                                    │
├─────────────────────────────────────────────────────────┤
│ 3. 检查版本更新                                          │
│    y3.version.askUpdate()                               │
├─────────────────────────────────────────────────────────┤
│ 4. 运行插件钩子                                          │
│    y3.plugin.runAllPlugins(map, 'onGame')               │
│    允许用户插件在游戏启动前执行自定义逻辑                  │
├─────────────────────────────────────────────────────────┤
│ 5. 构建启动参数                                          │
│    - type@editor_game                                   │
│    - subtype@editor_game (单人) 或                       │
│      subtype@editor_multi_game (多开)                   │
│    - editor_map_path@<项目路径>                          │
│    - level_id@<地图ID>                                  │
│    - release@true                                       │
│    - lua_wait_debugger@true (如需调试)                  │
│    - lua_multi_mode@true (多开模式)                     │
│    - 其他自定义 luaArgs                                 │
├─────────────────────────────────────────────────────────┤
│ 6. 更新通信端口文件                                      │
│    updateHelperPortFile()                               │
│    写入 log/helper_port.lua 到所有地图                   │
│    游戏启动后读取此端口连接到 VSCode                      │
├─────────────────────────────────────────────────────────┤
│ 7. 执行编辑器启动游戏                                    │
│    runShell(Editor.exe, [                               │
│      --dx11,                                            │
│      --start=Python,                                    │
│      --python-args=<参数>,                              │
│      --plugin-config=Plugins-PyQt,                      │
│      --console, --luaconsole (单人模式)                 │
│    ])                                                   │
├─────────────────────────────────────────────────────────┤
│ 8. 可选：启动 Tracy 性能分析工具                          │
│    y3.tracy.launch() (如果启用)                         │
├─────────────────────────────────────────────────────────┤
│ 9. 可选：附加调试器                                      │
│    debug.attach() (如果配置了启动后立即附加)              │
└─────────────────────────────────────────────────────────┘
```

#### 4. Shell 执行
- 文件：`src/runShell.ts`
- 通过 VSCode Task API 执行编辑器命令
- 等待进程结束并返回退出码

#### 5. 游戏连接
- 文件：`src/console/index.ts`
- 游戏启动后读取 `helper_port.lua` 中的端口
- 连接到 VSCode 的 `ConsoleServer`
- 实现功能：远程终端、热重载、自定义视图、调试器通信

#### 涉及的关键文件

| 文件 | 职责 |
|------|------|
| `src/mainMenu/pages/features.ts` | UI 树节点定义和命令绑定 |
| `src/extension.ts` | 命令注册和配置读取 |
| `src/launchGame.ts` | 核心启动逻辑（GameLauncher 类） |
| `src/runShell.ts` | Shell 命令执行封装 |
| `src/console/index.ts` | 游戏通信端口管理 |
| `src/config.ts` | 配置项管理（multiMode、tracy 等） |
| `src/env.ts` | 环境检测和路径管理 |
