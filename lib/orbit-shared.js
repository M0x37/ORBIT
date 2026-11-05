(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.OrbitShared = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

  // --- Weather -------------------------------------------------------------

  function describeWeather(code) {
    if (code === 0) return { icon: "clear", label: "Clear" };
    if (code === 1) return { icon: "partly", label: "Mainly clear" };
    if (code === 2) return { icon: "partly", label: "Partly cloudy" };
    if (code === 3) return { icon: "cloudy", label: "Overcast" };
    if (code === 45 || code === 48) return { icon: "fog", label: "Fog" };
    if (code >= 51 && code <= 57) return { icon: "drizzle", label: "Drizzle" };
    if (code >= 61 && code <= 67) return { icon: "rain", label: "Rain" };
    if (code >= 71 && code <= 77) return { icon: "snow", label: "Snow" };
    if (code >= 80 && code <= 82) return { icon: "rain", label: "Rain showers" };
    if (code === 85 || code === 86) return { icon: "snow", label: "Snow showers" };
    if (code >= 95 && code <= 99) return { icon: "storm", label: "Thunderstorm" };
    return { icon: "cloudy", label: "Unknown" };
  }

  // --- Display formatting --------------------------------------------------

  function formatClock(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "--:--";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function formatTemperature(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return `${Math.round(value)}°C`;
  }

  // --- To-Do ---------------------------------------------------------------

  function formatTodoSummary(items) {
    const list = Array.isArray(items) ? items : [];
    const open = list.filter((item) => !item.completed).length;
    const done = list.length - open;
    return `${open} OPEN · ${done} DONE`;
  }

  function ipcErrorMessage(error, fallback) {
    const message = String(error?.message || "").replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
    return message || fallback;
  }

  // --- Sentry --------------------------------------------------------------

  function formatSentryDetail(issue) {
    if (!issue || typeof issue !== "object") return "";
    const lastSeen = issue.lastSeen ? new Date(issue.lastSeen).toLocaleString("en-US") : "";
    const count = issue.count != null ? `${issue.count} Events` : "";
    return [issue.project, issue.culprit, count, lastSeen].filter(Boolean).join(" · ");
  }

  // --- To-Do validation ----------------------------------------------------

  function normalizeTodoTitle(title) {
    if (typeof title !== "string") throw new Error("Please enter a task.");
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Please enter a task.");
    if (trimmed.length > 500) throw new Error("Tasks can be at most 500 characters long.");
    return trimmed;
  }

  // --- Weather payload -----------------------------------------------------

  function parseWeatherPayload(payload) {
    const temperature = payload?.current?.temperature_2m;
    const weatherCode = payload?.current?.weather_code;
    if (typeof temperature !== "number" || !Number.isFinite(temperature) || !Number.isInteger(weatherCode)) {
      throw new Error("The weather service returned an unexpected response.");
    }
    return { temperature: Math.round(temperature), weatherCode };
  }

  // --- .env parsing --------------------------------------------------------

  function parseEnvFile(text, keys) {
    const file = String(text ?? "").replace(/^\uFEFF/, "");
    const wanted = new Set(Array.isArray(keys) ? keys : []);
    const values = {};
    for (const line of file.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match || !wanted.has(match[1])) continue;
      let value = match[2];
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      values[match[1]] = value;
    }
    return values;
  }

  const SENTRY_ENV_KEYS = ["SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_AUTH_TOKEN"];

  function parseSentryEnvFile(text) {
    return parseEnvFile(text, SENTRY_ENV_KEYS);
  }

  // --- GitHub --------------------------------------------------------------

  function validateGithubToken(token) {
    const value = typeof token === "string" ? token.trim() : "";
    if (value.length < 8 || value.length > 256 || /\s/.test(value)) {
      throw new Error("The GitHub token in the .env file is invalid.");
    }
    return value;
  }

  const GITHUB_NOTIFICATIONS_URL = "https://github.com/notifications";

  function githubNotificationUrl(notification) {
    const repository = notification?.repository?.full_name;
    const subject = notification?.subject;
    if (typeof repository !== "string" || !/^[^/]+\/[^/]+$/.test(repository)) {
      return GITHUB_NOTIFICATIONS_URL;
    }
    if (!subject || typeof subject.url !== "string") return GITHUB_NOTIFICATIONS_URL;

    let path;
    try {
      path = new URL(subject.url).pathname;
    } catch {
      return GITHUB_NOTIFICATIONS_URL;
    }

    const segment = path.split("/").filter(Boolean).pop() ?? "";
    if (subject.type === "Issue" || subject.type === "PullRequest") {
      return /^\d+$/.test(segment) ? `https://github.com/${repository}/issues/${segment}` : GITHUB_NOTIFICATIONS_URL;
    }
    if (subject.type === "Discussion") {
      return /^\d+$/.test(segment) ? `https://github.com/${repository}/discussions/${segment}` : GITHUB_NOTIFICATIONS_URL;
    }
    if (subject.type === "Commit") {
      return /^[0-9a-f]{4,40}$/i.test(segment)
        ? `https://github.com/${repository}/commit/${segment}`
        : GITHUB_NOTIFICATIONS_URL;
    }
    if (subject.type === "Release") {
      return `https://github.com/${repository}/releases`;
    }
    return GITHUB_NOTIFICATIONS_URL;
  }

  function mapGithubNotification(notification) {
    return {
      id: String(notification?.id ?? ""),
      title: String(notification?.subject?.title ?? "Untitled notification"),
      repository: String(notification?.repository?.full_name ?? "Unknown repository"),
      reason: String(notification?.reason ?? ""),
      type: String(notification?.subject?.type ?? ""),
      updatedAt: String(notification?.updated_at ?? ""),
      url: githubNotificationUrl(notification)
    };
  }

  function formatRelativeTime(value, now = new Date()) {
    if (value == null || value === "") return "";
    const date = new Date(value);
    const reference = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime()) || Number.isNaN(reference.getTime())) return "";

    const minutes = Math.floor((reference.getTime() - date.getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  // --- Sentry validation and pagination ------------------------------------

  function validateSentrySetup(input, options = {}) {
    const requireToken = options.requireToken !== false;
    const organization = typeof input?.organization === "string" ? input.organization.trim() : "";
    const project = typeof input?.project === "string" ? input.project.trim() : "";
    const token = typeof input?.token === "string" ? input.token : "";

    if (!SLUG_PATTERN.test(organization)) throw new Error("The Sentry organization slug is invalid.");
    if (!SLUG_PATTERN.test(project)) throw new Error("The Sentry project slug is invalid.");
    if (requireToken || token.length > 0) {
      if (token.length < 8 || token.length > 256 || /\s/.test(token)) {
        throw new Error("The Sentry API token is invalid.");
      }
    }

    return { organization, project, token };
  }

  function getNextSentryPage(linkHeader, currentUrl) {
    if (!linkHeader) return null;

    const nextLink = linkHeader
      .split(/,\s*(?=<)/)
      .find((link) => /;\s*rel="?next"?/.test(link));
    if (!nextLink || !/;\s*results="?true"?/.test(nextLink)) return null;

    const match = nextLink.match(/<([^>]+)>/);
    if (!match) throw new Error("Sentry returned an invalid page link.");
    return new URL(match[1], currentUrl);
  }

  function mapSentryIssue(issue) {
    return {
      id: String(issue.id ?? ""),
      title: String(issue.title ?? "Untitled error"),
      culprit: String(issue.culprit ?? ""),
      project: String(issue.project?.name ?? issue.project?.slug ?? "Unknown project"),
      level: String(issue.level ?? "error"),
      status: String(issue.status ?? "unknown"),
      count: String(issue.count ?? "0"),
      lastSeen: String(issue.lastSeen ?? "")
    };
  }

  return {
    describeWeather,
    formatClock,
    formatTemperature,
    formatTodoSummary,
    ipcErrorMessage,
    formatSentryDetail,
    normalizeTodoTitle,
    parseWeatherPayload,
    parseEnvFile,
    parseSentryEnvFile,
    validateGithubToken,
    githubNotificationUrl,
    mapGithubNotification,
    formatRelativeTime,
    validateSentrySetup,
    getNextSentryPage,
    mapSentryIssue
  };
});
