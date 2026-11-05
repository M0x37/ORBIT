# Quick Actions Audio Console — Design

## Intent

Quick Actions currently has one job: switch the Windows default output between a saved headset and monitor. This change turns it into a compact audio control center for everyday calls and gaming: switch output, mute output, mute the system microphone, and change the output volume. The page must stay usable in Orbit's fixed 980×560 window without scrolling.

## Current State

- `index.html` renders a single switch card plus a "Your devices" form (two selects and Save).
- `main.cjs` contains an embedded PowerShell/C# Core Audio script that lists active render devices, reads the default render device, and sets the default render device for all three endpoint roles.
- `preload.cjs` exposes `quickActions.getOutputDevices`, `getOutputPair`, `saveOutputPair`, and `toggleOutput`.
- The device pair is stored in `userData/output-devices.json`.
- `Alt+Shift+O` toggles the saved output pair globally.
- Audio behavior is not covered by automated tests.

## Goals

- Keep the existing output switch and device-pair configuration.
- Add system output mute/unmute.
- Add system microphone mute/unmute for the default communications capture device.
- Add a 0–100% output volume slider with a live percentage label.
- Show the current output device, next switch target, mute states, and volume in one panel.
- Keep all controls usable at 980×560 and at the 360px minimum width.
- Make audio logic testable through an injectable PowerShell runner.
- Keep existing errors and device-pair behavior intact.

## Non-Goals

- Per-application volume mixing.
- Microphone device selection or switching.
- Persisting mute or volume state; Windows remains the source of truth.
- Global hotkeys for mute or volume.
- Custom volume presets or more than one saved output pair.
- Live monitoring of changes made outside Orbit while the page is open.

## Anti-Goals

- Breaking `Alt+Shift+O` or the saved headset/monitor pair.
- Making the Quick Actions page taller than the fixed window or introducing scroll.
- Blocking the renderer on PowerShell or hiding audio errors silently.
- Adding Node access to the renderer or a native Node dependency.
- Adding a persistent background helper process for four occasional actions.

## Constraints

- Windows-only Core Audio through the existing PowerShell/C# bridge.
- Renderer stays sandboxed: all native work goes through `preload.cjs` and `ipcMain`.
- The C# script is embedded in JavaScript; it must remain compatible with Windows PowerShell 5.1.
- PowerShell startup costs roughly 200–500 ms per call. State changes must not spawn one process per slider pixel.
- The UI must fit in the existing `.page-section` conventions and use the existing `.quick-actions-section` registration in `showPage()`.
- New service files must be added to `npm run check` and are already covered by `build.files` via `lib/**/*`.

## Approaches Considered

### UI layout

- **A — Mixer strip:** keep the switch card and device form, insert a mixer row. Lowest risk, but three disconnected blocks.
- **B — Audio console:** one panel with current output, switch button, mute tiles, slider, and a compact device footer. Cohesive and still fits. **Chosen.**
- **C — Action tiles:** 2×2 clickable tiles with volume presets. Fast to scan, but taller and loses fine volume control.

### Implementation

- **1 — Extend `main.cjs` directly:** smallest diff, but audio logic stays untestable and the file grows.
- **2 — Extract `lib/audio-service.cjs` with an injectable PowerShell runner:** consistent with `lib/*-service.cjs`, integration-testable, modest refactor. **Chosen.**
- **3 — Persistent helper process or native module:** lower latency, but lifecycle, crash handling, and build complexity are not justified.

### Volume control

- Slider with 0–100% and a percentage label. **Chosen**, because it matches the console layout and allows fine control.
- Three presets (25/50/100%) were rejected as less flexible.

## Chosen Design

### Renderer layout

Replace the current switch card and form with one `.audio-console` panel. Keep the section registered as `.quick-actions-section` and the existing page-status element.

```
Quick Actions
Audio control

┌ Audio console ──────────────────────────────────────────────┐
│ CURRENT OUTPUT                                              │
│ Headset Earphone (Arctis Nova Pro)          [Switch to ...] │
│ Next: DELL U2723QE · Alt + Shift + O                        │
├─────────────────────────────────────────────────────────────┤
│ [Output      Unmuted] [Microphone     Live] [Volume ──● 68%]│
├─────────────────────────────────────────────────────────────┤
│ DEVICES  [Headset select] [Monitor select] [Save]           │
└─────────────────────────────────────────────────────────────┘
Status line
```

