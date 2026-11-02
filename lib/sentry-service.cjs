const { getNextSentryPage, mapSentryIssue } = require("./orbit-shared.js");

const DEFAULT_SENTRY_URL = "https://sentry.io";

async function fetchSentryPages({
  fetchImpl = fetch,
  initialUrl,
  token,
  resourceName,
  allowedOrigin = DEFAULT_SENTRY_URL,
  timeoutMs = 15000
}) {
  const results = [];
  const seenPages = new Set();
  let pageUrl = initialUrl;

  while (pageUrl) {
    if (pageUrl.origin !== allowedOrigin || !pageUrl.pathname.startsWith(initialUrl.pathname)) {
      throw new Error("Sentry returned an invalid page link.");
    }
    if (seenPages.has(pageUrl.href)) {
      throw new Error("Sentry returned a repeated results page.");
    }
    seenPages.add(pageUrl.href);

    let response;
    try {
      response = await fetchImpl(pageUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new Error(
          `Sentry did not respond in time while loading ${resourceName}. Sentry may be experiencing an outage. Check https://status.sentry.io.`
        );
      }
      throw new Error(`Sentry is unreachable while loading ${resourceName}. Check your internet connection.`);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Sentry rejected the token. Organization read permissions are required for all projects.");
      }
      if (response.status === 404) {
        throw new Error("Sentry organization not found. Check the organization slug.");
      }
      if (response.status === 429) {
        throw new Error("Sentry is rate limiting requests. Please try again later.");
      }
      throw new Error(`Sentry could not load ${resourceName} (HTTP ${response.status}).`);
    }

    let pageResults;
    try {
      pageResults = await response.json();
    } catch {
      throw new Error(`Sentry returned an invalid response for ${resourceName}.`);
    }
    if (!Array.isArray(pageResults)) {
      throw new Error(`Sentry returned an unexpected response for ${resourceName}.`);
    }
    results.push(...pageResults);
    pageUrl = getNextSentryPage(response.headers.get("link"), pageUrl);
  }

  return results;
}

async function loadSentryIssues({
  fetchImpl = fetch,
  organization,
  token,
  baseUrl = DEFAULT_SENTRY_URL,
  timeoutMs = 15000
}) {
  const organizationPath = `/api/0/organizations/${encodeURIComponent(organization)}/`;

  const issuesUrl = new URL(`${organizationPath}issues/`, baseUrl);
  issuesUrl.searchParams.set("query", "is:unresolved");
  issuesUrl.searchParams.set("statsPeriod", "14d");
  issuesUrl.searchParams.set("limit", "100");

  const projectsUrl = new URL(`${organizationPath}projects/`, baseUrl);
  projectsUrl.searchParams.set("limit", "100");

  const [issues, projects] = await Promise.all([
    fetchSentryPages({
      fetchImpl,
      initialUrl: issuesUrl,
      token,
      resourceName: "issues",
      allowedOrigin: new URL(baseUrl).origin,
      timeoutMs
    }),
    fetchSentryPages({
      fetchImpl,
      initialUrl: projectsUrl,
      token,
      resourceName: "projects",
      allowedOrigin: new URL(baseUrl).origin,
      timeoutMs
    })
  ]);

  return {
    projectCount: projects.length,
    issues: issues.map(mapSentryIssue)
  };
}

module.exports = { fetchSentryPages, loadSentryIssues, DEFAULT_SENTRY_URL };
