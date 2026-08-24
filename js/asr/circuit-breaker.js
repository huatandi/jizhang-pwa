'use strict';
/**
 * DeviceCircuitBreaker —— 设备级引擎健康熔断(V5 Phase1 保险7)
 *
 * 连续 N 次初始化失败 → 标记该引擎"暂不健康",之后直接走允许的 fallback(不再每次点都重试十几秒);
 * 一段时间 / 版本变化 / 用户手动"重新检测"后恢复。设备级,存 localStorage。
 */
(function (global) {
  const AsrKit = global.AsrKit = global.AsrKit || {};
  const KEY = 'sm_voice_breaker';
  const COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟冷却
  const MAX_FAILURES = 3;

  let _mem = null; // 无 localStorage 环境降级

  function _storage() { try { return global.localStorage || null; } catch (e) { return null; } }
  function load() {
    if (_mem) return _mem;
    try { return JSON.parse(_storage() && _storage().getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function save(s) {
    _mem = s;
    try { _storage() && _storage().setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  function markFailure(engine, reason) {
    const s = load();
    const e = s[engine] || (s[engine] = { failures: 0, disabledUntil: 0, lastReason: null, lastFailAt: 0 });
    e.failures = (e.failures || 0) + 1;
    e.lastReason = reason || null;
    e.lastFailAt = Date.now();
    if (e.failures >= MAX_FAILURES) e.disabledUntil = Date.now() + COOLDOWN_MS;
    save(s);
    return e.failures;
  }
  function markSuccess(engine) {
    const s = load();
    if (s[engine]) { s[engine].failures = 0; s[engine].disabledUntil = 0; save(s); }
  }
  function isDisabled(engine) {
    const s = load();
    const e = s[engine];
    if (!e || !e.disabledUntil) return false;
    if (Date.now() > e.disabledUntil) { e.disabledUntil = 0; e.failures = 0; save(s); return false; }
    return true;
  }
  function enable(engine) {
    const s = load();
    if (s[engine]) { s[engine].failures = 0; s[engine].disabledUntil = 0; save(s); }
  }
  function reset() { save({}); }
  function state(engine) { return load()[engine] || null; }

  AsrKit.circuitBreaker = { markFailure, markSuccess, isDisabled, enable, reset, state, COOLDOWN_MS, MAX_FAILURES };
})(typeof window !== 'undefined' ? window : globalThis);
