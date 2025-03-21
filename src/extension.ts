import { ChildProcess, SpawnOptions, execFile, spawn } from "node:child_process";
import { assert } from "node:console";
import * as fs from "node:fs/promises";
import path = require("node:path");
import * as vscode from 'vscode';

let platformStatusBarItem: vscode.StatusBarItem;
const clickedSelectPlatformCommandId = 'tim-buck2.selectPlatform';
let currentPlatform : string | null = null;

let targetStatusBarItem: vscode.StatusBarItem;
const clickedTargetCommandId = 'tim-buck2.selectTarget';
const currentTargetKey = 'tim-buck2.currentTarget';
let currentTarget : string | null = null;

let stopBuildButton: vscode.StatusBarItem;
const stopBuildCommandId = 'tim-buck2.stopBuild';
let buildIsRunning = false;
let buildProcess: ChildProcess | undefined;

const buildCommandId = 'tim-buck2.build';
const cleanCommandId = 'tim-buck2.clean';
const compileThisFileCommandId = 'tim-buck2.compileThisFile';
const launchTargetPathId = 'tim-buck2.launchTargetPath';

let buildOutput : vscode.OutputChannel;


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

    context.subscriptions.push(vscode.commands.registerCommand(
        launchTargetPathId,
        async () => {
            if (currentTarget === null) {
                return null;
            }
            // TODO: I'm not sure if this is the best way to ensure that
            // when we're getting the path to the build target for
            // debugging or launching, we build the latest version of
            // the underlying binary.
            await build();
            var out = JSON.parse(await runBuck(["build", currentTarget, "--show-json-output"]));
            return path.join(getWorkspaceRoot()!, out[currentTarget]);
        },
    ));

    platformStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2);
    platformStatusBarItem.command = clickedSelectPlatformCommandId;
    platformStatusBarItem.tooltip = 'Select Buck2 Build Platform';
    context.subscriptions.push(platformStatusBarItem);
    context.subscriptions.push(vscode.commands.registerCommand(clickedSelectPlatformCommandId, onClickedPlatform));

    targetStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2);
    targetStatusBarItem.command = clickedTargetCommandId;
    targetStatusBarItem.tooltip = 'Select Buck2 Build Target';
    context.subscriptions.push(targetStatusBarItem);
    context.subscriptions.push(vscode.commands.registerCommand(clickedTargetCommandId, async () => onClickedTarget(context)));

    stopBuildButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
    stopBuildButton.command = stopBuildCommandId;

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBars));
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(updateStatusBars));

    buildOutput = vscode.window.createOutputChannel('Buck2');
    currentTarget = context.workspaceState.get(currentTargetKey) ?? null;

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

    platforms.unshift('default');

    vscode.window.showQuickPick(platforms).then(async (newPlatform) => {
        if (newPlatform === 'default') {
            currentPlatform = null;
        } else if (newPlatform) {
            currentPlatform = newPlatform;
        }
        await buildCompileCommands();
        updateStatusBars();
    });
}

async function onClickedTarget(context: vscode.ExtensionContext) {
    const targets = await getTargets();

    targets.unshift('all');

    vscode.window.showQuickPick(targets).then(async (newTarget) => {
        if (newTarget === 'all') {
            currentTarget = null;
        } else if (newTarget) {
            currentTarget = newTarget;
        }
        context.workspaceState.update(currentTargetKey, currentTarget);
        await buildCompileCommands();
        updateStatusBars();
    });
}

function updateBuildButton() {
    if (buildProcess) {
        stopBuildButton.text = '$(loading~spin) Cancel Buck2 Build';
    } else {
        stopBuildButton.text = "$(settings-gear) Buck2 Build";
    }

    stopBuildButton.show();
}

function updateStatusBars() {
    platformStatusBarItem.text = `Platform: ${currentPlatform ?? 'default'}`;
    platformStatusBarItem.show();

    targetStatusBarItem.text = `Target: ${currentTarget ?? 'all'}`;
    targetStatusBarItem.show();
}

async function buildCompileCommands() {
    // NOTE: This function needs better error handling through-and-through.
    if (currentTarget === null) { return; }
    const conf = vscode.workspace.getConfiguration("tim-buck2");
    const bxl = conf.get("compileCommandsGenerator");
    const dest = conf.get("compileCommandsDestination");
    // My kingdom for do notation ...
    if (typeof bxl !== 'string' || typeof dest !== 'string') { return; } 
    // The current assumption is that the compile commands BXL is off the form:
    //
    //  buck2 bxl $SCRIPT -- --targets $TARGET
    //
    // And prints out at least one `buck-out` path that is the presumed compile commands
    const output = await runBuck(['bxl', bxl, "--", "--targets", currentTarget]);
    const buckOut = output.split("\n").find((v) => v.startsWith("buck-out"));
    if (buckOut === undefined) { return; }
    const root = getWorkspaceRoot()!;
    await fs.mkdir(path.join(root, path.dirname(dest)), { recursive: true });
    await fs.copyFile(path.join(root, buckOut), path.join(root, dest));
    if (conf.get("autoRestartClangd"))
    {
        vscode.commands.executeCommand("clangd.restart");
    }
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
    // `buck2 targets //...` is roughly "please get me all the targets in
    // the current repo."
    return splitLines(await runBuck(["targets", "//..."]));
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


async function build() {
    if (buildIsRunning) {
        vscode.window.showInformationMessage('A build is already running');
        return;
    }

    const conf = vscode.workspace.getConfiguration('tim-buck2');

    const buck2Path = conf.get('buck2Path') as string;
    assert(typeof buck2Path === 'string');

    const cmd = ['build', '-v2'];
    if (currentPlatform) {
        cmd.push('--target-platforms');
        cmd.push(currentPlatform);
    }

    cmd.push(currentTarget ?? '...');

    buildIsRunning = true;
    updateBuildButton();

    const code = await run(buck2Path, cmd);
    vscode.window.showInformationMessage('Compile complete');

    buildIsRunning = false;
    buildProcess = undefined;
    updateBuildButton();

}


function run(command: string, args: string[]): Promise<number> {
    return new Promise((accept, reject) => {
        buildOutput.clear();
        buildOutput.show();

        const options: SpawnOptions = {
            cwd: getWorkspaceRoot(),
        };

        buildProcess = spawn(command, args, options);

        const stdout = buildProcess.stdout!;
        const stderr = buildProcess.stderr!;

        stdout.setEncoding('utf8');
        stdout.addListener('data', (data) => {
            console.log('stdout', data);
            buildOutput.append(data.replaceAll('\n', '\r\n'));
        });

        stderr.setEncoding('utf8');
        stderr.addListener('data', (data: string) => {
            console.warn('stderr', data);
            buildOutput.append(data.replaceAll('\n', '\r\n'));
        });

        buildProcess.addListener('close', (code) => {
            accept(code!);
        });
    });
}
