# AGENTS.md

Orbit Desktop: a single-window Electron dashboard shipped as a portable Windows EXE. No bundler, no TypeScript, no framework. UI text, error messages, and changelog are English.

## Commands
- `npm start` — run the app with Electron; dev mode reads `.env` from the repo root.
- `npm run build:win` — electron-builder portable build to `dist/Orbit-Portable-<version>.exe` (Windows only).
- `npm run check` — syntax-check main, preload, and `lib/` scripts.
- `npm test` — unit + integration tests with `node:test` (no network).
- `npm run test:e2e` — Playwright Electron tests (Windows; launches the real app against local stubs).
- `npm run test:all` — check + unit + integration + E2E.
- `.github/workflows/ci.yml` gates the portable build and GitHub Release on green tests.

## Architecture
- `main.cjs` — main process: frameless window, system tray, `Alt+A` window hotkey, `Alt+Shift+O` output-device toggle, single-instance lock, all `ipcMain` handlers (`window:*`, `shortcut:open` for URLs and local apps, `todo:*` for Supabase To-Do CRUD, `sentry:*`, `weather:current`, `network:overview`), Sentry API calls.
- `preload.cjs` — the only renderer API surface, exposed as `window.orbitWindow` via `contextBridge`.
- `index.html` — the renderer: inline CSS + inline JS, plus `lib/orbit-shared.js` loaded as a classic script.
- `lib/orbit-shared.js` — UMD module shared by main and renderer: weather mapping, clock/temperature formatting, To-Do/Sentry formatting and validation, Sentry pagination.
- `lib/*-service.cjs` — injectable-`fetch` services for weather, To-Do, Sentry, and the public-IP lookup; covered by integration tests. `network-service.cjs` also reports local interface details and probes internet reachability over TCP.
- `lib/*-service.cjs` — injectable-`fetch` services for weather, To-Do, and Sentry; covered by integration tests.
- `tests/` — `unit/` (pure logic), `integration/` (mocked services), `e2e/` (Playwright Electron).
- `agent/` — project rules/docs. It is **not** shipped: `build.files` in `package.json` includes `index.html`, `main.cjs`, `preload.cjs`, `package.json`, `lib/**/*`, and `assets/orbit.ico`.

## Gotchas
- Keep the renderer sandboxed (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). Add native features through `preload.cjs` + `ipcMain`, never by enabling Node in the renderer.
- Window is frameless, transparent, 980×560 with `minHeight: 560`, and designed to avoid scrolling. New UI must fit the fixed height.
- Sentry config: dev reads `<repo>/.env`; packaged builds search for `.env` next to the portable EXE. Env config overrides and disables in-app config. The GUI token is encrypted with `safeStorage` into `userData/sentry-config.json`. Vars: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.
- Page switching is manual in `showPage()`: the overview page activates `.shortcuts-section` and `.sentry-section`; To-Do activates `.todo-section`; links activates `.links-section`. New pages must be registered there and use the `.page-section` convention.
- To-Do uses the Supabase project at `https://yklavrwnlzizftzytehf.supabase.co` and the existing `public.todos` table (`id`, `title`, `completed`, `created_at`). The publishable key is safe to ship; use main-process REST calls through `todo:*`, never renderer Node access.
- Closing the window hides Orbit to the system tray; use `Quit Orbit` in the tray menu to exit. `Alt+A` toggles the window, and the app enforces a single instance. Autostart is intentionally not implemented.
- Quick Actions can save a headset/monitor output-device pair locally in `userData`; the page button and `Alt+Shift+O` switch the Windows default output directly between those two devices.
- GitHub Inbox reads `GITHUB_TOKEN` from the same `.env` (dev: repo root; packaged: next to the EXE). The token is read-only and never stored by the app; opening a notification is restricted to `https://github.com`.
- Network overview shows internet reachability, probe response time, local interface details, and public IP. Public IP lookup sends a request to `https://api.ipify.org`; the UI discloses this external lookup.
- Test hooks (production-safe, env-only): `ORBIT_TEST_USER_DATA` isolates `userData`, `ORBIT_E2E=1` skips tray/hotkey, `ORBIT_NO_ENV=1` ignores `.env`, `ORBIT_WEATHER_BASE_URL` / `ORBIT_TODO_BASE_URL` / `ORBIT_GITHUB_BASE_URL` point at local stubs, `ORBIT_NETWORK_PROBE_HOST` / `ORBIT_NETWORK_PROBE_PORT` route the network probe to a local stub, `ORBIT_PUBLIC_IP_URL` points the public-IP lookup at a local stub, `ORBIT_GITHUB_TOKEN` injects a test token. Never let tests hit real Supabase/Sentry/Open-Meteo/GitHub/ipify or the public network probe.
- Version bumps are expected for fixes: update `package.json` `version` and add a changelog entry before rebuilding (see `agent/rules.md`). Releases are tags `v<version>` that must match `package.json`; CI fails otherwise.

## Changelog
- Trigger phrases like "Write to the changelog" or "Update changelog" mean: follow `agent/changelog-skill.md` — bump version, add an English Keep-a-Changelog entry, rebuild, delete older `dist/Orbit-Portable-*.exe`, and launch the new EXE.
- `.changelog-session.json` stages pending entries (`added`, `changed`, `fixed`, `removed`, `security`, `notes`); fold them into `CHANGELOG.md` when updating it.
