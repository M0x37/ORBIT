async function todoRequest({
  fetchImpl = fetch,
  baseUrl,
  apiKey,
  table,
  search,
  options = {},
  timeoutMs = 15000
}) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/rest/v1/${table}${search}`, {
      ...options,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...options.headers
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new Error("Could not reach the To-Do service. Check your internet connection.");
  }

  if (!response.ok) {
    let message = `The To-Do service returned HTTP ${response.status}.`;
    try {
      const payload = await response.json();
      if (payload?.message) message = payload.message;
    } catch {}
    throw new Error(message);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

module.exports = { todoRequest };
