
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
let currentTarget : string | null = null;

let stopBuildButton: vscode.StatusBarItem;
const stopBuildCommandId = 'tim-buck2.stopBuild';
let buildIsRunning = false;
let buildProcess: ChildProcess | undefined;

const buildCommandId = 'tim-buck2.build';
const cleanCommandId = 'tim-buck2.clean';
const compileThisFileCommandId = 'tim-buck2.compileThisFile';

let writeEmitter: vscode.EventEmitter<string>;
let buildTerminal : vscode.Terminal | undefined;

type CompilationDatabase = {
    [index: string]: CompilationDatabaseEntry
};

type CompilationDatabaseEntry = {
    file: string,
    directory: string,
    arguments: string[],
};

let compilationDatabase: CompilationDatabase = {};

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
    context.subscriptions.push(vscode.commands.registerCommand(compileThisFileCommandId, compileThisFile));

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

    buildCompilationDatabase();
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
        await buildCompilationDatabase();
        updateStatusBars();
    });
}

async function onClickedTarget() {
    const targets = await getTargets();

    targets.unshift('all');

    vscode.window.showQuickPick(targets).then(async (newTarget) => {
        if (newTarget === 'all') {
            currentTarget = null;
        } else if (newTarget) {
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
    platformStatusBarItem.text = `Platform: ${currentPlatform ?? 'default'}`;
    platformStatusBarItem.show();

    targetStatusBarItem.text = `Target: ${currentTarget ?? 'all'}`;
    targetStatusBarItem.show();
}

async function buildCompilationDatabase() {
    // buck2 build ':Luau.UnitTest[compilation-database]' ':Luau.Repl.CLI[compilation-database]'
    //      --target-platforms //platforms:release-nosan --show-full-output

    const json: string[] = JSON.parse(await runBuck(['cquery', 'deps(:)', '--json']));
    const allTargets = json.map(s => s.split(' ', 1)[0]).filter(s => s.startsWith('root//'));

    const compileDatabaseTargets = allTargets.map(s => s + '[compilation-database]');

    const cmd = ['build', '--show-full-output'];

    if (currentPlatform) {
        cmd.push('--target-platforms');
        cmd.push(currentPlatform);
    }

    const buildOutput = await runBuck(cmd.concat(compileDatabaseTargets));

    const databasePaths = splitLines(buildOutput).map(s => s.split(' ', 2)[1]);

    const newDatabase: CompilationDatabase = {};

    const promises = databasePaths.map(path => addCompilationDatabase(newDatabase, path));
    await Promise.all(promises);

    compilationDatabase = newDatabase;
}

async function addCompilationDatabase(database: CompilationDatabase, filePath: string) {
    const file = (await fs.readFile(filePath)).toString('utf8');
    const json = JSON.parse(file);

    for (const entry of json) {
        database[path.normalize(entry.file)] = entry;
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

async function compileThisFile() {
    const fsPath = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!fsPath) {
        return;
    }

    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return;
    }

    /*
     * Next thing: buck2 build compilation databases for the requested target only.
     * We're going to have to compute the target that corresponds to the current
     * file, then find that compilation database, then look that up.
     */

    const relativePath = path.relative(workspaceRoot, fsPath);

    const entry = compilationDatabase[relativePath];

    if (!entry) {
        return;
    }

    const executable = entry.arguments[0];
    const params = entry.arguments.slice(1);

    const opts = {
        cwd: path.join(getWorkspaceRoot()!!, entry.directory)
    };

    buildIsRunning = true;
    buildProcess = execFile(executable, params, opts, (err, stdout, stderr) => {
        vscode.window.showInformationMessage('Compile complete');
        if (err) {
            console.error('Error:', err);
        } else {
            console.log('Success!', stdout);
        }
        buildIsRunning = false;
        buildProcess = undefined;
        updateBuildButton();
    });
    updateBuildButton();
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
    buildCompilationDatabase();
    updateBuildButton();

    const code = await run(buck2Path, cmd);
    vscode.window.showInformationMessage('Compile complete');

    buildIsRunning = false;
    buildProcess = undefined;
    updateBuildButton();

}


function run(command: string, args: string[]): Promise<number> {
    return new Promise((accept, reject) => {
        if (!buildTerminal) {
            writeEmitter = new vscode.EventEmitter<string>();
            buildTerminal = vscode.window.createTerminal({
                name: 'tim-buck2',
                pty: {
                    onDidWrite: writeEmitter.event,
                    open() {

                    },
                    close() {

                    },
                    handleInput(data: string) {
                    }
                }
            });
            buildTerminal.show();
        }

        const options: SpawnOptions = {
            cwd: getWorkspaceRoot(),
        };

        buildProcess = spawn(command, args, options);

        const stdout = buildProcess.stdout!;
        assert(stdout);

        const stderr = buildProcess.stderr!;
        assert(stderr);

        stdout.setEncoding('utf8');
        stdout.addListener('data', (data) => {
            console.log('stdout', data);
            writeEmitter.fire(data.replaceAll('\n', '\r\n'));
        });

        stderr.setEncoding('utf8');
        stderr.addListener('data', (data: string) => {
            console.warn('stderr', data);
            writeEmitter.fire(data.replaceAll('\n', '\r\n'));
        });

        buildProcess.addListener('close', (code) => {
            accept(code!);
        });
    });
}
