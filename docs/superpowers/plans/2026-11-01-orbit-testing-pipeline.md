# Orbit Testing and CI Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unit, integration, and Electron E2E tests plus a test-gated GitHub Actions build/release pipeline, then push the complete app to `M0x37/ORBIT`.

**Architecture:** Extract pure logic into a UMD shared module and network code into injected-fetch services so both main and renderer use the same code and tests can mock I/O. `node:test` covers logic/services; Playwright launches the real Electron app against local stub servers.

**Tech Stack:** Node 22 test runner, `@playwright/test` (Electron), GitHub Actions, electron-builder.

**Spec:** `docs/superpowers/specs/2026-11-01-orbit-testing-pipeline-design.md`

## Global Constraints

- No bundler/framework; renderer sandbox unchanged (`contextIsolation`, `nodeIntegration: false`, `sandbox: true`).
- Shared module must load as a classic `<script>` and as CommonJS.
- `build.files` must include `lib/**/*`.
- Tests must never call real Supabase/Sentry/Open-Meteo.
- UI text/errors are English.
- Push must not include `.env`, `node_modules`, `dist`, test reports.
- E2E uses isolated `userData`, skips tray/hotkey, and points at local stubs.

## Review Focus

- Weather service timeout/HTTP/invalid-JSON/malformed payload → visible error state, no crash.
- Sentry pagination with repeated pages or foreign origins → error, no infinite loop.
- To-Do validation: empty, whitespace-only, >500 chars, non-string, invalid id.
- E2E at 360px width → no horizontal overflow; widget text truncates.
- Pipeline: failing tests must prevent build/release; tag must match `package.json` version.

---

### Task 1: Import the app into Git

**Files:** `.gitignore`, Git metadata

- [ ] Add `test-results/`, `playwright-report/`, `coverage/` to `.gitignore`.
- [ ] `git init`, verify `.env`, `node_modules/`, `dist/` are ignored.
- [ ] Commit the current app (1.7.0) as the initial import, remote `origin` → `https://github.com/M0x37/ORBIT.git`.
- [ ] Verify: `git status --short` is clean and `git ls-files` contains no `.env`.

### Task 2: Shared module and service extraction

**Files:**
- Create: `lib/orbit-shared.js`, `lib/weather-service.cjs`, `lib/todo-service.cjs`, `lib/sentry-service.cjs`
- Modify: `main.cjs`, `index.html`, `package.json` (`build.files`)

**Interfaces:**
- `OrbitShared.describeWeather(code) -> { icon, label }`
- `OrbitShared.formatClock(date) -> "HH:MM"`
- `OrbitShared.formatTemperature(value) -> "3°C" | "—"`
- `OrbitShared.formatTodoSummary(items) -> "1 OPEN · 2 DONE"`
- `OrbitShared.ipcErrorMessage(error, fallback) -> string`
- `OrbitShared.formatSentryDetail(issue) -> string`
- `OrbitShared.normalizeTodoTitle(title) -> string` (throws)
- `OrbitShared.parseWeatherPayload(payload) -> { temperature, weatherCode }` (throws)
- `OrbitShared.parseSentryEnvFile(text) -> { SENTRY_ORG?, SENTRY_PROJECT?, SENTRY_AUTH_TOKEN? }`
- `OrbitShared.validateSentrySetup({ organization, project, token }) -> { organization, project, token }` (throws)
- `OrbitShared.getNextSentryPage(linkHeader, currentUrl) -> URL | null` (throws)
- `OrbitShared.mapSentryIssue(issue) -> object`
- `fetchWeather({ fetchImpl, baseUrl, location }) -> Promise<{ temperature, weatherCode }>`
- `todoRequest({ fetchImpl, baseUrl, apiKey, table, search, options }) -> Promise<any>`
- `fetchSentryPages({ fetchImpl, initialUrl, token, resourceName }) -> Promise<array>`
- `loadSentryIssues({ fetchImpl, organization, token, baseUrl }) -> Promise<{ projectCount, issues }>`

- [ ] Implement the shared module with a UMD wrapper.
- [ ] Move pure logic out of `main.cjs` and `index.html`; keep behavior identical.
- [ ] Add `lib/**/*` to `build.files`; load the shared script before the inline script.
- [ ] Verify: `node --check` on all changed scripts, `npm start` renders unchanged.

### Task 3: Unit tests

**Files:** `tests/unit/orbit-shared.test.cjs`, `package.json` (`test:unit`, `check`)

- [ ] Test every WMO group + unknown code.
- [ ] Test clock at 09:05, 23:59, 00:00.
- [ ] Test temperature valid/invalid, To-Do summary/counts, IPC error prefix stripping.
- [ ] Test To-Do title trim/empty/too long/non-string.
- [ ] Test weather payload valid/missing/non-numeric.
- [ ] Test Sentry env parsing: full, partial, quoted, `export`, BOM, invalid slug/token.
- [ ] Test Sentry `Link` pagination: none, next+results, next without results, malformed.
- [ ] Test issue mapping defaults.
- [ ] Run `npm run test:unit`; all pass.

### Task 4: Integration tests

**Files:** `tests/integration/weather-service.test.cjs`, `todo-service.test.cjs`, `sentry-service.test.cjs`, `package.json` (`test:integration`)

- [ ] Weather: correct URL/params, rounding, network failure, HTTP error, invalid JSON, bad payload.
- [ ] To-Do: success JSON, 204 → null, API message surfaced, network failure.
- [ ] Sentry: pagination merge, 401/403/404/429 messages, invalid payload, repeated page, foreign origin.
- [ ] Run `npm run test:integration`; all pass.

### Task 5: Electron E2E

**Files:** `playwright.config.cjs`, `tests/e2e/app.spec.cjs`, `package.json` (`test:e2e`)

- [ ] Stub weather and To-Do HTTP servers per test; isolate `userData`; set `ORBIT_E2E`, `ORBIT_NO_ENV`.
- [ ] Test clock format/ticks and weather `7°C Partly cloudy`.
- [ ] Test Overview → To-Do → Links navigation and active sections.
- [ ] Test adding and completing a To-Do through the real UI/IPC.
- [ ] Run `npm run test:e2e`; all pass.

### Task 6: CI pipeline

**Files:** `.github/workflows/ci.yml`

- [ ] Jobs: `check` (syntax + unit + integration), `e2e` (Windows), `build` (Windows, non-PR, needs both), `release` (tag `v*`, verifies tag == version, uploads EXE).
- [ ] Upload Playwright report on failure and EXE artifact on build.
- [ ] Validate YAML syntax and event/permission logic by reading it back.

### Task 7: Version, changelog, verification, push

**Files:** `package.json`, `CHANGELOG.md`

- [ ] Bump `1.7.0` → `1.8.0`; add changelog entry and session notes.
- [ ] Run `npm run check`, `npm test`, `npm run test:e2e`, `npm run build:win`.
- [ ] Commit tests and CI, then `git push -u origin main`.
- [ ] Verify the remote branch contains the app and no secrets.
