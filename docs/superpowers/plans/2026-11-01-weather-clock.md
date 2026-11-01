# Weather + Clock Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clock and current Dreikirchen weather widget to the bottom of the Orbit sidebar.

**Architecture:** The main process fetches Open-Meteo and exposes it through a `weather:current` IPC handler; `preload.cjs` exposes `orbitWindow.weather.get()`; `index.html` renders the widget and updates the clock every second.

**Tech Stack:** Electron (main/preload/renderer), plain HTML/CSS/JS, Open-Meteo REST API, Node `fetch`.

**Spec:** `docs/superpowers/specs/2026-11-01-weather-clock-design.md`

## Global Constraints

- Renderer stays sandboxed: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; no Node in `index.html`.
- All UI text and error messages are English.
- Fixed window height 560px must not scroll; sidebar min width is fixed at 206px.
- `build.files` ships only `index.html`, `main.cjs`, `preload.cjs`, `package.json`, `assets/orbit.ico` — no new runtime files.
- Weather location is fixed: Dreikirchen, RP, latitude `50.43333`, longitude `7.95`, timezone `Europe/Berlin`.
- No API key.

## Review Focus

- Open-Meteo unreachable or timing out: widget shows `—` / `Unavailable`, the rest of the app keeps working.
- Malformed payload (`current` missing, temperature not a finite number): same error state, no crash.
- Unknown WMO code: `Unknown` label with a cloud icon, no crash.
- Narrow window (360px): weather text truncates with an ellipsis, no horizontal overflow.
- Minimum height 560px: sidebar widget fits without scrolling.

---

### Task 1: Weather IPC endpoint

**Files:**
- Modify: `main.cjs` (add `WEATHER_LOCATION` constant near line 25; add `fetchWeather()` near `todoRequest`; register `weather:current` handler near the `todo:*` handlers)
- Modify: `preload.cjs:8-19` (add `weather` namespace)
- Test: none in repo — verify with `node --check`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ipcMain.handle("weather:current")` returning `{ temperature: number, weatherCode: number }`; `window.orbitWindow.weather.get()` returning a Promise of the same.

- [ ] **Step 1: Add the location constant**

```js
const WEATHER_LOCATION = { latitude: 50.43333, longitude: 7.95 };
```

- [ ] **Step 2: Add `fetchWeather()`**

Signature: `async function fetchWeather()` in `main.cjs`.

- Build `https://api.open-meteo.com/v1/forecast` with `latitude`, `longitude`, `current=temperature_2m,weather_code`, `timezone=Europe/Berlin`.
- `fetch` with `AbortSignal.timeout(15000)`; on network failure throw `"The weather service is unreachable. Check your internet connection."`.
- Non-OK response: throw `` `The weather service returned HTTP ${response.status}.` ``.
- Invalid JSON: throw `"The weather service returned an invalid response."`.
- Validate `payload?.current?.temperature_2m` is a finite number and `payload?.current?.weather_code` is an integer; otherwise throw `"The weather service returned an unexpected response."`.
- Return `{ temperature: Math.round(temperature), weatherCode }`.

- [ ] **Step 3: Register the handler**

```js
ipcMain.handle("weather:current", fetchWeather);
```

- [ ] **Step 4: Expose it in preload**

```js
weather: {
  get: () => ipcRenderer.invoke("weather:current")
},
```

- [ ] **Step 5: Verify syntax**

Run: `node --check main.cjs; node --check preload.cjs`
Expected: no output, exit code 0.

---

### Task 2: Sidebar widget UI and behavior

**Files:**
- Modify: `index.html` (CSS after `.sidebar-item svg`; HTML inside `<aside class="sidebar">` after the Links button; JS after the window-control handlers)

**Interfaces:**
- Consumes: `window.orbitWindow.weather.get()` from Task 1.
- Produces: none for later tasks.

- [ ] **Step 1: Add CSS**

Add `.sidebar-widget` (flex column, `margin-top: auto`, `gap: 4px`, padding `12px 10px 0`, top border `1px solid var(--line)`), `.sidebar-clock` (`#f1f1f3`, 22px, weight 600, `font-variant-numeric: tabular-nums`), `.sidebar-weather` (flex, `align-items: center`, gap 6px, `color: var(--muted)`, 11px, `min-width: 0`), `.sidebar-weather svg` (14px square, `flex: 0 0 auto`, stroke currentColor, width 1.5, round caps/joins, no fill), and `.sidebar-weather-label` (ellipsis, nowrap).

- [ ] **Step 2: Add the markup**

As the last child of `.sidebar`:

```html
<div class="sidebar-widget" aria-label="Time and weather">
  <time class="sidebar-clock" id="sidebar-clock">--:--</time>
  <div class="sidebar-weather">
    <svg id="weather-icon" viewBox="0 0 20 20" aria-hidden="true"></svg>
    <span class="sidebar-weather-temp" id="weather-temp">&mdash;</span>
    <span class="sidebar-weather-label" id="weather-label">Loading&hellip;</span>
  </div>
</div>
```

- [ ] **Step 3: Add the renderer logic**

- Query `#sidebar-clock`, `#weather-icon`, `#weather-temp`, `#weather-label`.
- `describeWeather(code)` returns `{ icon, label }` using WMO groups: 0 Clear; 1 Mainly clear; 2 Partly cloudy; 3 Overcast; 45/48 Fog; 51–57 Drizzle; 61–67 Rain; 71–77 Snow; 80–82 Rain showers; 85/86 Snow showers; 95–99 Thunderstorm; anything else `{ icon: "cloudy", label: "Unknown" }`.
- Keep a static `WEATHER_ICONS` object mapping `clear`, `partly`, `cloudy`, `fog`, `drizzle`, `rain`, `snow`, `storm` to inline SVG path strings; set `weatherIcon.innerHTML` from it.
- `updateClock()`: `new Date()`, set `textContent` with `toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })` and `dateTime` to `now.toISOString()`.
- `loadWeather()`: on success set icon, `` `${temperature}°C` ``, label; on catch set temp `—` and label `Unavailable`.
- Run `updateClock()` then `setInterval(updateClock, 1000)`; run `loadWeather()` then `setInterval(loadWeather, 15 * 60 * 1000)`.

- [ ] **Step 4: Verify manually**

Run: `npm start`
Expected: clock ticks every second; after load the weather line shows e.g. `3°C Partly cloudy`; bottom of sidebar shows no clipping and no scrollbar at 560px height.

---

### Task 3: Version, changelog, build

**Files:**
- Modify: `package.json:3`
- Modify: `CHANGELOG.md`
- Build output: `dist/Orbit-Portable-1.7.0.exe`

- [ ] **Step 1: Bump version**

`"version": "1.6.0"` → `"version": "1.7.0"`.

- [ ] **Step 2: Add changelog entry**

At the top after the title:

```markdown
## [1.7.0] - 2026-11-01

### Added
- Clock and current weather widget at the bottom of the sidebar
- Weather for Dreikirchen via Open-Meteo, refreshed every 15 minutes
```

Add a `## Session Notes 2026-11-01` section at the end with the work request, steps taken, and open topics.

- [ ] **Step 3: Build**

Run: `npm run build:win`
Expected: `dist/Orbit-Portable-1.7.0.exe` exists.

- [ ] **Step 4: Remove old builds**

Delete every `dist/Orbit-Portable-*.exe` except `Orbit-Portable-1.7.0.exe`; confirm only one remains.

- [ ] **Step 5: Launch for a final check**

Run: `Start-Process "dist\Orbit-Portable-1.7.0.exe"`
Expected: Orbit opens and the widget is visible.
