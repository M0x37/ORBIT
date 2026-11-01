const { app, BrowserWindow, globalShortcut, ipcMain, Menu, safeStorage, shell, Tray } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const sentryConfigPath = () => path.join(app.getPath("userData"), "sentry-config.json");
const sentryEnvPaths = () => {
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
const artCraftLauncherPath = process.env.APPDATA
  ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "ArtCraft Launcher.lnk")
  : "C:\\Users\\maxsc\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\ArtCraft Launcher.lnk";

const TODO_SUPABASE_URL = "https://yklavrwnlzizftzytehf.supabase.co";
const TODO_SUPABASE_KEY = "sb_publishable_8SDYoTbHj-cbCIgkp28KaQ_JVaqb4EN";
const TODO_TABLE = "todos";
const GLOBAL_HOTKEY = "Alt+A";
const WEATHER_LOCATION = { latitude: 50.43333, longitude: 7.95 };

let mainWindow = null;
let tray = null;
let isQuitting = false;
let hotkeyRegistered = false;

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

async function todoRequest(search, options = {}) {
  let response;
  try {
    response = await fetch(`${TODO_SUPABASE_URL}/rest/v1/${TODO_TABLE}${search}`, {
      ...options,
      headers: {
        apikey: TODO_SUPABASE_KEY,
        Authorization: `Bearer ${TODO_SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...options.headers
      },
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new Error("Could not reach the To-Do service. Check your internet connection.");
  }

  if (!response.ok) {
    let message = `The To-Do service returned HTTP ${response.status}.`;
    try {
      const payload = await response.json();
      if (payload?.message) message = payload.message;
    } catch {}
    throw new Error(message);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function fetchWeather() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(WEATHER_LOCATION.latitude));
  url.searchParams.set("longitude", String(WEATHER_LOCATION.longitude));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("timezone", "Europe/Berlin");

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("The weather service is unreachable. Check your internet connection.");
  }

  if (!response.ok) {
    throw new Error(`The weather service returned HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The weather service returned an invalid response.");
  }

  const temperature = payload?.current?.temperature_2m;
  const weatherCode = payload?.current?.weather_code;
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || !Number.isInteger(weatherCode)) {
    throw new Error("The weather service returned an unexpected response.");
  }

  return { temperature: Math.round(temperature), weatherCode };
}

async function readSentryEnvConfig() {
  let foundPartialConfig = false;
  for (const envPath of sentryEnvPaths()) {
    let file;
    try {
      file = (await fs.readFile(envPath, "utf8")).replace(/^\uFEFF/, "");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error("The .env file could not be read.");
    }

    const values = {};
    for (const line of file.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?(SENTRY_ORG|SENTRY_PROJECT|SENTRY_AUTH_TOKEN)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      values[match[1]] = value;
    }

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

function registerGlobalHotkey() {
  hotkeyRegistered = globalShortcut.register(GLOBAL_HOTKEY, toggleWindow);
  if (!hotkeyRegistered) {
    console.error(`Orbit could not register the global shortcut ${GLOBAL_HOTKEY}.`);
  }
  updateTrayMenu();
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

ipcMain.handle("todo:list", async () => {
  const rows = await todoRequest("?select=id,title,completed,created_at&order=completed.asc,created_at.desc");
  if (!Array.isArray(rows)) throw new Error("The To-Do service returned an unexpected response.");
  return rows;
});

ipcMain.handle("todo:create", async (_event, title) => {
  if (typeof title !== "string") throw new Error("Please enter a task.");
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Please enter a task.");
  if (trimmed.length > 500) throw new Error("Tasks can be at most 500 characters long.");

  const rows = await todoRequest("", {
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

  const rows = await todoRequest(`?id=eq.${id}`, {
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

  await todoRequest(`?id=eq.${taskId}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  return { ok: true };
});

ipcMain.handle("weather:current", fetchWeather);

ipcMain.handle("sentry:status", async () => {
  const envConfig = await readSentryEnvConfig();
  if (envConfig) {
    return {
      configured: true,
      source: "env",
      organization: envConfig.organization,
      project: envConfig.project
    };
  }

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
  if (envConfig) {
    return {
      configured: true,
      source: "env",
      organization: envConfig.organization,
      project: envConfig.project
    };
  }
  if (!input || typeof input !== "object") {
    throw new Error("Please enter an organization, project, and API token.");
  }

  const { organization, project, token } = input;
  const slugPattern = /^[a-zA-Z0-9_-]{1,100}$/;
  if (typeof organization !== "string" || !slugPattern.test(organization.trim())) {
    throw new Error("The Sentry organization slug is invalid.");
  }
  if (typeof project !== "string" || !slugPattern.test(project.trim())) {
    throw new Error("The Sentry project slug is invalid.");
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure local storage is not available on this device.");
  }

  let encryptedToken;
  if (typeof token === "string" && token.length > 0) {
    if (token.length < 8 || token.length > 256 || /\s/.test(token)) {
      throw new Error("The Sentry API token is invalid.");
    }
    encryptedToken = safeStorage.encryptString(token).toString("base64");
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
    organization: organization.trim(),
    project: project.trim(),
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

  const organizationPath = `/api/0/organizations/${encodeURIComponent(config.organization)}/`;
  const issuesUrl = new URL(`${organizationPath}issues/`, "https://sentry.io");
  issuesUrl.searchParams.set("query", "is:unresolved");
  issuesUrl.searchParams.set("statsPeriod", "14d");
  issuesUrl.searchParams.set("limit", "100");

  const projectsUrl = new URL(`${organizationPath}projects/`, "https://sentry.io");
  projectsUrl.searchParams.set("limit", "100");

  const [issues, projects] = await Promise.all([
    fetchSentryPages(issuesUrl, token, "issues"),
    fetchSentryPages(projectsUrl, token, "projects")
  ]);

  return {
    projectCount: projects.length,
    issues: issues.map((issue) => ({
      id: String(issue.id ?? ""),
      title: String(issue.title ?? "Untitled error"),
      culprit: String(issue.culprit ?? ""),
      project: String(issue.project?.name ?? issue.project?.slug ?? "Unknown project"),
      level: String(issue.level ?? "error"),
      status: String(issue.status ?? "unknown"),
      count: String(issue.count ?? "0"),
      lastSeen: String(issue.lastSeen ?? "")
    }))
  };
});

async function fetchSentryPages(initialUrl, token, resourceName) {
  const results = [];
  const seenPages = new Set();
  let pageUrl = initialUrl;

  while (pageUrl) {
    if (pageUrl.origin !== "https://sentry.io" || !pageUrl.pathname.startsWith(initialUrl.pathname)) {
      throw new Error("Sentry returned an invalid page link.");
    }
    if (seenPages.has(pageUrl.href)) {
      throw new Error("Sentry returned a repeated results page.");
    }
    seenPages.add(pageUrl.href);

    let response;
    try {
      response = await fetch(pageUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new Error(`Sentry is unreachable while loading ${resourceName}. Check your internet connection.`);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Sentry rejected the token. Organization read permissions are required for all projects.");
      }
      if (response.status === 404) {
        throw new Error("Sentry organization not found. Check the organization slug.");
      }
      if (response.status === 429) {
        throw new Error("Sentry is rate limiting requests. Please try again later.");
      }
      throw new Error(`Sentry could not load ${resourceName} (HTTP ${response.status}).`);
    }

    let pageResults;
    try {
      pageResults = await response.json();
    } catch {
      throw new Error(`Sentry returned an invalid response for ${resourceName}.`);
    }
    if (!Array.isArray(pageResults)) {
      throw new Error(`Sentry returned an unexpected response for ${resourceName}.`);
    }
    results.push(...pageResults);
    pageUrl = getNextSentryPage(response.headers.get("link"), pageUrl);
  }

  return results;
}

function getNextSentryPage(linkHeader, currentUrl) {
  if (!linkHeader) return null;

  const nextLink = linkHeader
    .split(/,\s*(?=<)/)
    .find((link) => /;\s*rel="?next"?/.test(link));
  if (!nextLink || !/;\s*results="?true"?/.test(nextLink)) return null;

  const match = nextLink.match(/<([^>]+)>/);
  if (!match) throw new Error("Sentry returned an invalid page link.");
  return new URL(match[1], currentUrl);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    app.setAppUserModelId("com.orbit.desktop");
    createWindow();
    createTray();
    registerGlobalHotkey();
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
