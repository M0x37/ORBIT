# Changelog - Orbit Desktop App

## [1.10.0] - 2026-11-03

### Added
- Network overview showing adapter, local IPv4/IPv6, MAC address, DNS servers, public IP, latency, and internet reachability

### Changed
- Network tab redesigned as a single compact console panel instead of seven cards

## [1.9.1] - 2026-11-02

### Fixed
- Sentry timeouts now report that Sentry may be experiencing an outage and link to its status page instead of blaming the internet connection

## [1.9.0] - 2026-11-02

### Added
- Inbox page listing unread GitHub notifications, opened via `GITHUB_TOKEN` in `.env`
- Clicking a notification opens it on GitHub

## [1.8.0] - 2026-11-01

### Added
- Unit tests for shared logic (weather mapping, clock, To-Do formatting, Sentry parsing/pagination)
- Integration tests for the weather, To-Do, and Sentry services with mocked network calls
- Electron end-to-end tests for the clock/weather widget, page navigation, and To-Do flow
- GitHub Actions pipeline: syntax, unit, integration, E2E, portable build, and release on tags

### Changed
- Pure logic moved into `lib/` modules shared by the main process and the renderer
- Network services now accept injected `fetch` implementations for testability

## [1.7.0] - 2026-11-01

### Added
- Clock and current weather widget at the bottom of the sidebar
- Weather for Dreikirchen via Open-Meteo, refreshed every 15 minutes

## [1.6.0] - 2026-10-31

### Added
- System tray icon with show/hide and quit actions
- Global `Alt+A` shortcut to toggle Orbit

### Changed
- Closing the window now hides Orbit to the tray instead of quitting

## [1.5.0] - 2026-10-30

### Added
- Supabase project shortcut in the Links tab

## [1.4.0] - 2026-10-30

### Added
- To-Do tab backed by Supabase with add, complete, reopen, delete, and refresh
- To-Do items sync with the existing `public.todos` table

## [1.3.1] - 2026-10-30

### Changed
- Translated the entire app, all error messages, and the project documentation to English

## [1.3.0] - 2026-10-30

### Added
- Links tab with Cloudflare, ArtCraft, FritzBox, and ArtCraft Launcher
- Shortcuts can now open local apps as well

## [1.2.0] - 2026-10-29

### Removed
- Security tab and Windows Defender scans completely removed.

## [1.1.6] - 2026-10-29

### Changed
- Scan result in the Security tab displayed as a clear card with status, scan type, scope, duration, and finding count
- Technical Defender output moved into collapsible details
- "Windows Defender" button in the result header opens Windows Security

### Fixed
- Threats are listed after the scan with name and path (best effort via Defender)
- A failed finding query no longer causes the scan to fail

## [1.1.5] - 2026-10-29

### Changed
- Security tab design aligned with the shortcut cards (icons, consistent layout)
- Custom scan now uses the native folder dialog instead of `prompt()`
- Scan result shows a loading indicator while running

### Removed
- Native `confirm()` prompt before the scan removed (UAC already confirms)

### Fixed
- Security tab now responds to clicks: missing status element `#security-status` added
- Quick/full scan now actually starts (previously a silent `TypeError`)
- Windows Defender scan uses valid `MpCmdRun.exe` arguments; output is correctly captured as UTF-8
- Scan errors and UAC cancellation are reported visibly instead of hanging until timeout

## [1.1.4] - 2026-10-22

### Added
- New Security tab with Windows Defender integration

### Changed
- Window height reduced to 560px (no scrolling)

### Fixed
- "ICON not defined" error in Sentry Collapse removed

## [1.1.3] - 2026-10-22

All changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.2] - 2026-10-21

### Added
- **New "Security" tab** in the sidebar with shield icon
- **Windows Defender integration** with three scan options:
  - Quick scan (ScanType 1) - Fast scan of commonly affected areas
  - Full scan (ScanType 2) - Comprehensive scan of all files
  - Custom scan (ScanType 3) - Enter path via prompt
- IPC handler `defender:scan` in `main.cjs` uses `MpCmdRun.exe`
- Preload exposure `window.orbitWindow.defender.scan(type, path)`
- UI status display with colored feedback (info/success/error)
- Dynamic page header (eyebrow/title) when switching tabs

