'use strict';
/**
 * AsrKit 无关的天气数据层：WeatherData 统一 Schema + WeatherEvent 标准结构。
 * 所有 Provider 必须先转换成此格式；UI / Reminder / Voice 只消费此格式。
 *
 * 内部不保存本地化文字（如"小雨"），只保存枚举代码，显示层经 i18n 映射。
 */
(function (global) {
  // ---- WMO 天气代码 → 内部图标枚举（Provider 无关） ----
  const WMO_CLEAR = 0, WMO_PARTLY = 1, WMO_CLOUDY = 3, WMO_FOG = 45, WMO_DRIZZLE = 51,
        WMO_RAIN = 61, WMO_SNOW = 71, WMO_SHOWER = 80, WMO_THUNDER = 95;

  /** 单条天气代码 → 图标枚举 */
  function codeToIcon(code) {
    const c = Number(code);
    if (c === 0) return 'clear';
    if (c <= 2) return 'partly_cloudy';
    if (c === 3) return 'cloudy';
    if (c >= 45 && c <= 48) return 'fog';
    if (c >= 51 && c <= 57) return 'drizzle';
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if (c >= 71 && c <= 77) return 'snow';
    if (c >= 95 && c <= 99) return 'thunderstorm';
    return 'partly_cloudy';
  }

  // ---- 严重度枚举（内部代码，显示层 i18n） ----
  const RAIN_SEVERITY = { NONE: 'RAIN_NONE', TRACE: 'RAIN_TRACE', LIGHT: 'RAIN_LIGHT', MODERATE: 'RAIN_MODERATE', HEAVY: 'RAIN_HEAVY', VERY_HEAVY: 'RAIN_VERY_HEAVY' };
  const WIND_SEVERITY = { NORMAL: 'WIND_NORMAL', BREEZY: 'WIND_BREEZY', STRONG: 'WIND_STRONG', VERY_STRONG: 'WIND_VERY_STRONG' };
  const EVENT_CHANGE = { UNCHANGED: 'UNCHANGED', MINOR_CHANGE: 'MINOR_CHANGE', MAJOR_CHANGE: 'MAJOR_CHANGE', CANCELLED: 'CANCELLED', NEW_EVENT: 'NEW_EVENT' };

  /**
   * 降雨事件（连续小时合并后）
   * { id, type:'rain', startTime(ISO 含时区), peakTime, endTime, durationMinutes,
   *   severity(RAIN_*), metrics:{ precipitationSum, peakRate, probability },
   *   confidence(0~1), source, generatedAt }
   */
  function rainEvent(p) {
    return Object.assign({
      id: '', type: 'rain', startTime: '', peakTime: '', endTime: '',
      durationMinutes: 0, severity: RAIN_SEVERITY.NONE,
      metrics: { precipitationSum: 0, peakRate: 0, probability: 0 },
      confidence: 0.7, source: 'open-meteo', generatedAt: new Date().toISOString(),
    }, p || {});
  }

  /**
   * 大风事件
   * { id, type:'wind', startTime, peakTime, endTime, durationMinutes,
   *   severity(WIND_*), metrics:{ maxWindSpeed, maxWindGust },
   *   confidence, source, generatedAt }
   */
  function windEvent(p) {
    return Object.assign({
      id: '', type: 'wind', startTime: '', peakTime: '', endTime: '',
      durationMinutes: 0, severity: WIND_SEVERITY.NORMAL,
      metrics: { maxWindSpeed: 0, maxWindGust: 0 },
      confidence: 0.7, source: 'open-meteo', generatedAt: new Date().toISOString(),
    }, p || {});
  }

  /** 空 WeatherData 骨架（Provider/事件引擎填充） */
  function emptyWeatherData(location) {
    return {
      location: location || '',
      timezone: '',
      updatedAt: '',
      current: null,      // { temperature, apparentTemperature, humidity, precipitation, windSpeed, windGust, weatherCode }
      hourly: [],          // [{ time, temperature, apparentTemperature, precipitationProbability, precipitation, rain, windSpeed, windGust, weatherCode }]
      daily: [],           // [{ date, weatherCode, temperatureMax, temperatureMin, precipitationProbabilityMax, precipitationSum, windSpeedMax, windGustMax }]
    };
  }

  global.WeatherKit = global.WeatherKit || {};
  Object.assign(global.WeatherKit, {
    codeToIcon, RAIN_SEVERITY, WIND_SEVERITY, EVENT_CHANGE,
    WMO_CLEAR, WMO_PARTLY, WMO_CLOUDY, WMO_FOG, WMO_DRIZZLE, WMO_RAIN, WMO_SNOW, WMO_SHOWER, WMO_THUNDER,
    rainEvent, windEvent, emptyWeatherData,
  });
})(typeof window !== 'undefined' ? window : globalThis);
