const { test, expect, _electron: electron } = require("@playwright/test");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const APP_DIR = path.resolve(__dirname, "..", "..");

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text)
  });
  response.end(text);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
}

function createStubServer() {
  let todos = [];
  let nextId = 1;
  const state = {
    publicIpFail: false,
    notifications: [
      {
        id: "1",
        reason: "review_requested",
        updated_at: "2026-11-02T10:00:00Z",
        subject: { title: "Fix login", type: "PullRequest", url: "https://api.github.com/repos/octo/repo/pulls/7" },
        repository: { full_name: "octo/repo" }
      },
      {
        id: "2",
        reason: "mention",
        updated_at: "2026-11-02T09:00:00Z",
        subject: { title: "Deploy notes", type: "Issue", url: "https://api.github.com/repos/octo/repo/issues/42" },
        repository: { full_name: "octo/repo" }
      }
    ]
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, "http://127.0.0.1");

      if (url.pathname === "/public-ip") {
        if (state.publicIpFail) {
          sendJson(response, 500, { message: "Lookup failed" });
          return;
        }
        sendJson(response, 200, { ip: "203.0.113.42" });
        return;
      }

      if (url.pathname === "/forecast") {
        sendJson(response, 200, { current: { temperature_2m: 7.4, weather_code: 2 } });
        return;
      }

      if (url.pathname === "/notifications") {
        sendJson(response, 200, state.notifications);
        return;
      }

      if (url.pathname === "/rest/v1/todos") {
        if (request.method === "GET") {
          sendJson(response, 200, todos);
          return;
        }

        if (request.method === "POST") {
          const body = await readJson(request);
          const item = {
            id: nextId++,
            title: body.title,
            completed: false,
            created_at: new Date().toISOString()
          };
          todos.unshift(item);
          sendJson(response, 201, [item]);
          return;
        }

        if (request.method === "PATCH") {
          const id = Number(url.searchParams.get("id")?.replace("eq.", ""));
          const body = await readJson(request);
          const item = todos.find((entry) => entry.id === id);
          if (!item) {
            sendJson(response, 404, { message: "Task not found" });
            return;
          }
          item.completed = Boolean(body.completed);
          sendJson(response, 200, [item]);
          return;
        }

        if (request.method === "DELETE") {
          const id = Number(url.searchParams.get("id")?.replace("eq.", ""));
          todos = todos.filter((entry) => entry.id !== id);
          response.writeHead(204);
          response.end();
          return;
        }
      }

      sendJson(response, 404, { message: "Not found" });
    })();
  });

  server.state = state;
  return server;
}

let electronApp;
let page;
let server;
let probeServer;
let userDataDir;

