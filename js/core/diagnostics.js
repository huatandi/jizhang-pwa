'use strict';
/**
 * js/core/diagnostics.js —— DiagnosticsKit（V3.0 §十六）
 *
 * 统一诊断采集：module/operation/start/duration/success/errorCode/fallback/runtime/buildId。
 * 默认本地保存（localStorage 环形缓冲），不上传；设置页可查看/复制/导出 JSON。
 * 受 FeatureFlags.diagnosticsEnabled 控制；verbose 模式记录更多细节。
 */
(function (global) {
  const LS_KEY = 'sm_diagnostics';
  const MAX_ENTRIES = 200;          // 环形缓冲上限（防无限增长）
  let _mem = [];                    // 无 localStorage（Node 测试）降级
  let _memLoaded = false;

  function _storage() { try { return global.localStorage || null; } catch (e) { return null; } }

  function load() {
    if (_memLoaded) return _mem;
    try {
      const raw = _storage() && _storage().getItem(LS_KEY);
      _mem = raw ? JSON.parse(raw) : [];
    } catch (e) { _mem = []; }
    if (!Array.isArray(_mem)) _mem = [];
    _memLoaded = true;
    return _mem;
  }
  function save() {
    try { _storage() && _storage().setItem(LS_KEY, JSON.stringify(_mem.slice(-MAX_ENTRIES))); } catch (e) { /* ignore */ }
  }

  function buildId() {
    try {
      const m = global.AppCore && global.AppCore._buildManifest;
      return (m && m.buildId) || '';
    } catch (e) { return ''; }
  }

  function runtime() {
    try {
      const p = global.AppCore && global.AppCore.Capability && global.AppCore.Capability.getSync();
      return p ? {
        webgpu: p.webgpu, wasm: p.wasm, webspeech: p.webspeech,
        memoryGb: p.memoryGb, touch: p.touch,
      } : null;
    } catch (e) { return null; }
  }

  function enabled() {
    try {
      const F = global.AppCore && global.AppCore.FeatureFlags;
      return F ? F.isEnabled('diagnosticsEnabled') : true;
    } catch (e) { return true; }
  }

  /** 记录一条诊断 */
  function log(entry) {
    if (!enabled()) return;
    const e = Object.assign({
      module: '', operation: '', start: Date.now(), durationMs: 0,
      success: true, errorCode: '', fallback: null, runtime: null, buildId: buildId(),
    }, entry || {});
    if (e.runtime === null) e.runtime = runtime();
    const list = load();
    list.push(e);
    _mem = list.slice(-MAX_ENTRIES);
    save();
    // verbose 控制台输出（可选）
    try {
      const F = global.AppCore && global.AppCore.FeatureFlags;
      if (F && F.isEnabled('verboseDiagnostics')) {
        console.log('[diag] ' + (e.module || '?') + '/' + (e.operation || '?') + ' ' + (e.success ? 'OK' : 'FAIL') + ' ' + e.durationMs + 'ms' + (e.errorCode ? ' [' + e.errorCode + ']' : ''));
      }
    } catch (e2) { /* ignore */ }
    return e;
  }

  /** 同步计时器：start 返回 stop 函数 */
  function timer(module, operation, opts) {
    const t0 = Date.now();
    return (ok, extra) => {
      const e = log(Object.assign({
        module, operation, start: t0, durationMs: Date.now() - t0, success: !!ok,
      }, extra || {}));
      return e;
    };
  }

  /** 异步计时：包裹 async fn，自动记录成功/失败 */
  async function timed(module, operation, fn, opts) {
    const t0 = Date.now();
    const stop = (ok, extra) => log(Object.assign({
      module, operation, start: t0, durationMs: Date.now() - t0, success: ok,
    }, extra || {}));
    try {
      const r = await fn();
      stop(true, (opts && opts.onSuccess) || null);
      return r;
    } catch (e) {
      stop(false, { errorCode: (e && e.code) || ((opts && opts.errorCode) || 'UNKNOWN') });
      throw e;
    }
  }

  function list() { return load().slice(); }
  function clear() { _mem = []; _memLoaded = true; save(); }
  function exportJSON() { return JSON.stringify(list(), null, 2); }
  function summary() {
    const l = load();
    const byModule = {};
    for (const e of l) {
      const m = e.module || '?';
      byModule[m] = byModule[m] || { total: 0, fail: 0, avgMs: 0 };
      const b = byModule[m];
      b.total++; if (!e.success) b.fail++;
      b.avgMs = Math.round((b.avgMs * (b.total - 1) + (e.durationMs || 0)) / b.total);
    }
    return { total: l.length, byModule };
  }

  global.AppCore = global.AppCore || {};
  global.AppCore.Diagnostics = { log, timer, timed, list, clear, exportJSON, summary, MAX_ENTRIES };
})(typeof window !== 'undefined' ? window : globalThis);
