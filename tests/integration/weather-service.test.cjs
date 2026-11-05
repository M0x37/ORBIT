const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchWeather, fetchForecast, DEFAULT_WEATHER_URL, DEFAULT_LOCATION } = require("../../lib/weather-service.cjs");

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body
  };
}

test("fetchWeather builds the Open-Meteo request and rounds the temperature", async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return jsonResponse(200, { current: { temperature_2m: 3.6, weather_code: 2 } });
  };

  const result = await fetchWeather({ fetchImpl });

  assert.deepEqual(result, { temperature: 4, weatherCode: 2 });
  assert.equal(requestedUrl.origin, new URL(DEFAULT_WEATHER_URL).origin);
  assert.equal(requestedUrl.pathname, new URL(DEFAULT_WEATHER_URL).pathname);
  assert.equal(requestedUrl.searchParams.get("latitude"), String(DEFAULT_LOCATION.latitude));
  assert.equal(requestedUrl.searchParams.get("longitude"), String(DEFAULT_LOCATION.longitude));
  assert.equal(requestedUrl.searchParams.get("current"), "temperature_2m,weather_code");
  assert.equal(requestedUrl.searchParams.get("timezone"), "Europe/Berlin");
});

test("fetchWeather accepts a custom base URL and location", async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return jsonResponse(200, { current: { temperature_2m: -1.2, weather_code: 71 } });
  };

  const result = await fetchWeather({
    fetchImpl,
    baseUrl: "http://127.0.0.1:9999/forecast",
    location: { latitude: 1, longitude: 2 }
  });

  assert.deepEqual(result, { temperature: -1, weatherCode: 71 });
  assert.equal(requestedUrl.origin, "http://127.0.0.1:9999");
  assert.equal(requestedUrl.pathname, "/forecast");
  assert.equal(requestedUrl.searchParams.get("latitude"), "1");
  assert.equal(requestedUrl.searchParams.get("longitude"), "2");
});

test("fetchWeather reports network failures", async () => {
  await assert.rejects(
    fetchWeather({ fetchImpl: async () => { throw new TypeError("fetch failed"); } }),
    /unreachable\. Check your internet connection\./
  );
});

test("fetchWeather reports HTTP failures", async () => {
  await assert.rejects(
    fetchWeather({ fetchImpl: async () => jsonResponse(503, {}) }),
    /returned HTTP 503/
  );
});

test("fetchWeather reports invalid JSON", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => { throw new SyntaxError("bad json"); }
  });

  await assert.rejects(fetchWeather({ fetchImpl }), /invalid response/);
});

test("fetchWeather reports malformed payloads", async () => {
  await assert.rejects(
    fetchWeather({ fetchImpl: async () => jsonResponse(200, { current: { temperature_2m: null, weather_code: 2 } }) }),
    /unexpected response/
  );
});

test("fetchForecast requests hourly data and maps the first 24 hours", async () => {
  let requestedUrl;
  const times = Array.from({ length: 26 }, (_, index) => `2026-11-05T${String(index).padStart(2, "0")}:00`);
  const temperatures = times.map((_, index) => index);
  const codes = times.map(() => 2);
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return jsonResponse(200, {
      hourly: { time: times, temperature_2m: temperatures, weather_code: codes }
    });
  };

  const forecast = await fetchForecast({ fetchImpl });

  assert.equal(requestedUrl.searchParams.get("hourly"), "temperature_2m,weather_code");
  assert.equal(requestedUrl.searchParams.get("forecast_hours"), "24");
  assert.equal(requestedUrl.searchParams.get("timezone"), "Europe/Berlin");
  assert.equal(forecast.length, 24);
  assert.deepEqual(forecast[0], {
    time: times[0],
    temperature: 0,
    weatherCode: 2,
    label: "Partly cloudy",
    icon: "partly"
  });
});

test("fetchForecast tolerates missing weather codes", async () => {
  const fetchImpl = async () =>
    jsonResponse(200, {
      hourly: { time: ["2026-11-05T10:00"], temperature_2m: [7.2], weather_code: [null] }
    });

  const forecast = await fetchForecast({ fetchImpl });

  assert.equal(forecast.length, 1);
  assert.equal(forecast[0].weatherCode, 0);
  assert.equal(forecast[0].label, "Clear");
});

test("fetchForecast reports an unexpected payload", async () => {
  await assert.rejects(
    fetchForecast({ fetchImpl: async () => jsonResponse(200, { hourly: {} }) }),
    /unexpected forecast response/
  );
});
