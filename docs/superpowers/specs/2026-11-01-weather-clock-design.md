# Weather + Clock Widget — Design

## Intent

Give Orbit a small always-visible sense of time and current weather for Dreikirchen, without adding another tab or breaking the fixed 560px window height.

## Goals

- Local clock in 24h `HH:MM`, updated every second.
- Current temperature (°C) and condition for Dreikirchen, RP (50.43333, 7.95), refreshed every 15 minutes.
- Fits in the space freed at the bottom of the sidebar.
- Follows the existing architecture: network access in the main process, exposed through `preload.cjs`.

## Non-goals

- No forecast, hourly chart, or multiple locations.
- No weather configuration UI or location search.
- No notifications or tray weather.

## Anti-goals

- Renderer making direct network calls.
- Layout changes that introduce scrolling at the 560px minimum height.

## Constraints

- Renderer stays sandboxed; no Node in `index.html`.
- UI text and error messages stay English.
- `build.files` only ships `index.html`, `main.cjs`, `preload.cjs`, `package.json`, `assets/orbit.ico` — no new runtime files.

## Approaches

- **A — Main-process IPC (chosen):** `weather:current` in `main.cjs` calls Open-Meteo, `preload.cjs` exposes `orbitWindow.weather.get()`, renderer renders the widget. Consistent with existing `todo:*` and `sentry:*` handlers, keeps network and validation out of the renderer.
- **B — Renderer fetch:** fewer lines, but bypasses the established preload/IPC pattern and spreads network handling into the UI.

The human partner chose A.

## How it works

### Main process (`main.cjs`)

- Constants for the Dreikirchen coordinates and the Open-Meteo URL.
- `ipcMain.handle("weather:current")` fetches `current=temperature_2m,weather_code` with `timezone=Europe/Berlin`, a 15s timeout, and validates the response.
- Returns `{ temperature: number, weatherCode: number }`.
- User-facing errors in English, e.g. "The weather service is unreachable. Check your internet connection."

### Preload (`preload.cjs`)

- Add `weather: { get: () => ipcRenderer.invoke("weather:current") }`.

### Renderer (`index.html`)

- Add a `.sidebar-widget` at the bottom of the sidebar (`margin-top: auto`), separated by a top border, matching existing muted sidebar styling.
- Contains the clock line and a weather line (inline SVG icon + temperature + condition).
- Clock updates every second; weather loads on startup and every 15 minutes.
- On failure: temperature shows `—`, condition shows `Unavailable`; no toast or extra chrome.
- WMO weather codes mapped to short English labels and inline SVG icons (clear, partly cloudy, overcast, fog, drizzle, rain, snow, thunderstorm).

## Release

- Version bump `1.6.0` → `1.7.0` (new feature).
- English changelog entry.
- Rebuild the portable EXE and remove the older `dist/Orbit-Portable-*.exe`.

## Left to the builder

- Exact SVG shapes and spacing, as long as the widget matches the sidebar style and fits without scrolling.
- Icon/label choice for obscure WMO codes.
