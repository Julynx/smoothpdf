const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose secure API channel to the renderer process.
 */
contextBridge.exposeInMainWorld('api', {
    getFilePath: () => ipcRenderer.invoke('getFilePath'),
    onFileUpdated: (callback) =>
        ipcRenderer.on('fileUpdated', (_event, filePath) => callback(filePath)),
    selectFile: () => ipcRenderer.invoke('selectFile'),
    closeFile: () => ipcRenderer.invoke('closeFile'),
});
