// Orbit main process: frameless window, tray, global hotkeys, and every native IPC handler.

const { app, BrowserWindow, globalShortcut, ipcMain, Menu, safeStorage, shell, Tray } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  mapGithubNotification,
  normalizeTodoTitle,
  parseEnvFile,
  parseSentryEnvFile,
  validateGithubToken,
  validateSentrySetup
} = require("./lib/orbit-shared.js");
const { fetchWeather, fetchForecast } = require("./lib/weather-service.cjs");
const { todoRequest: sendTodoRequest } = require("./lib/todo-service.cjs");
const { loadSentryIssues } = require("./lib/sentry-service.cjs");
const { fetchNotifications } = require("./lib/github-service.cjs");
const { getNetworkOverview } = require("./lib/network-service.cjs");
const { AUDIO_DEVICE_SCRIPT, createAudioService } = require("./lib/audio-service.cjs");

if (process.env.ORBIT_TEST_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.ORBIT_TEST_USER_DATA));
}

// --- Runtime paths and feature flags ---------------------------------------

const E2E_MODE = process.env.ORBIT_E2E === "1";

const sentryConfigPath = () => path.join(app.getPath("userData"), "sentry-config.json");
const outputDevicesConfigPath = () => path.join(app.getPath("userData"), "output-devices.json");
const envPaths = () => {
  if (!app.isPackaged) return [path.join(__dirname, ".env")];

  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  const executableDirectory = path.dirname(app.getPath("exe"));
  return [...new Set([
    portableDirectory,
    executableDirectory,
    portableDirectory ? path.dirname(portableDirectory) : null,
    path.dirname(executableDirectory)
  ].filter(Boolean).map((directory) => path.join(directory, ".env")))];
};
const appDataDirectory = process.env.APPDATA || path.join(process.env.USERPROFILE || os.homedir(), "AppData", "Roaming");
const artCraftLauncherPath = path.join(
  appDataDirectory,
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "ArtCraft Launcher.lnk"
);

const TODO_SUPABASE_URL = process.env.ORBIT_TODO_BASE_URL || "https://yklavrwnlzizftzytehf.supabase.co";
const TODO_SUPABASE_KEY = "sb_publishable_8SDYoTbHj-cbCIgkp28KaQ_JVaqb4EN";
const TODO_TABLE = "todos";
const GLOBAL_HOTKEY = "Alt+A";
const QUICK_ACTION_HOTKEY = "Alt+Shift+O";

let mainWindow = null;
let tray = null;
let isQuitting = false;
let hotkeyRegistered = false;

// --- Shortcut targets ------------------------------------------------------

const shortcuts = {
  youtube: { kind: "url", target: "https://www.youtube.com/" },
  github: { kind: "url", target: "https://github.com/" },
  cloudflare: { kind: "url", target: "https://www.cloudflare.com/" },
  vercel: { kind: "url", target: "https://vercel.com/" },
  chrome: { kind: "url", target: "https://dash.m0x2.dev/" },
  cloudflareDashboard: { kind: "url", target: "https://dash.cloudflare.com/3482dd2eb85032e7641005c32a67d50e/home" },
  artcraft: { kind: "url", target: "https://getartcraft.com/" },
  supabase: { kind: "url", target: "https://supabase.com/dashboard/project/yklavrwnlzizftzytehf" },
  fritzbox: { kind: "url", target: "http://192.168.178.1/#overview" },
  artcraftLauncher: { kind: "app", target: artCraftLauncherPath }
};

function requestTodoRows(search, options = {}) {
  return sendTodoRequest({
    baseUrl: TODO_SUPABASE_URL,
    apiKey: TODO_SUPABASE_KEY,
    table: TODO_TABLE,
    search,
    options
  });
}

// --- Audio service and PowerShell bridge -----------------------------------

function runPowerShellCommand(action, payload = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", AUDIO_DEVICE_SCRIPT],
      {
        windowsHide: true,
        timeout: 15000,
        env: {
          ...process.env,
          ORBIT_AUDIO_ACTION: action,
          ORBIT_AUDIO_DEVICE_ID: payload.deviceId || "",
          ORBIT_AUDIO_MUTED: payload.muted ? "1" : "0",
          ORBIT_AUDIO_VOLUME: payload.volume === undefined ? "" : String(payload.volume)
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || "").trim() || error.message));
          return;
        }
        resolve((stdout || "").trim());
      }
    );
  });
}

