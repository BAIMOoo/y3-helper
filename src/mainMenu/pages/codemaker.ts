import { TreeNode } from "../treeNode";
import * as vscode from 'vscode';

export class CodeMaker入口 extends TreeNode {
    constructor() {
        super('打开 CodeMaker', {
            iconPath: new vscode.ThemeIcon('hubot'),
            command: {
                command: 'y3-helper.codemaker.open',
                title: '打开 CodeMaker',
            },
            tooltip: '打开 CodeMaker AI 助手面板',
        });
    }
}