test.beforeEach(async () => {
  server = createStubServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  probeServer = net.createServer((socket) => socket.end());
  await new Promise((resolve) => probeServer.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const probePort = probeServer.address().port;
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-e2e-"));

  electronApp = await electron.launch({
    args: [APP_DIR],
    env: {
      ...process.env,
      ORBIT_E2E: "1",
      ORBIT_NO_ENV: "1",
      ORBIT_TEST_USER_DATA: userDataDir,
      ORBIT_WEATHER_BASE_URL: `http://127.0.0.1:${port}/forecast`,
      ORBIT_TODO_BASE_URL: `http://127.0.0.1:${port}`,
      ORBIT_GITHUB_BASE_URL: `http://127.0.0.1:${port}`,
      ORBIT_NETWORK_PROBE_HOST: "127.0.0.1",
      ORBIT_NETWORK_PROBE_PORT: String(probePort),
      ORBIT_PUBLIC_IP_URL: `http://127.0.0.1:${port}/public-ip`,
      ORBIT_GITHUB_TOKEN: "ghp_e2e_token"
    }
  });

  page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterEach(async () => {
  await electronApp?.close();
  if (probeServer?.listening) await new Promise((resolve) => probeServer.close(resolve));
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await fs.rm(userDataDir, { recursive: true, force: true });
});

test("shows a ticking clock and the stubbed weather", async () => {
  await expect(page).toHaveTitle(/Orbit/);
  await expect(page.locator("#sidebar-clock")).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.locator("#weather-temp")).toHaveText("7°C");
  await expect(page.locator("#weather-label")).toHaveText("Partly cloudy");

  const firstTimestamp = await page.locator("#sidebar-clock").getAttribute("datetime");
  await page.waitForFunction(
    (previous) => document.querySelector("#sidebar-clock").getAttribute("datetime") !== previous,
    firstTimestamp,
    { timeout: 5000 }
  );

  const clock = await page.evaluate(() => {
    const element = document.querySelector("#sidebar-clock");
    const date = new Date(element.getAttribute("datetime"));
    const expected = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return { text: element.textContent, expected };
  });

  expect(clock.text).toBe(clock.expected);
});

test("navigates between Overview, To-Do, Links, Network, and Quick Actions", async () => {
  await page.locator('[data-page="todo"]').click();
  await expect(page.locator("#page-title")).toHaveText("To-Do");
  await expect(page.locator(".todo-section")).toHaveClass(/active/);
  await expect(page.locator(".shortcuts-section")).not.toHaveClass(/active/);

  await page.locator('[data-page="links"]').click();
  await expect(page.locator("#page-title")).toHaveText("Links");
  await expect(page.locator(".links-section")).toHaveClass(/active/);
  await expect(page.locator(".todo-section")).not.toHaveClass(/active/);

  await page.locator('[data-page="network"]').click();
  await expect(page.locator("#page-title")).toHaveText("Network");
  await expect(page.locator(".network-section")).toHaveClass(/active/);
  await expect(page.locator("#network-connection")).toHaveText("Online");
  await expect(page.locator("#network-ip")).toHaveText("127.0.0.1");
  await expect(page.locator("#network-adapter")).not.toHaveText("—");
  await expect(page.locator("#network-mac")).not.toHaveText("—");
  await expect(page.locator("#network-dns")).not.toHaveText("—");
  await expect(page.locator("#network-public-ip")).toHaveText("203.0.113.42");
  await expect(page.locator(".network-console")).toBeVisible();
  await expect(page.locator(".network-console-row")).toHaveCount(6);
  await expect(page.locator(".network-card")).toHaveCount(0);
  await expect(page.locator(".network-console")).toHaveClass(/is-online/);
  await expect(page.locator("#network-latency")).toHaveText(/\d+ ms/);
  await expect(page.locator("#network-ipv6")).not.toHaveText("—");

  await page.locator('[data-page="overview"]').click();
  await expect(page.locator("#page-title")).toHaveText("Overview");
  await expect(page.locator(".shortcuts-section")).toHaveClass(/active/);
  await expect(page.locator(".sentry-section")).toHaveClass(/active/);

  await expect(page.locator('.sidebar-item[data-page="quick-actions"]')).toHaveCount(0);
  await page.locator('.control-settings[data-page="quick-actions"]').click();
  await expect(page.locator("#page-title")).toHaveText("Quick Actions");
  await expect(page.locator(".quick-actions-section")).toHaveClass(/active/);

  const quickActions = await page.evaluate(() => ({
    getState: typeof window.orbitWindow.quickActions.getState,
    setOutputMuted: typeof window.orbitWindow.quickActions.setOutputMuted,
    setMicrophoneMuted: typeof window.orbitWindow.quickActions.setMicrophoneMuted,
    setVolume: typeof window.orbitWindow.quickActions.setVolume,
    onStateChange: typeof window.orbitWindow.quickActions.onStateChange
  }));
  expect(quickActions).toEqual({
    getState: "function",
    setOutputMuted: "function",
    setMicrophoneMuted: "function",
    setVolume: "function",
    onStateChange: "function"
  });

  await expect(page.locator("#quick-actions-heading")).toHaveText("Audio control");
  await expect(page.locator(".audio-console")).toBeVisible();
  await expect(page.locator("#audio-current-name")).toBeVisible();
  await expect(page.locator("#audio-switch")).toBeVisible();
  await expect(page.locator("#audio-output-mute")).toBeVisible();
  await expect(page.locator("#audio-mic-mute")).toBeVisible();
  await expect(page.locator('#audio-volume-slider[type="range"]')).toBeVisible();
  await expect(page.locator("#audio-volume-value")).toBeVisible();
  await expect(page.locator("#headset-device")).toBeVisible();
  await expect(page.locator("#monitor-device")).toBeVisible();
  await expect(page.locator("#save-audio-devices")).toBeVisible();
});

test("shows the network console offline state when the probe is unreachable", async () => {
  await new Promise((resolve) => probeServer.close(resolve));
  await page.locator('[data-page="network"]').click();
  await expect(page.locator(".network-console")).toHaveClass(/is-offline/);
  await expect(page.locator("#network-connection")).toHaveText("Offline");
  await expect(page.locator("#network-latency")).toHaveText("—");
  await expect(page.locator("#network-public-ip")).toHaveText("203.0.113.42");
  await expect(page.locator("#network-adapter")).not.toHaveText("—");
  await expect(page.locator("#network-ip")).not.toHaveText("—");
  await expect(page.locator("#network-mac")).not.toHaveText("—");
  await expect(page.locator("#network-dns")).not.toHaveText("—");
  await expect(page.locator("#network-status")).toHaveText(/Updated \d{2}:\d{2}|Checked at \d{2}:\d{2}/);
});

test("keeps the network console online when only the public IP lookup fails", async () => {
  server.state.publicIpFail = true;
  await page.locator('[data-page="network"]').click();
  await expect(page.locator(".network-console")).toHaveClass(/is-online/);
  await expect(page.locator("#network-connection")).toHaveText("Online");
  await expect(page.locator("#network-public-ip")).toHaveText("Unavailable");
});

test("fits the network console at the minimum window size with long values", async () => {
  const windowHandle = await electronApp.browserWindow(page);
  await windowHandle.evaluate((window) => window.setSize(360, 560));
  await page.waitForFunction(() => window.innerWidth <= 420);
  await page.locator('[data-page="network"]').click();
  await expect(page.locator(".network-console")).toHaveClass(/is-online/);

  await page.evaluate(() => {
    document.querySelector("#network-ip").textContent = "192.168.178.123";
    document.querySelector("#network-mac").textContent = "A4:83:E7:2C:91:0B";
    document.querySelector("#network-ipv6").textContent = "2a02:8109:9a3f:1c00:0000:0000:0000:0042";
    document.querySelector("#network-dns").textContent = "1.1.1.1 · 8.8.8.8 · 9.9.9.9 · 149.112.112.112";
  });

  const layout = await page.evaluate(() => {
    const content = document.querySelector(".page-content");
    const consoleBox = document.querySelector(".network-console").getBoundingClientRect();
    const metrics = (selector) => {
      const element = document.querySelector(selector);
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        textOverflow: getComputedStyle(element).textOverflow
      };
    };
    return {
      contentScrollWidth: content.scrollWidth,
      contentClientWidth: content.clientWidth,
      contentScrollHeight: content.scrollHeight,
      contentClientHeight: content.clientHeight,
      consoleRight: consoleBox.right,
      viewportWidth: window.innerWidth,
      ip: metrics("#network-ip"),
      mac: metrics("#network-mac"),
      ipv6: metrics("#network-ipv6"),
      dns: metrics("#network-dns")
    };
  });

  expect(layout.contentScrollWidth).toBeLessThanOrEqual(layout.contentClientWidth);
  expect(layout.contentScrollHeight).toBeLessThanOrEqual(layout.contentClientHeight);
  expect(layout.consoleRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.ip.scrollWidth).toBeLessThanOrEqual(layout.ip.clientWidth + 1);
  expect(layout.mac.scrollWidth).toBeLessThanOrEqual(layout.mac.clientWidth + 1);
  expect(layout.ipv6.scrollWidth).toBeGreaterThan(layout.ipv6.clientWidth);
  expect(layout.ipv6.textOverflow).toBe("ellipsis");
  expect(layout.dns.scrollWidth).toBeGreaterThan(layout.dns.clientWidth);
  expect(layout.dns.textOverflow).toBe("ellipsis");
});

test("navigates to Inbox and renders unread notifications", async () => {
  server.state.notifications = [
    {
      id: "1",
      reason: "review_requested",
      updated_at: "2026-11-02T10:00:00Z",
      subject: { title: "Fix login", type: "PullRequest", url: "https://api.github.com/repos/octo/repo/pulls/7" },
      repository: { full_name: "octo/repo" }
    },
    {
      id: "2",
      reason: "mention",
      updated_at: "2026-11-02T09:00:00Z",
      subject: { title: "Deploy notes", type: "Issue", url: "https://api.github.com/repos/octo/repo/issues/42" },
      repository: { full_name: "octo/repo" }
    }
  ];
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

test("adds, completes, and deletes a To-Do through the real IPC layer", async () => {
  await page.locator('[data-page="todo"]').click();
  await expect(page.locator("#page-title")).toHaveText("To-Do");
  await expect(page.locator("#todo-summary")).toHaveText("0 OPEN · 0 DONE");
  await expect(page.locator("#todo-input")).toHaveAccessibleName("New task");

  await page.locator("#todo-input").fill("Write tests");
  await page.locator("#todo-add").click();

  await expect(page.locator(".todo-item")).toHaveCount(1);
  await expect(page.locator(".todo-item")).toContainText("Write tests");
  await expect(page.locator("#todo-summary")).toHaveText("1 OPEN · 0 DONE");

  await page.locator(".todo-checkbox").check();
  await expect(page.locator(".todo-item")).toHaveClass(/is-done/);
  await expect(page.locator("#todo-summary")).toHaveText("0 OPEN · 1 DONE");

  await page.locator(".todo-delete").click();
  await expect(page.locator(".todo-item")).toHaveCount(0);
  await expect(page.locator("#todo-empty")).toBeVisible();
  await expect(page.locator("#todo-summary")).toHaveText("0 OPEN · 0 DONE");
});

test("fits the minimum window size without scrolling", async () => {
  server.state.notifications = [
    {
      id: "1",
      reason: "review_requested",
      updated_at: "2026-11-02T10:00:00Z",
      subject: { title: "Fix login", type: "PullRequest", url: "https://api.github.com/repos/octo/repo/pulls/7" },
      repository: { full_name: "octo/repo" }
    }
  ];
  const windowHandle = await electronApp.browserWindow(page);
  await windowHandle.evaluate((window) => window.setSize(360, 560));
  await page.waitForTimeout(500);

  await expect(page.locator(".sidebar-widget")).toBeVisible();

  await page.locator('[data-page="inbox"]').click();
  await expect(page.locator(".inbox-item")).toHaveCount(1);

  await page.locator('.control-settings[data-page="quick-actions"]').click();
  await expect(page.locator("#page-title")).toHaveText("Quick Actions");
  await expect(page.locator(".audio-console")).toBeVisible();

  const overflow = await page.evaluate(() => {
    const root = document.querySelector(".window");
    const content = document.querySelector(".page-content");
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      contentScrollWidth: content.scrollWidth,
      contentClientWidth: content.clientWidth,
      contentScrollHeight: content.scrollHeight,
      contentClientHeight: content.clientHeight
    };
  });

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight);
  expect(overflow.contentScrollWidth).toBeLessThanOrEqual(overflow.contentClientWidth);
  expect(overflow.contentScrollHeight).toBeLessThanOrEqual(overflow.contentClientHeight);
});
