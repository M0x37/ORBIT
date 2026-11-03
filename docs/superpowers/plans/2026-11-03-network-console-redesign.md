# Network Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven-card Network grid with the single compact "Console" panel from the approved design while keeping every value, ID, and behavior.

**Architecture:** Pure renderer change in `index.html` (CSS, markup, element refs, `loadNetworkOverview()`). No main/preload/service changes. E2E coverage pins the layout, offline state, and partial public-IP failure before the implementation changes.

**Tech Stack:** Electron, plain HTML/CSS/JS, Node test runner, Playwright Electron.

**Spec:** `docs/superpowers/specs/2026-11-03-network-console-redesign-design.md`

## Global Constraints

- Fixed 980×560 window; the Network page must fit without page scrolling at 360×560.
- Renderer stays sandboxed; no Node access in `index.html`.
- UI copy stays English.
- Keep IDs `network-connection`, `network-latency`, `network-ip`, `network-adapter`, `network-ipv6`, `network-mac`, `network-dns`, `network-public-ip`, `network-status`.
- Keep the existing refresh button, disclosure line, status line, loading state, and error behavior.
- Do not commit; repo policy requires an explicit request.
- No new dependencies.

## Review Focus

- **Narrow width with long IPv6/DNS values:** values must ellipsize inside the row, not widen the page at 360px. Covered by the narrow-window E2E test.
- **Probe unreachable:** the panel must show `Offline`, a red dot, `—` latency, and keep local details. Covered by the offline E2E test.
- **Public-IP lookup failure while online:** the panel must stay online and show `Unavailable` for the public IP. Covered by the public-IP-failure E2E test.
- **Missing local detail:** a null adapter/IP/MAC/DNS value must render `Unavailable`, not `null` or an empty row. Existing `loadNetworkOverview()` fallback is preserved; verified by the offline test and service integration tests.
- **IPC rejection:** the catch branch must show `Unavailable`, a red dot, and the error message. Preserved verbatim from the current implementation; manual check with the real app.

---

### Task 1: Pin the console behavior with E2E tests

**Files:**
- Modify: `tests/e2e/app.spec.cjs` (stub server at line ~50, navigation test at line ~175, new tests after it)

**Interfaces:**
- Consumes: existing `server.state` pattern and `ORBIT_PUBLIC_IP_URL` stub.
- Produces: E2E expectations for `.network-console`, `.network-console-row`, `.network-console.is-online/is-offline`, and the retained value IDs.

- [ ] **Step 1: Add stub controls for a failing public-IP lookup**

In `createStubServer()`, add `publicIpFail: false` to the `state` object and change the `/public-ip` branch to:

```js
if (url.pathname === "/public-ip") {
  if (state.publicIpFail) {
    sendJson(response, 500, { message: "Lookup failed" });
    return;
  }
  sendJson(response, 200, { ip: "203.0.113.42" });
  return;
}
```

- [ ] **Step 2: Extend the navigation test with console assertions**

After the existing `#network-public-ip` assertion in the navigation test, add:

```js
await expect(page.locator(".network-console")).toBeVisible();
await expect(page.locator(".network-console-row")).toHaveCount(6);
await expect(page.locator(".network-card")).toHaveCount(0);
await expect(page.locator(".network-console")).toHaveClass(/is-online/);
await expect(page.locator("#network-latency")).toHaveText(/\d+ ms/);
await expect(page.locator("#network-ipv6")).not.toHaveText(/unavailable/i);
```

- [ ] **Step 3: Add the offline and partial-failure tests**

Add after the navigation test:

