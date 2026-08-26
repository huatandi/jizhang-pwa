'use strict';
/**
 * js/core/runtime-asset-manager.js —— RuntimeAssetManager（V3.0 §十二）
 *
 * 统一管理重型运行时资源（OCR/ASR/模型/图表），替代各引擎自行下载。
 * 状态：UNLOADED / LOADING / READY / FAILED / INCOMPATIBLE
 * 接口：loadRuntime(type) / getStatus(type) / warmup(type) / abort(type) / clearCache(type)
 * 受 FeatureFlags 控制；内存压力时可释放闲置模型（§三十六）。
 */
(function (global) {
  const STATE = { UNLOADED: 'UNLOADED', LOADING: 'LOADING', READY: 'READY', FAILED: 'FAILED', INCOMPATIBLE: 'INCOMPATIBLE' };

  // 运行时注册表：type → { load: async () => void, dispose?: () => void, deps?: string[] }
  const RUNNERS = {};
  const state = {};      // type → STATE
  const instances = {};  // type → 实例/句柄
  let _abort = {};       // type → AbortController

  function register(type, runner) {
    RUNNERS[type] = runner;
    if (!state[type]) state[type] = STATE.UNLOADED;
  }

  function getStatus(type) { return state[type] || STATE.UNLOADED; }
  function getInstance(type) { return instances[type] || null; }

  function setState(type, st) {
    state[type] = st;
    // 诊断采集
    try {
      const D = global.AppCore && global.AppCore.Diagnostics;
      if (D) D.log({ module: 'runtime', operation: type + ':' + st, success: st === STATE.READY, errorCode: st === STATE.FAILED ? 'RUNTIME_' + type.toUpperCase() + '_FAILED' : '' });
    } catch (e) { /* ignore */ }
  }

  async function loadRuntime(type, opts) {
    const o = opts || {};
    const cur = getStatus(type);
    if (cur === STATE.READY) return instances[type];
    if (cur === STATE.LOADING) { /* 已有加载中，等待完成（简化：返回 undefined，调用方重试） */ return null; }
    const runner = RUNNERS[type];
    if (!runner) { setState(type, STATE.FAILED); return null; }
    // 能力门控：FeatureFlag 关闭 → INCOMPATIBLE
    try {
      const F = global.AppCore && global.AppCore.FeatureFlags;
      const flagName = runner.flagName;
      if (flagName && F && !F.isEnabled(flagName)) { setState(type, STATE.INCOMPATIBLE); return null; }
    } catch (e) { /* ignore */ }
    setState(type, STATE.LOADING);
    _abort[type] = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    try {
      const inst = await runner.load({ signal: _abort[type] && _abort[type].signal, ...o });
      instances[type] = inst;
      setState(type, STATE.READY);
      return inst;
    } catch (e) {
      setState(type, STATE.FAILED);
      console.warn('[runtime] ' + type + ' 加载失败:', e && e.message || e);
      return null;
    }
  }

  /** 预热：低优先级后台加载（requestIdleCallback/setTimeout） */
  function warmup(type, opts) {
    const schedule = (typeof requestIdleCallback === 'function')
      ? requestIdleCallback : (fn) => setTimeout(fn, 500);
    schedule(() => { if (getStatus(type) === STATE.UNLOADED) loadRuntime(type, opts).catch(() => {}); });
  }

  function abort(type) {
    if (_abort[type]) { try { _abort[type].abort(); } catch (e) { /* ignore */ } }
    state[type] = STATE.UNLOADED;
  }

  function clearCache(type) {
    try {
      const runner = RUNNERS[type];
      if (runner && runner.dispose) runner.dispose(instances[type]);
      instances[type] = null;
      state[type] = STATE.UNLOADED;
      // 清模型缓存（IndexedDB/Cache）
      try {
        const D = global.AppCore && global.AppCore.Diagnostics;
        if (D) D.log({ module: 'runtime', operation: type + ':clearCache', success: true });
      } catch (e) { /* ignore */ }
    } catch (e) { console.warn('[runtime] clearCache ' + type + ':', e); }
  }

  /** 内存压力释放（§三十六）：释放非当前使用且闲置的重型实例 */
  function releaseIdle(keepTypes) {
    const keep = keepTypes || [];
    for (const type of Object.keys(instances)) {
      if (!keep.includes(type) && getStatus(type) === STATE.READY) {
        try {
          const runner = RUNNERS[type];
          if (runner && runner.dispose) runner.dispose(instances[type]);
          instances[type] = null;
          state[type] = STATE.UNLOADED;
          console.log('[runtime] 释放闲置资源: ' + type);
        } catch (e) { /* ignore */ }
      }
    }
  }

  function statusReport() {
    const out = {};
    for (const type of Object.keys(RUNNERS)) out[type] = getStatus(type);
    return out;
  }

  global.AppCore = global.AppCore || {};
  global.AppCore.RuntimeAssets = {
    STATE, register, loadRuntime, getStatus, getInstance, warmup, abort, clearCache, releaseIdle, statusReport,
  };
})(typeof window !== 'undefined' ? window : globalThis);
