'use strict';
/**
 * WeatherConfig —— 天气模块配置中心（§45）
 *
 * 集中管理所有阈值 / 缓存 TTL / 提醒提前量 / 变化策略。
 * 禁止业务代码散落 magic numbers；设置页高级项可覆盖。
 */
(function (global) {
  const DEFAULTS = {
    // ---- 降雨事件（§7）----
    rainStartThreshold: 0.1,   // mm/h 达到即视为"开始下雨"
    rainEndThreshold: 0.05,    // mm/h 低于视为"雨停"
    rainGapTolerance: 2,       // 小时内短间隙（雨停≤2h 再接雨）→ 合并为一个事件
    // 雨量等级（§8，峰值 mm/h）
    rainTraceMax: 0.1,
    rainLightMax: 1.5,
    rainModerateMax: 4,
    rainHeavyMax: 8,
    // ---- 大风事件（§11，持续风 km/h）----
    windBreezyMin: 20,
    windStrongMin: 30,
    windVeryStrongMin: 45,
    windEventThreshold: 25,    // 持续风 ≥ 此值才构成 WindEvent
    windGustThreshold: 40,     // 阵风 ≥ 此值构成提醒关注
    windGapTolerance: 2,       // 小时短间隙合并
    // ---- 预报变化策略（§19）----
    change: {
      minorStartShiftMin: 15,  // 开始时间偏移 <15min → UNCHANGED
      majorStartShiftMin: 60,  // 偏移 ≥60min → MAJOR_CHANGE
      majorSeverityShift: 1,   // 严重度跨 ≥1 档 → MAJOR_CHANGE
    },
    // ---- 缓存 TTL（ms，§31）----
    cacheTTL: {
      current: 10 * 60 * 1000,     // 当前天气 10 分钟
      hourly: 30 * 60 * 1000,      // 小时预报 30 分钟
      daily: 6 * 60 * 60 * 1000,   // 未来日预报 6 小时
    },
    // ---- 提醒（§16）----
    reminder: {
      rainAdvanceMin: 30,     // 默认降雨提前 30 分钟
      windAdvanceMin: 30,     // 默认大风提前 30 分钟
      rainEnabled: true,
      windEnabled: true,
    },
    // ---- 刷新触发（§32：iOS PWA 无后台常驻，仅前台时机刷新）----
    refreshOn: { startup: true, foreground: true, openCard: true, intervalMs: 60 * 60 * 1000 },
    // ---- 单位（§38，内部标准 SI；显示层换算）----
    units: { temperature: 'c', windSpeed: 'kmh' },
    // 天气显示语言独立于系统/浏览器语言；默认中文，可选 zh/es/en/auto
    language: 'zh',
  };

  const LS_KEY = 'sm_weather_cfg';
  let overrides = null;

  function load() {
    if (overrides) return overrides;
    try {
      const raw = global.localStorage && global.localStorage.getItem(LS_KEY);
      overrides = raw ? JSON.parse(raw) : {};
    } catch (e) { overrides = {}; }
    return overrides;
  }
  function get(key) {
    const o = load();
    if (key && key in o) return o[key];
    const d = DEFAULTS;
    return (key && key in d) ? d[key] : d;
  }
  function set(key, value) {
    const o = load();
    o[key] = value;
    overrides = o;
    try { global.localStorage && global.localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
  }
  function reset() {
    overrides = {};
    try { global.localStorage && global.localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
  }
  function getReminder() {
    return Object.assign({}, DEFAULTS.reminder, get('reminder') || {});
  }
  function getUnits() {
    return Object.assign({}, DEFAULTS.units, get('units') || {});
  }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.WeatherConfig = { DEFAULTS, get, set, reset, getReminder, getUnits, LS_KEY };
})(typeof window !== 'undefined' ? window : globalThis);