```js
test("shows the network console offline state when the probe is unreachable", async () => {
  await new Promise((resolve) => server.close(resolve));
  await page.locator('[data-page="network"]').click();
  await expect(page.locator(".network-console")).toHaveClass(/is-offline/);
  await expect(page.locator("#network-connection")).toHaveText("Offline");
  await expect(page.locator("#network-latency")).toHaveText("—");
  await expect(page.locator("#network-public-ip")).toHaveText("Unavailable");
  await expect(page.locator("#network-status")).toContainText("Updated");
});

test("keeps the network console online when only the public IP lookup fails", async () => {
  server.state.publicIpFail = true;
  await page.locator('[data-page="network"]').click();
  await expect(page.locator(".network-console")).toHaveClass(/is-online/);
  await expect(page.locator("#network-connection")).toHaveText("Online");
  await expect(page.locator("#network-public-ip")).toHaveText("Unavailable");
});
```

- [ ] **Step 4: Add the narrow-window overflow test**

```js
test("fits the network console at the minimum window size with long values", async () => {
  const windowHandle = await electronApp.browserWindow(page);
  await windowHandle.evaluate((window) => window.setSize(360, 560));
  await page.waitForTimeout(500);
  await page.locator('[data-page="network"]').click();
  await expect(page.locator(".network-console")).toBeVisible();

  await page.evaluate(() => {
    document.querySelector("#network-ipv6").textContent = "2a02:8109:9a3f:1c00:0000:0000:0000:0042";
    document.querySelector("#network-dns").textContent = "1.1.1.1 · 8.8.8.8 · 9.9.9.9 · 149.112.112.112";
    document.querySelector("#network-mac").textContent = "A4:83:E7:2C:91:0B";
  });

  const layout = await page.evaluate(() => {
    const root = document.querySelector(".window");
    const consoleBox = document.querySelector(".network-console").getBoundingClientRect();
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      consoleRight: consoleBox.right,
      viewportWidth: window.innerWidth
    };
  });

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight);
  expect(layout.consoleRight).toBeLessThanOrEqual(layout.viewportWidth);
});
```

- [ ] **Step 5: Run the E2E suite to verify it fails for the right reason**

Run: `npm run test:e2e`
Expected: the new console assertions fail because `.network-console` does not exist; offline/partial tests cannot find it either.

---

### Task 2: Implement the console panel

**Files:**
- Modify: `index.html` (CSS lines ~314–409, markup lines ~1690–1761, refs ~2236–2247, `loadNetworkOverview()` ~2312–2364, media query ~1300)

**Interfaces:**
- Consumes: `window.orbitWindow.network.getOverview()` result fields `connected`, `latencyMs`, `localIp`, `interfaceName`, `localIpv6`, `macAddress`, `dnsServers`, `publicIp`, `checkedAt`.
- Produces: `.network-console` with `is-online` / `is-offline` classes and six `.network-console-row` rows.

- [ ] **Step 1: Replace the grid/card CSS with console styles**

Replace the `.network-grid` through `.network-status` block (keep `.network-status`) with:

```css
.network-console {
  overflow: hidden;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018));
}

.network-console-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.075);
}

.network-console-state {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
}

.network-console-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: #777981;
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.035);
}

.network-console.is-online .network-console-dot {
  background: #8fd39a;
  box-shadow: 0 0 0 4px rgba(143, 211, 154, 0.1);
}

.network-console.is-offline .network-console-dot {
  background: #e1a0a0;
  box-shadow: 0 0 0 4px rgba(225, 160, 160, 0.1);
}

.network-console-connection {
  overflow: hidden;
  color: #d8d9dd;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.network-console-latency {
  flex: 0 0 auto;
  color: #a7d6b1;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.network-console-body {
  display: grid;
}

.network-console-row {
  display: grid;
  grid-template-columns: minmax(78px, 0.36fr) minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  min-width: 0;
  padding: 8px 14px;
}

.network-console-row + .network-console-row {
  border-top: 1px solid rgba(255, 255, 255, 0.055);
}

.network-console-label {
  color: #85878f;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.network-console-value {
  overflow: hidden;
  min-width: 0;
  color: #e3e4e8;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 11px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Remove the `.network-grid` rule from the `@media (max-width: 600px)` block.

- [ ] **Step 2: Replace the card markup with the console markup**

```html
<div class="network-console" aria-live="polite">
  <div class="network-console-head">
    <span class="network-console-state">
      <span class="network-console-dot" aria-hidden="true"></span>
      <span class="network-console-connection" id="network-connection">Checking…</span>
    </span>
    <span class="network-console-latency" id="network-latency">—</span>
  </div>
  <div class="network-console-body">
    <div class="network-console-row"><span class="network-console-label">Adapter</span><span class="network-console-value" id="network-adapter">—</span></div>
    <div class="network-console-row"><span class="network-console-label">Local IPv4</span><span class="network-console-value" id="network-ip">—</span></div>
    <div class="network-console-row"><span class="network-console-label">IPv6</span><span class="network-console-value" id="network-ipv6">—</span></div>
    <div class="network-console-row"><span class="network-console-label">MAC address</span><span class="network-console-value" id="network-mac">—</span></div>
    <div class="network-console-row"><span class="network-console-label">DNS servers</span><span class="network-console-value" id="network-dns">—</span></div>
    <div class="network-console-row"><span class="network-console-label">Public IP</span><span class="network-console-value" id="network-public-ip">Checking…</span></div>
  </div>
