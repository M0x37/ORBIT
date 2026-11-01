const { parseWeatherPayload } = require("./orbit-shared.js");

const DEFAULT_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_LOCATION = { latitude: 50.43333, longitude: 7.95 };

async function fetchWeather({
  fetchImpl = fetch,
  baseUrl = DEFAULT_WEATHER_URL,
  location = DEFAULT_LOCATION,
  timeoutMs = 15000
} = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("timezone", "Europe/Berlin");

  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error("The weather service is unreachable. Check your internet connection.");
  }

  if (!response.ok) {
    throw new Error(`The weather service returned HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The weather service returned an invalid response.");
  }

  return parseWeatherPayload(payload);
}

module.exports = { fetchWeather, DEFAULT_WEATHER_URL, DEFAULT_LOCATION };
