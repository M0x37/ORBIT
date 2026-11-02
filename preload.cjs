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
  network: {
    getOverview: () => ipcRenderer.invoke("network:overview")
  },
  github: {
    getNotifications: () => ipcRenderer.invoke("github:notifications"),
    open: (url) => ipcRenderer.invoke("github:open", url)
  },
  quickActions: {
    getOutputDevices: () => ipcRenderer.invoke("audio:list-output-devices"),
    getOutputPair: () => ipcRenderer.invoke("audio:get-output-pair"),
    saveOutputPair: (pair) => ipcRenderer.invoke("audio:save-output-pair", pair),
    toggleOutput: () => ipcRenderer.invoke("audio:toggle-output"),
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
