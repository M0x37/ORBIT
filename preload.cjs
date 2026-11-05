// Renderer bridge: the only API exposed to the sandboxed window. Every call is
// forwarded to a validated ipcMain handler in main.cjs.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orbitWindow", {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  openShortcut: (shortcutId) => ipcRenderer.invoke("shortcut:open", shortcutId),
  // To-Do (Supabase)
  todo: {
    list: () => ipcRenderer.invoke("todo:list"),
    create: (title) => ipcRenderer.invoke("todo:create", title),
    setCompleted: (id, completed) => ipcRenderer.invoke("todo:set-completed", { id, completed }),
    remove: (id) => ipcRenderer.invoke("todo:delete", id)
  },
  // Weather and network
  weather: {
    get: () => ipcRenderer.invoke("weather:current"),
    forecast: () => ipcRenderer.invoke("weather:forecast")
  },
  network: {
    getOverview: () => ipcRenderer.invoke("network:overview")
  },
  // GitHub inbox
  github: {
    getNotifications: () => ipcRenderer.invoke("github:notifications"),
    open: (url) => ipcRenderer.invoke("github:open", url)
  },
  // Quick Actions audio console
  quickActions: {
    getOutputDevices: () => ipcRenderer.invoke("audio:list-output-devices"),
    getOutputPair: () => ipcRenderer.invoke("audio:get-output-pair"),
    saveOutputPair: (pair) => ipcRenderer.invoke("audio:save-output-pair", pair),
    toggleOutput: () => ipcRenderer.invoke("audio:toggle-output"),
    getState: () => ipcRenderer.invoke("audio:get-state"),
    setOutputMuted: (muted) => ipcRenderer.invoke("audio:set-output-mute", muted),
    setMicrophoneMuted: (muted) => ipcRenderer.invoke("audio:set-mic-mute", muted),
    setVolume: (volume) => ipcRenderer.invoke("audio:set-volume", volume),
    onStateChange: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("audio:state-changed", listener);
      return () => ipcRenderer.removeListener("audio:state-changed", listener);
    }
  },
  // Sentry
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
