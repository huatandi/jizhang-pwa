'use strict';
/**
 * VoiceRuntimeProfile —— 语音运行时能力门控(V5 Phase1 保险1)
 *
 * 启动时一次性探测并缓存在 AsrKit.runtime;AsrManager 据此路由,不靠"点了试→报错→再回退"。
 * 提供本地 Feature Flags + Kill Switch(保险8,不依赖远端)。
 */
(function (global) {
  const AsrKit = global.AsrKit = global.AsrKit || {};
  let _profile = null; // Promise<capability>
  let _profileValue = null;

  function _hasSAB() { try { return typeof SharedArrayBuffer !== 'undefined'; } catch (e) { return false; } }
  function _isolated() {
    try { return (typeof global.crossOriginIsolated !== 'undefined' && global.crossOriginIsolated) || _hasSAB(); }
    catch (e) { return false; }
  }

  /** 异步探测能力(缓存;含 WebGPU adapter 探测) */
  function detect() {
    if (_profile) return _profile;
    _profile = (async () => {
      const nav = global.navigator || {};
      const cap = {
        webgpu: false,
        wasm: typeof WebAssembly !== 'undefined',
        simd: false,
        sab: _hasSAB(),
        isolated: _isolated(),
        audioWorklet: typeof global.AudioWorkletNode !== 'undefined',
        offscreenCanvas: typeof global.OffscreenCanvas !== 'undefined',
        memoryGb: nav.deviceMemory || null,
        cores: nav.hardwareConcurrency || null,
        audioCapture: !!(nav.mediaDevices && nav.mediaDevices.getUserMedia),
        speechRecognition: !!(global.SpeechRecognition || global.webkitSpeechRecognition),
      };
      try {
        if (typeof WebAssembly !== 'undefined' && WebAssembly.validate) {
          cap.simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
        }
      } catch (e) { /* ignore */ }
      try {
        if (nav.gpu) { const a = await nav.gpu.requestAdapter(); cap.webgpu = !!a; }
      } catch (e) { cap.webgpu = false; }
      _profileValue = cap;
      return cap;
    })();
    return _profile;
  }

  function getProfileSync() { return _profileValue; }

  /** 依据 Profile 给出 ASR 可行后端(路由建议) */
  function asrBackendPlan(cap) {
    const c = cap || _profileValue || {};
    if (c.webgpu && c.isolated) return { engine: 'whisper', backend: 'webgpu', reason: 'WebGPU 可用(需隔离环境)' };
    if (c.wasm) return { engine: 'whisper', backend: 'wasm', reason: 'WASM(单线程)' };
    if (c.speechRecognition) return { engine: 'webspeech', backend: 'online', reason: 'Web Speech(在线,需符合隐私策略)' };
    return { engine: 'none', backend: null, reason: '无可用语音引擎' };
  }

  // ---- Feature Flags + Kill Switch(保险8) ----
  const DEFAULT_FLAGS = {
    whisperV2Pipeline: true,
    sessionHandleV2: true,
    memoryCandidateMode: true,
    audioFocusV2: true,
    adaptiveVadEnabled: false,
    preRollEnabled: false,
    voiceIntentV2Enabled: false,
    dynamicEvidenceEnabled: true,
    modelRouterV2Enabled: false,
    selfTestEnabled: true,
    // OCR 试验：Paddle WebGPU 实验路径（默认关闭；开启后仅在有 navigator.gpu 时尝试 WebGPU，
    // 失败自动回 WASM 单线程，再失败 → Tesseract。用于同图 benchmark，不改变默认稳定路径）
    paddleWebGpuExperimental: false,
  };
  const FLAG_KEY = 'sm_voice_flags';
  let _memFlags = null; // 无 localStorage 环境(如 Node 测试)的降级

  function _storage() { try { return global.localStorage || null; } catch (e) { return null; } }

  function getFlags() {
    let overrides = {};
    if (_memFlags) overrides = _memFlags;
    else { try { overrides = JSON.parse(_storage() && _storage().getItem(FLAG_KEY) || '{}') || {}; } catch (e) { /* ignore */ } }
    return Object.assign({}, DEFAULT_FLAGS, overrides);
  }
  function isEnabled(name) { return !!getFlags()[name]; }
  function setFlag(name, value) {
    const s = getFlags(); s[name] = !!value;
    if (_storage()) { try { _storage().setItem(FLAG_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
    else { _memFlags = s; }
  }
  function resetFlags() { _memFlags = null; try { _storage() && _storage().removeItem(FLAG_KEY); } catch (e) { /* ignore */ } }

  AsrKit.runtime = {
    detect, getProfileSync, asrBackendPlan, isEnabled, getFlags, setFlag, resetFlags, DEFAULT_FLAGS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
