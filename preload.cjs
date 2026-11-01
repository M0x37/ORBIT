const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orbitWindow", {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  openShortcut: (shortcutId) => ipcRenderer.invoke("shortcut:open", shortcutId),
  todo: {
    list: () => ipcRenderer.invoke("todo:list"),
    create: (title) => ipcRenderer.invoke("todo:create", title),
    setCompleted: (id, completed) => ipcRenderer.invoke("todo:set-completed", { id, completed }),
    remove: (id) => ipcRenderer.invoke("todo:delete", id)
  },
  weather: {
    get: () => ipcRenderer.invoke("weather:current")
  },
  sentry: {
    getStatus: () => ipcRenderer.invoke("sentry:status"),
    configure: (config) => ipcRenderer.invoke("sentry:configure", config),
    clear: () => ipcRenderer.invoke("sentry:clear"),
    getIssues: () => ipcRenderer.invoke("sentry:issues")
  },
  onMaximizedChange: (callback) => {
    ipcRenderer.on("window:maximized", (_event, isMaximized) => callback(isMaximized));
  }
});
