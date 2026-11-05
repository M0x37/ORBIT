const test = require("node:test");
const assert = require("node:assert/strict");
const shared = require("../../lib/orbit-shared.js");

test("describeWeather maps every WMO group", () => {
  const cases = [
    [0, "clear", "Clear"],
    [1, "partly", "Mainly clear"],
    [2, "partly", "Partly cloudy"],
    [3, "cloudy", "Overcast"],
    [45, "fog", "Fog"],
    [48, "fog", "Fog"],
    [51, "drizzle", "Drizzle"],
    [57, "drizzle", "Drizzle"],
    [61, "rain", "Rain"],
    [67, "rain", "Rain"],
    [71, "snow", "Snow"],
    [77, "snow", "Snow"],
    [80, "rain", "Rain showers"],
    [82, "rain", "Rain showers"],
    [85, "snow", "Snow showers"],
    [86, "snow", "Snow showers"],
    [95, "storm", "Thunderstorm"],
    [99, "storm", "Thunderstorm"]
  ];

  for (const [code, icon, label] of cases) {
    assert.deepEqual(shared.describeWeather(code), { icon, label }, `code ${code}`);
  }

  assert.deepEqual(shared.describeWeather(123), { icon: "cloudy", label: "Unknown" });
});

test("formatClock renders 24h HH:MM", () => {
  assert.equal(shared.formatClock(new Date(2026, 0, 2, 9, 5)), "09:05");
  assert.equal(shared.formatClock(new Date(2026, 0, 2, 23, 59)), "23:59");
  assert.equal(shared.formatClock(new Date(2026, 0, 2, 0, 0)), "00:00");
});

test("formatClock handles invalid input", () => {
  assert.equal(shared.formatClock(new Date("nope")), "--:--");
  assert.equal(shared.formatClock(null), "--:--");
  assert.equal(shared.formatClock("09:05"), "--:--");
});

test("formatTemperature rounds and validates", () => {
  assert.equal(shared.formatTemperature(3), "3°C");
  assert.equal(shared.formatTemperature(3.4), "3°C");
  assert.equal(shared.formatTemperature(-2.6), "-3°C");
  assert.equal(shared.formatTemperature(Number.NaN), "—");
  assert.equal(shared.formatTemperature("3"), "—");
  assert.equal(shared.formatTemperature(null), "—");
});

test("formatTodoSummary counts open and done items", () => {
  assert.equal(shared.formatTodoSummary([]), "0 OPEN · 0 DONE");
  assert.equal(
    shared.formatTodoSummary([{ completed: false }, { completed: true }, { completed: true }]),
    "1 OPEN · 2 DONE"
  );
  assert.equal(shared.formatTodoSummary(null), "0 OPEN · 0 DONE");
});

test("ipcErrorMessage strips the Electron IPC prefix", () => {
  const wrapped = new Error("Error invoking remote method 'todo:create': Error: Please enter a task.");
  assert.equal(shared.ipcErrorMessage(wrapped, "fallback"), "Please enter a task.");
  assert.equal(shared.ipcErrorMessage(new Error("Plain failure"), "fallback"), "Plain failure");
  assert.equal(shared.ipcErrorMessage(null, "fallback"), "fallback");
  assert.equal(shared.ipcErrorMessage(new Error(""), "fallback"), "fallback");
});

test("formatSentryDetail joins available fields", () => {
  const detail = shared.formatSentryDetail({
    project: "Orbit",
    culprit: "app.js in run",
    count: "5",
    lastSeen: "2026-11-01T12:00:00Z"
  });

  assert.match(detail, /^Orbit · app\.js in run · 5 Events · /);
  assert.equal(shared.formatSentryDetail({}), "");
  assert.equal(shared.formatSentryDetail({ project: "Orbit", count: 0 }), "Orbit · 0 Events");
  assert.equal(shared.formatSentryDetail(null), "");
});

test("normalizeTodoTitle trims and validates", () => {
  assert.equal(shared.normalizeTodoTitle("  Buy milk  "), "Buy milk");
  assert.equal(shared.normalizeTodoTitle("a".repeat(500)), "a".repeat(500));

  assert.throws(() => shared.normalizeTodoTitle(""), /Please enter a task\./);
  assert.throws(() => shared.normalizeTodoTitle("   "), /Please enter a task\./);
  assert.throws(() => shared.normalizeTodoTitle(null), /Please enter a task\./);
  assert.throws(() => shared.normalizeTodoTitle(42), /Please enter a task\./);
  assert.throws(() => shared.normalizeTodoTitle("a".repeat(501)), /at most 500 characters/);
});