- Section heading changes from "Switch audio output" to "Audio control"; the global page title remains "Quick Actions".
- `#audio-current-name` shows the current default output name or "No active output device".
- A pair is **ready** when a saved pair exists and both saved device IDs are present in the current active render-device list.
- The switch target is computed the same way as the existing toggle: if the current output is the headset, target the monitor; otherwise target the headset. This also covers a third device or no current output.
- `#audio-current-meta` shows `Next: <target name> · Alt + Shift + O` when the pair is ready; otherwise "Choose two devices below." when there is no pair, or "Re-select your devices below." when a saved pair is invalid.
- `#audio-switch` shows `Switch to <target name>` when ready and `Switch output` otherwise. It stays enabled so the existing missing-pair/unavailable-device errors remain reachable.
- `#audio-output-mute` is a button with `aria-pressed` and a state badge: "Unmuted" / "Muted". Its accessible label switches between "Mute output" and "Unmute output". It is disabled when `state.output` is `null`.
- `#audio-mic-mute` is a button with `aria-pressed` and a state badge: "Live" / "Muted". Its accessible label switches between "Mute microphone" and "Unmute microphone". It is disabled when `state.microphone` is `null`.
- `#audio-volume-slider` is `<input type="range" min="0" max="100" step="1">`; `#audio-volume-value` displays `NN%`. The slider is disabled when no output device is available.
- Keep `#headset-device`, `#monitor-device`, and `#save-audio-devices`, and keep the footer inside `<form id="audio-device-setup">` so the existing submit behavior is preserved.
- Use the existing `#quick-actions-status` as the only status/error live region on the page. Do not add a second `aria-live` region.
- Errors remain English and specific, e.g. "The output device could not be muted.", "The microphone could not be muted.", "The volume could not be changed.", "The audio state could not be read."

### Renderer behavior

- `loadAudioConsole()` runs on Quick Actions page activation and loads devices, the saved pair, and the audio state in parallel.
- Device-list failures and state failures are reported independently: a failed state read must not prevent device configuration, and vice versa.
- Mute buttons disable while their request is pending, then render the returned state.
- The volume slider updates its label immediately on `input`, debounces the IPC write by about 150 ms, and flushes on `change`. It updates optimistically; on error it shows the error and reloads `getState()`.
- The switch button calls the existing toggle, renders the returned state and target, and reports the existing success message.
- `renderAudioState(state)` updates current device, discrete mute states, volume, switch label, and target meta; controls with a `null` endpoint are disabled.
- A single subscription to `audio:state-changed` updates the panel after the global `Alt+Shift+O` hotkey fires. The subscription is installed once at startup.
- Page activation always refreshes state so external Windows changes are picked up when the user returns to the page.

### IPC and preload surface

Add to `window.orbitWindow.quickActions`:

- `getState()` → `ipcRenderer.invoke("audio:get-state")`
- `setOutputMuted(muted)` → `ipcRenderer.invoke("audio:set-output-mute", muted)`
- `setMicrophoneMuted(muted)` → `ipcRenderer.invoke("audio:set-mic-mute", muted)`
- `setVolume(volume)` → `ipcRenderer.invoke("audio:set-volume", volume)`
- `onStateChange(callback)` → subscribes to `audio:state-changed` and returns an unsubscribe function.

Existing methods stay: `getOutputDevices`, `getOutputPair`, `saveOutputPair`, `toggleOutput`.

Main-process state shape:

```js
{
  output: { id, name, muted, volume } | null,
  microphone: { id, name, muted } | null
}
```

- `volume` is an integer from 0 to 100.
- `null` means no active default endpoint for that direction.
- `audio:toggle-output` now returns `{ ok, message, state }`.
- The global hotkey sends `audio:state-changed` with the new state after a successful toggle.

### Audio service

New `lib/audio-service.cjs` exports `AUDIO_DEVICE_SCRIPT` and `createAudioService`.

```js
createAudioService({
  runPowerShell, // (action, payload) => Promise<string>
  getConfigPath, // () => absolute output-devices.json path
  fsImpl = require("node:fs/promises")
})
```

Methods:

- `listOutputDevices()`
- `getOutputPair()`
- `saveOutputPair({ headsetId, monitorId })`
- `toggleOutput()`
- `getState()`
- `setOutputMuted(muted)`
- `setMicrophoneMuted(muted)`
- `setOutputVolume(volume)`

Rules:

- Device-list parsing, pair validation, config read/write, and error mapping move out of `main.cjs` into this service.
- `setOutputVolume` accepts a number, rejects non-finite values, clamps to 0–100, and sends an integer.
- `setOutputMuted` and `setMicrophoneMuted` require booleans.
- `toggleOutput` reads the current output with one `default` call, then sets the computed target with one `set` call. `set` returns the fresh state, so a switch does not need a third state call.
- `set`, `set-output-mute`, `set-mic-mute`, and `set-volume` all return the fresh audio state in the same PowerShell invocation.
- Missing saved pair still throws "Select your headset and monitor in Quick Actions first."; unavailable saved devices still throw "A selected output device is unavailable. Re-select your devices in Quick Actions."
- Empty or malformed PowerShell JSON maps to friendly service errors, never raw stderr.

