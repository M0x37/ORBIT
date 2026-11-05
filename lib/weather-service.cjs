const { describeWeather, parseWeatherPayload } = require("./orbit-shared.js");

const DEFAULT_WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_LOCATION = { latitude: 50.43333, longitude: 7.95 };

/** Fetch the current temperature and weather code from Open-Meteo. */
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

/** Fetch a simple 24-hour forecast from Open-Meteo. */
async function fetchForecast({
  fetchImpl = fetch,
  baseUrl = DEFAULT_WEATHER_URL,
  location = DEFAULT_LOCATION,
  timeoutMs = 15000
} = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("hourly", "temperature_2m,weather_code");
  url.searchParams.set("timezone", "Europe/Berlin");
  url.searchParams.set("forecast_hours", "24");

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

  if (!payload.hourly || !Array.isArray(payload.hourly.time)) {
    throw new Error("The weather service returned an unexpected forecast response.");
  }

  // Build an array of { time, temperature, weatherCode } for the next 24 hours
  const hours = payload.hourly.time.length;
  const forecast = [];
  for (let i = 0; i < Math.min(hours, 24); i++) {
    const code = payload.hourly.weather_code[i] || 0;
    forecast.push({
      time: payload.hourly.time[i],
      temperature: payload.hourly.temperature_2m[i],
      weatherCode: code,
      label: describeWeather(code).label,
      icon: describeWeather(code).icon
    });
  }

  return forecast;
}

module.exports = { fetchWeather, fetchForecast, DEFAULT_WEATHER_URL, DEFAULT_LOCATION };