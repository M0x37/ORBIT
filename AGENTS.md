# AGENTS.md

Orbit Desktop: a single-window Electron dashboard shipped as a portable Windows EXE. No bundler, no TypeScript, no framework. UI text, error messages, and changelog are English.

## Commands
- `npm start` — run the app with Electron; dev mode reads `.env` from the repo root.
- `npm run build:win` — electron-builder portable build to `dist/Orbit-Portable-<version>.exe` (Windows only).
- There are no lint, typecheck, or test scripts; verify by launching the app and building.

## Architecture
- `main.cjs` — main process: frameless window, system tray, `Alt+A` global hotkey, single-instance lock, all `ipcMain` handlers (`window:*`, `shortcut:open` for URLs and local apps, `todo:*` for Supabase To-Do CRUD, `sentry:*`), Sentry API calls.
- `preload.cjs` — the only renderer API surface, exposed as `window.orbitWindow` via `contextBridge`.
- `index.html` — the entire renderer: inline CSS + inline JS. Edit styles and behavior here directly.
- `agent/` — project rules/docs. It is **not** shipped: `build.files` in `package.json` only includes `index.html`, `main.cjs`, `preload.cjs`, `package.json`, and `assets/orbit.ico`.

## Gotchas
- Keep the renderer sandboxed (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). Add native features through `preload.cjs` + `ipcMain`, never by enabling Node in the renderer.
- Window is frameless, transparent, 980×560 with `minHeight: 560`, and designed to avoid scrolling. New UI must fit the fixed height.
- Sentry config: dev reads `<repo>/.env`; packaged builds search for `.env` next to the portable EXE. Env config overrides and disables in-app config. The GUI token is encrypted with `safeStorage` into `userData/sentry-config.json`. Vars: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.
- Page switching is manual in `showPage()`: the overview page activates `.shortcuts-section` and `.sentry-section`; To-Do activates `.todo-section`; links activates `.links-section`. New pages must be registered there and use the `.page-section` convention.
- To-Do uses the Supabase project at `https://yklavrwnlzizftzytehf.supabase.co` and the existing `public.todos` table (`id`, `title`, `completed`, `created_at`). The publishable key is safe to ship; use main-process REST calls through `todo:*`, never renderer Node access.
- Closing the window hides Orbit to the system tray; use `Quit Orbit` in the tray menu to exit. `Alt+A` toggles the window, and the app enforces a single instance. Autostart is intentionally not implemented.
- Version bumps are expected for fixes: update `package.json` `version` and add a changelog entry before rebuilding (see `agent/rules.md`).

## Changelog
- Trigger phrases like "Write to the changelog" or "Update changelog" mean: follow `agent/changelog-skill.md` — bump version, add an English Keep-a-Changelog entry, rebuild, delete older `dist/Orbit-Portable-*.exe`, and launch the new EXE.
- `.changelog-session.json` stages pending entries (`added`, `changed`, `fixed`, `removed`, `security`, `notes`); fold them into `CHANGELOG.md` when updating it.
