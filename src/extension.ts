import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const STORAGE_KEY = 'projectNote.storageDirectory';
const NOTE_EXTENSION = '.txt';

export function activate(context: vscode.ExtensionContext) {
  const open = vscode.commands.registerCommand('projectNote.open', () => openProjectNote());
  const setStorage = vscode.commands.registerCommand('projectNote.setStorageDirectory', () => setStorageDirectory());
  context.subscriptions.push(open, setStorage);
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
  await vscode.workspace.getConfiguration().update(
    STORAGE_KEY,
    directory,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(`Project Note storage directory set to: ${directory}`);
}

async function openProjectNote(): Promise<void> {
  const storageDirectory = vscode.workspace.getConfiguration().get<string>(STORAGE_KEY, '');
  if (!storageDirectory) {
    const action = await vscode.window.showWarningMessage(
      'Project Note storage directory has not been configured.',
      'Set Storage Directory'
    );
    if (action === 'Set Storage Directory') await setStorageDirectory();
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open a project folder before opening its project note.');
    return;
  }

  const projectPath = workspaceFolder.uri.fsPath;
  const notePath = await getNotePath(storageDirectory, projectPath);

  try {
    await fs.mkdir(storageDirectory, { recursive: true });
    let content = '';
    try {
      content = await fs.readFile(notePath, 'utf8');
    } catch (error: unknown) {
      if (!isNodeError(error, 'ENOENT')) throw error;
    }

    const document = await vscode.workspace.openTextDocument({
      language: 'plaintext',
      content
    });
    const editor = await vscode.window.showTextDocument(document, { preview: false });

    const save = vscode.commands.registerCommand('projectNote.saveCurrentNote', async () => {
      if (vscode.window.activeTextEditor !== editor) return;
      await fs.writeFile(notePath, document.getText(), 'utf8');
      vscode.window.setStatusBarMessage('Project Note saved', 2000);
    });

    const disposable = vscode.workspace.onDidSaveTextDocument(async (savedDocument) => {
      if (savedDocument.uri.toString() !== document.uri.toString()) return;
      try {
        await fs.writeFile(notePath, savedDocument.getText(), 'utf8');
        vscode.window.setStatusBarMessage('Project Note saved', 2000);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to save Project Note: ${error}`);
      }
    });

    editor.document.isDirty;
    contextlessCleanup(save, disposable);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open Project Note: ${error}`);
  }
}

async function getNotePath(storageDirectory: string, projectPath: string): Promise<string> {
  const projectName = path.basename(projectPath) || 'project';
  const projectId = encodeProjectPath(projectPath);
  return path.join(storageDirectory, `${projectName}-${projectId}${NOTE_EXTENSION}`);
}

function encodeProjectPath(projectPath: string): string {
  // Keep the filename portable across Windows/macOS/Linux while making two
  // projects with the same basename unlikely to collide.
  let hash = 2166136261;
  for (const char of projectPath) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

function contextlessCleanup(...disposables: vscode.Disposable[]): void {
  // The document is intentionally independent of the extension activation
  // context. VS Code disposes the editor/document listeners when the session ends.
  void disposables;
}

export function deactivate() {}
