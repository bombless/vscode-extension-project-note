import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const STORAGE_KEY = 'projectNote.storageDirectory';
const NOTE_EXTENSION = '.txt';

export function activate(context: vscode.ExtensionContext) {
  const noteViewProvider = new ProjectNoteViewProvider();

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

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = getWebviewHtml(view.webview);
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

function getWebviewHtml(webview: vscode.Webview): string {
  const nonce = createNonce();
  const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'`;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}"><title>Project Note</title>
<style>
html, body { height: 100%; }
body { box-sizing: border-box; color: var(--vscode-foreground); font-family: var(--vscode-font-family); margin: 0; overflow: hidden; padding: 10px; }
#editor { display: none; flex-direction: column; height: 100%; min-height: 0; }
#project { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#note { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); box-sizing: border-box; color: var(--vscode-input-foreground); flex: 1; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 1.6; min-height: 0; outline: none; padding: 10px; resize: none; width: 100%; }
#note:focus { border-color: var(--vscode-focusBorder); } #note:disabled { opacity: 0.6; }
#footer { align-items: center; display: flex; gap: 8px; margin-top: 8px; min-height: 28px; }
#status { color: var(--vscode-descriptionForeground); flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } #status.error { color: var(--vscode-errorForeground); }
button { background: var(--vscode-button-background); border: 0; color: var(--vscode-button-foreground); cursor: pointer; font: inherit; padding: 6px 10px; } button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); } button:disabled { cursor: default; opacity: 0.55; }
#setup { display: none; padding-top: 4px; } #setup h2 { font-size: 14px; font-weight: 600; margin: 0 0 8px; } #setup p { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.5; margin: 0 0 14px; }
</style></head><body>
<section id="setup"><h2>存储目录</h2><p>选择一个项目目录外的文件夹，用来保存项目笔记。</p><button id="select-directory" type="button">选择存储目录</button></section>
<section id="editor"><div id="project"></div><textarea id="note" aria-label="Project note" placeholder="为当前项目写下笔记..."></textarea><div id="footer"><div id="status" role="status"></div><button id="save-note" type="button">保存笔记</button></div></section>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi(); const note = document.getElementById('note'); const project = document.getElementById('project'); const status = document.getElementById('status'); const setup = document.getElementById('setup'); const editor = document.getElementById('editor'); const selectDirectory = document.getElementById('select-directory'); const saveNote = document.getElementById('save-note'); let editable = false;
const setStatus = (text, isError = false) => { status.textContent = text; status.classList.toggle('error', isError); };
const save = () => { if (!editable) return; saveNote.disabled = true; setStatus('正在保存...'); vscode.postMessage({ type: 'save', content: note.value }); };
note.addEventListener('input', () => { if (editable) setStatus('未保存'); });
saveNote.addEventListener('click', save);
selectDirectory.addEventListener('click', () => vscode.postMessage({ type: 'selectStorageDirectory' }));
window.addEventListener('message', (event) => { const message = event.data; if (message.type === 'load') { project.textContent = message.projectName; note.value = message.content; editable = Boolean(message.notePath); setup.style.display = editable ? 'none' : 'block'; editor.style.display = editable ? 'flex' : 'none'; note.disabled = !editable; saveNote.disabled = !editable; setStatus(message.message || (editable ? '已保存' : ''), Boolean(message.message)); } if (message.type === 'saved') { saveNote.disabled = false; setStatus('已保存'); } if (message.type === 'saveError') { saveNote.disabled = false; setStatus(message.message, true); } });
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('');
}

export function deactivate() {}
