# GitHub Inbox — Design

## Intent

Give Orbit a place that answers "What is waiting for me?" by listing unread GitHub notifications, and let a click open the matching item on GitHub.

## Goals

- New **Inbox** page in the sidebar listing unread GitHub notifications.
- Each entry shows the subject title, repository, reason, and when it was last updated.
- Clicking an entry opens the matching GitHub page in the default browser.
- Loads when the Inbox page is opened; manual refresh button.
- Token comes from `GITHUB_TOKEN` in `.env`.
- Follows the existing architecture: network in the main process, `preload.cjs` bridge, shared pure logic in `lib/orbit-shared.js`, `lib/github-service.cjs` with injectable `fetch`.

## Non-goals

- No background polling, no unread badge in the sidebar (variant A was chosen).
- No mark-as-read, unsubscribe, or any write actions against GitHub.
- No GUI token form and no encrypted token storage; `.env` only.
- No filtering, grouping, or search.
- No pagination beyond the first API page (max 50 notifications).

## Anti-goals

- Renderer making network calls or opening arbitrary URLs.
- Adding scrolling to the app shell; the list scrolls inside its panel like the To-Do list.
- Shipping a new runtime file outside `lib/`.

## Constraints

- Renderer stays sandboxed (`contextIsolation`, no Node).
- UI text and error messages in English.
- Fixed 980×560 window, `minHeight: 560`; the page must fit without page-level scrolling.
- GitHub API needs a token with at least `notifications` read scope.
- Tests must never hit real GitHub; use `ORBIT_GITHUB_BASE_URL` against local stubs.

## Approaches

- **A — Unread notifications page (chosen):** `GET /notifications?all=false&per_page=50` with `Authorization: Bearer`, mapped to a simple list. Matches "what is waiting for me".
- **B — Open PRs/issues per selected repo:** needs repo configuration and more UI; answers "how are my projects doing" instead.

The human partner chose A.

## How it works

### Config (`main.cjs`, `.env.example`)

- Add `GITHUB_TOKEN` to `.env.example`.
- Reuse the existing `.env` discovery: dev reads the repo `.env`, packaged builds read next to the EXE.
- Generalize the env reader in `lib/orbit-shared.js` to accept the keys to extract (e.g. `parseEnvFile(text, keys)`), keeping `parseSentryEnvFile` as a thin wrapper.
- Token validation: non-empty, 8–256 chars, no whitespace.
- When no token is set, the page shows "Add GITHUB_TOKEN to the .env file to connect GitHub." (not an error state).
- Test hook `ORBIT_GITHUB_BASE_URL` overrides the API origin (default `https://api.github.com`), like the weather/To-Do hooks.

### Service (`lib/github-service.cjs`)

- `fetchNotifications({ fetchImpl = fetch, baseUrl, token, perPage = 50, timeoutMs = 15000 })`.
- Request headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.
- Sends `all=false` (unread only) and `per_page=50`; first page only.
- Validates the response is an array.
- Error messages (English):
  - 401/403 → "GitHub rejected the token. Check GITHUB_TOKEN in the .env file."
  - 429 → "GitHub is rate limiting requests. Please try again later."
  - other non-OK → "GitHub could not load notifications (HTTP <status>)."
  - network/timeout → "GitHub is unreachable. Check your internet connection."
  - invalid JSON/shape → "GitHub returned an invalid response."

### Shared logic (`lib/orbit-shared.js`)

- `mapGithubNotification(notification)` → `{ id, title, repository, reason, type, updatedAt, url }`.
  - `title` = `subject.title`, fallback "Untitled notification".
  - `repository` = `repository.full_name`, fallback "Unknown repository".
  - `reason` = `reason` (e.g. `review_requested`, `mention`), formatted for display.
- `githubNotificationUrl(notification)`:
  - Derive from `subject.url`'s API path for known types:
    - Issue / PullRequest → `https://github.com/<repo>/issues/<n>` (GitHub redirects PRs to `/pull/<n>`).
    - Discussion → `/discussions/<n>`.
    - Commit → `/commit/<sha>`.
    - Release → `https://github.com/<repo>/releases`.
  - Unknown or missing → `https://github.com/notifications`.
  - URL is always `https://github.com/...` so the main process can validate the origin.
- Keep formatting helpers (relative time like "2h ago") in shared logic so they are unit-testable.

### Main process (`main.cjs`)

- `sentryEnvPaths` becomes a generic `envPaths` used by both Sentry and GitHub.
- `ipcMain.handle("github:notifications")` reads `GITHUB_TOKEN`, calls `fetchNotifications` with `ORBIT_GITHUB_BASE_URL` when set, and returns `{ configured: boolean, notifications: [...] }`.
- `ipcMain.handle("github:open", (_event, url) => ...)` validates the URL parses and its origin is exactly `https://github.com`, then `shell.openExternal`. Any other URL throws "This link cannot be opened."

### Preload (`preload.cjs`)

- Add `github: { getNotifications: () => ipcRenderer.invoke("github:notifications"), open: (url) => ipcRenderer.invoke("github:open", url) }`.

### Renderer (`index.html`)

- Sidebar item **Inbox** with an inbox/tray icon between Overview and To-Do.
- New `.inbox-section.page-section` using the same panel styling as To-Do/Sentry:
  - Header: `GITHUB · INBOX`, summary `— UNREAD`, refresh button (reuses `.sentry-icon-button`).
  - List rows: title (ellipsised), `repository · reason`, relative time on the right; whole row is a button that calls `github.open`.
  - Empty state: "Inbox zero. Nothing is waiting for you."
  - Error line reuses the muted/error text style.
- `showPage("inbox")` activates `.inbox-section`, sets eyebrow "Workspace" and title "Inbox", and calls the loader.
- List max-height scrolls internally, like `.todo-list`.
- Refresh button reloads; loading and errors are announced via `role="status"`.

### Tests

- Unit (`tests/unit/orbit-shared.test.cjs`): env parsing with multiple keys, notification mapping, URL derivation for each known subject type + fallback, relative-time formatting.
- Integration (`tests/integration/github-service.test.cjs`): success, unread query params/headers, 401/403/429/other, network failure, invalid payload.
- E2E (`tests/e2e/app.spec.cjs`): navigate to Inbox, stub `ORBIT_GITHUB_BASE_URL`, assert rows render and empty/error states; no real GitHub calls.

## Release

- Version bump `1.8.0` → `1.9.0`.
- English Keep-a-Changelog entry under Added.
- Rebuild `npm run build:win`, delete older `dist/Orbit-Portable-*.exe`, launch the new EXE.

## Left to the builder

- Exact icon, spacing, and row layout, as long as the page fits the fixed height and matches existing panel styling.
- Relative-time granularity (minutes/hours/days) and exact phrasing.
- Whether the reason is shown verbatim (`review_requested`) or prettified ("Review requested").
