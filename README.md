# Smooth PDF

A minimal, modern, and high-performance Electron-based PDF viewer designed for seamless document auto-reloading.

## Features

- **Live Reload:** Automatically watches the target PDF for changes.
- **Scroll Sync:** Retains your exact scroll position across reloads.
- **Flicker-Free Crossfade:** Seamlessly renders the new version underneath the current one, then elegantly fades out the old layer.
- **Modern Minimal UX:** Dark mode, custom scrollbars, and a clean, frameless-styled window.
- **System Integration:** Registers as a PDF viewer during installation, allowing you to open PDFs directly via "Open with...".

## Installation

1. Ensure you have Node.js and `npm` installed.
2. Clone the repository or navigate to the directory.
3. Install dependencies:

   ```bash
   npm install
   ```

## Usage

Run the application:

```bash
npm start
```

1. The viewer will launch to a clean interface.
2. Click the **Open PDF** button in the top right to select a PDF via your native file browser.
3. The selected document will load, and auto-reload logic will automatically apply to any external modifications made to that file.

## Building for Production

To package the application into a standalone executable (`.exe` for Windows), run the newly configured build script:

```bash
# Build both the NSIS Installer and the Portable exe
npm run build
```

To build just the installer:

```bash
npm run build:installer
```

Or just build a portable `.exe` (does not require installation):

```bash
npm run build:portable
```

The output will be placed inside the `dist/` folder in the project root.

## Technology Stack

- **Electron:** Core framework.
- **PDF.js:** Rendering engine for accurate document display.
- **Chokidar:** Robust filesystem watcher for instant updates.
