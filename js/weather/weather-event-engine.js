'use strict';
/**
 * WeatherEventEngine —— 天气事件引擎（§5，本次开发最重要模块）
 *
 * 把连续小时天气数据转换为【天气事件】：
 *   - RainEvent：start/peak/end + 持续 + 累计 + 峰值强度 + 概率 + 严重度
 *   - WindEvent：start/peak/end + 持续 + 最大持续风 + 最大阵风 + 严重度
 *
 * 关键能力（§7/§9）：
 *   - 事件合并（Gap Tolerance）：中间短暂弱化不拆成多个事件
 *   - 阈值集中配置（WeatherConfig），无 magic numbers
 *   - 独立降雨/大风必须分开
 *   - 内部输出枚举严重度，i18n 在显示层
 */
(function (global) {
  const cfgGet = (k) => { const C = global.WeatherKit.WeatherConfig; return C ? C.get(k) : undefined; };
  const D = global.WeatherKit.WeatherConfig ? global.WeatherKit.WeatherConfig.DEFAULTS : {};

  /** 解析 "2026-08-25T16:00" 或 ISO → Date（按 WeatherData.timezone 语义；小时数据用字符串比较即可） */
  function parseTime(t) { return new Date(String(t || '').replace(' ', 'T')); }

  /** 分钟差（a-b） */
  function diffMin(a, b) { return Math.round((parseTime(a) - parseTime(b)) / 60000); }

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function fmtTime(t) { if (!t) return ''; const d = parseTime(t); return isNaN(d.getTime()) ? String(t).slice(11, 16) : String(t).slice(11, 16); }

  // ================= 降雨事件（§6-§8） =================
  /**
   * @param {Array<{time, precipitation, precipitationProbability}>} hourly
   * @returns {Array<Object>} RainEvent[]
   */
  function detectRainEvents(hourly) {
    const C = global.WeatherKit.WeatherConfig || { get: () => undefined };
    const D = C.DEFAULTS || {};
    const startTh = num(cfgGet('rainStartThreshold'), D.rainStartThreshold);
    const endTh = num(cfgGet('rainEndThreshold'), D.rainEndThreshold);
    const gapTol = num(cfgGet('rainGapTolerance'), D.rainGapTolerance);
    const rows = (hourly || []).filter(h => h && h.time).map(h => ({
      time: h.time,
      rain: num(h.precipitation != null ? h.precipitation : h.rain),
      prob: num(h.precipitationProbability),
    }));
    if (!rows.length) return [];

    const events = [];
    let cur = null;      // 当前事件累积
    let gapHrs = 0;      // 距上一有效雨小时的间隙（小时）
    let lastRainIdx = -1;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const raining = r.rain > endTh; // 用 end 阈值判断"在雨"
      if (raining) {
        if (!cur) {
          cur = { startIdx: i, rows: [r], endIdx: i };
        } else {
          // 若之前有间隙（>0）且在容忍范围内 → 合并；超过容忍 → 关闭当前，开新事件
          if (gapHrs > 0 && gapHrs <= gapTol) {
            cur.rows.push(r); cur.endIdx = i;
          } else if (gapHrs > gapTol) {
            events.push(buildRainEvent(cur));
            cur = { startIdx: i, rows: [r], endIdx: i };
          } else {
            cur.rows.push(r); cur.endIdx = i;
          }
        }
        gapHrs = 0;
        lastRainIdx = i;
      } else {
        // 无雨：若事件未闭合，间隙累积
        if (cur) {
          // 只在间隙未超容忍时保留；超了之后下一雨点触发关闭
          gapHrs++;
        }
      }
    }
    if (cur) events.push(buildRainEvent(cur));
    return events;
  }

  function buildRainEvent(cur) {
    const rows = cur.rows;
    const peak = rows.reduce((m, r) => (r.rain > m.rain ? r : m), rows[0]);
    const total = rows.reduce((s, r) => s + r.rain, 0);
    const maxProb = rows.reduce((m, r) => Math.max(m, r.prob || 0), 0);
    const startTime = rows[0].time;
    const endTime = rows[rows.length - 1].time;
    const severity = global.WeatherKit.RainSeverityResolver.resolve(peak.rain, total);
    const id = 'rain-' + String(startTime).replace(/[^0-9]/g, '').slice(0, 12);
    return global.WeatherKit.rainEvent({
      id,
      startTime, peakTime: peak.time, endTime,
      durationMinutes: diffMin(endTime, startTime) + 60,
      severity,
      metrics: {
        precipitationSum: Math.round(total * 10) / 10,
        peakRate: Math.round(peak.rain * 10) / 10,
        probability: Math.round(maxProb),
      },
      confidence: Math.min(0.95, 0.55 + maxProb / 100 * 0.4),
    });
  }

  // ================= 大风事件（§9-§11） =================
  /**
   * @param {Array<{time, windSpeed, windGust}>} hourly
   * @returns {Array<Object>} WindEvent[]
   */
  function detectWindEvents(hourly) {
    const C = global.WeatherKit.WeatherConfig || { get: () => undefined };
    const D = C.DEFAULTS || {};
    const evTh = num(cfgGet('windEventThreshold'), D.windEventThreshold);
    const gapTol = num(cfgGet('windGapTolerance'), D.windGapTolerance);
    const rows = (hourly || []).filter(h => h && h.time).map(h => ({
      time: h.time,
      wind: num(h.windSpeed),
      gust: num(h.windGust),
    }));
    if (!rows.length) return [];

    const events = [];
    let cur = null, gapHrs = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const windy = r.wind >= evTh;
      if (windy) {
        if (!cur) cur = { startIdx: i, rows: [r], endIdx: i };
        else if (gapHrs > 0 && gapHrs <= gapTol) { cur.rows.push(r); cur.endIdx = i; }
        else if (gapHrs > gapTol) { events.push(buildWindEvent(cur)); cur = { startIdx: i, rows: [r], endIdx: i }; }
        else { cur.rows.push(r); cur.endIdx = i; }
        gapHrs = 0;
      } else if (cur) {
        gapHrs++;
      }
    }
    if (cur) events.push(buildWindEvent(cur));
    return events;
  }

  function buildWindEvent(cur) {
    const rows = cur.rows;
    const peakWind = rows.reduce((m, r) => (r.wind > m.wind ? r : m), rows[0]);
    const maxGustRow = rows.reduce((m, r) => (r.gust > (m.gust || 0) ? r : m), rows[0]);
    const maxGust = rows.reduce((m, r) => Math.max(m, r.gust || 0), 0);
    const startTime = rows[0].time;
    const endTime = rows[rows.length - 1].time;
    const severity = global.WeatherKit.WindSeverityResolver.resolve(peakWind.wind, maxGust);
    const id = 'wind-' + String(startTime).replace(/[^0-9]/g, '').slice(0, 12);
    return global.WeatherKit.windEvent({
      id,
      startTime, peakTime: peakWind.time, endTime,
      durationMinutes: diffMin(endTime, startTime) + 60,
      severity,
      metrics: {
        maxWindSpeed: Math.round(peakWind.wind),
        maxWindGust: Math.round(maxGust),
      },
      confidence: 0.8,
    });
  }

  /** 总入口：从 WeatherData 提取事件（含排序：先近后远） */
  function detectEvents(weatherData) {
    const hourly = (weatherData && weatherData.hourly) || [];
    const rain = detectRainEvents(hourly);
    const wind = detectWindEvents(hourly);
    const all = [...rain.map(e => Object.assign(e, { type: 'rain' })), ...wind.map(e => Object.assign(e, { type: 'wind' }))];
    return all.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  }

  global.WeatherKit = global.WeatherKit || {};
  Object.assign(global.WeatherKit, {
    WeatherEventEngine: { detectRainEvents, detectWindEvents, detectEvents, fmtTime, diffMin },
  });
})(typeof window !== 'undefined' ? window : globalThis);
