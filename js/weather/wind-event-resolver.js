'use strict';
/**
 * WindSeverityResolver —— 风力等级（§11）
 *
 * 区分持续风与阵风：severity 由持续风速决定；阵风用于提醒关注（§10）。
 * 阈值走 WeatherConfig。
 */
(function (global) {
  const S = global.WeatherKit.WIND_SEVERITY;

  function resolve(sustainedKmh, gustKmh) {
    const cfg = global.WeatherKit.WeatherConfig || { get: () => undefined };
    const D = cfg.DEFAULTS || {};
    const wind = Number(sustainedKmh) || 0;
    const gust = Number(gustKmh) || 0;
    const breezy = num(cfg.get('windBreezyMin'), D.windBreezyMin);
    const strong = num(cfg.get('windStrongMin'), D.windStrongMin);
    const very = num(cfg.get('windVeryStrongMin'), D.windVeryStrongMin);
    const peak = Math.max(wind, gust * 0.7); // 阵风按 70% 折算持续等效，避免单次阵风误判
    if (peak < breezy) return S.NORMAL;
    if (peak < strong) return S.BREEZY;
    if (peak < very) return S.STRONG;
    return S.VERY_STRONG;
  }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : Number(d); }

  const LEVEL = {};
  LEVEL[S.NORMAL] = 0; LEVEL[S.BREEZY] = 1; LEVEL[S.STRONG] = 2; LEVEL[S.VERY_STRONG] = 3;
  function level(sev) { return LEVEL[sev] || 0; }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.WindSeverityResolver = { resolve, level };
})(typeof window !== 'undefined' ? window : globalThis);
