
import { ChildProcess, execFile } from "node:child_process";
import { assert } from "node:console";
import * as vscode from 'vscode';

let platformStatusBarItem: vscode.StatusBarItem;
const clickedSelectPlatformCommandId = 'tim-buck2.selectPlatform';
let currentPlatform = '';

let targetStatusBarItem: vscode.StatusBarItem;
const clickedTargetCommandId = 'tim-buck2.selectTarget';
let currentTarget = '';

let stopBuildButton: vscode.StatusBarItem;
const stopBuildCommandId = 'tim-buck2.stopBuild';
let buildIsRunning = false;
let buildProcess: ChildProcess | undefined;

const cleanCommandId = 'tim-buck2.clean';

const buildCommandId = 'tim-buck2.build';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "tim-buck2" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json

    context.subscriptions.push(vscode.commands.registerCommand(buildCommandId, build));
    context.subscriptions.push(vscode.commands.registerCommand(cleanCommandId, clean));
    context.subscriptions.push(vscode.commands.registerCommand(stopBuildCommandId, stopBuild));

    // TODO scoop up the default platform from .buckconfig
    currentPlatform = "root//platforms:release-nosan";
    currentTarget = ":Luau.UnitTest";

    platformStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2);
    platformStatusBarItem.command = clickedSelectPlatformCommandId;
    platformStatusBarItem.tooltip = 'Select Build Platform';
    context.subscriptions.push(platformStatusBarItem);
    context.subscriptions.push(vscode.commands.registerCommand(clickedSelectPlatformCommandId, onClickedPlatform));

    targetStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2);
    targetStatusBarItem.command = clickedTargetCommandId;
    targetStatusBarItem.tooltip = 'Select Build Target';
    context.subscriptions.push(targetStatusBarItem);
    context.subscriptions.push(vscode.commands.registerCommand(clickedTargetCommandId, onClickedTarget));

    stopBuildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
    stopBuildButton.command = stopBuildCommandId;

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBars));
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(updateStatusBars));

    updateStatusBars();
    updateBuildButton();
}

// This method is called when your extension is deactivated
export function deactivate() {
    platformStatusBarItem.hide();
    targetStatusBarItem.hide();
}

async function onClickedPlatform() {
    const platforms = await getPlatforms();

    vscode.window.showQuickPick(platforms).then(async (newPlatform) => {
        if (newPlatform) {
            currentPlatform = newPlatform;
        }
        await buildCompilationDatabase();
        updateStatusBars();
    });
}

async function onClickedTarget() {
    const targets = await getTargets();

    vscode.window.showQuickPick(targets).then(async (newTarget) => {
        if (newTarget) {
            currentTarget = newTarget;
        }
        await buildCompilationDatabase();
        updateStatusBars();
    });
}

function updateBuildButton() {
    if (buildProcess) {
        stopBuildButton.text = '$(loading~spin) Cancel Build';
    } else {
        stopBuildButton.text = "$(settings-gear) Build";
    }

    stopBuildButton.show();
}

function updateStatusBars() {
    platformStatusBarItem.text = currentPlatform ? `Platform: ${currentPlatform}` : "Platform...";
    platformStatusBarItem.show();

    targetStatusBarItem.text = currentTarget ? `Target: ${currentTarget}` : "Target...";
    targetStatusBarItem.show();
}

async function buildCompilationDatabase() {
    return;
    const subTarget = currentTarget + '[compilation-database]';

    const cmd = ['build'];
    if (currentPlatform.length > 0) {
        cmd.push('--target-platforms');
        cmd.push(currentPlatform);
    }

    cmd.push('--out');
    cmd.push('.');

    cmd.push(currentTarget + '[compilation-database]');

    const stdout = await runBuck(cmd);
}

function stopBuild() {
    if (!buildProcess) {
        build();
    } else {
        buildProcess.kill();
    }

    updateBuildButton();
}

function clean() {
    runBuck(['clean']);
}

function splitLines(s: string): string[] {
    return s.split("\n").filter(s => s && s.length > 0).map(s => s.trim());
}

async function getTargets(): Promise<string[]> {
    let stdout = await runBuck(["targets", ":"]);
    return splitLines(stdout);
}

async function getPlatforms(): Promise<string[]> {
    const conf = vscode.workspace.getConfiguration('tim-buck2');

    const targetMask = conf.get('platformTargetMask') as string;
    assert(typeof targetMask === 'string');

    let stdout = await runBuck(["targets", targetMask]);
    return splitLines(stdout);
}

function getWorkspaceRoot() {
    // TODO: What if there are multiple folders?
    const workspaceUri = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length ? vscode.workspace.workspaceFolders[0].uri : null;

    assert(workspaceUri);

    return workspaceUri?.fsPath;
}

function runBuck(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const conf = vscode.workspace.getConfiguration('tim-buck2');

        const buck2Path = conf.get('buck2Path') as string;
        assert(typeof buck2Path === 'string');

        execFile(buck2Path, args, { cwd: getWorkspaceRoot() }, (err, stdout, stderr) => {
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


function build() {
    if (buildIsRunning) {
        vscode.window.showInformationMessage('A build is already running');
        return;
    }

    const conf = vscode.workspace.getConfiguration('tim-buck2');

    const buck2Path = conf.get('buck2Path') as string;
    assert(typeof buck2Path === 'string');

    const cmd = ['build'];
    if (currentPlatform.length > 0) {
        cmd.push('--target-platforms');
        cmd.push(currentPlatform);
    }

    cmd.push(currentTarget);

    buildIsRunning = true;
    buildProcess = execFile(buck2Path, cmd, { cwd: getWorkspaceRoot() }, (err, stdout, stderr) => {
        buildIsRunning = false;
        buildProcess = undefined;
        updateBuildButton();
    });

    buildCompilationDatabase();
    updateBuildButton();
}