</div>
```

- [ ] **Step 3: Update element refs and `loadNetworkOverview()`**

Remove `networkConnectionDetail` and `networkPublicIpDetail`; add `const networkConsole = document.querySelector(".network-console");`.

Loading state: remove both detail writes, set `networkIpv6.textContent = "—"`.

Success state:
```js
networkConsole.classList.toggle("is-online", result.connected);
networkConsole.classList.toggle("is-offline", !result.connected);
networkConnection.textContent = result.connected ? "Online" : "Offline";
networkLatency.textContent = result.latencyMs == null ? "—" : `${result.latencyMs} ms`;
networkIp.textContent = result.localIp || "Unavailable";
networkAdapter.textContent = result.interfaceName || "Unavailable";
networkIpv6.textContent = result.localIpv6 || "Unavailable";
networkMac.textContent = result.macAddress || "Unavailable";
networkDns.textContent = result.dnsServers.length ? result.dnsServers.join(" · ") : "Unavailable";
networkPublicIp.textContent = result.publicIp || "Unavailable";
```

Catch state: set `networkConsole.classList.remove("is-online")`, add `is-offline`, `networkConnection.textContent = "Unavailable"`, latency `—`, IPv6 `Unavailable`, and keep `networkStatus.textContent = error.message || "Network status could not be checked."`.

- [ ] **Step 4: Run the E2E suite**

Run: `npm run test:e2e`
Expected: all tests pass, including the four new assertions.

---

### Task 3: Version, changelog, full verification, build

**Files:**
- Modify: `package.json`, `package-lock.json` (version `1.10.0`)
- Modify: `CHANGELOG.md` (restore the accidentally removed 1.9.0/1.9.1 entries and add 1.10.0)
- Build: `dist/Orbit-Portable-1.10.0.exe`

- [ ] **Step 1: Bump the version**

Run: `npm version 1.10.0 --no-git-tag-version`

- [ ] **Step 2: Fix the changelog and add the entry**

Restore the header and entries below at the top of `CHANGELOG.md`:

```markdown
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
```

- [ ] **Step 3: Run the full test suite**

Run: `npm run test:all`
Expected: syntax check, unit, integration, and E2E all pass.

- [ ] **Step 4: Build the portable EXE**

Run: `npm run build:win`
Expected: `dist/Orbit-Portable-1.10.0.exe` exists.

- [ ] **Step 5: Replace the old build and launch the new one**

Stop the running Orbit process, delete `dist/Orbit-Portable-1.9.1.exe`, and launch `dist/Orbit-Portable-1.10.0.exe`.

```powershell
Get-Process Orbit -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -LiteralPath "dist\Orbit-Portable-1.9.1.exe" -ErrorAction SilentlyContinue
Start-Process -FilePath "dist\Orbit-Portable-1.10.0.exe"
```

Expected: the new build opens on the console Network tab.
