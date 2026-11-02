const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchSentryPages, loadSentryIssues } = require("../../lib/sentry-service.cjs");

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body
  };
}

const INITIAL_URL = new URL("https://sentry.io/api/0/organizations/my-org/issues/?query=is%3Aunresolved");

test("fetchSentryPages returns a single page", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: url.href, options });
    return jsonResponse(200, [{ id: 1 }]);
  };

  const results = await fetchSentryPages({
    fetchImpl,
    initialUrl: INITIAL_URL,
    token: "abcdefgh",
    resourceName: "issues"
  });

  assert.deepEqual(results, [{ id: 1 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, "Bearer abcdefgh");
  assert.equal(calls[0].options.headers.Accept, "application/json");
});

test("fetchSentryPages follows rel=next links", async () => {
  const nextUrl = "https://sentry.io/api/0/organizations/my-org/issues/?cursor=page2";
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    if (call === 1) {
      return jsonResponse(200, [{ id: 1 }], {
        link: `<${nextUrl}>; rel="next"; results="true"; cursor="page2"`
      });
    }
    return jsonResponse(200, [{ id: 2 }]);
  };

  const results = await fetchSentryPages({
    fetchImpl,
    initialUrl: INITIAL_URL,
    token: "abcdefgh",
    resourceName: "issues"
  });

  assert.deepEqual(results, [{ id: 1 }, { id: 2 }]);
});

test("fetchSentryPages rejects repeated pages", async () => {
  const fetchImpl = async () =>
    jsonResponse(200, [{ id: 1 }], {
      link: `<${INITIAL_URL.href}>; rel="next"; results="true"`
    });

  await assert.rejects(
    fetchSentryPages({
      fetchImpl,
      initialUrl: INITIAL_URL,
      token: "abcdefgh",
      resourceName: "issues"
    }),
    /repeated results page/
  );
});

test("fetchSentryPages rejects foreign origins", async () => {
  const fetchImpl = async () =>
    jsonResponse(200, [{ id: 1 }], {
      link: '<https://evil.example/api/0/organizations/my-org/issues/>; rel="next"; results="true"'
    });

  await assert.rejects(
    fetchSentryPages({
      fetchImpl,
      initialUrl: INITIAL_URL,
      token: "abcdefgh",
      resourceName: "issues"
    }),
    /invalid page link/
  );
});

test("fetchSentryPages maps auth, missing, and rate-limit errors", async () => {
  const cases = [
    [401, /rejected the token/],
    [403, /rejected the token/],
    [404, /organization not found/],
    [429, /rate limiting/],
    [500, /could not load issues \(HTTP 500\)/]
  ];

  for (const [status, pattern] of cases) {
    await assert.rejects(
      fetchSentryPages({
        fetchImpl: async () => jsonResponse(status, {}),
        initialUrl: INITIAL_URL,
        token: "abcdefgh",
        resourceName: "issues"
      }),
      pattern
    );
  }
});

test("fetchSentryPages maps network and payload failures", async () => {
  await assert.rejects(
    fetchSentryPages({
      fetchImpl: async () => { throw new TypeError("fetch failed"); },
      initialUrl: INITIAL_URL,
      token: "abcdefgh",
      resourceName: "issues"
    }),
    /unreachable while loading issues/
  );

  await assert.rejects(
    fetchSentryPages({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => { throw new SyntaxError("bad json"); }
      }),
      initialUrl: INITIAL_URL,
      token: "abcdefgh",
      resourceName: "issues"
    }),
    /invalid response for issues/
  );

  await assert.rejects(
    fetchSentryPages({
      fetchImpl: async () => jsonResponse(200, { not: "an array" }),
      initialUrl: INITIAL_URL,
      token: "abcdefgh",
      resourceName: "issues"
    }),
    /unexpected response for issues/
  );
});

test("fetchSentryPages explains timeouts as a possible Sentry outage", async () => {
  for (const name of ["TimeoutError", "AbortError"]) {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = name;

    await assert.rejects(
      fetchSentryPages({
        fetchImpl: async () => {
          throw timeout;
        },
        initialUrl: INITIAL_URL,
        token: "abcdefgh",
        resourceName: "issues"
      }),
      (error) => {
        assert.match(error.message, /did not respond in time while loading issues/);
        assert.match(error.message, /https:\/\/status\.sentry\.io/);
        return true;
      }
    );
  }
});

test("loadSentryIssues queries issues and projects and maps the result", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url.toString());
    const path = new URL(url).pathname;
    if (path.endsWith("/issues/")) {
      return jsonResponse(200, [
        { id: 7, title: "Boom", culprit: "main.cjs", project: { name: "Orbit" }, count: 3, level: "error", status: "unresolved" }
      ]);
    }
    if (path.endsWith("/projects/")) {
      return jsonResponse(200, [{ id: 1 }, { id: 2 }]);
    }
    throw new Error(`unexpected path ${path}`);
  };

  const result = await loadSentryIssues({
    fetchImpl,
    organization: "my org",
    token: "abcdefgh"
  });

  assert.equal(result.projectCount, 2);
  assert.deepEqual(result.issues, [
    {
      id: "7",
      title: "Boom",
      culprit: "main.cjs",
      project: "Orbit",
      level: "error",
      status: "unresolved",
      count: "3",
      lastSeen: ""
    }
  ]);

  const issuesUrl = new URL(calls.find((call) => call.includes("/issues/")));
  assert.equal(issuesUrl.pathname, "/api/0/organizations/my%20org/issues/");
  assert.equal(issuesUrl.searchParams.get("query"), "is:unresolved");
  assert.equal(issuesUrl.searchParams.get("statsPeriod"), "14d");
  assert.equal(issuesUrl.searchParams.get("limit"), "100");

  const projectsUrl = new URL(calls.find((call) => call.includes("/projects/")));
  assert.equal(projectsUrl.pathname, "/api/0/organizations/my%20org/projects/");
  assert.equal(projectsUrl.searchParams.get("limit"), "100");
});