const audioService = createAudioService({
  runPowerShell: runPowerShellCommand,
  getConfigPath: outputDevicesConfigPath,
  fsImpl: fs
});

// --- Environment configuration (.env) --------------------------------------

async function readEnvTextFile(envPath) {
  try {
    return (await fs.readFile(envPath, "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("The .env file could not be read.");
  }
}

async function readSentryEnvConfig() {
  if (process.env.ORBIT_NO_ENV === "1") return null;

  let foundPartialConfig = false;
  for (const envPath of envPaths()) {
    const file = await readEnvTextFile(envPath);
    if (file === null) continue;

    const values = parseSentryEnvFile(file);
    const provided = Object.values(values).filter(Boolean).length;
    if (provided === 0) continue;
    if (provided !== 3) {
      foundPartialConfig = true;
      continue;
    }

    const slugPattern = /^[a-zA-Z0-9_-]{1,100}$/;
    if (!slugPattern.test(values.SENTRY_ORG) || !slugPattern.test(values.SENTRY_PROJECT)) {
      throw new Error("SENTRY_ORG or SENTRY_PROJECT in the .env file is invalid.");
    }
    if (values.SENTRY_AUTH_TOKEN.length < 8 || values.SENTRY_AUTH_TOKEN.length > 256 || /\s/.test(values.SENTRY_AUTH_TOKEN)) {
      throw new Error("SENTRY_AUTH_TOKEN in the .env file is invalid.");
    }

    return {
      organization: values.SENTRY_ORG,
      project: values.SENTRY_PROJECT,
      token: values.SENTRY_AUTH_TOKEN
    };
  }

  if (foundPartialConfig) {
    throw new Error("Please set SENTRY_ORG, SENTRY_PROJECT, and SENTRY_AUTH_TOKEN in the .env file.");
  }
  return null;
}

function sentryStatusFromEnv(envConfig) {
  return {
    configured: true,
    source: "env",
    organization: envConfig.organization,
    project: envConfig.project
  };
}

async function readGithubToken() {
  if (process.env.ORBIT_GITHUB_TOKEN) return validateGithubToken(process.env.ORBIT_GITHUB_TOKEN);
  if (process.env.ORBIT_NO_ENV === "1") return null;

  for (const envPath of envPaths()) {
    const file = await readEnvTextFile(envPath);
    if (file === null) continue;

    const values = parseEnvFile(file, ["GITHUB_TOKEN"]);
    if (values.GITHUB_TOKEN) return validateGithubToken(values.GITHUB_TOKEN);
  }
  return null;
}

// --- Window, tray, and global hotkeys --------------------------------------

function showWindow() {
  if (!app.isReady()) return;

  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    showWindow();
    return;
  }

  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    hideWindow();
  } else {
    showWindow();
  }
}

