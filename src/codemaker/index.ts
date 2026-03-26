import * as vscode from 'vscode';
import { CodeMakerWebviewProvider } from './webviewProvider';
import { CodeMakerApiServer } from './apiServer';
import { initOpenFilesHandler } from './handlers/openFilesHandler';
import { initWorkspaceTracker } from './handlers/workspaceTracker';

let webviewProvider: CodeMakerWebviewProvider | undefined;
let apiServer: CodeMakerApiServer | undefined;

/**
 * 初始化 CodeMaker 模块
 */
export function initCodeMaker(context: vscode.ExtensionContext) {
    const extensionUri = context.extensionUri;

    // 创建 WebviewViewProvider
    webviewProvider = new CodeMakerWebviewProvider(extensionUri);

    // 注册到 codemaker.webview 视图（已在 package.json 中声明于 secondarySidebar 容器）
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            CodeMakerWebviewProvider.viewType,
            webviewProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // 创建 API Server 管理器
    const globalStoragePath = context.globalStorageUri.fsPath;
    apiServer = new CodeMakerApiServer(extensionUri, globalStoragePath);

    // 启动 API Server（完成后再自动展开面板，避免 iframe 在 Server 就绪前加载）
    startApiServer(context);

    // 注册打开命令
    context.subscriptions.push(
        vscode.commands.registerCommand('y3-helper.codemaker.open', () => {
            context.globalState.update('codemaker.userClosed', false);
            vscode.commands.executeCommand('codemaker.webview.focus');
        })
    );

    // 监听配置变化 → 重发 INIT_DATA（与源码版一致）
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration('CodeMaker.CodeChatApiKey') ||
                e.affectsConfiguration('CodeMaker.CodeChatApiBaseUrl') ||
                e.affectsConfiguration('CodeMaker.CodeChatModel')
            ) {
                // 配置变化时，向 webview 重新发送 INIT_DATA
                if (webviewProvider) {
                    webviewProvider.sendMessage({
                        type: 'CONFIG_CHANGED',
                    });
                    // sendInitData 是 private，通过触发 GET_INIT_DATA 流程间接刷新
                    // 实际上直接 public sendMessage 把新数据推过去更简洁
                    webviewProvider.refreshInitData();
                }
            }
        })
    );

    // 初始化 workspaceTracker 和 openFilesHandler（与源码版一致：在 extension activate 时初始化）
    initOpenFilesHandler(context);
    initWorkspaceTracker();

    // 视图关闭状态管理（不涉及自动打开，可立即注册）
    setupDisposeListener(context);
}

function setupDisposeListener(context: vscode.ExtensionContext) {
    // 监听视图关闭
    if (webviewProvider) {
        const checkDispose = () => {
            if (webviewProvider?.view) {
                webviewProvider.view.onDidDispose(() => {
                    context.globalState.update('codemaker.userClosed', true);
                });
            }
        };
        setTimeout(checkDispose, 2000);
    }
}

async function startApiServer(context: vscode.ExtensionContext) {
    if (!apiServer) { return; }

    try {
        const port = await apiServer.start();
        if (webviewProvider) {
            webviewProvider.setApiServerPort(port);
        }
        console.log(`[CodeMaker] API Server started on port ${port}`);

        // API Server 就绪后，再自动展开面板（避免 iframe 在 Server 启动前加载导致"请重新连接"）
        const userClosed = context.globalState.get<boolean>('codemaker.userClosed', false);
        if (!userClosed) {
            vscode.commands.executeCommand('codemaker.webview.focus');
        }
    } catch (err) {
        console.error('[CodeMaker] Failed to start API Server:', err);
        vscode.window.showErrorMessage(`CodeMaker API Server 启动失败: ${err}`);
    }
}

export function stopCodeMaker() {
    if (apiServer) {
        apiServer.stop();
        apiServer = undefined;
    }
}

export { webviewProvider, apiServer };