### Changed
- **HTML structure fixed**: Security section is now an independent sibling (no longer nested in sentry-section)
- CSS: `.page-section` class for all sections with `display: none` / `.active` → `display: block`
- Navigation: Correct switching between Overview (Shortcuts + Sentry) and Security (Security only)

---

## [1.1.1] - 2026-10-21

### Added
- **Magnifier icon** in the titlebar (right of Minimize)
- Click opens `https://dash.m0x2.dev/` in the default browser
- **App icon** for taskbar and window (`assets/orbit.ico`)
- `icon` field in `package.json` build config
- `icon` option in the `BrowserWindow` constructor

### Changed
- Chrome shortcut URL changed from `google.com` to `dash.m0x2.dev`

---

## [1.1.0] - 2026-10-21

### Added
- Agent rules in `agent/rules.md` and `agent/agent.md`
- New rule: "When deleting/rewriting features, remove all old code that is no longer needed"
- New rule: "For fixes, bump the version in package.json and rebuild"

### Changed
- **Window height** from 820px → 560px (minHeight 560px) - no more scrolling needed
- **Sentry collapse/expand completely removed**:
  - Collapse button removed from HTML
  - Event listeners removed from JavaScript
  - `.sentry-panel.is-collapsed` CSS removed
  - Sentry panel is now always expanded
- **"ICON not defined" error fixed**: `preserveSentrySettingsIcon()` function and calls removed (was legacy code from the collapse feature)
- **Old EXE versions cleaned up**: Only the current version remains in `dist/`

---

## [1.0.12] - 2026-10-21 (base version before session)

### Existing Features
- Frameless window with custom titlebar (transparent, animated)
- Shortcut buttons: YouTube, GitHub, Cloudflare, Vercel
- Sentry integration (configuration via .env or encrypted local storage, issue display)
- IPC bridge between renderer and main process via preload script
- Electron + electron-builder for portable Windows EXE

---

## Session Notes 2026-10-21

**Work request**: Adjust window size, remove Sentry collapse, add icon, create Security tab with Windows Defender

**Steps taken**:
1. Reduced window height (820→560px)
2. Completely removed Sentry collapse/expand feature (button, CSS, JS)
3. Cleaned up `preserveSentrySettingsIcon()` legacy function (caused "ICON not defined")
4. Configured app icon (`orbit.ico`) for taskbar/window
5. Added magnifier button in titlebar for `dash.m0x2.dev`
6. Security tab with 3 Windows Defender scan options
7. Correct page navigation (toggle sections instead of append)
8. Bumped version: 1.0.12 → 1.1.0 → 1.1.1 → 1.1.2
9. Cleaned up old build artifacts

**Open topics / Known issues**:
- Windows Defender scan requires admin rights for full/custom scans
- MpCmdRun.exe path detection via glob could be more robust
- No app icon for macOS/Linux (Windows .ico only)

---

## Session Notes 2026-11-01

**Work request**: Add a weather and clock widget and rebuild the app

**Steps taken**:
1. Added the `weather:current` IPC handler in `main.cjs` using Open-Meteo (fixed location: Dreikirchen)
2. Exposed `window.orbitWindow.weather.get()` through `preload.cjs`
3. Added the sidebar widget with a 24h clock, temperature, weather condition, and matching icons
4. Removed the unused sidebar footer text
5. Bumped version 1.6.0 → 1.7.0 and rebuilt the portable EXE

**Open topics / Known issues**:
- Weather location is hardcoded; changing it requires a code change
- No forecast, only current conditions
- Weather is fetched from the main process, so it also works with the window hidden

---

## Session Notes 2026-11-01 (testing)

**Work request**: Add real tests and testing stages, then push the complete app to GitHub

**Steps taken**:
1. Imported the app into Git and pushed it to `M0x37/ORBIT`
2. Extracted shared logic into `lib/orbit-shared.js` and network code into injectable services
3. Added unit tests for pure functions and integration tests for all three network services
4. Added Playwright Electron tests for the widget, navigation, To-Do flow, and minimum window size
5. Added a GitHub Actions pipeline that gates build and release on green tests
6. Bumped version 1.7.0 → 1.8.0

**Open topics / Known issues**:
- CI runs E2E on Windows only; Linux/macOS packaging is not configured
- Release requires pushing a tag that matches the `package.json` version
- `npm audit` reports moderate vulnerabilities in the Electron build toolchain
