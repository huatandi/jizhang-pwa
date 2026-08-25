'use strict';
/**
 * WeatherDiffEngine —— 预报变化检测（§17-§19）
 *
 * 天气提醒不是固定 Reminder：预报会变。比较旧/新事件：
 *   UNCHANGED / MINOR_CHANGE / MAJOR_CHANGE / CANCELLED / NEW_EVENT
 *
 * 策略（§19，阈值集中在 WeatherConfig.change）：
 *   - 开始时间偏移 <15min → UNCHANGED
 *   - 偏移 ≥60min 或严重度跨 ≥1 档 → MAJOR_CHANGE
 *   - 其余 → MINOR_CHANGE
 *   - 旧事件消失 → CANCELLED；新事件出现 → NEW_EVENT
 */
(function (global) {
  const CHANGE = global.WeatherKit.EVENT_CHANGE;

  function minDiff(a, b) {
    const ta = new Date(a), tb = new Date(b);
    if (isNaN(ta.getTime()) || isNaN(tb.getTime())) return 0;
    return Math.round((ta - tb) / 60000);
  }

  /**
   * 比较单个事件
   * @param {Object} oldE 旧事件（可为 null）
   * @param {Object} newE 新事件（可为 null）
   * @returns {string} EVENT_CHANGE 枚举
   */
  function compareEvent(oldE, newE) {
    const C = global.WeatherKit.WeatherConfig || { get: () => undefined };
    const D = C.DEFAULTS || {};
    const change = C.get('change') || D.change || {};
    const minorShift = Number(change.minorStartShiftMin) || 15;
    const majorShift = Number(change.majorStartShiftMin) || 60;
    const majorSev = Number(change.majorSeverityShift) || 1;

    if (!oldE && !newE) return CHANGE.UNCHANGED;
    if (oldE && !newE) return CHANGE.CANCELLED;
    if (!oldE && newE) return CHANGE.NEW_EVENT;
    if (oldE.type !== newE.type) return CHANGE.MAJOR_CHANGE;

    const shift = Math.abs(minDiff(newE.startTime, oldE.startTime));
    if (shift < minorShift) return CHANGE.UNCHANGED;

    let major = shift >= majorShift;
    // 严重度跨档
    if (!major) {
      const resolver = oldE.type === 'rain' ? global.WeatherKit.RainSeverityResolver : global.WeatherKit.WindSeverityResolver;
      if (resolver && resolver.level) {
        const dl = Math.abs(resolver.level(newE.severity) - resolver.level(oldE.severity));
        if (dl >= majorSev) major = true;
      }
    }
    return major ? CHANGE.MAJOR_CHANGE : CHANGE.MINOR_CHANGE;
  }

  /**
   * 批量比较事件列表（按 id 匹配；id 含起始时间，跨版本可能变化 →
   * 用"类型+最接近起始时间"匹配，避免 id 漂移误判为全 NEW/CANCELLED）
   * @returns {{ events: Array<{change, oldEvent, newEvent}> }}
   */
  function compareEvents(oldList, newList) {
    const olds = (oldList || []).slice();
    const news = (newList || []).slice();
    const out = [];

    const usedOld = new Set();
    // 1) 先按类型+起始时间最近匹配
    for (const ne of news) {
      let best = null, bestDiff = Infinity, bestIdx = -1;
      olds.forEach((oe, i) => {
        if (usedOld.has(i) || oe.type !== ne.type) return;
        const d = Math.abs(minDiff(ne.startTime, oe.startTime));
        if (d < bestDiff) { bestDiff = d; best = oe; bestIdx = i; }
      });
      if (best && bestDiff <= 12 * 60) { // 12 小时窗口内视为同一事件
        usedOld.add(bestIdx);
        out.push({ change: compareEvent(best, ne), oldEvent: best, newEvent: ne });
      } else {
        out.push({ change: CHANGE.NEW_EVENT, oldEvent: null, newEvent: ne });
      }
    }
    // 2) 未被匹配的旧事件 → CANCELLED
    olds.forEach((oe, i) => {
      if (!usedOld.has(i)) out.push({ change: CHANGE.CANCELLED, oldEvent: oe, newEvent: null });
    });
    return { events: out };
  }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.WeatherDiffEngine = { compareEvent, compareEvents };
})(typeof window !== 'undefined' ? window : globalThis);
