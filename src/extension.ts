// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { execFile } from "node:child_process";
import { assert } from "node:console";
import * as os from 'os';
import * as vscode from 'vscode';

let platformStatusBarItem: vscode.StatusBarItem;
const clickedSelectPlatformCommandId = 'tim-buck2.selectPlatform';
let validPlatforms: string[] = [];
let currentPlatform = '';

let targetStatusBarItem: vscode.StatusBarItem;
const clickedTargetCommandId = 'tim-buck2.selectTarget';
const buildCommandId = 'tim-buck2.build';
let validTargets: string[] = [];
let currentTarget = '';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "tim-buck2" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json

    let disposable = vscode.commands.registerCommand(buildCommandId, build);
    context.subscriptions.push(disposable);

    currentPlatform = "//platforms:platforhms";
    currentTarget = ":";

    platformStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    platformStatusBarItem.command = clickedSelectPlatformCommandId;
    context.subscriptions.push(platformStatusBarItem);
    context.subscriptions.push(vscode.commands.registerCommand(clickedSelectPlatformCommandId, onClickedPlatform));

    targetStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    targetStatusBarItem.command = clickedTargetCommandId;
    context.subscriptions.push(targetStatusBarItem);
    context.subscriptions.push(vscode.commands.registerCommand(clickedTargetCommandId, onClickedTarget));

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBars));
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(updateStatusBars));

    updateStatusBars();
}

async function build() {
    
}

async function onClickedPlatform() {
    const platforms = await getPlatforms();

    vscode.window.showQuickPick(platforms).then((newPlatform) => {
        if (newPlatform) {
            currentPlatform = newPlatform;
        }
        updateStatusBars();
    });
}

async function onClickedTarget() {
    const targets = await getTargets();

    vscode.window.showQuickPick(targets).then((newTarget) => {
        if (newTarget) {
            currentTarget = newTarget;
        }
        updateStatusBars();
    });
}

function updateStatusBars() {
    platformStatusBarItem.text = currentPlatform ? `Platform: ${currentPlatform}` : "Platform...";
    platformStatusBarItem.show();

    targetStatusBarItem.text = currentTarget ? `Target: ${currentTarget}` : "Target...";
    targetStatusBarItem.show();
}

function splitLines(s: string): string[] {
    return s.split("\n").filter(s => s && s.length > 0).map(s => s.trim());
}

async function getTargets(): Promise<string[]> {
    let stdout = await runBuck(["targets", ":"]);
    return splitLines(stdout);
}

// TODO: Only do this on startup or when we sense a change to .buckconfig or .buckconfig.local
function getPlatforms(): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const conf = vscode.workspace.getConfiguration('tim-buck2');

        const buck2Path = conf.get('buck2Path') as string;
        assert(typeof buck2Path === 'string');

        const targetMask = conf.get('platformTargetMask') as string;
        assert(typeof targetMask === 'string');

        // TODO: What if there are multiple folders?
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

            validPlatforms = stdout.split('\n').filter(s => s && s.length > 0);

            resolve(validPlatforms);
        });
    });
}

function runBuck(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const conf = vscode.workspace.getConfiguration('tim-buck2');

        const buck2Path = conf.get('buck2Path') as string;
        assert(typeof buck2Path === 'string');

        // TODO: What if there are multiple folders?
        const workspaceUri = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length ? vscode.workspace.workspaceFolders[0].uri : null;

        if (!workspaceUri) {
            reject('No workspace URI');
            return;
        }

        const options = {
            // TODO: There may be more than one folder
            cwd: workspaceUri.fsPath
        };
        
        execFile(buck2Path, args, options, (err, stdout, stderr) => {
            if (err) {
                console.error('Buck2 command failed:', args);
                console.error(err);
                console.warn(stderr);
                reject(err);
                return;
            }

            resolve(stdout);
        });
    });
}

// This method is called when your extension is deactivated
export function deactivate() {
    platformStatusBarItem.hide();
    targetStatusBarItem.hide();
}
