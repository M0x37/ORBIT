const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchNotifications, DEFAULT_GITHUB_API_URL } = require("../../lib/github-service.cjs");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

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
    fetchImpl: async (url) => {
      calls.push(url.href);
      return jsonResponse(200, []);
    },
    baseUrl: "http://127.0.0.1:9",
    token: "ghp_abcdefgh"
  });

  assert.equal(new URL(calls[0]).origin, "http://127.0.0.1:9");
});

test("fetchNotifications maps HTTP errors", async () => {
  const cases = [
    [401, /rejected the token/],
    [403, /rejected the token/],
    [429, /rate limiting/],
    [500, /HTTP 500/]
  ];

  for (const [status, pattern] of cases) {
    await assert.rejects(
      fetchNotifications({ fetchImpl: async () => jsonResponse(status, {}), token: "ghp_abcdefgh" }),
      pattern
    );
  }
});

test("fetchNotifications maps network and payload failures", async () => {
  await assert.rejects(
    fetchNotifications({
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
      token: "ghp_abcdefgh"
    }),
    /unreachable/
  );

  await assert.rejects(
    fetchNotifications({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("bad json");
        }
      }),
      token: "ghp_abcdefgh"
    }),
    /invalid response/
  );

  await assert.rejects(
    fetchNotifications({
      fetchImpl: async () => jsonResponse(200, { not: "an array" }),
      token: "ghp_abcdefgh"
    }),
    /unexpected response/
  );
});
