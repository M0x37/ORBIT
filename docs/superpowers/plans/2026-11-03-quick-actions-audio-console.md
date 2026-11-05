# Quick Actions Audio Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Quick Actions into a compact audio console that switches output, mutes output and microphone, and controls output volume, backed by a testable `lib/audio-service.cjs`.

**Architecture:** Move the existing PowerShell/Core Audio logic into an injectable service. Extend the C# bridge with `IAudioEndpointVolume` state, mute, and volume actions. Expose those actions through IPC/preload, then replace the Quick Actions page with one console panel and wire renderer state, debouncing, and hotkey synchronization.

**Tech Stack:** Electron 45, vanilla HTML/CSS/JS, Node `node:test`, Playwright Electron, Windows PowerShell 5.1 + C# COM interop, Core Audio.

**Spec:** `docs/superpowers/specs/2026-11-03-quick-actions-audio-console-design.md`

## Global Constraints

- Windows only; Core Audio runs through PowerShell 5.1 and the embedded C# script.
- Renderer stays sandboxed: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; all native work goes through `preload.cjs` and `ipcMain`.
- Window is fixed at 980×560, `minHeight: 560`, `minWidth: 360`; Quick Actions must not scroll or clip.
- UI text, status messages, and errors are English.
- No new dependencies, native Node modules, or persistent helper processes.
- Output operations use `eMultimedia` (render, dataFlow `0`, role `1`); microphone mute uses `eCommunications` (capture, dataFlow `1`, role `2`).
- State shape is `{ output: { id, name, muted, volume } | null, microphone: { id, name, muted } | null }`, with integer volume `0`–`100`.
- Version is `1.11.0` when release bookkeeping is done.
- `npm run check` must include `lib/audio-service.cjs`.
- Do not build, publish, or commit unless the user explicitly asks. The repo policy requires explicit commit permission.

## Review Focus

- No default output or microphone present: the page still loads and disables only the missing controls.
- PowerShell or COM failure: the user gets a specific error, no raw stderr, and the remaining controls stay usable.
- Fast slider dragging: writes coalesce, the final value wins, and Orbit does not spawn one PowerShell process per pixel.
- Saved pair references a disconnected device, or the current output is a third device: the switch target/label stays correct and the existing re-select error remains reachable.
- Long device names at 360px and the full console at 980×560: labels truncate cleanly with no page scroll or clipped controls.

---

### Task 1: Extract the existing audio logic into a service

**Files:**
- Create: `lib/audio-service.cjs`
- Create: `tests/integration/audio-service.test.cjs`
- Modify: `main.cjs` (audio script, audio functions, imports, IPC handlers)
- Modify: `package.json` (`check` script)

**Interfaces:**
- Consumes: existing PowerShell behavior from `main.cjs`.
- Produces: `AUDIO_DEVICE_SCRIPT` (string) and `createAudioService({ runPowerShell, getConfigPath, fsImpl })` with `listOutputDevices()`, `getOutputPair()`, `saveOutputPair({ headsetId, monitorId })`, and `toggleOutput()`.

- [ ] **Step 1: Write failing integration tests for the extracted service**

Create `tests/integration/audio-service.test.cjs`. Use a fake runner that records `{ action, payload }` calls and a temporary config directory.

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createAudioService } = require("../../lib/audio-service.cjs");

const devices = [
  { id: "headset", name: "Arctis Nova Pro" },
  { id: "monitor", name: "DELL U2723QE" }
];

function createFakeRunner(responses) {
  const calls = [];
  return {
    calls,
    run: async (action, payload) => {
      calls.push({ action, payload });
      const response = responses[action];
      return typeof response === "function" ? response(payload) : response;
    }
  };
}

