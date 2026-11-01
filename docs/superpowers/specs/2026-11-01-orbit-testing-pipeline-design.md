# Orbit Testing and CI Pipeline — Design

## Intent

Give Orbit a real test suite and a CI pipeline that proves the app works before anything is built or released. Today the repository has no tests, no lint/typecheck, and no Git history; verification is "launch it and look". This design adds testable boundaries to the existing app and gates every build/release on green tests.

## Goals

- Unit tests for every pure function (weather mapping, clock formatting, To-Do validation/formatting, Sentry env parsing, pagination, issue mapping).
- Integration tests for the network-facing services (weather, To-Do, Sentry) with mocked `fetch`, including error paths.
- An Electron end-to-end test that launches the real app, checks the clock/weather widget, page navigation, and the To-Do add/complete flow.
- A GitHub Actions pipeline: syntax check → unit → integration → E2E (Windows) → portable build → GitHub Release only on `v*` tags.
- The existing runtime architecture stays intact: no bundler, no framework, sandboxed renderer, network access in the main process.

## Non-Goals

- Rewriting the UI or changing user-facing behavior.
- 100% coverage targets or mutation testing.
- Signed Windows binaries or auto-update.
- Testing the tray icon/global hotkey UI on CI (covered indirectly by launch smoke test).

## Anti-Goals

- Tests that call the real Supabase, Sentry, or Open-Meteo APIs.
- Shipping `.env`, tokens, or `node_modules`/`dist` in Git.
- Building or releasing when any test stage fails.

## Constraints

- Renderer stays sandboxed; shared code must work as a plain `<script>` and as CommonJS.
- `build.files` must include any new runtime file.
- UI text and error messages stay English.
- Windows is the build target; CI uses `windows-latest` for E2E/build and `ubuntu-latest` for fast tests.
- The existing `npm start` and `npm run build:win` behavior must not change.

## Approaches

- **A — Node test runner + Playwright Electron (chosen):** `node:test` for unit/integration (zero runtime deps), `@playwright/test` for one real Electron launch, GitHub Actions stages. Keeps the plain-JS setup; one new dev dependency.
- **B — Vitest + jsdom + Playwright:** familiar tooling and DOM tests inside `index.html`, but more dependencies/config and jsdom does not model Electron.
- **C — Unit/integration only:** cheapest, but never proves the packaged app starts or that preload/IPC wiring works.

The human partner chose A. Deployment means a GitHub Release with the portable EXE, created only for tags matching the package version.

## Structure

- `lib/orbit-shared.js` — UMD module usable by main and renderer: `describeWeather`, `formatClock`, `formatTemperature`, `formatTodoSummary`, `todoErrorMessage`, `formatSentryDetail`, `normalizeTodoTitle`, `parseWeatherPayload`, `parseSentryEnvFile`, `validateSentrySetup`, `getNextSentryPage`, `mapSentryIssue`.
- `lib/weather-service.cjs` — `fetchWeather({ fetchImpl, baseUrl, location })`: URL building, timeout, error messages, payload validation.
- `lib/todo-service.cjs` — `todoRequest({ fetchImpl, baseUrl, apiKey, table, search, options })` plus response parsing.
- `lib/sentry-service.cjs` — `fetchSentryPages(...)` and `loadSentryIssues(...)` with pagination, auth/rate-limit errors, and issue mapping.
- `main.cjs` — imports the services, keeps IPC/file/safeStorage/window/tray logic.
- `index.html` — loads `lib/orbit-shared.js` before its inline script and calls the shared helpers.
- `tests/unit/*.test.cjs`, `tests/integration/*.test.cjs`, `tests/e2e/app.spec.cjs`, `playwright.config.cjs`.
- `.github/workflows/ci.yml`.

## Test Hooks (production-safe)

- `ORBIT_TEST_USER_DATA` — isolate `app.setPath("userData", …)` so E2E never collides with the running app's single-instance lock.
- `ORBIT_E2E=1` — skip tray and global hotkey registration during E2E.
- `ORBIT_NO_ENV=1` — ignore `.env` so Sentry stays unconfigured during E2E.
- `ORBIT_WEATHER_BASE_URL`, `ORBIT_TODO_BASE_URL` — point services at local stub servers during E2E; default unchanged.

## Pipeline

1. **check** (ubuntu): `npm ci`, `npm run check` (syntax), unit, integration.
2. **e2e** (windows, needs check): `npm ci`, `npm run test:e2e`; upload report on failure.
3. **build** (windows, needs test + e2e, not PRs): `npm run build:win`, upload EXE artifact.
4. **release** (needs build, only `refs/tags/v*`): verify tag equals `package.json` version, create GitHub Release with the EXE.

## Release

- Version bump `1.7.0` → `1.8.0` (test infrastructure).
- Changelog entry.
- Committed history: app import, tests/refactor, CI, pushed to `M0x37/ORBIT`.

## Left to the builder

- Exact assertions and stub payloads, as long as they cover the success and error paths named above.
- Whether to split test files further once they grow.
