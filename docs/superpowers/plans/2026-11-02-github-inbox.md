# GitHub Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Inbox page listing unread GitHub notifications, with click-to-open on GitHub, configured via `GITHUB_TOKEN` in `.env`.

**Architecture:** Main process reads/maps notifications through `lib/github-service.cjs` (injectable `fetch`), shared pure logic lives in `lib/orbit-shared.js`, `preload.cjs` exposes `github.*`, and `index.html` renders a new `.inbox-section` page. URL opening is restricted to `https://github.com`.

**Tech Stack:** Electron, vanilla JS/HTML/CSS, `node:test`, Playwright Electron.

**Spec:** `docs/superpowers/specs/2026-11-02-github-inbox-design.md`

## Global Constraints

- Renderer stays sandboxed (`contextIsolation`, `nodeIntegration: false`, `sandbox: true`).
- All UI text and error messages in English.
- Fixed 980×560 window, `minHeight: 560`; no page-level scrolling.
- Token comes from `GITHUB_TOKEN` in `.env`; no GUI form, no encrypted storage.
- No background polling and no sidebar badge (variant A).
- Tests never hit real GitHub; use `ORBIT_GITHUB_BASE_URL` stubs.
- Only `https://github.com/...` URLs may be opened by `github:open`.
- Do **not** commit unless the user explicitly asks (overrides the plan skill's commit steps).
- Version bump `1.8.0` → `1.9.0` and an English changelog entry before rebuilding.

## Review Focus

- Missing/empty `GITHUB_TOKEN` → page shows a setup hint, not an error or crash.
- Malformed notification (missing `subject`, `repository`, or `subject.url`) → fallback values, no exception.
- API-URL-to-GitHub-URL mapping for Issue vs PullRequest vs Discussion vs Commit vs Release vs unknown → correct link or `https://github.com/notifications`.
- 401/403/429 → clear, distinct messages (token vs rate limit).
- Very long title/repository and empty inbox at 360px width → ellipsis, no overflow, empty state visible.

---

## File Structure

- Modify `lib/orbit-shared.js` — generic env parser, token validation, notification mapping, URL derivation, relative time.
- Create `lib/github-service.cjs` — `fetchNotifications` with injectable `fetch`.
- Modify `main.cjs` — generic env path helper, `readGithubToken`, `github:notifications`, `github:open`.
- Modify `preload.cjs` — `orbitWindow.github`.
- Modify `index.html` — sidebar item, `.inbox-section`, styles, loader/renderer, `showPage` branch.
- Modify `.env.example`, `package.json`, `CHANGELOG.md`, `AGENTS.md`.
- Modify `tests/unit/orbit-shared.test.cjs`, `tests/e2e/app.spec.cjs`; create `tests/integration/github-service.test.cjs`.

---

### Task 1: Shared GitHub logic

**Files:**
- Modify: `lib/orbit-shared.js`
- Test: `tests/unit/orbit-shared.test.cjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `parseEnvFile(text, keys) -> Record<string,string>` (only provided keys).
  - `parseSentryEnvFile(text)` remains, implemented via `parseEnvFile`.
  - `validateGithubToken(token) -> string` (trimmed) or throws.
  - `githubNotificationUrl(notification) -> string`.
  - `mapGithubNotification(notification) -> { id, title, repository, reason, type, updatedAt, url }`.
  - `formatRelativeTime(iso, now = new Date()) -> string`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/orbit-shared.test.cjs`

```js
test("parseEnvFile reads only the requested keys", () => {
  const text = [
    "# comment",
    "GITHUB_TOKEN=ghp_abcdefgh",
    "SENTRY_ORG=my-org",
    "IGNORED=value"
  ].join("\n");
  assert.deepEqual(shared.parseEnvFile(text, ["GITHUB_TOKEN"]), { GITHUB_TOKEN: "ghp_abcdefgh" });
  assert.deepEqual(shared.parseEnvFile("IGNORED=x", ["GITHUB_TOKEN"]), {});
});

test("validateGithubToken trims and rejects invalid tokens", () => {
  assert.equal(shared.validateGithubToken("  ghp_abcdefgh  "), "ghp_abcdefgh");
  assert.throws(() => shared.validateGithubToken(""), /GitHub token/);
  assert.throws(() => shared.validateGithubToken("short"), /GitHub token/);
  assert.throws(() => shared.validateGithubToken("ghp_abc defgh"), /GitHub token/);
  assert.throws(() => shared.validateGithubToken("a".repeat(257)), /GitHub token/);
});

test("githubNotificationUrl builds GitHub links for known subject types", () => {
  const base = { repository: { full_name: "octo/repo" } };
  assert.equal(
    shared.githubNotificationUrl({ ...base, subject: { type: "Issue", url: "https://api.github.com/repos/octo/repo/issues/42" } }),
    "https://github.com/octo/repo/issues/42"
  );
  assert.equal(
    shared.githubNotificationUrl({ ...base, subject: { type: "PullRequest", url: "https://api.github.com/repos/octo/repo/pulls/7" } }),
    "https://github.com/octo/repo/issues/7"
  );
  assert.equal(
    shared.githubNotificationUrl({ ...base, subject: { type: "Discussion", url: "https://api.github.com/repos/octo/repo/discussions/5" } }),
    "https://github.com/octo/repo/discussions/5"
  );
  assert.equal(
    shared.githubNotificationUrl({ ...base, subject: { type: "Commit", url: "https://api.github.com/repos/octo/repo/commits/abc123" } }),
    "https://github.com/octo/repo/commit/abc123"
  );
  assert.equal(
    shared.githubNotificationUrl({ ...base, subject: { type: "Release", url: "https://api.github.com/repos/octo/repo/releases/9" } }),
    "https://github.com/octo/repo/releases"
  );
  assert.equal(
    shared.githubNotificationUrl({ ...base, subject: { type: "CheckSuite", url: "https://api.github.com/repos/octo/repo/check-suites/1" } }),
    "https://github.com/notifications"
  );
  assert.equal(shared.githubNotificationUrl({}), "https://github.com/notifications");
});

test("mapGithubNotification maps fields and fills defaults", () => {
  assert.deepEqual(shared.mapGithubNotification({}), {
    id: "",
    title: "Untitled notification",
    repository: "Unknown repository",
    reason: "",
    type: "",
    updatedAt: "",
    url: "https://github.com/notifications"
  });

  const mapped = shared.mapGithubNotification({
    id: 12,
    reason: "review_requested",
    updated_at: "2026-11-02T10:00:00Z",
    subject: { title: "Fix login", type: "PullRequest", url: "https://api.github.com/repos/octo/repo/pulls/7" },
    repository: { full_name: "octo/repo" }
  });
  assert.equal(mapped.id, "12");
  assert.equal(mapped.title, "Fix login");
  assert.equal(mapped.repository, "octo/repo");
  assert.equal(mapped.reason, "review_requested");
  assert.equal(mapped.type, "PullRequest");
  assert.equal(mapped.updatedAt, "2026-11-02T10:00:00Z");
  assert.equal(mapped.url, "https://github.com/octo/repo/issues/7");
});

test("formatRelativeTime renders coarse relative times", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  assert.equal(shared.formatRelativeTime("2026-11-02T11:59:40Z", now), "just now");
  assert.equal(shared.formatRelativeTime("2026-11-02T11:55:00Z", now), "5m ago");
  assert.equal(shared.formatRelativeTime("2026-11-02T10:00:00Z", now), "2h ago");
  assert.equal(shared.formatRelativeTime("2026-10-30T12:00:00Z", now), "3d ago");
  assert.equal(shared.formatRelativeTime("not-a-date", now), "");
  assert.equal(shared.formatRelativeTime(null, now), "");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit`
Expected: FAIL — `shared.parseEnvFile is not a function`.

- [ ] **Step 3: Implement in `lib/orbit-shared.js`**

Refactor the existing parser into `parseEnvFile(text, keys)` (same line regex and quote-stripping; match only keys in the provided array) and keep:

```js
const SENTRY_ENV_KEYS = ["SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_AUTH_TOKEN"];
function parseSentryEnvFile(text) { return parseEnvFile(text, SENTRY_ENV_KEYS); }
```

Add `validateGithubToken` (trim; 8–256 chars; no whitespace; throw `"The GitHub token in the .env file is invalid."`), `githubNotificationUrl`, `mapGithubNotification`, `formatRelativeTime` per the interfaces and spec. Add all to `module.exports`.

- [ ] **Step 4: Run tests and verify pass**

Run: `npm run test:unit`
Expected: PASS, including the pre-existing `parseSentryEnvFile` tests.

---

### Task 2: GitHub notifications service

**Files:**
- Create: `lib/github-service.cjs`
- Test: `tests/integration/github-service.test.cjs`

**Interfaces:**
- Consumes: nothing from Task 1 (service returns raw notifications; mapping happens in main).
- Produces: `fetchNotifications({ fetchImpl = fetch, baseUrl = "https://api.github.com", token, perPage = 50, timeoutMs = 15000 }) -> Promise<object[]>`; also exports `DEFAULT_GITHUB_API_URL`.

- [ ] **Step 1: Write the failing integration tests**

Mirror the `jsonResponse` helper from `tests/integration/sentry-service.test.cjs`.

```js
const { fetchNotifications, DEFAULT_GITHUB_API_URL } = require("../../lib/github-service.cjs");

test("fetchNotifications requests unread notifications with the expected headers", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: url.href, options });
    return jsonResponse(200, [{ id: 1 }]);
  };
  const result = await fetchNotifications({ fetchImpl, token: "ghp_abcdefgh" });
  assert.deepEqual(result, [{ id: 1 }]);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, DEFAULT_GITHUB_API_URL);
  assert.equal(url.pathname, "/notifications");
  assert.equal(url.searchParams.get("all"), "false");
  assert.equal(url.searchParams.get("per_page"), "50");
  assert.equal(calls[0].options.headers.Authorization, "Bearer ghp_abcdefgh");
  assert.equal(calls[0].options.headers.Accept, "application/vnd.github+json");
  assert.equal(calls[0].options.headers["X-GitHub-Api-Version"], "2022-11-28");
});

test("fetchNotifications uses the injected base URL", async () => {
  const calls = [];
  await fetchNotifications({
    fetchImpl: async (url) => { calls.push(url.href); return jsonResponse(200, []); },
    baseUrl: "http://127.0.0.1:9",
    token: "ghp_abcdefgh"
  });
  assert.equal(new URL(calls[0]).origin, "http://127.0.0.1:9");
});

test("fetchNotifications maps HTTP errors", async () => {
  const cases = [[401, /rejected the token/], [403, /rejected the token/], [429, /rate limiting/], [500, /HTTP 500/]];
  for (const [status, pattern] of cases) {
    await assert.rejects(
      fetchNotifications({ fetchImpl: async () => jsonResponse(status, {}), token: "ghp_abcdefgh" }),
      pattern
    );
  }
});

test("fetchNotifications maps network and payload failures", async () => {
  await assert.rejects(
    fetchNotifications({ fetchImpl: async () => { throw new TypeError("fetch failed"); }, token: "ghp_abcdefgh" }),
    /unreachable/
  );
  await assert.rejects(
    fetchNotifications({
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } }),
      token: "ghp_abcdefgh"
    }),
    /invalid response/
  );
  await assert.rejects(
    fetchNotifications({ fetchImpl: async () => jsonResponse(200, { not: "an array" }), token: "ghp_abcdefgh" }),
    /unexpected response/
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:integration`
Expected: FAIL — module `lib/github-service.cjs` not found.

- [ ] **Step 3: Implement `lib/github-service.cjs`**

Build `new URL("/notifications", baseUrl)`, set `all=false` and `per_page`, call `fetchImpl` with the three headers and `signal: AbortSignal.timeout(timeoutMs)`, then apply the exact error messages from the spec. Return the parsed array. Export `{ fetchNotifications, DEFAULT_GITHUB_API_URL }` where `DEFAULT_GITHUB_API_URL = "https://api.github.com"`.

- [ ] **Step 4: Update `package.json` `check` script**

Append `&& node --check lib/github-service.cjs`.

- [ ] **Step 5: Run tests and check**

Run: `npm run test:integration && npm run check`
Expected: PASS.

---

### Task 3: Main-process and preload wiring

**Files:**
- Modify: `main.cjs`
- Modify: `preload.cjs`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `fetchNotifications`, `mapGithubNotification`, `parseEnvFile`, `validateGithubToken`.
- Produces: IPC `github:notifications -> { configured: boolean, notifications: MappedNotification[] }`, `github:open(url) -> void`; preload `orbitWindow.github.getNotifications()`, `orbitWindow.github.open(url)`.

- [ ] **Step 1: Generalize env paths in `main.cjs`**

Rename `sentryEnvPaths` to `envPaths` (same body) and update `readSentryEnvConfig` to call it. No behavior change.

- [ ] **Step 2: Add token reading**

```js
async function readGithubToken() {
  if (process.env.ORBIT_GITHUB_TOKEN) return validateGithubToken(process.env.ORBIT_GITHUB_TOKEN);
  if (process.env.ORBIT_NO_ENV === "1") return null;
  for (const envPath of envPaths()) {
    let file;
    try {
      file = (await fs.readFile(envPath, "utf8")).replace(/^\uFEFF/, "");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error("The .env file could not be read.");
    }
    const values = parseEnvFile(file, ["GITHUB_TOKEN"]);
    if (values.GITHUB_TOKEN) return validateGithubToken(values.GITHUB_TOKEN);
  }
  return null;
}
```

- [ ] **Step 3: Add IPC handlers**

```js
ipcMain.handle("github:notifications", async () => {
  const token = await readGithubToken();
  if (!token) return { configured: false, notifications: [] };
  const baseUrl = process.env.ORBIT_GITHUB_BASE_URL || undefined;
  const notifications = await fetchNotifications(baseUrl ? { token, baseUrl } : { token });
  return { configured: true, notifications: notifications.map(mapGithubNotification) };
});

ipcMain.handle("github:open", async (_event, target) => {
  let url;
  try { url = new URL(target); } catch { throw new Error("This link cannot be opened."); }
  if (url.protocol !== "https:" || url.origin !== "https://github.com") {
    throw new Error("This link cannot be opened.");
  }
  await shell.openExternal(url.href);
});
```

Import the new functions at the top.

- [ ] **Step 4: Add the preload bridge**

```js
github: {
  getNotifications: () => ipcRenderer.invoke("github:notifications"),
  open: (url) => ipcRenderer.invoke("github:open", url)
},
```

- [ ] **Step 5: Update `.env.example` and docs**

Add `GITHUB_TOKEN=` under the Sentry lines. Add `ORBIT_GITHUB_BASE_URL` / `ORBIT_GITHUB_TOKEN` to the test-hooks section of `AGENTS.md`.

- [ ] **Step 6: Verify**

Run: `npm run check && npm test`
Expected: PASS.

---

### Task 4: Inbox UI and end-to-end tests

**Files:**
- Modify: `index.html`
- Modify: `tests/e2e/app.spec.cjs`

**Interfaces:**
- Consumes: `orbitWindow.github.*`, `OrbitShared.formatRelativeTime`.
- Produces: sidebar item `[data-page="inbox"]`, `.inbox-section`, `#inbox-list`, `#inbox-empty`, `#inbox-status`, `#inbox-summary`, `#inbox-refresh`.

- [ ] **Step 1: Add the sidebar item and section markup**

Insert the Inbox sidebar button between Overview and To-Do. Add `.inbox-section.page-section` after the Overview sections, using the same `.todo-panel`/`.sentry-panel` styling:

```html
<section class="inbox-section page-section" aria-labelledby="inbox-heading">
  <div class="todo-panel">
    <div class="todo-panel-header">
      <div class="todo-header-label">
        <span class="todo-mark" aria-hidden="true"></span>
        <h2 class="todo-panel-title" id="inbox-heading">GITHUB · INBOX</h2>
      </div>
      <div class="todo-header-right">
        <span class="todo-summary" id="inbox-summary">— UNREAD</span>
        <button class="sentry-icon-button" id="inbox-refresh" type="button" aria-label="Refresh Inbox" title="Refresh">…reuse refresh svg…</button>
      </div>
    </div>
    <div class="todo-body">
      <p class="todo-status" id="inbox-status" role="status" aria-live="polite"></p>
      <div class="todo-empty" id="inbox-empty" hidden>Inbox zero. Nothing is waiting for you.</div>
      <div class="todo-list" id="inbox-list"></div>
    </div>
  </div>
</section>
```

Add `.inbox-section { margin-top: 24px; }` and a `.inbox-item` style reusing the To-Do row look, with the row as a full-width button (title ellipsised, meta line, right-aligned time).

- [ ] **Step 2: Add renderer logic**

```js
const inboxList = document.querySelector("#inbox-list");
const inboxEmpty = document.querySelector("#inbox-empty");
const inboxStatus = document.querySelector("#inbox-status");
const inboxSummary = document.querySelector("#inbox-summary");
const inboxRefresh = document.querySelector("#inbox-refresh");

function renderInbox(items) {
  inboxList.replaceChildren();
  inboxSummary.textContent = `${items.length} UNREAD`;
  inboxEmpty.hidden = items.length > 0;
  for (const item of items) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "inbox-item";
    const copy = document.createElement("span");
    copy.className = "inbox-item-copy";
    const title = document.createElement("span");
    title.className = "inbox-item-title";
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.className = "inbox-item-meta";
    meta.textContent = [item.repository, item.reason].filter(Boolean).join(" · ");
    copy.append(title, meta);
    const time = document.createElement("span");
    time.className = "inbox-item-time";
    time.textContent = OrbitShared.formatRelativeTime(item.updatedAt);
    row.append(copy, time);
    row.addEventListener("click", async () => {
      try {
        await window.orbitWindow.github.open(item.url);
      } catch (error) {
        inboxStatus.textContent = error.message || "This link cannot be opened.";
      }
    });
    inboxList.append(row);
  }
}

async function loadInbox() {
  inboxRefresh.disabled = true;
  inboxStatus.textContent = "Loading notifications…";
  try {
    const result = await window.orbitWindow.github.getNotifications();
    if (!result.configured) {
      inboxList.replaceChildren();
      inboxEmpty.hidden = true;
      inboxSummary.textContent = "— UNREAD";
      inboxStatus.textContent = "Add GITHUB_TOKEN to the .env file to connect GitHub.";
      return;
    }
    renderInbox(result.notifications);
    inboxStatus.textContent = "";
  } catch (error) {
    inboxList.replaceChildren();
    inboxEmpty.hidden = true;
    inboxSummary.textContent = "— UNREAD";
    inboxStatus.textContent = error.message || "GitHub notifications could not be loaded.";
  } finally {
    inboxRefresh.disabled = false;
  }
}

inboxRefresh.addEventListener("click", loadInbox);
```

In `showPage`, add: `else if (pageId === "inbox") { document.querySelector(".inbox-section").classList.add("active"); eyebrow.textContent = "Workspace"; title.textContent = "Inbox"; loadInbox(); }`.

- [ ] **Step 3: Extend the E2E stub server**

Give the stub mutable state and serve notifications:

```js
function createStubServer() {
  const state = { notifications: [/* two sample notifications */] };
  const server = http.createServer((request, response) => { /* existing */ });
  server.state = state;
  return server;
}
```

In the handler, before the 404: if `url.pathname === "/notifications"` return `sendJson(response, 200, state.notifications)`.

Add to the launch env: `ORBIT_GITHUB_BASE_URL: \`http://127.0.0.1:${port}\`` and `ORBIT_GITHUB_TOKEN: "ghp_e2e"`.

- [ ] **Step 4: Add E2E tests**

```js
test("navigates to Inbox and renders unread notifications", async () => {
  await page.locator('[data-page="inbox"]').click();
  await expect(page.locator("#page-title")).toHaveText("Inbox");
  await expect(page.locator(".inbox-section")).toHaveClass(/active/);
  await expect(page.locator(".inbox-item")).toHaveCount(2);
  await expect(page.locator("#inbox-summary")).toHaveText("2 UNREAD");
  await expect(page.locator(".inbox-item").first()).toContainText("octo/repo");
});

test("shows the inbox-zero state", async () => {
  server.state.notifications = [];
  await page.locator('[data-page="inbox"]').click();
  await expect(page.locator("#inbox-empty")).toBeVisible();
  await expect(page.locator("#inbox-summary")).toHaveText("0 UNREAD");
});
```

Update the existing "fits the minimum window size without scrolling" test to also click `[data-page="inbox"]` and re-run the overflow assertion.

- [ ] **Step 5: Run E2E and check**

Run: `npm run test:e2e && npm run check`
Expected: PASS.

---

### Task 5: Release

**Files:**
- Modify: `package.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump version** to `1.9.0`.
- [ ] **Step 2: Add changelog entry**

```markdown
## [1.9.0] - 2026-11-02

### Added
- Inbox page listing unread GitHub notifications, opened via `GITHUB_TOKEN` in `.env`
- Clicking a notification opens it on GitHub
```

- [ ] **Step 3: Full verification**

Run: `npm run test:all`
Expected: syntax, unit, integration, and E2E all PASS.

- [ ] **Step 4: Build and replace the EXE**

Run: `npm run build:win`; delete older `dist/Orbit-Portable-*.exe`; launch the new EXE.

**Note:** skipping the build is fine if the user only wants the code change; confirm before building.

---

## Self-Review

- **Spec coverage:** page/sidebar (Task 4), REST unread first page (Task 2), `.env` token (Tasks 1/3), mapping/URLs/time (Task 1), restricted open (Task 3), tests (Tasks 1/2/4), release (Task 5). E2E token injection adds `ORBIT_GITHUB_TOKEN`, an addition to the spec's test hooks.
- **Review Focus tests:** missing token (Task 4 hint + Task 3 null), malformed payload (Task 1 defaults), URL mapping (Task 1), HTTP errors (Task 2), long text/empty at 360px (Task 4 CSS + E2E).
- **Type consistency:** `fetchNotifications` returns raw arrays; `mapGithubNotification` runs in `main.cjs`; renderer consumes mapped `{ title, repository, reason, updatedAt, url }`.
