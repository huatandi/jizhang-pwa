'use strict';
/**
 * RainSeverityResolver —— 雨量等级（§8）
 *
 * 内部只产生枚举代码（RAIN_TRACE/LIGHT/MODERATE/HEAVY/VERY_HEAVY），
 * 显示层经 i18n 转文字。阈值来自 WeatherConfig，UI 不自行判断。
 */
(function (global) {
  const S = global.WeatherKit.RAIN_SEVERITY;

  /**
   * @param {number} peakRate  峰值 mm/h
   * @param {number} totalMm   累计 mm（用于区分 trace）
   * @returns {string} RAIN_* 枚举
   */
  function resolve(peakRate, totalMm) {
    const cfg = global.WeatherKit.WeatherConfig || { get: () => undefined };
    const D = cfg.DEFAULTS || {};
    const peak = Number(peakRate) || 0;
    const total = Number(totalMm) || 0;
    if (peak <= 0 && total <= 0) return S.NONE;
    const traceMax = num(cfg.get('rainTraceMax'), D.rainTraceMax);
    const lightMax = num(cfg.get('rainLightMax'), D.rainLightMax);
    const moderateMax = num(cfg.get('rainModerateMax'), D.rainModerateMax);
    const heavyMax = num(cfg.get('rainHeavyMax'), D.rainHeavyMax);
    if (peak < traceMax && total < 0.2) return S.TRACE;
    if (peak < lightMax) return S.LIGHT;
    if (peak < moderateMax) return S.MODERATE;
    if (peak < heavyMax) return S.HEAVY;
    return S.VERY_HEAVY;
  }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : Number(d); }

  /** 严重度档位（用于变化检测：跨档=MAJOR） */
  const LEVEL = {};
  LEVEL[S.NONE] = 0; LEVEL[S.TRACE] = 1; LEVEL[S.LIGHT] = 2; LEVEL[S.MODERATE] = 3; LEVEL[S.HEAVY] = 4; LEVEL[S.VERY_HEAVY] = 5;
  function level(sev) { return LEVEL[sev] || 0; }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.RainSeverityResolver = { resolve, level };
})(typeof window !== 'undefined' ? window : globalThis);
