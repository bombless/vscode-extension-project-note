import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const STORAGE_KEY = 'projectNote.storageDirectory';
const NOTE_EXTENSION = '.txt';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('projectNote.open', openProjectNote),
    vscode.commands.registerCommand('projectNote.setStorageDirectory', setStorageDirectory)
  );
}

async function setStorageDirectory(): Promise<void> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Use as Project Note Storage'
  });

  if (!selected?.[0]) return;
  const directory = selected[0].fsPath;
  await vscode.workspace.getConfiguration('projectNote').update(
    'storageDirectory',
    directory,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(`Project Note storage directory set to: ${directory}`);
}

async function openProjectNote(): Promise<void> {
  let storageDirectory = vscode.workspace.getConfiguration('projectNote').get<string>('storageDirectory', '');

  if (!storageDirectory) {
    const action = await vscode.window.showWarningMessage(
      'Project Note storage directory has not been configured.',
      'Set Storage Directory'
    );
    if (action !== 'Set Storage Directory') return;
    await setStorageDirectory();
    storageDirectory = vscode.workspace.getConfiguration('projectNote').get<string>('storageDirectory', '');
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open a project folder before opening its project note.');
    return;
  }

  if (!storageDirectory) return;

  const notePath = getNotePath(storageDirectory, workspaceFolder.uri.fsPath);

  try {
    await fs.mkdir(storageDirectory, { recursive: true });
    try {
      await fs.access(notePath);
    } catch (error: unknown) {
      if (!isNodeError(error, 'ENOENT')) throw error;
      await fs.writeFile(notePath, '', 'utf8');
    }

    // Open the real file, rather than an untitled document. VS Code's normal
    // save flow then persists edits directly to the configured storage folder.
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(notePath));
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open Project Note: ${error}`);
  }
}

function getNotePath(storageDirectory: string, projectPath: string): string {
  const projectName = path.basename(projectPath) || 'project';
  const projectId = hashProjectPath(projectPath);
  return path.join(storageDirectory, `${projectName}-${projectId}${NOTE_EXTENSION}`);
}

function hashProjectPath(projectPath: string): string {
  let hash = 2166136261;
  for (const char of projectPath) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

export function deactivate() {}
