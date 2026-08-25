'use strict';
/**
 * WeatherNormalizer —— Open-Meteo 原始 JSON → 内部 WeatherData Schema（§4）
 *
 * 业务层只消费 Schema，绝不接触 Provider 原始结构。
 * 时区处理（§41）：使用 raw.timezone 标识；事件时间以该时区解释（ISO 字符串带偏移）。
 */
(function (global) {
  /**
   * @param {Object} raw  Open-Meteo forecast 原始 JSON
   * @param {Object} meta { name, timezone }
   * @returns {Object} WeatherData
   */
  function normalize(raw, meta) {
    const m = meta || {};
    const tz = raw && (raw.timezone || m.timezone) || '';
    const cur = raw && raw.current || {};
    const hourlyRaw = (raw && raw.hourly) || {};
    const dailyRaw = (raw && raw.daily) || {};

    const hourly = [];
    const times = hourlyRaw.time || [];
    for (let i = 0; i < times.length; i++) {
      hourly.push({
        time: times[i],
        temperature: num(hourlyRaw.temperature_2m && hourlyRaw.temperature_2m[i]),
        apparentTemperature: num(hourlyRaw.apparent_temperature && hourlyRaw.apparent_temperature[i]),
        precipitationProbability: num(hourlyRaw.precipitation_probability && hourlyRaw.precipitation_probability[i]),
        precipitation: num(hourlyRaw.precipitation && hourlyRaw.precipitation[i]),
        rain: num(hourlyRaw.rain && hourlyRaw.rain[i]),
        windSpeed: num(hourlyRaw.wind_speed_10m && hourlyRaw.wind_speed_10m[i]),
        windGust: num(hourlyRaw.wind_gusts_10m && hourlyRaw.wind_gusts_10m[i]),
        weatherCode: num(hourlyRaw.weather_code && hourlyRaw.weather_code[i]),
      });
    }

    const daily = [];
    const dtimes = dailyRaw.time || [];
    for (let i = 0; i < dtimes.length; i++) {
      daily.push({
        date: dtimes[i],
        weatherCode: num(dailyRaw.weather_code && dailyRaw.weather_code[i]),
        temperatureMax: num(dailyRaw.temperature_2m_max && dailyRaw.temperature_2m_max[i]),
        temperatureMin: num(dailyRaw.temperature_2m_min && dailyRaw.temperature_2m_min[i]),
        precipitationProbabilityMax: num(dailyRaw.precipitation_probability_max && dailyRaw.precipitation_probability_max[i]),
        precipitationSum: num(dailyRaw.precipitation_sum && dailyRaw.precipitation_sum[i]),
        windSpeedMax: num(dailyRaw.wind_speed_10m_max && dailyRaw.wind_speed_10m_max[i]),
        windGustMax: num(dailyRaw.wind_gusts_10m_max && dailyRaw.wind_gusts_10m_max[i]),
      });
    }

    const data = global.WeatherKit.emptyWeatherData(m.name || '');
    data.timezone = tz;
    data.updatedAt = new Date().toISOString();
    data.current = {
      temperature: num(cur.temperature_2m),
      apparentTemperature: num(cur.apparent_temperature),
      humidity: num(cur.relative_humidity_2m),
      precipitation: num(cur.precipitation),
      windSpeed: num(cur.wind_speed_10m),
      windGust: num(cur.wind_gusts_10m),
      weatherCode: num(cur.weather_code),
    };
    data.hourly = hourly;
    data.daily = daily;
    return data;
  }

  /** 兼容测试：直接传 raw 数组数组格式（Open-Meteo 常见）的兜底 */
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.WeatherNormalizer = { normalize, num };
})(typeof window !== 'undefined' ? window : globalThis);