### PowerShell / Core Audio

Keep one `AUDIO_DEVICE_SCRIPT` and extend it with:

- Output mute/volume through `IAudioEndpointVolume` (GUID `5CDF2C82-841E-4546-9722-0CF74078229A`) activated from the default render endpoint.
- Microphone mute through `IAudioEndpointVolume` activated from the default capture communications endpoint.
- All output operations use render / `eMultimedia` (dataFlow `0`, role `1`): current device lookup, state, mute, volume, and toggle target selection. `SetDefaultDevice` continues setting all three roles, so Orbit's switch keeps Windows' role defaults aligned.
- Microphone mute uses capture / `eCommunications` (dataFlow `1`, role `2`).
- Per-endpoint `try/catch` so a missing microphone does not make the output state unreadable. Missing endpoints become `null` in the returned state.
- Volume read/write with `GetMasterVolumeLevelScalar` / `SetMasterVolumeLevelScalar`, rounded to an integer percentage.
- `SetMute` / `GetMute` using Win32 `BOOL` marshaling.
- COM objects released with `Marshal.ReleaseComObject`; activation pointers released after use.

PowerShell env contract:

- `ORBIT_AUDIO_ACTION`: `list`, `default`, `set`, `state`, `set-output-mute`, `set-mic-mute`, `set-volume`.
- `ORBIT_AUDIO_DEVICE_ID`: device id for `set`.
- `ORBIT_AUDIO_MUTED`: `1` or `0` for mute actions.
- `ORBIT_AUDIO_VOLUME`: `0`–`100` for `set-volume`.
- `state`, `set`, and all mute/volume actions print compact JSON in the shape above.
- `default` prints the current output device id using `eMultimedia`.
- `list` prints the active render-device array.

`main.cjs` keeps the `execFile("powershell.exe", ...)` runner, but its signature becomes `(action, payload)` and it sets the env vars above. The script string moves to the service.

### Testing

Add `tests/integration/audio-service.test.cjs` using a fake `runPowerShell` and a temporary config directory. Cover:

- Device list parsing/filtering and malformed list output.
- Pair save/read, `ENOENT` → `null`, invalid config → friendly error.
- Same-device and unavailable-device rejection.
- Toggle target selection and missing-pair/unavailable-pair errors.
- State parsing, including `null` output/microphone.
- Mute actions pass the correct action and boolean payload.
- Volume accepts `0`, `68`, `100`; clamps below/above; rejects `NaN`/non-number.
- Runner failures map to friendly messages.

E2E:

- Extend the existing Quick Actions navigation test to assert the console, both mute buttons, the range input, both device selects, and Save are present.
- Do not assert real mute/volume values in E2E; those depend on the machine's audio devices.
- Keep the no-scroll check at 980×560 and 360×560.

Manual smoke on Windows:

- Switch output via button and `Alt+Shift+O`; current device and "next" label update.
- Mute/unmute output and microphone; verify Windows volume UI reflects it.
- Drag volume slider; verify Windows volume changes and UI percentage follows.
- Disconnect a saved device and verify the existing re-select error.
- Confirm no page scroll and no clipped labels at 980×560.

### Release bookkeeping

- Bump `package.json` to `1.11.0`.
- Add a `CHANGELOG.md` entry for the Audio Console.
- Add `lib/audio-service.cjs` to `npm run check`.
- Do not build or publish a release unless explicitly requested after verification.

## Builder Check Resolutions

The design review raised four plannable gaps; they are settled here:

- `set` returns the fresh state JSON, and `toggleOutput` uses `default` + `set` only.
- All output operations use `eMultimedia`; microphone mute uses `eCommunications`.
- "Next" is the actual computed toggle target, and a pair is ready only when both saved devices are currently present.
- The output/microphone mute tile is disabled when its endpoint is `null`; the switch button stays enabled to preserve existing errors.

## Builder Calls

These are left to the implementer without needing another product decision:

- Exact CSS values, spacing, icon SVGs, and responsive rules.
- Full `IAudioEndpointVolume` vtable declaration and COM release details.
- Debounce timing around 150 ms and coalescing of overlapping volume writes.
- Whether the output mute tile shows "On" or "Unmuted" as its badge.
- Wording of secondary helper text, as long as the specified errors remain.
- Test file organization and fixture details.

## Open Questions

None. The feature scope, layout B, implementation approach 2, slider control, endpoint roles, and testing direction are settled.
