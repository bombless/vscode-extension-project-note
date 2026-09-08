import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const STORAGE_KEY = 'projectNote.storageDirectory';
const NOTE_EXTENSION = '.txt';

export function activate(context: vscode.ExtensionContext) {
  const noteViewProvider = new ProjectNoteViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.commands.registerCommand('projectNote.open', openProjectNote),
    vscode.commands.registerCommand('projectNote.setStorageDirectory', async () => {
      if (await setStorageDirectory()) await noteViewProvider.refresh();
    }),
    vscode.window.registerWebviewViewProvider('projectNote.view', noteViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(STORAGE_KEY)) void noteViewProvider.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void noteViewProvider.refresh())
  );
}

class ProjectNoteViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    view.webview.html = await getWebviewHtml(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isViewMessage(message)) return;
      if (message.type === 'ready') await this.refresh();
      if (message.type === 'save') await this.save(message.content);
      if (message.type === 'selectStorageDirectory' && await setStorageDirectory()) await this.refresh();
    });
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    const note = await getProjectNote();
    await this.view.webview.postMessage({ type: 'load', ...note });
  }

  private async save(content: string): Promise<void> {
    const note = await getProjectNote();
    if (!note.notePath) {
      await this.view?.webview.postMessage({ type: 'saveError', message: note.message });
      return;
    }
    try {
      await fs.writeFile(note.notePath, content, 'utf8');
      await this.view?.webview.postMessage({ type: 'saved' });
    } catch (error) {
      await this.view?.webview.postMessage({ type: 'saveError', message: `Failed to save note: ${String(error)}` });
    }
  }
}

type ProjectNote = {
  content: string;
  projectName: string;
  notePath?: string;
  message?: string;
};

async function getProjectNote(): Promise<ProjectNote> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return { content: '', projectName: 'No project folder', message: 'Open a project folder to create a project note.' };
  }
  const storageDirectory = getStorageDirectory();
  if (!storageDirectory) {
    return { content: '', projectName: workspaceFolder.name, message: 'Select a storage directory before editing this project note.' };
  }

  const notePath = getNotePath(storageDirectory, workspaceFolder.uri.fsPath);
  try {
    await fs.mkdir(storageDirectory, { recursive: true });
    let content = '';
    try {
      content = await fs.readFile(notePath, 'utf8');
    } catch (error: unknown) {
      if (!isNodeError(error, 'ENOENT')) throw error;
      await fs.writeFile(notePath, '', 'utf8');
    }
    return { content, projectName: workspaceFolder.name, notePath };
  } catch (error) {
    return { content: '', projectName: workspaceFolder.name, message: `Failed to load note: ${String(error)}` };
  }
}

async function setStorageDirectory(): Promise<boolean> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Use as Project Note Storage'
  });
  if (!selected?.[0]) return false;
  const directory = selected[0].fsPath;
  await vscode.workspace.getConfiguration('projectNote').update(
    'storageDirectory', directory, vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(`Project Note storage directory set to: ${directory}`);
  return true;
}

async function openProjectNote(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open a project folder before opening its project note.');
    return;
  }
  let storageDirectory = getStorageDirectory();
  if (!storageDirectory) {
    const action = await vscode.window.showWarningMessage(
      'Project Note storage directory has not been configured.', 'Set Storage Directory'
    );
    if (action !== 'Set Storage Directory' || !(await setStorageDirectory())) return;
    storageDirectory = getStorageDirectory();
  }
  const notePath = getNotePath(storageDirectory, workspaceFolder.uri.fsPath);
  try {
    await fs.mkdir(storageDirectory, { recursive: true });
    try {
      await fs.access(notePath);
    } catch (error: unknown) {
      if (!isNodeError(error, 'ENOENT')) throw error;
      await fs.writeFile(notePath, '', 'utf8');
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(notePath));
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open Project Note: ${String(error)}`);
  }
}

function getStorageDirectory(): string {
  return vscode.workspace.getConfiguration('projectNote').get<string>(STORAGE_KEY.split('.')[1], '');
}

function getNotePath(storageDirectory: string, projectPath: string): string {
  const projectName = path.basename(projectPath) || 'project';
  return path.join(storageDirectory, `${projectName}-${hashProjectPath(projectPath)}${NOTE_EXTENSION}`);
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

function isViewMessage(message: unknown): message is { type: 'ready' } | { type: 'save'; content: string } | { type: 'selectStorageDirectory' } {
  return typeof message === 'object' && message !== null && 'type' in message &&
    ((message as { type: unknown }).type === 'ready' ||
      (message as { type: unknown }).type === 'selectStorageDirectory' ||
      ((message as { type: unknown }).type === 'save' && typeof (message as { content?: unknown }).content === 'string'));
}

async function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const nonce = createNonce();
  const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'`;
  const templateUri = vscode.Uri.joinPath(extensionUri, 'media', 'project-note.html');
  const template = Buffer.from(await vscode.workspace.fs.readFile(templateUri)).toString('utf8');
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'project-note.css'));
  return template
    .replace('{{csp}}', csp)
    .replace('{{styleUri}}', styleUri.toString())
    .replace('{{nonce}}', nonce);
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('');
}

export function deactivate() {}