function updateTrayMenu() {
  if (!tray) return;

  const isVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  const template = [
    {
      label: isVisible ? "Hide Orbit" : "Show Orbit",
      click: () => (isVisible ? hideWindow() : showWindow())
    }
  ];

  if (!hotkeyRegistered) {
    template.push({ label: "Hotkey unavailable", enabled: false });
  }

  template.push(
    { type: "separator" },
    {
      label: "Quit Orbit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, "assets/orbit.ico"));
    tray.setToolTip("Orbit");
    tray.on("click", toggleWindow);
    updateTrayMenu();
  } catch (error) {
    tray = null;
    console.error("Orbit could not create the system tray icon.", error);
  }
}

function registerOrbitHotkey(accelerator, handler) {
  const registered = globalShortcut.register(accelerator, handler);
  if (!registered) {
    console.error(`Orbit could not register the global shortcut ${accelerator}.`);
  }
  return registered;
}

function registerGlobalHotkey() {
  hotkeyRegistered = registerOrbitHotkey(GLOBAL_HOTKEY, toggleWindow);
  updateTrayMenu();
}

function registerQuickActionHotkey() {
  registerOrbitHotkey(QUICK_ACTION_HOTKEY, () => {
    audioService
      .toggleOutput()
      .then((result) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("audio:state-changed", result.state);
        }
      })
      .catch((error) => {
        console.error("Orbit could not switch the output device.", error);
      });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 560,
    minWidth: 360,
    minHeight: 560,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    icon: path.join(__dirname, "assets/orbit.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("maximize", () => mainWindow.webContents.send("window:maximized", true));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("window:maximized", false));
  mainWindow.on("show", updateTrayMenu);
  mainWindow.on("hide", updateTrayMenu);

  mainWindow.on("close", (event) => {
    if (isQuitting || !tray) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    updateTrayMenu();
  });
}

// --- IPC: window controls and shortcuts ------------------------------------

ipcMain.on("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.on("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("shortcut:open", async (_event, shortcutId) => {
  const shortcut = shortcuts[shortcutId];
  if (!shortcut) throw new Error("Unknown shortcut.");

  if (shortcut.kind === "app") {
    const error = await shell.openPath(shortcut.target);
    if (error) throw new Error(`The app could not be opened: ${error}`);
    return;
  }

  await shell.openExternal(shortcut.target);
});

// --- IPC: audio ------------------------------------------------------------

ipcMain.handle("audio:list-output-devices", async () => audioService.listOutputDevices());
ipcMain.handle("audio:get-output-pair", async () => audioService.getOutputPair());
ipcMain.handle("audio:save-output-pair", async (_event, input) => audioService.saveOutputPair(input));
ipcMain.handle("audio:toggle-output", async () => audioService.toggleOutput());
ipcMain.handle("audio:get-state", async () => audioService.getState());
ipcMain.handle("audio:set-output-mute", async (_event, muted) => audioService.setOutputMuted(muted));
ipcMain.handle("audio:set-mic-mute", async (_event, muted) => audioService.setMicrophoneMuted(muted));
ipcMain.handle("audio:set-volume", async (_event, volume) => audioService.setOutputVolume(volume));

// --- IPC: To-Do (Supabase) -------------------------------------------------

ipcMain.handle("todo:list", async () => {
  const rows = await requestTodoRows("?select=id,title,completed,created_at&order=completed.asc,created_at.desc");
  if (!Array.isArray(rows)) throw new Error("The To-Do service returned an unexpected response.");
  return rows;
});

ipcMain.handle("todo:create", async (_event, title) => {
  const trimmed = normalizeTodoTitle(title);

  const rows = await requestTodoRows("", {
    method: "POST",
    body: JSON.stringify({ title: trimmed, completed: false }),
    headers: { Prefer: "return=representation" }
  });
  if (!Array.isArray(rows) || !rows[0]) throw new Error("The task could not be created.");
  return rows[0];
});

ipcMain.handle("todo:set-completed", async (_event, input) => {
  const id = Number(input?.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid task.");
  if (typeof input?.completed !== "boolean") throw new Error("Invalid task state.");

  const rows = await requestTodoRows(`?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ completed: input.completed }),
    headers: { Prefer: "return=representation" }
  });
  if (!Array.isArray(rows) || !rows[0]) throw new Error("The task could not be updated.");
  return rows[0];
});

ipcMain.handle("todo:delete", async (_event, id) => {
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) throw new Error("Invalid task.");

  await requestTodoRows(`?id=eq.${taskId}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  return { ok: true };
});

// --- IPC: weather and network ----------------------------------------------

ipcMain.handle("weather:current", () =>
  fetchWeather(process.env.ORBIT_WEATHER_BASE_URL ? { baseUrl: process.env.ORBIT_WEATHER_BASE_URL } : {})
);

ipcMain.handle("weather:forecast", () =>
  fetchForecast(process.env.ORBIT_WEATHER_BASE_URL ? { baseUrl: process.env.ORBIT_WEATHER_BASE_URL } : {})
);

ipcMain.handle("network:overview", async () => {
  const host = process.env.ORBIT_NETWORK_PROBE_HOST || undefined;
  const configuredPort = process.env.ORBIT_NETWORK_PROBE_PORT;
  const port = configuredPort ? Number(configuredPort) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("The network probe port is invalid.");
  }
  const publicIpUrl = process.env.ORBIT_PUBLIC_IP_URL || undefined;
  return getNetworkOverview({
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
    ...(publicIpUrl ? { publicIpUrl } : {})
  });
});

// --- IPC: GitHub inbox -----------------------------------------------------

ipcMain.handle("github:notifications", async () => {
  const token = await readGithubToken();
  if (!token) return { configured: false, notifications: [] };

  const baseUrl = process.env.ORBIT_GITHUB_BASE_URL || undefined;
  const notifications = await fetchNotifications(baseUrl ? { token, baseUrl } : { token });
  return { configured: true, notifications: notifications.map(mapGithubNotification) };
});

ipcMain.handle("github:open", async (_event, target) => {
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error("This link cannot be opened.");
  }
  if (url.protocol !== "https:" || url.origin !== "https://github.com") {
    throw new Error("This link cannot be opened.");
  }
  await shell.openExternal(url.href);
});

// --- IPC: Sentry -----------------------------------------------------------

ipcMain.handle("sentry:status", async () => {
  const envConfig = await readSentryEnvConfig();
  if (envConfig) return sentryStatusFromEnv(envConfig);

  try {
    const savedConfig = JSON.parse(await fs.readFile(sentryConfigPath(), "utf8"));
    return {
      configured: true,
      source: "saved",
      organization: String(savedConfig.organization ?? ""),
      project: String(savedConfig.project ?? "")
    };
  } catch (error) {
    if (error.code === "ENOENT") return { configured: false };
    throw new Error("The saved Sentry configuration could not be read.");
  }
});

ipcMain.handle("sentry:configure", async (_event, input) => {
  const envConfig = await readSentryEnvConfig();
  if (envConfig) return sentryStatusFromEnv(envConfig);
  if (!input || typeof input !== "object") {
    throw new Error("Please enter an organization, project, and API token.");
  }

  const validated = validateSentrySetup(input, { requireToken: false });
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure local storage is not available on this device.");
  }

  let encryptedToken;
  if (validated.token.length > 0) {
    encryptedToken = safeStorage.encryptString(validated.token).toString("base64");
  } else {
    try {
      const savedConfig = JSON.parse(await fs.readFile(sentryConfigPath(), "utf8"));
      if (typeof savedConfig.token !== "string") throw new Error("Missing token");
      encryptedToken = savedConfig.token;
    } catch {
      throw new Error("Please enter a Sentry API token.");
    }
  }

  const config = {
    organization: validated.organization,
    project: validated.project,
    token: encryptedToken
  };
  const configPath = sentryConfigPath();
  const temporaryPath = `${configPath}.tmp`;

  try {
    await fs.writeFile(temporaryPath, JSON.stringify(config), { mode: 0o600 });
    await fs.rename(temporaryPath, configPath);
  } catch {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw new Error("The Sentry configuration could not be saved securely.");
  }

  return { configured: true };
});

ipcMain.handle("sentry:clear", async () => {
  try {
    await fs.unlink(sentryConfigPath());
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error("The saved Sentry configuration could not be removed.");
    }
  }
  return { configured: false };
});

ipcMain.handle("sentry:issues", async () => {
  let config = await readSentryEnvConfig();
  let token = config?.token;
  if (!config) {
    try {
      config = JSON.parse(await fs.readFile(sentryConfigPath(), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("Please connect your Sentry project first.");
      throw new Error("The saved Sentry configuration is corrupted.");
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure local storage is not available on this device.");
    }

    try {
      token = safeStorage.decryptString(Buffer.from(config.token, "base64"));
    } catch {
      throw new Error("The locally stored Sentry token could not be decrypted. Please connect Sentry again.");
    }
  }

  return loadSentryIssues({ organization: config.organization, token });
});

// --- App lifecycle ---------------------------------------------------------

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    app.setAppUserModelId("com.orbit.desktop");
    createWindow();
    if (!E2E_MODE) {
      createTray();
      registerGlobalHotkey();
      registerQuickActionHotkey();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
