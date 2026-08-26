'use strict';
/**
 * js/core/capability.js —— CapabilityManager（V3.0 §十五）
 *
 * Feature Flag ≠ Capability：flag 开启但设备不支持 → 由本模块裁决。
 * 统一探测设备能力，输出 RuntimeProfile（只读，惰性缓存）。
 * OCR/Voice 只读 RuntimeProfile，不各自重复探测。
 * 兼容既有 AsrKit.runtime 探测（voice-runtime-profile）——合并避免重复请求 adapter。
 */
(function (global) {
  let _profile = null;    // 缓存 Promise
  let _profileValue = null;

  function _hasSAB() { try { return typeof SharedArrayBuffer !== 'undefined'; } catch (e) { return false; } }
  function _isolated() {
    try { return (typeof global.crossOriginIsolated !== 'undefined' && global.crossOriginIsolated) || _hasSAB(); }
    catch (e) { return false; }
  }
  function _nav() { try { return global.navigator || {}; } catch (e) { return {}; } }

  function detect() {
    if (_profile) return _profile;
    _profile = (async () => {
      const nav = _nav();
      const cap = {
        webgpu: false,
        wasm: typeof WebAssembly !== 'undefined',
        wasmSimd: false,
        wasmThreads: _hasSAB(),
        sab: _hasSAB(),
        isolated: _isolated(),
        audioWorklet: typeof global.AudioWorkletNode !== 'undefined',
        offscreenCanvas: typeof global.OffscreenCanvas !== 'undefined',
        webspeech: !!(global.SpeechRecognition || global.webkitSpeechRecognition),
        notifications: typeof global.Notification !== 'undefined',
        backgroundSync: typeof global.ServiceWorkerRegistration !== 'undefined' && 'sync' in (global.ServiceWorkerRegistration.prototype || {}),
        geolocation: !!(nav.geolocation && nav.geolocation.getCurrentPosition),
        storageEstimate: !!(nav.storage && nav.storage.estimate),
        memoryGb: nav.deviceMemory || null,
        cores: nav.hardwareConcurrency || null,
        touch: (typeof nav.maxTouchPoints !== 'undefined' && nav.maxTouchPoints > 0),
        online: (typeof nav.onLine === 'boolean') ? nav.onLine : true,
      };
      // WASM SIMD 探测（轻量）
      try {
        if (typeof WebAssembly !== 'undefined' && WebAssembly.validate) {
          cap.wasmSimd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
        }
      } catch (e) { cap.wasmSimd = false; }
      // WebGPU adapter 探测（仅一次）
      try {
        if (nav.gpu && nav.gpu.requestAdapter) {
          const a = await nav.gpu.requestAdapter();
          cap.webgpu = !!a;
        }
      } catch (e) { cap.webgpu = false; }
      // 合并既有 AsrKit.runtime 探测结果（避免重复请求 adapter）
      try {
        const ar = global.AsrKit && global.AsrKit.runtime && global.AsrKit.runtime.getProfileSync;
        if (typeof ar === 'function') {
          const p = ar();
          if (p) {
            if (typeof p.webgpu === 'boolean' && !cap.webgpu) cap.webgpu = p.webgpu;
            if (typeof p.simd === 'boolean' && !cap.wasmSimd) cap.wasmSimd = p.simd;
            if (typeof p.sab === 'boolean' && !cap.sab) cap.sab = p.sab;
            if (typeof p.speechRecognition === 'boolean' && !cap.webspeech) cap.webspeech = p.speechRecognition;
          }
        }
      } catch (e) { /* ignore */ }
      _profileValue = cap;
      return cap;
    })();
    return _profile;
  }

  function getSync() { return _profileValue; }

  /** 单能力同步读（未探测完成时返回保守值 null） */
  function has(name) {
    const p = _profileValue;
    return p ? !!p[name] : null;
  }

  global.AppCore = global.AppCore || {};
  global.AppCore.Capability = { detect, getSync, has };
})(typeof window !== 'undefined' ? window : globalThis);
