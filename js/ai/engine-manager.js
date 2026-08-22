'use strict';
/**
 * AI Kit 统一引擎管理 —— 设备能力检测 + OCR/ASR 引擎路由
 *
 * 负责：
 *  - 一次性探测设备能力（WebGPU / WASM / 内存 / 线程）
 *  - 按能力 + 设备档位选择 OCR 主引擎（Paddle→Tesseract→Server）
 *  - 按能力 + 档位选择 ASR 主引擎（Whisper→WebSpeech→Unavailable）
 *  - 供工作台/语音 UI 读取统一能力徽标
 *
 * 设计：轻量门面，不持有重型引擎实例（实例按需懒加载）。
 */
(function (global) {
  // 复用全局 AIKit（可能已由 global-config 创建，含 globalConfig）
  // ⚠️ 必须用全局对象，否则 global.AIKit = global.AIKit || AIKit 在已存在时会丢弃本模块能力
  const AIKit = global.AIKit = global.AIKit || {};
  if (!AIKit.version) AIKit.version = '1.0.0';

  /* ================== 设备能力探测 ================== */
  let _cap = null;
  async function detectCapability() {
    if (_cap) return _cap;
    const nav = global.navigator || {};
    const cap = {
      webgpu: false,
      wasm: typeof WebAssembly !== 'undefined',
      simd: false,
      threads: false,
      memoryGb: nav.deviceMemory || null,
      cores: nav.hardwareConcurrency || null,
      mobile: /Mobi|Android|iPhone|iPad/i.test(nav.userAgent || ''),
      offline: !nav.onLine,
      speechRecognition: !!(global.SpeechRecognition || global.webkitSpeechRecognition),
    };
    try {
      if (WebAssembly && WebAssembly.validate) {
        cap.simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      }
    } catch (e) { /* ignore */ }
    try {
      cap.threads = (() => {
        const sab = typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(4) : null;
        return !!sab;
      })();
    } catch (e) { cap.threads = false; }
    try {
      if (nav.gpu) {
        const adapter = await nav.gpu.requestAdapter();
        cap.webgpu = !!adapter;
        if (cap.webgpu) { try { adapter.requestAdapterInfo && adapter.requestAdapterInfo().then(inf => { cap.gpuVendor = inf.vendor; }).catch(() => {}); } catch (e) {} }
      }
    } catch (e) { cap.webgpu = false; }
    _cap = cap;
    return cap;
  }

  /* ================== 档位 ================== */
  function deviceProfile(cap) {
    const c = cap || _cap || { memoryGb: null, cores: null, mobile: false };
    if (c.memoryGb == null) return c.mobile ? 'low' : 'balanced';
    if (c.memoryGb >= 8 && (c.cores || 8) >= 8) return 'high';
    if (c.memoryGb >= 4) return 'balanced';
    return 'low';
  }

  /* ================== OCR 路由 ================== */
  function ocrPlan(cap) {
    const c = cap || _cap || {};
    if (c.webgpu) return { engine: 'paddle', backend: 'webgpu', reason: 'WebGPU 加速' };
    if (c.wasm) return { engine: 'paddle', backend: 'wasm', reason: 'WASM（单线程）' };
    return { engine: 'server', backend: null, reason: '本地引擎不可用，走服务器' };
  }

  /* ================== ASR 路由 ================== */
  function asrPlan(cap, allowOnline) {
    const c = cap || _cap || {};
    if (c.webgpu || c.wasm) return { engine: 'whisper', backend: c.webgpu ? 'webgpu' : 'wasm', reason: '本地 Whisper' };
    if (allowOnline && c.speechRecognition) return { engine: 'webspeech', backend: 'online', reason: 'Web Speech（在线）' };
    return { engine: 'none', backend: null, reason: '无可用语音引擎' };
  }

  /* ================== 能力徽标（UI 用） ================== */
  function capabilityBadge(cap) {
    const c = cap || _cap || {};
    const parts = [];
    parts.push(c.webgpu ? 'WebGPU' : (c.wasm ? 'WASM' : '无本地推理'));
    parts.push(c.threads ? '多线程' : '单线程');
    if (c.memoryGb) parts.push(c.memoryGb + 'GB');
    if (c.mobile) parts.push('移动端');
    if (!c.offline) parts.push('在线');
    return parts.join(' · ');
  }

  /* ================== 命名空间导出 ================== */
  Object.assign(AIKit, {
    detectCapability, deviceProfile, ocrPlan, asrPlan, capabilityBadge,
  });
})(typeof window !== 'undefined' ? window : globalThis);
