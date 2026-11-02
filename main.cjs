const { app, BrowserWindow, globalShortcut, ipcMain, Menu, safeStorage, shell, Tray } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  mapGithubNotification,
  parseEnvFile,
  parseSentryEnvFile,
  validateGithubToken,
  validateSentrySetup
} = require("./lib/orbit-shared.js");
const { fetchWeather } = require("./lib/weather-service.cjs");
const { todoRequest: sendTodoRequest } = require("./lib/todo-service.cjs");
const { loadSentryIssues } = require("./lib/sentry-service.cjs");
const { fetchNotifications } = require("./lib/github-service.cjs");
const { getNetworkOverview } = require("./lib/network-service.cjs");

if (process.env.ORBIT_TEST_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.ORBIT_TEST_USER_DATA));
}

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
const artCraftLauncherPath = process.env.APPDATA
  ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "ArtCraft Launcher.lnk")
  : "C:\\Users\\maxsc\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\ArtCraft Launcher.lnk";

const TODO_SUPABASE_URL = process.env.ORBIT_TODO_BASE_URL || "https://yklavrwnlzizftzytehf.supabase.co";
const TODO_SUPABASE_KEY = "sb_publishable_8SDYoTbHj-cbCIgkp28KaQ_JVaqb4EN";
const TODO_TABLE = "todos";
const GLOBAL_HOTKEY = "Alt+A";
const QUICK_ACTION_HOTKEY = "Alt+Shift+O";

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

function todoRequest(search, options = {}) {
  return sendTodoRequest({
    baseUrl: TODO_SUPABASE_URL,
    apiKey: TODO_SUPABASE_KEY,
    table: TODO_TABLE,
    search,
    options
  });
}

const AUDIO_DEVICE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class AudioDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IMMDeviceCollection devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
  [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
  [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int Item(uint index, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, out IntPtr result);
  [PreserveSig] int OpenPropertyStore(uint mode, out IPropertyStore store);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetState(out uint state);
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint index, out PropertyKey key);
  [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
  [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
  [PreserveSig] int Commit();
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
struct PropertyKey {
  public Guid FormatId;
  public uint PropertyId;
}

[StructLayout(LayoutKind.Explicit)]
struct PropVariant {
  [FieldOffset(0)] public ushort Type;
  [FieldOffset(8)] public IntPtr PointerValue;
}

[ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultFormat, out IntPtr format);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format, IntPtr mixFormat);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, out long defaultPeriod, out long minimumPeriod);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, ref long period);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, ref PropertyKey key, IntPtr value);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, ref PropertyKey key, IntPtr value);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
}

public static class OrbitAudio {
  static IMMDeviceEnumerator CreateEnumerator() {
    return (IMMDeviceEnumerator)new AudioDeviceEnumerator();
  }

  static string FriendlyName(IMMDevice device) {
    IPropertyStore store;
    Marshal.ThrowExceptionForHR(device.OpenPropertyStore(0, out store));
    var key = new PropertyKey {
      FormatId = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"),
      PropertyId = 14
    };
    PropVariant value;
    Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
    try {
      if (value.Type != 31 || value.PointerValue == IntPtr.Zero) return "Unknown device";
      return Marshal.PtrToStringUni(value.PointerValue);
    } finally {
      PropVariantClear(ref value);
      Marshal.ReleaseComObject(store);
    }
  }

  [DllImport("ole32.dll")]
  static extern int PropVariantClear(ref PropVariant value);

  public static object[] GetDevices() {
    var enumerator = CreateEnumerator();
    IMMDeviceCollection collection;
    Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(0, 1, out collection));
    uint count;
    Marshal.ThrowExceptionForHR(collection.GetCount(out count));
    var result = new List<object>();
    for (uint i = 0; i < count; i++) {
      IMMDevice device;
      Marshal.ThrowExceptionForHR(collection.Item(i, out device));
      string id;
      Marshal.ThrowExceptionForHR(device.GetId(out id));
      result.Add(new { id = id, name = FriendlyName(device) });
      Marshal.ReleaseComObject(device);
    }
    Marshal.ReleaseComObject(collection);
    Marshal.ReleaseComObject(enumerator);
    return result.ToArray();
  }

  public static string GetDefaultDeviceId() {
    var enumerator = CreateEnumerator();
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 0, out device));
    string id;
    Marshal.ThrowExceptionForHR(device.GetId(out id));
    Marshal.ReleaseComObject(device);
    Marshal.ReleaseComObject(enumerator);
    return id;
  }

  public static void SetDefaultDevice(string id) {
    var policyType = Type.GetTypeFromCLSID(new Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9"));
    var policy = (IPolicyConfig)Activator.CreateInstance(policyType);
    for (int role = 0; role < 3; role++) {
      Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(id, role));
    }
    Marshal.ReleaseComObject(policy);
  }
}
'@

