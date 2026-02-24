const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
// const fs = require('fs'); // Moved to lazy loading
// const chokidar = require('chokidar'); // Moved to lazy loading

// Use logging as per global rules
const log = (msg) => {
  const timestamp = new Date().toISOString();
  const formattedMsg = `[INFO] ${timestamp} - ${msg}`;
  console.log(formattedMsg);
};

const logError = (err) => {
  const timestamp = new Date().toISOString();
  console.error(`[ERROR] ${timestamp} -`, err);
};

let mainWindow = null;
let watcher = null;
let targetPdf = null;

/**
 * Initializes the main browser window.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#121212",
      symbolColor: "#ffffff",
    },
    backgroundColor: "#121212",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile("index.html");
  mainWindow.removeMenu();
}

/**
 * Sets up the file watcher for the target PDF.
 * @param {string} filePath - Absolute path to the PDF to watch.
 */
function setupWatcher(filePath) {
  if (watcher) watcher.close();

  const chokidar = require("chokidar");
  log(`Setting up watcher for ${filePath}`);
  watcher = chokidar.watch(filePath, {
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 100,
    },
  });

  watcher.on("change", () => {
    log(`File changed: ${filePath}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("fileUpdated", filePath);
    }
  });

  watcher.on("error", (err) => logError(err));
}

app.whenReady().then(() => {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  if (args.length > 0) {
    targetPdf = path.resolve(args[0]);
    log(`Target PDF: ${targetPdf}`);
  } else {
    log("No PDF specified on startup.");
  }

  createWindow();

  if (targetPdf) {
    setupWatcher(targetPdf);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("getFile", async (event, filePath) => {
  log(`Reading file: ${filePath}`);
  const fs = require("fs");
  try {
    const buffer = await fs.promises.readFile(filePath);
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  } catch (err) {
    logError(err);
    throw err;
  }
});

ipcMain.handle("getFilePath", () => {
  return targetPdf;
});

ipcMain.handle("selectFile", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Select PDF",
    filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
    properties: ["openFile"],
  });

  if (canceled || filePaths.length === 0) {
    return null;
  }

  targetPdf = filePaths[0];
  setupWatcher(targetPdf);
  return targetPdf;
});

ipcMain.handle("closeFile", () => {
  log("Closing file");
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  targetPdf = null;
  return true;
});
