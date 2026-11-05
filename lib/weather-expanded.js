// Expanded weather view (scoped to avoid clashing with the inline script).
(function () {
  const WEATHER_ICONS = {
    clear: '<circle cx="10" cy="10" r="3.5"></circle><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"></path>',
    partly: '<circle cx="7" cy="7.5" r="3"></circle><path d="M7 2.5v1M2 7.5h1M3.5 4l.7.7M10.5 4l-.7.7"></path><path d="M8.5 16h6a2.5 2.5 0 0 0 .2-5 4 4 0 0 0-7.7-.8A2.9 2.9 0 0 0 8.5 16Z"></path>',
    cloudy: '<path d="M6 16h8a3 3 0 0 0 .3-6 5 5 0 0 0-9.6-1A3.5 3.5 0 0 0 6 16Z"></path>',
    fog: '<path d="M5 8h10M4 11h12M5 14h10"></path>',
    drizzle: '<path d="M6 12h8a3 3 0 0 0 .3-6 5 5 0 0 0-9.6-1A3.5 3.5 0 0 0 6 12Z"></path><path d="M7 15v1M10 15v1M13 15v1"></path>',
    rain: '<path d="M6 11h8a3 3 0 0 0 .3-6 5 5 0 0 0-9.6-1A3.5 3.5 0 0 0 6 11Z"></path><path d="M7 14l-1 3M10.5 14l-1 3M14 14l-1 3"></path>',
    snow: '<path d="M6 11h8a3 3 0 0 0 .3-6 5 5 0 0 0-9.6-1A3.5 3.5 0 0 0 6 11Z"></path><path d="M7 14.5v2M7 16.5h.01M11 14.5v2M11 16.5h.01M15 14.5v2M15 16.5h.01"></path>',
    storm: '<path d="M6 11h8a3 3 0 0 0 .3-6 5 5 0 0 0-9.6-1A3.5 3.5 0 0 0 6 11Z"></path><path d="m10 12-2 4h3l-1 3"></path>'
  };

  let lastFocusedElement = null;

  function iconSvg(iconName, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    if (className) svg.setAttribute("class", className);
    svg.innerHTML = WEATHER_ICONS[iconName] || WEATHER_ICONS.cloudy;
    return svg;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatHour(time) {
    const part = String(time).split("T")[1];
    return part ? part.slice(0, 5) : "--:--";
  }

  function modalRoot() {
    return document.querySelector("#weather-expanded-modal");
  }

  function closeModal() {
    modalRoot()?.remove();
    document.removeEventListener("keydown", onKeyDown);
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
    lastFocusedElement = null;
  }

  function onKeyDown(event) {
    if (event.key === "Escape") closeModal();
  }

  function mountModal(panel) {
    const modal = element("div", "weather-modal");
    modal.id = "weather-expanded-modal";
    modal.appendChild(panel);
    document.body.appendChild(modal);
    document.addEventListener("keydown", onKeyDown);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
    panel.querySelector("[data-weather-close]")?.addEventListener("click", closeModal);
    panel.querySelector("[data-weather-close]")?.focus();
  }

  function buildCloseButton() {
    const button = element("button", "weather-close", "\u00d7");
    button.type = "button";
    button.dataset.weatherClose = "";
    button.setAttribute("aria-label", "Close weather view");
    button.title = "Close";
    return button;
  }

  function buildHero(weather, condition, metaText) {
    const hero = element("div", "weather-hero");

    const iconWrap = element("div", "weather-hero-icon");
    iconWrap.appendChild(iconSvg(condition.icon));

    const copy = element("div", "weather-hero-copy");
    copy.appendChild(element("div", "weather-hero-temp", OrbitShared.formatTemperature(weather.temperature)));
    const label = element("div", "weather-hero-label", condition.label);
    label.id = "weather-modal-condition";
    copy.appendChild(label);
    if (metaText) copy.appendChild(element("div", "weather-hero-meta", metaText));

    hero.append(iconWrap, copy);
    return hero;
  }

  function buildStats(forecast) {
    const temperatures = forecast
      .map((entry) => entry.temperature)
      .filter((value) => typeof value === "number" && Number.isFinite(value));
    if (temperatures.length === 0) return null;

    const stats = element("div", "weather-stats");
    const rows = [
      ["High", Math.max(...temperatures)],
      ["Low", Math.min(...temperatures)]
    ];
    for (const [label, value] of rows) {
      const stat = element("div", "weather-stat");
      stat.appendChild(element("span", "weather-stat-label", label));
      stat.appendChild(element("span", "weather-stat-value", OrbitShared.formatTemperature(value)));
      stats.appendChild(stat);
    }
    return stats;
  }

  function buildHourly(forecast) {
    const section = element("section", "weather-hourly");
    section.setAttribute("aria-label", "Hourly forecast");

    const head = element("div", "weather-hourly-head");
    head.appendChild(element("span", "weather-hourly-title", "Next 24 hours"));
    if (forecast.length > 0) {
      head.appendChild(element("span", "weather-hourly-note", `${forecast.length} hours`));
    }
    section.appendChild(head);

    if (forecast.length === 0) {
      section.appendChild(element("p", "weather-hour-empty", "No hourly forecast available."));
      return section;
    }

    const list = element("div", "weather-hourly-list");
    forecast.forEach((entry, index) => {
      const condition = OrbitShared.describeWeather(entry.weatherCode);
      const row = element("div", "weather-hour-row");

      const icon = element("span", "weather-hour-icon");
      icon.appendChild(iconSvg(condition.icon));
      row.appendChild(icon);

      row.appendChild(element("span", "weather-hour-time", index === 0 ? "Now" : formatHour(entry.time)));
      row.appendChild(element("span", "weather-hour-label", condition.label));
      row.appendChild(element("span", "weather-hour-temp", OrbitShared.formatTemperature(entry.temperature)));
      list.appendChild(row);
    });

    section.appendChild(list);
    return section;
  }

  function buildErrorView() {
    const panel = element("div", "weather-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Weather unavailable");
    panel.appendChild(buildCloseButton());

    const error = element("div", "weather-error");
    error.appendChild(element("p", "weather-error-title", "Weather unavailable"));
    error.appendChild(
      element("p", "weather-error-text", "Could not fetch weather data. Please try again later.")
    );
    const action = element("button", "weather-error-action", "Close");
    action.type = "button";
    action.dataset.weatherClose = "";
    action.addEventListener("click", closeModal);
    error.appendChild(action);
    panel.appendChild(error);

    mountModal(panel);
  }

  async function openExpandedWeatherView() {
    if (modalRoot()) return;

    lastFocusedElement = document.activeElement;

    let weather;
    let forecast = [];
    try {
      weather = await window.orbitWindow.weather.get();
      try {
        forecast = await window.orbitWindow.weather.forecast();
      } catch {
        forecast = [];
      }
    } catch (error) {
      console.error("Failed to load expanded weather view:", error);
      buildErrorView();
      return;
    }

    const condition = OrbitShared.describeWeather(weather.weatherCode);
    const now = new Date();
    const updatedAt = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const panel = element("div", "weather-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Weather details");
    panel.appendChild(buildCloseButton());
    panel.appendChild(buildHero(weather, condition, `Updated ${updatedAt}`));

    const body = element("div", "weather-body");
    const stats = buildStats(forecast);
    if (stats) body.appendChild(stats);
    body.appendChild(buildHourly(forecast));
    panel.appendChild(body);

    mountModal(panel);
  }

  function initWeatherWidget() {
    const weatherWidget = document.querySelector('.sidebar-widget[aria-label="Time and weather"]');
    if (!weatherWidget) return;
    weatherWidget.style.cursor = "pointer";
    weatherWidget.setAttribute("role", "button");
    weatherWidget.setAttribute("tabindex", "0");
    weatherWidget.setAttribute("title", "Show weather details");
    weatherWidget.addEventListener("click", openExpandedWeatherView);
    weatherWidget.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openExpandedWeatherView();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWeatherWidget);
  } else {
    initWeatherWidget();
  }
})();
