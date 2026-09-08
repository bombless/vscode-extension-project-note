# Project Note

A small VS Code extension for keeping one plain-text note per project.

## Usage

1. Run **Project Note: Set Storage Directory** once and choose a folder where notes should be stored.
2. Open any project folder in VS Code.
3. Select the **Project Note** icon in the left activity bar, edit the note directly in its text area, then select **Save Note**.
4. Use the view's Open Note button (or run **Project Note: Open Note**) when you need the same file in the main editor.

Notes are stored outside the project workspace. Each note filename contains the project folder name plus a stable hash of its absolute path, so projects with the same folder name do not normally overwrite each other.

## Configuration

The storage folder can also be configured through the `projectNote.storageDirectory` setting.

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.