test("parseWeatherPayload validates and rounds", () => {
  assert.deepEqual(
    shared.parseWeatherPayload({ current: { temperature_2m: 3.6, weather_code: 2 } }),
    { temperature: 4, weatherCode: 2 }
  );

  assert.throws(() => shared.parseWeatherPayload({}), /unexpected response/);
  assert.throws(
    () => shared.parseWeatherPayload({ current: { temperature_2m: "3", weather_code: 2 } }),
    /unexpected response/
  );
  assert.throws(
    () => shared.parseWeatherPayload({ current: { temperature_2m: 3, weather_code: 2.5 } }),
    /unexpected response/
  );
});

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

test("parseSentryEnvFile parses the supported formats", () => {
  const values = shared.parseSentryEnvFile(
    [
      "\uFEFF# comment",
      "SENTRY_ORG=my-org",
      "export SENTRY_PROJECT='my-project'",
      'SENTRY_AUTH_TOKEN="abcdefgh"',
      "IGNORED=value"
    ].join("\r\n")
  );

  assert.deepEqual(values, {
    SENTRY_ORG: "my-org",
    SENTRY_PROJECT: "my-project",
    SENTRY_AUTH_TOKEN: "abcdefgh"
  });
});

test("parseSentryEnvFile returns only provided keys", () => {
  assert.deepEqual(shared.parseSentryEnvFile("SENTRY_ORG=only-org"), { SENTRY_ORG: "only-org" });
  assert.deepEqual(shared.parseSentryEnvFile(""), {});
  assert.deepEqual(shared.parseSentryEnvFile(null), {});
});

test("validateSentrySetup validates slugs and tokens", () => {
  assert.deepEqual(
    shared.validateSentrySetup({ organization: " my-org ", project: "my-project", token: "abcdefgh" }),
    { organization: "my-org", project: "my-project", token: "abcdefgh" }
  );

  assert.throws(
    () => shared.validateSentrySetup({ organization: "bad org", project: "p", token: "abcdefgh" }),
    /organization slug is invalid/
  );
  assert.throws(
    () => shared.validateSentrySetup({ organization: "o", project: "bad/project", token: "abcdefgh" }),
    /project slug is invalid/
  );
  assert.throws(
    () => shared.validateSentrySetup({ organization: "o", project: "p", token: "short" }),
    /API token is invalid/
  );
  assert.throws(
    () => shared.validateSentrySetup({ organization: "o", project: "p", token: "abc defgh" }),
    /API token is invalid/
  );
});

test("validateSentrySetup can reuse a stored token", () => {
  assert.deepEqual(
    shared.validateSentrySetup({ organization: "o", project: "p", token: "" }, { requireToken: false }),
    { organization: "o", project: "p", token: "" }
  );
  assert.throws(
    () => shared.validateSentrySetup({ organization: "o", project: "p", token: "" }),
    /API token is invalid/
  );
});

test("getNextSentryPage reads rel=next with results=true", () => {
  const current = "https://sentry.io/api/0/organizations/my-org/issues/?query=is%3Aunresolved";
  const header =
    '<https://sentry.io/api/0/organizations/my-org/issues/?cursor=abc>; rel="next"; results="true"; cursor="abc"';

  assert.equal(shared.getNextSentryPage(null, current), null);
  assert.equal(shared.getNextSentryPage('<>; rel="prev"; results="false"', current), null);
  assert.equal(shared.getNextSentryPage('<>; rel="next"; results="false"', current), null);
  assert.throws(() => shared.getNextSentryPage("; rel=next; results=true", current), /invalid page link/);

  const next = shared.getNextSentryPage(header, current);
  assert.ok(next instanceof URL);
  assert.equal(next.searchParams.get("cursor"), "abc");
});

test("getNextSentryPage throws on an invalid next link", () => {
  const current = "https://sentry.io/api/0/organizations/my-org/issues/";
  const header = 'not-a-link; rel="next"; results="true"';
  assert.throws(() => shared.getNextSentryPage(header, current), /invalid page link/);
});

test("mapSentryIssue fills defaults", () => {
  assert.deepEqual(shared.mapSentryIssue({}), {
    id: "",
    title: "Untitled error",
    culprit: "",
    project: "Unknown project",
    level: "error",
    status: "unknown",
    count: "0",
    lastSeen: ""
  });

  assert.deepEqual(
    shared.mapSentryIssue({
      id: 12,
      title: "Boom",
      culprit: "main.cjs",
      project: { name: "Orbit" },
      level: "fatal",
      status: "unresolved",
      count: 7,
      lastSeen: "2026-11-01T00:00:00Z"
    }),
    {
      id: "12",
      title: "Boom",
      culprit: "main.cjs",
      project: "Orbit",
      level: "fatal",
      status: "unresolved",
      count: "7",
      lastSeen: "2026-11-01T00:00:00Z"
    }
  );
});