switch ($env:ORBIT_AUDIO_ACTION) {
  'list' {
    ConvertTo-Json -InputObject ([OrbitAudio]::GetDevices()) -Compress -Depth 4
  }
  'default' {
    [OrbitAudio]::GetDefaultDeviceId()
  }
  'set' {
    [OrbitAudio]::SetDefaultDevice($env:ORBIT_AUDIO_DEVICE_ID)
    'ok'
  }
  default {
    throw 'Unknown audio command.'
  }
}
`;

function runPowerShellCommand(args) {
  const [action, deviceId] = args;
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
          ORBIT_AUDIO_DEVICE_ID: deviceId || ""
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

async function getAudioDevices() {
  const output = await runPowerShellCommand(["list"]);
  try {
    const devices = JSON.parse(output || "[]");
    if (!Array.isArray(devices)) throw new Error("unexpected device list");
    return devices.filter((device) => typeof device?.id === "string" && typeof device?.name === "string");
  } catch {
    throw new Error("The audio device list could not be read.");
  }
}

async function saveOutputDevicePair(input) {
  const headsetId = input?.headsetId;
  const monitorId = input?.monitorId;
  if (typeof headsetId !== "string" || typeof monitorId !== "string" || headsetId === monitorId) {
    throw new Error("Select two different output devices.");
  }

  const devices = await getAudioDevices();
  const headset = devices.find((device) => device.id === headsetId);
  const monitor = devices.find((device) => device.id === monitorId);
  if (!headset || !monitor) throw new Error("The selected output device is no longer available.");

  const config = {
    headset: { id: headset.id, name: headset.name },
    monitor: { id: monitor.id, name: monitor.name }
  };
  const configPath = outputDevicesConfigPath();
  const temporaryPath = `${configPath}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(config), { mode: 0o600 });
    await fs.rename(temporaryPath, configPath);
  } catch {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw new Error("The output device selection could not be saved.");
  }
  return config;
}

async function getOutputDevicePair() {
  try {
    const config = JSON.parse(await fs.readFile(outputDevicesConfigPath(), "utf8"));
    if (typeof config.headset?.id !== "string" || typeof config.monitor?.id !== "string") {
      throw new Error("invalid saved selection");
    }
    return config;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("The saved output device selection could not be read.");
  }
}

async function toggleAudioOutputDevice() {
  const pair = await getOutputDevicePair();
  if (!pair) throw new Error("Select your headset and monitor in Quick Actions first.");

  const devices = await getAudioDevices();
  const headset = devices.find((device) => device.id === pair.headset.id);
  const monitor = devices.find((device) => device.id === pair.monitor.id);
  if (!headset || !monitor) {
    throw new Error("A selected output device is unavailable. Re-select your devices in Quick Actions.");
  }

  const currentId = await runPowerShellCommand(["default"]);
  const target = currentId === headset.id ? monitor : headset;
  await runPowerShellCommand(["set", target.id]);
  return { ok: true, message: `Output switched to ${target.name}.` };
}

async function readSentryEnvConfig() {
  if (process.env.ORBIT_NO_ENV === "1") return null;

  let foundPartialConfig = false;
  for (const envPath of envPaths()) {
    let file;
    try {
      file = (await fs.readFile(envPath, "utf8")).replace(/^\uFEFF/, "");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error("The .env file could not be read.");
    }

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

async function readGithubToken() {
  if (process.env.ORBIT_GITHUB_TOKEN) return validateGithubToken(process.env.ORBIT_GITHUB_TOKEN);
  if (process.env.ORBIT_NO_ENV === "1") return null;

  for (const envPath of envPaths()) {
    let file;
    try {
      file = (await fs.readFile(envPath, "utf8")).replace(/^\uFEFF/, "");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error("The .env file could not be read.");
    }

    const values = parseEnvFile(file, ["GITHUB_TOKEN"]);
    if (values.GITHUB_TOKEN) return validateGithubToken(values.GITHUB_TOKEN);
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

function registerQuickActionHotkey() {
  const quickHotkeyRegistered = globalShortcut.register(QUICK_ACTION_HOTKEY, () => {
    toggleAudioOutputDevice().catch((error) => {
      console.error("Orbit could not switch the output device.", error);
    });
  });

  if (!quickHotkeyRegistered) {
    console.error(`Orbit could not register the global shortcut ${QUICK_ACTION_HOTKEY}.`);
  }
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

ipcMain.handle("audio:list-output-devices", async () => getAudioDevices());
ipcMain.handle("audio:get-output-pair", async () => getOutputDevicePair());
ipcMain.handle("audio:save-output-pair", async (_event, input) => saveOutputDevicePair(input));
ipcMain.handle("audio:toggle-output", async () => toggleAudioOutputDevice());

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

ipcMain.handle("weather:current", () =>
  fetchWeather(process.env.ORBIT_WEATHER_BASE_URL ? { baseUrl: process.env.ORBIT_WEATHER_BASE_URL } : {})
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
