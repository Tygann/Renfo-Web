// @ts-check

// Weather data utilities: resolve WeatherKit data through proxy (preferred) or direct fallback.
/** @typedef {import("../types.js").WeatherForecast} WeatherForecast */

const weatherForecastCache = new Map();

function getWeatherKitToken() {
  const weatherToken = String(
    window.RENFO_CONFIG?.WEATHERKIT_TOKEN ?? "",
  ).trim();
  if (weatherToken) return weatherToken;
  const mapToken = String(window.RENFO_CONFIG?.MAPKIT_TOKEN ?? "").trim();
  return mapToken || null;
}

function getWeatherApiBaseUrl() {
  return String(window.RENFO_CONFIG?.WEATHER_API_URL ?? "").trim();
}

function getWeatherCacheKey(lat, lng) {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

function parseIsoDateParts(dateValue) {
  const text = String(dateValue ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function toUtcDayTimestamp(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function formatWeekdayFromParts(parts) {
  const utcMidday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return utcMidday.toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  });
}

function formatMonthDayFromParts(parts) {
  const utcMidday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return utcMidday.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatWeatherDayLabel(dateValue, index, firstDateValue = null) {
  const parts = parseIsoDateParts(dateValue);
  if (!parts) return index === 0 ? "Today" : `Day ${index + 1}`;

  const firstParts = parseIsoDateParts(firstDateValue);
  if (firstParts) {
    const daysFromStart = Math.round(
      (toUtcDayTimestamp(parts) - toUtcDayTimestamp(firstParts)) / 86400000,
    );
    if (daysFromStart === 0) return "Today";
  } else {
    if (index === 0) return "Today";
  }

  return formatWeekdayFromParts(parts);
}

function formatWeatherDateLabel(dateValue) {
  const parts = parseIsoDateParts(dateValue);
  if (!parts) return "";
  return formatMonthDayFromParts(parts);
}

function isMetricWeatherUnits(units) {
  const normalized = String(units ?? "")
    .trim()
    .toLowerCase();
  return (
    normalized === "m" ||
    normalized === "metric" ||
    normalized === "si" ||
    normalized === "c"
  );
}

function formatWeatherTemperature(value, units = null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const normalizedValue = isMetricWeatherUnits(units)
    ? (value * 9) / 5 + 32
    : value;
  return `${Math.round(normalizedValue)}\u00B0`;
}

function parseWeatherPrecipChancePercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = value <= 1 ? value * 100 : value;
  if (!Number.isFinite(normalized)) return null;
  const rounded = Math.round(normalized);
  if (rounded <= 0) return null;
  return Math.min(100, rounded);
}

function getMaxWeatherPrecipChancePercent(...values) {
  let max = null;
  for (const value of values) {
    const parsed = parseWeatherPrecipChancePercent(value);
    if (parsed == null) continue;
    max = max == null ? parsed : Math.max(max, parsed);
  }
  return max;
}

function isWetPrecipitationType(type) {
  const normalized = String(type ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "clear") return false;
  return /rain|drizzle|snow|sleet|hail|ice|mixed|freezing/.test(normalized);
}

function shouldDisplayWeatherPrecipChance(
  precipChancePercent,
  day,
  daytimeForecast,
  overnightForecast,
  iconName,
) {
  if (precipChancePercent == null) return false;
  if (
    isWetPrecipitationType(day?.precipitationType) ||
    isWetPrecipitationType(daytimeForecast?.precipitationType) ||
    isWetPrecipitationType(overnightForecast?.precipitationType)
  ) {
    return true;
  }

  return (
    iconName === "cloud-rain" ||
    iconName === "cloud-lightning" ||
    iconName === "snowflake"
  );
}

function getWeatherConditionIconName(conditionCode, isDaylight = true) {
  const code = String(conditionCode ?? "").toLowerCase();
  if (!code) return "cloud";
  if (/(thunder|storm|tropicalstorm|hurricane)/.test(code))
    return "cloud-lightning";
  if (/(snow|sleet|flurries|blizzard|hail|frigid|freezing)/.test(code))
    return "snowflake";
  if (/(rain|drizzle|showers)/.test(code)) return "cloud-rain";
  if (/(wind|breezy|blowingdust)/.test(code)) return "wind";
  if (/(fog|haze|smoke|dust)/.test(code)) return "cloud-fog";
  if (/(clear|sunny)/.test(code)) return isDaylight ? "sun" : "moon";
  if (/(mostlyclear|partlycloudy)/.test(code))
    return isDaylight ? "cloud-sun" : "cloud-moon";
  if (/(cloudy|overcast)/.test(code)) return "cloud";
  return "cloud";
}

function mapWeatherPayload(payload) {
  const current = payload?.currentWeather ?? null;
  const forecastUnits =
    payload?.forecastDaily?.metadata?.units ??
    payload?.currentWeather?.metadata?.units ??
    null;
  const forecastDays = Array.isArray(payload?.forecastDaily?.days)
    ? payload.forecastDaily.days.slice(0, 10)
    : [];
  const firstForecastDate = forecastDays[0]?.forecastStart ?? null;
  const dailyRows = forecastDays.map((day, index) => {
    const daytimeForecast = day?.daytimeForecast ?? {};
    const overnightForecast = day?.overnightForecast ?? {};
    const iconName = getWeatherConditionIconName(
      day?.conditionCode ??
        daytimeForecast.conditionCode ??
        overnightForecast.conditionCode,
      true,
    );
    const precipChancePercent = getMaxWeatherPrecipChancePercent(
      day?.precipitationChance,
      daytimeForecast?.precipitationChance,
      overnightForecast?.precipitationChance,
    );
    const shouldShowPrecipChance = shouldDisplayWeatherPrecipChance(
      precipChancePercent,
      day,
      daytimeForecast,
      overnightForecast,
      iconName,
    );

    return {
      dayLabel: formatWeatherDayLabel(
        day?.forecastStart,
        index,
        firstForecastDate,
      ),
      dateLabel: formatWeatherDateLabel(day?.forecastStart),
      icon: iconName,
      tempHigh: formatWeatherTemperature(day?.temperatureMax, forecastUnits),
      tempLow: formatWeatherTemperature(day?.temperatureMin, forecastUnits),
      precipChancePercent: shouldShowPrecipChance ? precipChancePercent : null,
    };
  });

  return {
    current,
    days: dailyRows,
  };
}

function buildWeatherProxyUrl(baseUrl, lat, lng) {
  const url = new URL(baseUrl, window.location.href);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lng", String(lng));
  return url.toString();
}

async function fetchWeatherForecast(lat, lng) {
  const proxyBaseUrl = getWeatherApiBaseUrl();
  // Preferred path for web: proxy keeps Apple signing credentials off the client.
  if (proxyBaseUrl) {
    const proxyResponse = await fetch(
      buildWeatherProxyUrl(proxyBaseUrl, lat, lng),
      {
        cache: "no-store",
      },
    );

    if (!proxyResponse.ok) {
      const proxyError = new Error(
        `Weather API request failed with status ${proxyResponse.status}.`,
      );
      proxyError.code = "http_error";
      proxyError.status = proxyResponse.status;
      proxyError.source = "proxy";
      throw proxyError;
    }

    const proxyPayload = await proxyResponse.json();
    return mapWeatherPayload(proxyPayload);
  }

  const token = getWeatherKitToken();
  if (!token) {
    const missingTokenError = new Error("Missing WeatherKit configuration.");
    missingTokenError.code = "missing_token";
    throw missingTokenError;
  }

  const path = `${encodeURIComponent(String(lat))}/${encodeURIComponent(String(lng))}`;
  const url = `https://weatherkit.apple.com/api/v1/weather/en/${path}?dataSets=currentWeather,forecastDaily&timezone=auto&countryCode=US`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const err = new Error(
      `WeatherKit request failed with status ${response.status}.`,
    );
    err.code = "http_error";
    err.status = response.status;
    err.source = "weatherkit_direct";
    throw err;
  }

  const payload = await response.json();
  return mapWeatherPayload(payload);
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<WeatherForecast>}
 */
async function getWeatherForecast(lat, lng) {
  const key = getWeatherCacheKey(lat, lng);
  // Cache the in-flight promise so repeated requests for same location coalesce.
  if (weatherForecastCache.has(key)) return weatherForecastCache.get(key);

  const promise = fetchWeatherForecast(lat, lng).catch((err) => {
    // Failed calls should not stay cached.
    weatherForecastCache.delete(key);
    throw err;
  });
  weatherForecastCache.set(key, promise);
  return promise;
}

export { getWeatherForecast };
