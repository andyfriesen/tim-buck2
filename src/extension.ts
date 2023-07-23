// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { execFile } from "node:child_process";
import { assert } from "node:console";
import * as os from 'os';
import * as vscode from 'vscode';

let platformStatusBarItem: vscode.StatusBarItem;
const clickedStatusBarCommandId = 'tim-buck2.selectPlatform';
const buildCommandId = 'tim-buck2.build';

let validTargets: string[] = [];
let currentTarget: string = '';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "tim-buck2" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('tim-buck2.helloWorld', () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World from tim-buck2!');
    });

    currentTarget = "//platforms:platforhms";

    context.subscriptions.push(disposable);

    context.subscriptions.push(vscode.commands.registerCommand(clickedStatusBarCommandId, onClickedStatusBarCommand));

    platformStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    platformStatusBarItem.command = clickedStatusBarCommandId;

    context.subscriptions.push(platformStatusBarItem);

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBars));
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(updateStatusBars));

    updateStatusBars();
}

async function onClickedStatusBarCommand() {
    const platforms = await getPlatforms();

    vscode.window.showQuickPick(platforms).then((tgt) => {
        if (tgt) {
            currentTarget = tgt;
        }
        updateStatusBars();
    });
}

function updateStatusBars() {
    if (currentTarget) {
        platformStatusBarItem.text = currentTarget;
        platformStatusBarItem.show();
    } else {
        platformStatusBarItem.hide();
    }
}

function getPlatforms(): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const conf = vscode.workspace.getConfiguration('tim-buck2');
        
        const buck2Path = conf.get('buck2Path') as string;
        assert(typeof buck2Path === 'string');
        
        const targetMask = conf.get('platformTargetMask') as string;
        assert(typeof targetMask === 'string');
        
        const workspaceUri = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length ? vscode.workspace.workspaceFolders[0].uri : null;
        
        if (!workspaceUri) {
            reject('No workspace URI');
            return;
        }

        const options = {
            // TODO: There may be more than one folder
            cwd: workspaceUri.fsPath
        };
        
        execFile(buck2Path, ['targets', targetMask], options, (err, stdout, stderr) => {
            if (err) {
                console.error('Failed to get list of platforms');
                console.error(err);
                console.warn(stderr);
                reject(err);
                return;
            }
        
            validTargets = stdout.split('\n').filter(s => s && s.length > 0);

            resolve(validTargets);
        });
    });
}

// This method is called when your extension is deactivated
export function deactivate() {
    platformStatusBarItem.hide();
}
