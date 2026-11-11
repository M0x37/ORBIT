Orbit Desktop
=============

Orbit is a single, frameless Electron dashboard window for Windows. It serves as a central, quickly accessible surface for weather, clock, tasks, GitHub notifications, Sentry errors, network status, shortcuts, and audio control. The app is built as a portable Windows EXE and has no dependency on bundlers, TypeScript, or frameworks.

What the app is for
-------------------

- Weather (current plus a 24-hour forecast) in the sidebar and as an expanded view
- Clock in the sidebar
- Cloud To-Do list (Supabase): create tasks, mark them done, delete them
- GitHub inbox: show unread notifications and open them on GitHub
- Sentry: error overview per organization and project, token stored encrypted locally
- Network overview: internet reachability, response time, local interfaces, and public IP
- Shortcuts: open links and local apps with a single click
- Audio console: switch the default output between a saved headset and monitor, mute output, mute the microphone, adjust volume, save a device pair
- Tray icon: closing only hides the window (it does not quit), "Quit Orbit" exits the app
- Global hotkeys: Alt+A shows and hides the window, Alt+Shift+O switches the audio output
- Single instance: only one Orbit window at a time

Prerequisites
-------------

- Windows
- Node.js (for development and the build)
- A GitHub personal access token with at least the read-only `notifications` scope for the inbox
- A Sentry API token plus organization and project for the Sentry connection

Initial setup
-------------

1. Clone or download the repository.
2. Install dependencies:

   npm install

3. Create a `.env` file in the repository root. Use `.env.example` as a template:

   SENTRY_ORG=your-organization
   SENTRY_PROJECT=your-project
   SENTRY_AUTH_TOKEN=your-sentry-token
   GITHUB_TOKEN=your-github-token
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-supabase-anon-key
   SUPABASE_TABLE=todos

   The `.env` file is listed in `.gitignore` and is never added to Git. Real tokens do not belong in version control.

4. Start the app in development mode (reads `.env` from the repository root):

   npm start

5. Build the portable Windows package:

   npm run build:win

   The result is written to `dist/Orbit-Portable-<version>.exe`. Packaged builds look for `.env` next to the EXE.

Customizing personal shortcuts
------------------------------

`main.cjs` only contains generic default URLs. Put your personal targets (your own domains, Cloudflare account, Supabase project, Fritzbox, and so on) into the local file `lib/shortcuts-local.cjs`. That file is listed in `.gitignore` and is never pushed.

Example `lib/shortcuts-local.cjs`:

    module.exports = {
      chrome: { kind: "url", target: "https://dash.yourdomain.dev/" },
      cloudflareDashboard: { kind: "url", target: "https://dash.cloudflare.com/your-account-id/home" },
      artcraft: { kind: "url", target: "https://your-domain.com/" },
      supabase: { kind: "url", target: "https://supabase.com/dashboard/project/your-project-ref" },
      fritzbox: { kind: "url", target: "http://192.168.178.1/#overview" },
      artcraftLauncher: { kind: "app", target: "C:\\Path\\to\\ArtCraft Launcher.lnk" }
    };

Anything missing from this file falls back to the generic defaults in `main.cjs`. This keeps your local code personal while Git and the push only contain placeholders.

Usage
-----

- Alt+A: show and hide the Orbit window
- Alt+Shift+O: switch the audio output between the saved headset and monitor
- Closing the window: hides it to the system tray
- Tray menu: "Show Orbit"/"Hide Orbit" and "Quit Orbit" to exit completely
- Sidebar: switch pages via Overview, Inbox, To-Do, Links, Network, and Quick Actions
- Weather and clock run automatically in the sidebar and refresh on a regular interval

Pages
-----

Overview
  Shows the shortcuts (YouTube, GitHub, Cloudflare, Vercel, Chrome dashboard, Cloudflare dashboard, ArtCraft, Supabase, Fritzbox, ArtCraft Launcher), the audio console, and the Sentry section.

Inbox
  Lists unread GitHub notifications. Clicking an entry opens it on github.com. Without `GITHUB_TOKEN`, a setup hint is shown.

To-Do
  Cloud task list via your own Supabase project. Tasks can be created, marked done, and deleted. Requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`.

Links
  Shortcut page (see the shortcuts above).

Network
  Shows internet reachability, response time, local interface, local IPv4/IPv6 address, MAC address, DNS servers, and the public IP (looked up via api.ipify.org and disclosed in the UI).

Quick Actions / Audio console
  Switch output (hotkey Alt+Shift+O), mute output, mute the microphone, adjust volume, save a headset/monitor device pair.

Sentry (configure)
------------------

In the app under Sentry, you can enter the organization, project, and API token. The token is encrypted locally with Electron `safeStorage` into `userData/sentry-config.json` and is never shown in the interface.

Alternatively, Orbit connects automatically via the `.env` variables `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN`. The `.env` configuration takes precedence and disables the in-app configuration.

To-Do (Supabase)
----------------

The To-Do page is backed by your own Supabase project. Create a project at supabase.com, then create the `public.todos` table. A matching schema looks like this:

    create table public.todos (
      id bigint generated by default as identity primary key,
      title text not null,
      completed boolean not null default false,
      created_at timestamptz not null default now()
    );

Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `.env`. `SUPABASE_TABLE` is optional and defaults to `todos`. The publishable/anon key is used from the main process only.

Commands
--------

- `npm start` — start the app in development mode
- `npm run build:win` — build the portable Windows package (Windows only)
- `npm run check` — syntax-check main, preload, and lib/
- `npm test` — unit and integration tests (no network)
- `npm run test:e2e` — Playwright E2E tests (Windows, launches the real app against local stubs)
- `npm run test:all` — check + test + test:e2e

Security and architecture
-------------------------

- The renderer is sandboxed (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). Native features are only exposed through `preload.cjs` and `ipcMain`.
- The GitHub token is read-only and is never stored by the app. Opening notifications is restricted to `https://github.com`.
- The Sentry token is stored encrypted locally and is never shown in the interface.
- The public IP lookup uses `https://api.ipify.org`.
- Test hooks via environment variables (for example `ORBIT_TEST_USER_DATA`, `ORBIT_E2E=1`, `ORBIT_NO_ENV=1`, `ORBIT_WEATHER_BASE_URL`, `ORBIT_GITHUB_BASE_URL`, `ORBIT_PUBLIC_IP_URL`) are production-safe and intended only for local stubs. Never test against real Supabase, Sentry, Open-Meteo, GitHub, or ipify services.
- Autostart is intentionally not implemented.

Before publishing the history online
------------------------------------

- The real tokens in `.env` are not in the Git history because `.env` is listed in `.gitignore` and was never committed. Still, rotate the tokens if they have ever left this machine.
- Personal shortcuts now live in `lib/shortcuts-local.cjs` (in `.gitignore`, never pushed). `main.cjs` only contains generic placeholders. Before pushing, make sure this file is not accidentally forced in (`git add -f`).
- The To-Do Supabase project is configured through `.env` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_TABLE`). No personal Supabase values are hardcoded in the repository.
- `package.json` lists the author "Max".

Version and changelog
---------------------

For fixes, bump the version in `package.json` and add a Keep-a-Changelog entry to `CHANGELOG.md`. Releases are tags of the form `v<version>` that must match `package.json`.
