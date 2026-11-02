const DEFAULT_GITHUB_API_URL = "https://api.github.com";

async function fetchNotifications({
  fetchImpl = fetch,
  baseUrl = DEFAULT_GITHUB_API_URL,
  token,
  perPage = 50,
  timeoutMs = 15000
}) {
  const url = new URL("/notifications", baseUrl);
  url.searchParams.set("all", "false");
  url.searchParams.set("per_page", String(perPage));

  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new Error("GitHub is unreachable. Check your internet connection.");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("GitHub rejected the token. Check GITHUB_TOKEN in the .env file.");
    }
    if (response.status === 429) {
      throw new Error("GitHub is rate limiting requests. Please try again later.");
    }
    throw new Error(`GitHub could not load notifications (HTTP ${response.status}).`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("GitHub returned an invalid response.");
  }
  if (!Array.isArray(payload)) {
    throw new Error("GitHub returned an unexpected response.");
  }

  return payload;
}

module.exports = { fetchNotifications, DEFAULT_GITHUB_API_URL };
