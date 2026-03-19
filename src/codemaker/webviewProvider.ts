import * as vscode from 'vscode';
import * as os from 'os';
import { getCodeMakerConfig } from './configProvider';

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

    private _handleMessage(message: any, webview: vscode.Webview) {
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
            default: {
                // 其他消息暂不处理，但可以扩展
                // console.log('[CodeMaker] Unhandled message:', message.type);
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