async function createService(responses, configPath) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-audio-"));
  const runner = createFakeRunner(responses);
  const service = createAudioService({
    runPowerShell: runner.run,
    getConfigPath: () => configPath || path.join(dir, "output-devices.json"),
    fsImpl: fs
  });
  return { service, runner, dir };
}
```

Add tests for:
- `listOutputDevices` parses valid JSON and filters entries without string `id`/`name`.
- Malformed list JSON rejects with `The audio device list could not be read.`
- `saveOutputPair` writes `{ headset:{id,name}, monitor:{id,name} }` and returns it.
- Same-device save rejects with `Select two different output devices.`
- Unknown-device save rejects with `The selected output device is no longer available.`
- Missing config returns `null` from `getOutputPair()`.
- Invalid config rejects with `The saved output device selection could not be read.`
- Toggle from headset selects monitor and returns `Output switched to DELL U2723QE.`
- Toggle from monitor selects headset.
- Toggle without a saved pair rejects with `Select your headset and monitor in Quick Actions first.`
- Toggle with a disconnected saved device rejects with `A selected output device is unavailable. Re-select your devices in Quick Actions.`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL because `lib/audio-service.cjs` does not exist.

- [ ] **Step 3: Create `lib/audio-service.cjs` with the existing behavior**

Move `AUDIO_DEVICE_SCRIPT`, `getAudioDevices`, `saveOutputDevicePair`, `getOutputDevicePair`, and `toggleAudioOutputDevice` out of `main.cjs`. Export:

```js
module.exports = { AUDIO_DEVICE_SCRIPT, createAudioService };
```

`createAudioService` returns methods that:

- Call `runPowerShell("list")`, `runPowerShell("default")`, and `runPowerShell("set", { deviceId })`.
- Validate and filter the device list exactly as the current code does.
- Read/write the pair through `fsImpl` and `getConfigPath()`.
- Validate same-device and unknown-device saves with the existing error strings.
- Keep the existing toggle message `Output switched to ${target.name}.`
- Wrap each PowerShell call so raw stderr never reaches the renderer.

- [ ] **Step 4: Wire `main.cjs` to the service**

Import `AUDIO_DEVICE_SCRIPT` and `createAudioService`. Define `runPowerShellCommand(action, payload)` with the existing `execFile("powershell.exe", ["-NoProfile", "-Command", AUDIO_DEVICE_SCRIPT], ...)` runner and env vars:

```js
{
  ...process.env,
  ORBIT_AUDIO_ACTION: action,
  ORBIT_AUDIO_DEVICE_ID: payload?.deviceId || "",
  ORBIT_AUDIO_MUTED: payload?.muted ? "1" : "0",
  ORBIT_AUDIO_VOLUME: payload?.volume === undefined ? "" : String(payload.volume)
}
```

Create one service instance:

```js
const audioService = createAudioService({
  runPowerShell: runPowerShellCommand,
  getConfigPath: outputDevicesConfigPath,
  fsImpl: fs
});
```

Replace the four existing `ipcMain` audio handlers with calls to the service. Update `registerQuickActionHotkey()` to call `audioService.toggleOutput()`.

- [ ] **Step 5: Add the service to syntax checks**

In `package.json`, append `&& node --check lib/audio-service.cjs` to the `check` script.

- [ ] **Step 6: Run verification**

Run: `npm run check && npm run test:integration && npm run test:unit && npm run test:e2e`
Expected: all pass; Quick Actions navigation still works.

---

### Task 2: Add state, mute, and volume to the service and PowerShell bridge

**Files:**
- Modify: `lib/audio-service.cjs`
- Modify: `tests/integration/audio-service.test.cjs`

**Interfaces:**
- Consumes: Task 1 service factory and runner contract.
- Produces: `getState()`, `setOutputMuted(muted)`, `setMicrophoneMuted(muted)`, `setOutputVolume(volume)`; `toggleOutput()` now returns `{ ok, message, state }`.

- [ ] **Step 1: Write failing tests for the new behavior**

Add tests for:
- `getState()` parses `{ output, microphone }`, including `null` endpoints.
- `setOutputMuted(true)` calls `{ action: "set-output-mute", payload: { muted: true } }` and returns state.
- `setOutputMuted("yes")` rejects with `The output mute state must be true or false.`
- `setMicrophoneMuted(false)` calls `{ action: "set-mic-mute", payload: { muted: false } }`.
- `setOutputVolume(68)` calls `{ action: "set-volume", payload: { volume: 68 } }`.
- `setOutputVolume(-5)` sends `0`; `setOutputVolume(150)` sends `100`.
- `setOutputVolume(NaN)` rejects with `The volume must be a number between 0 and 100.`
- `getState()` runner failure rejects with `The audio state could not be read.`
- `toggleOutput()` returns the state from the `set` action and does not make a separate `state` call.

Use a state fixture:

```js
const state = {
  output: { id: "headset", name: "Arctis Nova Pro", muted: false, volume: 68 },
  microphone: { id: "mic", name: "Arctis Mic", muted: true }
};
function stateJson() {
  return JSON.stringify(state);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL because the new methods and `set` state parsing are missing.

- [ ] **Step 3: Extend the C# bridge with `IAudioEndpointVolume`**

Add this interface to `AUDIO_DEVICE_SCRIPT`:

```csharp
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
  [PreserveSig] int GetChannelCount(out uint channelCount);
  [PreserveSig] int SetMasterVolumeLevel(float levelDb, IntPtr eventContext);
  [PreserveSig] int SetMasterVolumeLevelScalar(float level, IntPtr eventContext);
  [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
  [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, IntPtr eventContext);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, IntPtr eventContext);
  [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr eventContext);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  [PreserveSig] int GetVolumeStepInfo(out uint step, out uint stepCount);
  [PreserveSig] int VolumeStepUp(IntPtr eventContext);
  [PreserveSig] int VolumeStepDown(IntPtr eventContext);
  [PreserveSig] int QueryHardwareSupport(out uint hardwareSupportMask);
  [PreserveSig] int GetVolumeRange(out float min, out float max, out float increment);
}
```

Add helpers:
- `GetDefaultDevice(int dataFlow, int role)` returns `null` when `GetDefaultAudioEndpoint` fails.
- `GetEndpointVolume(IMMDevice device)` activates `IAudioEndpointVolume`, releases the raw pointer, and returns the COM object.
- `GetState()` builds output from render/`eMultimedia` and microphone from capture/`eCommunications`.
- `SetOutputMute(bool muted)`, `SetMicrophoneMute(bool muted)`, and `SetOutputVolume(int volume)` mutate the endpoint, release COM objects, and return `GetState()`.
- `GetDefaultDeviceId()` uses render/`eMultimedia`.

Use segment helpers so a missing microphone does not fail output state:

```csharp
static object ReadOutput() {
  var device = GetDefaultDevice(0, 1);
  if (device == null) return null;
  try {
    string id; Marshal.ThrowExceptionForHR(device.GetId(out id));
    var volume = GetEndpointVolume(device);
    try {
      bool muted; Marshal.ThrowExceptionForHR(volume.GetMute(out muted));
      float level; Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out level));
      return new { id, name = FriendlyName(device), muted, volume = (int)Math.Round(level * 100) };
    } finally { Marshal.ReleaseComObject(volume); }
  } finally { Marshal.ReleaseComObject(device); }
}
```

Add `ReadMicrophone()` with `GetDefaultDevice(1, 2)` and `{ id, name, muted }`.

- [ ] **Step 4: Extend the PowerShell action switch**

Add:

```powershell
'state' {
  ConvertTo-Json -InputObject ([OrbitAudio]::GetState()) -Compress -Depth 5
}
'set-output-mute' {
  [OrbitAudio]::SetOutputMute($env:ORBIT_AUDIO_MUTED -eq '1') | Out-Null
  ConvertTo-Json -InputObject ([OrbitAudio]::GetState()) -Compress -Depth 5
}
'set-mic-mute' {
  [OrbitAudio]::SetMicrophoneMute($env:ORBIT_AUDIO_MUTED -eq '1') | Out-Null
  ConvertTo-Json -InputObject ([OrbitAudio]::GetState()) -Compress -Depth 5
}
'set-volume' {
  [OrbitAudio]::SetOutputVolume([int]$env:ORBIT_AUDIO_VOLUME) | Out-Null
  ConvertTo-Json -InputObject ([OrbitAudio]::GetState()) -Compress -Depth 5
}
```

Change `'set'` to print `GetState()` JSON instead of `ok`. Keep `'default'` printing the device id and `'list'` printing the render-device array.

- [ ] **Step 5: Extend the service methods**

Implement:
- `parseState(output)` shared by all state-returning actions.
- `getState()` calls `state`.
- `setOutputMuted(muted)` validates boolean, calls `set-output-mute`, returns state.
- `setMicrophoneMuted(muted)` validates boolean, calls `set-mic-mute`, returns state.
- `setOutputVolume(volume)` validates finite number, clamps, rounds, calls `set-volume`, returns state.
- `toggleOutput()` calls `default`, computes target, calls `set`, and returns `{ ok: true, message, state }`.

Error strings:
- `The audio state could not be read.`
- `The output mute state must be true or false.`
- `The output device could not be muted.`
- `The microphone mute state must be true or false.`
- `The microphone could not be muted.`
- `The volume must be a number between 0 and 100.`
- `The volume could not be changed.`

- [ ] **Step 6: Run verification**

Run: `npm run check && npm run test:integration`
Expected: all pass.

---

### Task 3: Expose state and control IPC through preload and main

**Files:**
- Modify: `main.cjs` (IPC handlers, hotkey broadcast)
- Modify: `preload.cjs` (quickActions bridge)
- Modify: `tests/e2e/app.spec.cjs` (preload surface assertions)

**Interfaces:**
- Consumes: Task 2 service methods and state shape.
- Produces: `quickActions.getState`, `setOutputMuted`, `setMicrophoneMuted`, `setVolume`, `onStateChange`; IPC channels `audio:get-state`, `audio:set-output-mute`, `audio:set-mic-mute`, `audio:set-volume`, `audio:state-changed`.

- [ ] **Step 1: Write failing E2E surface assertions**

In the Quick Actions part of the navigation test, after the page is active, add:

```js
const quickActions = await page.evaluate(() => ({
  getState: typeof window.orbitWindow.quickActions.getState,
  setOutputMuted: typeof window.orbitWindow.quickActions.setOutputMuted,
  setMicrophoneMuted: typeof window.orbitWindow.quickActions.setMicrophoneMuted,
  setVolume: typeof window.orbitWindow.quickActions.setVolume,
  onStateChange: typeof window.orbitWindow.quickActions.onStateChange
}));
expect(quickActions).toEqual({
  getState: "function",
  setOutputMuted: "function",
  setMicrophoneMuted: "function",
  setVolume: "function",
  onStateChange: "function"
});
```

Run: `npm run test:e2e`
Expected: FAIL because those functions are not exposed yet.

- [ ] **Step 2: Add main IPC handlers**

In `main.cjs`:

```js
ipcMain.handle("audio:get-state", async () => audioService.getState());
ipcMain.handle("audio:set-output-mute", async (_event, muted) => audioService.setOutputMuted(muted));
ipcMain.handle("audio:set-mic-mute", async (_event, muted) => audioService.setMicrophoneMuted(muted));
ipcMain.handle("audio:set-volume", async (_event, volume) => audioService.setOutputVolume(volume));
```

Update the `Alt+Shift+O` handler to:

```js
audioService.toggleOutput()
  .then((result) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("audio:state-changed", result.state);
    }
  })
  .catch((error) => {
    console.error("Orbit could not switch the output device.", error);
  });
```

- [ ] **Step 3: Extend the preload bridge**

Add to `quickActions` in `preload.cjs`:

```js
getState: () => ipcRenderer.invoke("audio:get-state"),
setOutputMuted: (muted) => ipcRenderer.invoke("audio:set-output-mute", muted),
setMicrophoneMuted: (muted) => ipcRenderer.invoke("audio:set-mic-mute", muted),
setVolume: (volume) => ipcRenderer.invoke("audio:set-volume", volume),
onStateChange: (callback) => {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on("audio:state-changed", listener);
  return () => ipcRenderer.removeListener("audio:state-changed", listener);
}
```

- [ ] **Step 4: Run verification**

Run: `npm run check && npm run test:e2e`
Expected: all pass, including the new surface assertions.

---

### Task 4: Replace Quick Actions with the Audio Console

**Files:**
- Modify: `index.html` (Quick Actions CSS, markup, renderer JS, `showPage()` refresh)
- Modify: `tests/e2e/app.spec.cjs` (console structure assertions)

**Interfaces:**
- Consumes: Task 3 preload surface and Task 2 state shape.
- Produces: `.audio-console`, `#audio-current-name`, `#audio-current-meta`, `#audio-switch`, `#audio-output-mute`, `#audio-output-state`, `#audio-mic-mute`, `#audio-mic-state`, `#audio-volume-slider`, `#audio-volume-value`; `renderAudioState(state)` and `loadAudioConsole()`.

- [ ] **Step 1: Write failing E2E structure assertions**

After the Quick Actions page is active, assert:

```js
await expect(page.locator("#quick-actions-heading")).toHaveText("Audio control");
await expect(page.locator(".audio-console")).toBeVisible();
await expect(page.locator("#audio-current-name")).toBeVisible();
await expect(page.locator("#audio-switch")).toBeVisible();
await expect(page.locator("#audio-output-mute")).toBeVisible();
await expect(page.locator("#audio-mic-mute")).toBeVisible();
await expect(page.locator('#audio-volume-slider[type="range"]')).toBeVisible();
await expect(page.locator("#audio-volume-value")).toBeVisible();
await expect(page.locator("#headset-device")).toBeVisible();
await expect(page.locator("#monitor-device")).toBeVisible();
await expect(page.locator("#save-audio-devices")).toBeVisible();
```

Also extend `fits the minimum window size without scrolling` to navigate to Quick Actions at 360×560 and repeat the `.window` overflow assertion after asserting `.audio-console` is visible. Add a long synthetic device name to the local audio state only if a deterministic test hook is introduced; otherwise rely on the manual long-name check.

Run: `npm run test:e2e`
Expected: FAIL because the current page still uses the old switch card and form.

- [ ] **Step 2: Replace the Quick Actions CSS**

Remove the old `.audio-device-setup*` and `.audio-switch-button*` rules that no longer apply. Add `.audio-console`, header, current-device, mixer tiles, volume slider, footer, and responsive rules.

Requirements:
- Panel uses `border`, `border-radius: 12px`, and the existing dark panel gradient.
- Header is a flex row with the current output block and switch button.
- Mixer is a 3-column grid: output mute, microphone mute, volume.
- Footer is `<form id="audio-device-setup">` with two selects and Save.
- Device names use `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`.
- At `max-width: 720px`, mixer stacks or narrows without horizontal overflow; at 360px the console still fits.
- Style `input[type="range"]` with the existing monochrome track/thumb language.
- Keep focus-visible outlines on buttons and the slider.
- Do not add a second `aria-live` region.

- [ ] **Step 3: Replace the Quick Actions markup**

Keep `<section class="quick-actions-section page-section" aria-labelledby="quick-actions-heading">` and `#quick-actions-status`.

Markup contract:

```html
<h2 id="quick-actions-heading">Audio control</h2>
<div class="audio-console">
  <div class="audio-console-header">
    <div class="audio-current">
      <span class="audio-console-label">Current output</span>
      <p id="audio-current-name">Loading audio…</p>
      <p id="audio-current-meta">Reading devices…</p>
    </div>
    <button id="audio-switch" class="audio-switch-button" type="button" data-quick-action="toggle-output">Switch output</button>
  </div>
  <div class="audio-mixer">
    <button id="audio-output-mute" class="audio-mixer-tile" type="button" aria-pressed="false">
      <span class="audio-tile-label">Output</span>
      <span id="audio-output-state" class="audio-tile-state">Unmuted</span>
    </button>
    <button id="audio-mic-mute" class="audio-mixer-tile" type="button" aria-pressed="false">
      <span class="audio-tile-label">Microphone</span>
      <span id="audio-mic-state" class="audio-tile-state">Live</span>
    </button>
    <div class="audio-volume-tile">
      <label for="audio-volume-slider">Volume</label>
      <div class="audio-volume-row">
        <input id="audio-volume-slider" type="range" min="0" max="100" step="1" value="0">
        <output id="audio-volume-value" for="audio-volume-slider">0%</output>
      </div>
    </div>
  </div>
  <form id="audio-device-setup" class="audio-console-footer">
    <span class="audio-footer-label">Devices</span>
    <label class="audio-device-field" for="headset-device">Headset
      <select id="headset-device"></select>
    </label>
    <label class="audio-device-field" for="monitor-device">Monitor
      <select id="monitor-device"></select>
    </label>
    <button id="save-audio-devices" class="audio-device-save" type="submit">Save</button>
  </form>
</div>
<p class="shortcut-status" id="quick-actions-status" role="status" aria-live="polite"></p>
```

- [ ] **Step 4: Implement renderer state and behavior**

Replace `loadAudioDevices()` with `loadAudioConsole()` and add `renderAudioState(state)`.

`loadAudioConsole()`:
- Disable selects, Save, mute buttons, and slider while loading.
- Run `getOutputDevices()`, `getOutputPair()`, and `getState()` in parallel with `Promise.allSettled` so one failure does not hide the others.
- Populate both selects from the device list; select the saved pair when present.
- Save is enabled only when at least two devices exist.
- Render state when available; otherwise show `The audio state could not be read.` and leave switch/device controls usable.
- Show `No active output devices were found.` when the list is empty.
- Show `Select your headset and monitor once, then save them.` when no pair exists.
- Show `Devices ready.` when the pair is ready.
- Show `Re-select your devices below.` when a pair exists but either device is missing.

`renderAudioState(state)`:
- Output name: `state.output?.name || "No active output device"`.
- Compute `pairReady` from saved pair IDs and current device list.
- Target: if `state.output.id === pair.headset.id`, target monitor; otherwise target headset.
- Meta: `Next: ${target.name} · Alt + Shift + O` when ready; otherwise the instructions above.
- Switch button: `Switch to ${target.name}` when ready, else `Switch output`.
- Output mute: text `Unmuted`/`Muted`, `aria-pressed`, accessible label, disabled when `state.output` is null.
- Mic mute: text `Live`/`Muted`, `aria-pressed`, accessible label, disabled when `state.microphone` is null.
- Volume slider/value: `state.output.volume`, disabled when output is null.

Wire:
- `#audio-switch` keeps the existing `[data-quick-action]` click handler; after toggle, render `result.state`.
- `#audio-output-mute` calls `setOutputMuted(!current.muted)`, disables while pending, renders returned state, and reports errors to `#quick-actions-status`.
- `#audio-mic-mute` calls `setMicrophoneMuted(!current.muted)` the same way.
- The slider updates `#audio-volume-value` immediately on `input`, schedules a 150 ms debounced `setVolume(Number(value))`, and flushes on `change`.
- Coalesce slider writes: keep a `pendingVolume` and a single timer; if a write is in flight, store the latest value and send it after the current write resolves.
- On slider error, show `The volume could not be changed.` and call `getState()` to resync.
- Subscribe once with `window.orbitWindow.quickActions.onStateChange((state) => renderAudioState(state))`.
- Keep the existing device `submit` handler; after save, reload the pair and render state.
- In `showPage("quick-actions")`, call `loadAudioConsole()` instead of `loadAudioDevices()`.

- [ ] **Step 5: Run verification**

Run: `npm run check && npm run test:integration && npm run test:unit && npm run test:e2e`
Expected: all pass.

- [ ] **Step 6: Manual smoke on Windows**

Run `npm start`, open Quick Actions, and verify:
- Current output, next target, and switch label are correct.
- Output mute and mic mute change Windows state and the badges.
- Slider changes Windows volume; rapid drags end on the final value.
- `Alt+Shift+O` while Quick Actions is visible updates the panel.
- A disconnected saved device shows the re-select message and the existing error on switch.
- 980×560 and 360×560 show no page scroll or clipped controls.

---

### Task 5: Version, changelog, and full verification

**Files:**
- Modify: `package.json` (`version`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: version `1.11.0` and a release-ready changelog entry.

- [ ] **Step 1: Bump the version and add the changelog entry**

Set `package.json` version to `1.11.0`. Add at the top of `CHANGELOG.md`:

```markdown
## [1.11.0] - 2026-11-03

### Added
- Quick Actions audio console with output switching, output mute, microphone mute, and a volume slider

### Changed
- Quick Actions is now a single console panel with current device and next switch target
```

- [ ] **Step 2: Run the full verification suite**

Run: `npm run test:all`
Expected: syntax checks, 21+ unit tests, integration tests including `audio-service`, and all E2E tests pass.

- [ ] **Step 3: Report build/release status**

Do not run `npm run build:win` or publish a release. Report that the code and tests are complete and ask whether to build the portable EXE.

---

## Plan Self-Review

- Spec coverage: UI B, service extraction, mute/volume, IPC/preload, hotkey sync, tests, error strings, no-scroll constraints, version/changelog all map to tasks.
- Type consistency: `getState`, `setOutputMuted`, `setMicrophoneMuted`, `setOutputVolume`, `onStateChange`, and the state shape are used consistently across tasks.
- Review Focus tests: no-endpoint state and PowerShell failures are covered in Task 2 integration tests; missing/disconnected pair and target selection in Task 1/2 tests; rapid slider and min-width layout are manual checks in Task 4.
- No commit steps: repo policy requires explicit commit permission.
