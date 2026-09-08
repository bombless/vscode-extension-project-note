# Project Note

A small VS Code extension for keeping one plain-text note per project.

## Usage

1. Run **Project Note: Set Storage Directory** once and choose a folder where notes should be stored.
2. Open any project folder in VS Code.
3. Run **Project Note: Open Note** from the Command Palette.
4. Edit the plain-text note and save it normally with `Ctrl+S` / `Cmd+S`.
5. Open the note again later from the same project to continue editing it.

Notes are stored outside the project workspace. Each note filename contains the project folder name plus a stable hash of its absolute path, so projects with the same folder name do not normally overwrite each other.

## Configuration

The storage folder can also be configured through the `projectNote.storageDirectory` setting.

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.
