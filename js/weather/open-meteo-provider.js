'use strict';
/**
 * OpenMeteoProvider —— Open-Meteo 免费天气 API 实现（§3，第一版 Provider）
 *
 * 无需 API Key、无需服务器、纯前端 fetch。全球城市支持。
 * 返回内部 WeatherData Schema（经 weather-normalizer 转换，见 fetchWeather）。
 *
 * 端：
 *   Geocoding：https://geocoding-api.open-meteo.com/v1/search?name=...&language=zh&count=5
 *   Forecast： https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=...
 *              &hourly=...&daily=...&timezone=auto
 */
(function (global) {
  const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  const FC_URL = 'https://api.open-meteo.com/v1/forecast';

  function jsonFetch(url, timeoutMs) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl && timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : {})
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => { if (timer) clearTimeout(timer); });
  }

  /**
   * 城市名 → 坐标（Open-Meteo Geocoding）
   * @returns {Array<{name, latitude, longitude, country, admin1, timezone}>}
   */
  async function geocode(name, opts) {
    const o = opts || {};
    const q = encodeURIComponent(String(name || '').trim());
    if (!q) return [];
    const url = `${GEO_URL}?name=${q}&language=${o.language || 'zh'}&count=${o.count || 5}&format=json`;
    const j = await jsonFetch(url, o.timeoutMs || 8000);
    return (j && Array.isArray(j.results) ? j.results : []).map((r) => ({
      name: r.name || name,
      country: r.country || '',
      admin1: r.admin1 || '',
      latitude: r.latitude,
      longitude: r.longitude,
      timezone: r.timezone || 'auto',
      country_code: r.country_code || '',
    }));
  }

  /**
   * 按坐标抓取当前/小时/未来日预报，返回 Open-Meteo 原始 JSON
   */
  async function forecastRaw(lat, lon, opts) {
    const o = opts || {};
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      timezone: o.timezone || 'auto',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
      hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,wind_speed_10m,wind_gusts_10m,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max',
      forecast_days: String(o.forecastDays || 7),
    });
    return jsonFetch(`${FC_URL}?${params.toString()}`, o.timeoutMs || 15000);
  }

  class OpenMeteoProvider extends global.WeatherKit.WeatherProvider.Base {
    constructor() { super('open-meteo'); }

    /**
     * 入口：输入城市名或 {name,latitude,longitude}，返回 WeatherData（内部 Schema）
     */
    async fetchWeather(location, opts) {
      const o = opts || {};
      let loc = location;
      if (typeof location === 'string') {
        const hits = await geocode(location, o);
        if (!hits.length) throw new Error('未找到城市: ' + location);
        loc = hits[0];
      }
      const lat = Number(loc.latitude), lon = Number(loc.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('缺少有效坐标');
      const raw = await forecastRaw(lat, lon, o);
      const normalizer = global.WeatherKit.WeatherNormalizer;
      if (!normalizer) throw new Error('WeatherNormalizer 未加载');
      const data = normalizer.normalize(raw, {
        name: loc.name || loc.admin1 || loc.country || String(location),
        timezone: raw.timezone || loc.timezone || '',
      });
      return data;
    }
  }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.OpenMeteoProvider = OpenMeteoProvider;
  global.WeatherKit.geocode = geocode;
  global.WeatherKit.forecastRaw = forecastRaw;
})(typeof window !== 'undefined' ? window : globalThis);
