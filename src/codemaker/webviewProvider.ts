import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { getCodeMakerConfig } from './configProvider';
import { handleExtendedMessage } from './messageHandlers';

/**
 * CodeMaker WebView 视图提供者
 * 在右侧 Secondary Side Bar 中展示 CodeMaker 完整 UI
 * 
 * 消息流与源码版完全一致：
 *   iframe(React) ←postMessage→ outer HTML ←postMessage→ VSCode Extension
 *   outer HTML 做全量双向转发，不拦截任何消息类型
 */
export class CodeMakerWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codemaker.webview';

    private _view?: vscode.WebviewView;
    private _apiServerPort: number = 3001;

    /** 源码版的 leftOverMessages 机制：在 webview 首次发消息前缓存待发送的消息 */
    private _hasInit: boolean = false;
    private _leftOverMessages: any[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {}

    /**
     * 设置 API Server 端口号（启动后回调）
     */
    public setApiServerPort(port: number) {
        this._apiServerPort = port;
        // 如果 WebView 已加载，刷新 iframe 并重新初始化
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview();
            // 重置 init 状态，因为 HTML 重载了
            this._hasInit = false;
        }
    }

    /**
     * 获取 WebviewView 实例
     */
    public get view(): vscode.WebviewView | undefined {
        return this._view;
    }

    // ─────────────────────────────────────────────
    //  resolveWebviewView —— 与源码版一致
    // ─────────────────────────────────────────────

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview();

        // ── 注册消息监听（与源码版一致：在 resolveWebviewView 内直接注册）──
        webviewView.webview.onDidReceiveMessage(async (message) => {
            // 收到消息可以认为 webview 已完成渲染，清空 leftOverMessages
            if (!this._hasInit) {
                this._hasInit = true;
                if (this._leftOverMessages.length > 0) {
                    setTimeout(() => {
                        for (const msg of this._leftOverMessages) {
                            this._sendToWebview(msg);
                        }
                        this._leftOverMessages = [];
                    }, 1000);
                }
            }
            this._handleMessage(message, webviewView.webview);
        });

        // ── 视图 dispose 时重置状态 ──
        webviewView.onDidDispose(() => {
            this._view = undefined;
            this._hasInit = false;
        });

        // 监听主题变化
        vscode.window.onDidChangeActiveColorTheme(() => {
            const themeStyle = [
                vscode.ColorThemeKind.Dark,
                vscode.ColorThemeKind.HighContrast
            ].includes(vscode.window.activeColorTheme.kind) ? 'dark' : 'light';

            this.sendMessage({
                type: 'THEME_CHANGED',
                data: { themeStyle },
            });
        });
    }

    // ─────────────────────────────────────────────
    //  消息处理 —— 对应源码版 handleMessage
    // ─────────────────────────────────────────────

    private async _handleMessage(message: any, webview: vscode.Webview) {
        // ── 所有消息都日志输出，便于排查 ──
        if (!['CONSOLE_LOG', 'CONSOLE_WARN', 'CONSOLE_ERROR', 'PRINT_LOG',
              'REPORT_CONSOLE_LOG', 'REPORT_CONSOLE_WARN', 'REPORT_CONSOLE_ERROR'].includes(message.type)) {
            console.log(`[CodeMaker MSG] type=${message.type}`);
        }

        switch (message.type) {
            case 'GET_INIT_DATA': {
                this._sendInitData(webview);
                break;
            }
            case 'GET_WORKSPACE_INFO': {
                this._sendWorkspaceInfo();
                break;
            }
            case 'COPY_TO_CLIPBOARD': {
                vscode.env.clipboard.writeText(message.data);
                break;
            }
            case 'OPEN_IN_BROWSER': {
                const url = message.data?.url;
                if (url) {
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
                break;
            }
            case 'KEYBOARD_PASTE': {
                vscode.env.clipboard.readText().then(text => {
                    if (text) {
                        this.sendMessage({
                            type: 'APPLY_KEYBOARD_PASTE',
                            data: text,
                        });
                    }
                });
                break;
            }
            case 'GET_WORKSPACE_FILES': {
                const keyword: string = message.data?.keyword ?? '';
                const max: number = message.data?.max ?? 50;
                this._searchWorkspaceFiles(keyword, max).then(files => {
                    this.sendMessage({
                        type: 'WORKSPACE_FILES',
                        data: files,
                    });
                });
                break;
            }
            case 'SEARCH_WORKSPACE_PATH': {
                const keyword: string = message.data?.keyword ?? '';
                const max: number = message.data?.max ?? 10;
                const searchType: string | undefined = message.data?.type; // "file" | "folder" | undefined
                this._searchWorkspacePaths(keyword, max, searchType).then(files => {
                    this.sendMessage({
                        type: 'WORKSPACE_FILES',
                        data: files,
                    });
                });
                break;
            }
            case 'TOOL_CALL': {
                this._handleToolCall(message.data);
                break;
            }
            default: {
                // 尝试使用扩展消息处理器（覆盖源码版 96 个 case 中的大部分）
                try {
                    const handled = await handleExtendedMessage(message, webview, this);
                    if (!handled) {
                        console.log('[CodeMaker] Unhandled message:', message.type);
                    }
                } catch (err) {
                    console.error('[CodeMaker] Error handling message:', message.type, err);
                }
                break;
            }
        }
    }

    // ─────────────────────────────────────────────
    //  发送 INIT_DATA —— 与源码版 sendInitData 一致
    // ─────────────────────────────────────────────

    private _sendInitData(targetWebview?: vscode.Webview) {
        const config = getCodeMakerConfig();

        const themeStyle = [
            vscode.ColorThemeKind.Dark,
            vscode.ColorThemeKind.HighContrast
        ].includes(vscode.window.activeColorTheme.kind) ? 'dark' : 'light';

        const initDataMessage = {
            type: 'INIT_DATA',
            data: {
                // 认证相关（Y3Helper 集成模式，使用本地凭证）
                username: 'y3helper-user',
                accessToken: 'y3helper-local',
                isLogin: true,

                // IDE 标识
                IDE: 'vscode',
                app_version: vscode.version,
                codeMakerVersion: '1.0.0',

                // 配置项
                codeChatApiKey: config.apiKey,
                codeChatApiBaseUrl: config.apiBaseUrl,
                codeChatModel: config.model,
                // 固定模型：非空时前端会锁定模型选择器，直接显示该值
                fixedModel: config.model,

                // UI 设置
                submitKey: 'Enter',
                themeStyle: themeStyle,
                enableAutoExecuteCommand: false,
                newCodeReview: true,

                // 源码版的默认值
                codeGenerateModel: '',
                codeGenerateModelCode: '',
                gatewayName: '',
                isMhxy: false,
                codebaseDefaultAuthorizationPath: [],
                codeBaseCheckCommands: [],
                currentFileAutoAttach: false,
                disableNewApply: false,
                planModeEnabled: false,
            },
        };

        if (targetWebview) {
            targetWebview.postMessage(initDataMessage);
        } else {
            this.sendMessage(initDataMessage);
        }
    }

    // ─────────────────────────────────────────────
    //  发送 SYNC_WORKSPACE_INFO —— 与源码版 getWorkspaceInfo 一致
    // ─────────────────────────────────────────────

    private _sendWorkspaceInfo() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspace = workspaceFolders?.[0]?.uri.fsPath || '';
        const repoName = workspaceFolders?.[0]?.name || '';

        let currentFilePath = '';
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            currentFilePath = editor.document.fileName;
        }

        let openFiles = vscode.workspace.textDocuments || [];
        openFiles = openFiles.filter((file) => {
            return file.fileName.indexOf(workspace) >= 0;
        });

        const shell = this._getShellFromEnv();

        this.sendMessage({
            type: 'SYNC_WORKSPACE_INFO',
            data: {
                workspace: workspace,
                repoUrl: '',
                repoName: repoName,
                repoType: 'git',
                osName: os.type(),
                shell: shell,
                currentFilePath: currentFilePath,
                openFilePaths: openFiles.map((f) => f.fileName),
                repoCodeTable: '',
                codebaseCustomPrompt: '',
            },
        });
    }

    private _getShellFromEnv(): string {
        const env = process.env;
        if (process.platform === 'win32') {
            return env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
        }
        if (process.platform === 'darwin') {
            return env.SHELL || '/bin/zsh';
        }
        return env.SHELL || '/bin/bash';
    }

    // ─────────────────────────────────────────────
    //  TOOL_CALL 处理 —— AI 模型调用的工具（read_file、list_files 等）
    // ─────────────────────────────────────────────

    /**
     * 处理前端发来的 TOOL_CALL 消息
     * AI 模型通过 function_call 调用 read_file / list_files 等工具时，
     * 前端会发送 TOOL_CALL，Extension 执行后返回 TOOL_CALL_RESULT
     */
    private async _handleToolCall(data: any) {
        const { tool_name, tool_params, tool_id } = data || {};
        if (!tool_name || !tool_id) {
            return;
        }

        console.log(`[CodeMaker] TOOL_CALL: ${tool_name}, id: ${tool_id}`);

        try {
            let result: any;
            switch (tool_name) {
                case 'read_file':
                    result = await this._toolReadFile(tool_params);
                    break;
                case 'list_files_top_level':
                    result = await this._toolListFiles(tool_params, false);
                    break;
                case 'list_files_recursive':
                    result = await this._toolListFiles(tool_params, true);
                    break;
                case 'view_source_code_definitions_top_level':
                    result = await this._toolViewDefinitions(tool_params);
                    break;
                case 'grep_search':
                    result = await this._toolGrepSearch(tool_params);
                    break;
                default:
                    result = {
                        content: `Tool "${tool_name}" is not supported in Y3Helper integration.`,
                        isError: true,
                    };
                    break;
            }

            this.sendMessage({
                type: 'TOOL_CALL_RESULT',
                data: {
                    tool_result: result,
                    tool_id: tool_id,
                    tool_name: tool_name,
                    extra: {},
                },
            });
        } catch (err: any) {
            console.error(`[CodeMaker] TOOL_CALL error (${tool_name}):`, err);
            this.sendMessage({
                type: 'TOOL_CALL_RESULT',
                data: {
                    tool_result: {
                        content: `Error executing ${tool_name}: ${err.message || err}`,
                        isError: true,
                    },
                    tool_id: tool_id,
                    tool_name: tool_name,
                    extra: {},
                },
            });
        }
    }

    /**
     * read_file 工具：读取指定文件内容
     * tool_params: { path: string, offset?: number, limit?: number }
     */
    private async _toolReadFile(params: any): Promise<any> {
        let filePath: string = params?.path || params?.file_path || '';
        if (!filePath) {
            return { content: 'Error: No file path provided.', isError: true };
        }

        // 如果是相对路径，解析为绝对路径
        if (!path.isAbsolute(filePath)) {
            const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspace) {
                filePath = path.join(workspace, filePath);
            }
        }

        try {
            const stat = await fs.promises.stat(filePath);
            if (stat.isDirectory()) {
                return { content: `Error: "${filePath}" is a directory, not a file.`, path: filePath, isError: true };
            }

            const buffer = await fs.promises.readFile(filePath, 'utf-8');
            let lines = buffer.split('\n');

            const offset = Math.max(0, (params?.offset || 1) - 1);
            const limit = params?.limit || 500;
            lines = lines.slice(offset, offset + limit);

            // 添加行号（cat -n 格式）
            const numbered = lines.map((line, i) => {
                const lineNum = offset + i + 1;
                return `${String(lineNum).padStart(6, ' ')}\t${line}`;
            }).join('\n');

            return {
                content: numbered,
                path: filePath,
                isError: false,
            };
        } catch (err: any) {
            return {
                content: `Error reading file "${filePath}": ${err.message}`,
                path: filePath,
                isError: true,
            };
        }
    }

    /**
     * list_files_top_level / list_files_recursive 工具
     * tool_params: { path: string }
     */
    private async _toolListFiles(params: any, recursive: boolean): Promise<any> {
        let dirPath: string = params?.path || '.';
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (!path.isAbsolute(dirPath)) {
            if (workspace) {
                dirPath = path.join(workspace, dirPath);
            }
        }

        try {
            const stat = await fs.promises.stat(dirPath);
            if (!stat.isDirectory()) {
                return { content: `Error: "${dirPath}" is not a directory.`, isError: true };
            }

            const entries = await this._listDir(dirPath, recursive, workspace || dirPath, 0, 5);
            return {
                content: entries.join('\n'),
                isError: false,
            };
        } catch (err: any) {
            return {
                content: `Error listing directory "${dirPath}": ${err.message}`,
                isError: true,
            };
        }
    }

    private async _listDir(dirPath: string, recursive: boolean, basePath: string, depth: number, maxDepth: number): Promise<string[]> {
        const results: string[] = [];
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                // 跳过常见无关目录
                if (['.git', 'node_modules', '.DS_Store', '__pycache__'].includes(entry.name)) {
                    continue;
                }
                const fullPath = path.join(dirPath, entry.name);
                const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');

                if (entry.isDirectory()) {
                    results.push(relativePath + '/');
                    if (recursive && depth < maxDepth) {
                        const subEntries = await this._listDir(fullPath, true, basePath, depth + 1, maxDepth);
                        results.push(...subEntries);
                    }
                } else {
                    results.push(relativePath);
                }

                if (results.length > 500) {
                    results.push('... (truncated, too many entries)');
                    break;
                }
            }
        } catch (err) {
            // 忽略权限错误等
        }
        return results;
    }

    /**
     * view_source_code_definitions_top_level 工具（简化版：返回文件列表）
     */
    private async _toolViewDefinitions(params: any): Promise<any> {
        // 简化实现：列出目录下的源码文件
        const result = await this._toolListFiles(params, false);
        return result;
    }

    /**
     * grep_search 工具：在工作区搜索匹配的文本
     * tool_params: { regex: string, path?: string, file_pattern?: string }
     */
    private async _toolGrepSearch(params: any): Promise<any> {
        const regex = params?.regex || params?.pattern;
        if (!regex) {
            return { content: 'Error: No search pattern provided.', isError: true };
        }

        let searchPath = params?.path || '.';
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!path.isAbsolute(searchPath) && workspace) {
            searchPath = path.join(workspace, searchPath);
        }

        try {
            const results: string[] = [];
            const re = new RegExp(regex, params?.case_sensitive ? '' : 'i');
            await this._grepDir(searchPath, re, params?.file_pattern, results, 50);

            if (results.length === 0) {
                return { content: 'No matches found.', isError: false };
            }
            return { content: results.join('\n'), isError: false };
        } catch (err: any) {
            return { content: `Error during search: ${err.message}`, isError: true };
        }
    }

    private async _grepDir(dirPath: string, regex: RegExp, filePattern: string | undefined, results: string[], maxResults: number): Promise<void> {
        if (results.length >= maxResults) { return; }
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (results.length >= maxResults) { return; }
                if (['.git', 'node_modules', 'dist', 'out', '__pycache__'].includes(entry.name)) {
                    continue;
                }
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    await this._grepDir(fullPath, regex, filePattern, results, maxResults);
                } else {
                    // 文件模式过滤
                    if (filePattern) {
                        const ext = filePattern.replace('*', '');
                        if (!entry.name.endsWith(ext)) { continue; }
                    }
                    try {
                        const content = await fs.promises.readFile(fullPath, 'utf-8');
                        const lines = content.split('\n');
                        for (let i = 0; i < lines.length; i++) {
                            if (regex.test(lines[i])) {
                                results.push(`${fullPath}:${i + 1}: ${lines[i].trimEnd()}`);
                                if (results.length >= maxResults) { return; }
                            }
                        }
                    } catch {
                        // 跳过无法读取的文件（二进制等）
                    }
                }
            }
        } catch {
            // 忽略权限错误
        }
    }

    // ─────────────────────────────────────────────
    //  工作区文件/目录搜索
    // ─────────────────────────────────────────────

    /**
     * 搜索工作区文件（用于 GET_WORKSPACE_FILES）
     * 返回匹配关键字的文件列表，当前打开的文件标记 isActive
     */
    private async _searchWorkspaceFiles(keyword: string, max: number): Promise<any[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const activeFilePath = vscode.window.activeTextEditor?.document.fileName;
        const openFilePaths = new Set(
            vscode.workspace.textDocuments
                .filter(doc => !doc.isUntitled)
                .map(doc => doc.fileName)
        );

        // 使用 glob 模式搜索文件
        const pattern = keyword
            ? `**/*${keyword}*`
            : '**/*';

        const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.DS_Store}';

        try {
            const uris = await vscode.workspace.findFiles(pattern, excludePattern, max * 3);

            const results: any[] = [];
            for (const uri of uris) {
                const relativePath = vscode.workspace.asRelativePath(uri, false);
                const fileName = path.basename(uri.fsPath);

                // 如果有关键字，进行更精确的过滤
                if (keyword && !relativePath.toLowerCase().includes(keyword.toLowerCase())) {
                    continue;
                }

                const isActive = uri.fsPath === activeFilePath || openFilePaths.has(uri.fsPath);

                results.push({
                    path: relativePath.replace(/\\/g, '/'),
                    fileName: fileName,
                    isActive: isActive,
                });

                if (results.length >= max) {
                    break;
                }
            }

            // 将活动文件排在前面
            results.sort((a, b) => {
                if (a.isActive && !b.isActive) { return -1; }
                if (!a.isActive && b.isActive) { return 1; }
                return 0;
            });

            return results;
        } catch (e) {
            console.error('[CodeMaker] Error searching workspace files:', e);
            return [];
        }
    }

    /**
     * 搜索工作区路径（用于 SEARCH_WORKSPACE_PATH）
     * 支持按 file / folder 类型过滤
     * 目录路径以 "/" 结尾，文件路径不带结尾斜杠
     */
    private async _searchWorkspacePaths(keyword: string, max: number, type?: string): Promise<any[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const activeFilePath = vscode.window.activeTextEditor?.document.fileName;
        const results: any[] = [];

        if (type === 'folder' || !type) {
            // 搜索目录：通过搜索目录下的任意文件来发现目录
            const dirPattern = keyword
                ? `**/*${keyword}*/**`
                : '**/*';
            const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.DS_Store}';

            try {
                const uris = await vscode.workspace.findFiles(dirPattern, excludePattern, 500);
                const dirSet = new Set<string>();

                for (const uri of uris) {
                    const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
                    // 收集所有中间目录
                    const parts = relativePath.split('/');
                    let dirPath = '';
                    for (let i = 0; i < parts.length - 1; i++) {
                        dirPath = dirPath ? `${dirPath}/${parts[i]}` : parts[i];
                        if (keyword) {
                            if (dirPath.toLowerCase().includes(keyword.toLowerCase())) {
                                dirSet.add(dirPath);
                            }
                        } else {
                            dirSet.add(dirPath);
                        }
                    }
                }

                for (const dir of dirSet) {
                    const dirName = path.basename(dir);
                    results.push({
                        path: dir + '/',  // 目录以 "/" 结尾
                        fileName: dirName,
                        isActive: false,
                    });
                    if (type === 'folder' && results.length >= max) {
                        break;
                    }
                }
            } catch (e) {
                console.error('[CodeMaker] Error searching workspace folders:', e);
            }
        }

        if (type === 'file' || !type) {
            // 搜索文件
            const filePattern = keyword
                ? `**/*${keyword}*`
                : '**/*';
            const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.DS_Store}';

            try {
                const uris = await vscode.workspace.findFiles(filePattern, excludePattern, max * 3);

                for (const uri of uris) {
                    const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
                    const fileName = path.basename(uri.fsPath);

                    if (keyword && !relativePath.toLowerCase().includes(keyword.toLowerCase())) {
                        continue;
                    }

                    const isActive = uri.fsPath === activeFilePath;

                    results.push({
                        path: relativePath,
                        fileName: fileName,
                        isActive: isActive,
                    });

                    if (results.length >= max) {
                        break;
                    }
                }
            } catch (e) {
                console.error('[CodeMaker] Error searching workspace files:', e);
            }
        }

        // 活动文件排在前面，截断到 max
        results.sort((a, b) => {
            if (a.isActive && !b.isActive) { return -1; }
            if (!a.isActive && b.isActive) { return 1; }
            return 0;
        });

        return results.slice(0, max);
    }

    // ─────────────────────────────────────────────
    //  sendMessage —— 带 leftOverMessages 队列
    // ─────────────────────────────────────────────

    /**
     * 公开方法：重新发送 INIT_DATA（配置变化时由 index.ts 调用）
     */
    public refreshInitData() {
        this._sendInitData();
    }

    public sendMessage(message: any) {
        if (this._view && this._hasInit) {
            this._sendToWebview(message);
        } else {
            this._leftOverMessages.push(message);
        }
    }

    private _sendToWebview(message: any) {
        this._view?.webview.postMessage(message);
    }

    // ─────────────────────────────────────────────
    //  生成 HTML —— 消息桥与源码版完全一致（全量双向转发）
    // ─────────────────────────────────────────────

    private _getHtmlForWebview(): string {
        const origin = `http://localhost:${this._apiServerPort}`;
        const hash = new Date().getTime();
        const iframeUrl = `${origin}?hash=${hash}`;

        // 与源码版 _getHtmlForWebview 完全一致的消息桥逻辑：
        // 1. 来自 iframe (origin === localhost) → vscode.postMessage(event.data)
        // 2. 来自 VSCode (origin.startsWith('vscode-webview')) → iframe.contentWindow.postMessage(event.data, iframeuri)
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CodeMaker</title>
    <style>::selection {background: transparent;}</style>
</head>
<body style="padding-left: 0; padding-right: 0; margin: 0; overflow: hidden;">
    <iframe
        src="${iframeUrl}"
        frameborder="0"
        style="width: 100%; height: calc(100vh - 3px)"
        id="codemaker-webui"
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads"
        allow="cross-origin-isolated; autoplay; local-network-access; clipboard-read; clipboard-write"
    ></iframe>
    <script>
        const iframeuri = "${iframeUrl}";
        const iframe = document.getElementById("codemaker-webui");
        const vscode = acquireVsCodeApi();

        window.addEventListener("message", (event) => {
            // 来自 iframe 的消息 → 转发给 VSCode Extension
            if (event.origin === "${origin}") {
                vscode.postMessage(event.data);
                console.log("[CodeMaker Bridge] iframe → vscode:", event.data?.type);
            }
            // 来自 VSCode Extension 的消息 → 转发给 iframe
            else if (event.origin && event.origin.startsWith("vscode-webview")) {
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage(event.data, iframeuri);
                    console.log("[CodeMaker Bridge] vscode → iframe:", event.data?.type);
                }
            }
            // 未知来源
            else {
                console.log("[CodeMaker Bridge] Unknown origin:", event.origin, event.data?.type);
            }
        });
    </script>
</body>
</html>`;
    }
}