'use strict';
/**
 * js/core/feature-flags.js —— FeatureFlag Center（V3.0 §十四）
 *
 * 统一管理实验能力，替代散落的局部开关：
 *   - DEFAULT：出厂默认
 *   - LOCAL_SETTING：localStorage 覆盖（sm_feature_flags）
 *   - RUNTIME_OVERRIDE：内存覆盖（本次会话，如调试）
 * 支持 Emergency Kill Switch：任一 flag 可被强制关闭，避免新功能出 bug 拖垮整个 App。
 * 兼容既有 AsrKit.runtime flags（voice-runtime-profile）——读取时合并。
 */
(function (global) {
  const DEFAULT_FLAGS = {
    // ---- OCR（V3.0 §十四 列出的实验能力）----
    ocrWebGpu: false,                 // Paddle WebGPU 实验路径（默认关闭）
    ocrV7Intelligence: true,          // Document Intelligence V7（稳定）
    ocrTemplateLearning: true,        // 模板纠错学习
    ocrRoiRescue: true,               // ROI 救援
    // ---- Voice ----
    voiceDraftSession: true,          // Draft Session（V6 稳定）
    adaptiveVad: false,               // 自适应 VAD（实验）
    whisperLocal: true,               // 本地 Whisper
    webspeechFallback: true,          // WebSpeech 回退
    // ---- AI ----
    glmOcrRescue: false,              // GLM OCR 救援（实验，需网络）
    aiCloudAssist: false,             // 云端 AI 辅助（默认关，隐私）
    // ---- Weather ----
    weatherPush: false,               // 云端天气推送（默认关，需 Serverless）
    // ---- Sync ----
    cloudSync: false,                 // 云端同步（默认关，隐私）
    // ---- Debug ----
    diagnosticsEnabled: true,         // 诊断采集
    verboseDiagnostics: false,        // 详细诊断（默认关，省存储）
  };
  const LS_KEY = 'sm_feature_flags';
  let _mem = null;          // RUNTIME_OVERRIDE
  let _memLocal = null;     // 本进程 LOCAL_SETTING 缓存

  function _storage() { try { return global.localStorage || null; } catch (e) { return null; } }

  function localOverrides() {
    if (_memLocal) return _memLocal;
    let o = {};
    try { o = JSON.parse(_storage() && _storage().getItem(LS_KEY) || '{}') || {}; } catch (e) { /* ignore */ }
    _memLocal = o;
    return o;
  }

  /** 完整合并视图：DEFAULT ← LOCAL_SETTING ← RUNTIME_OVERRIDE（runtime 覆盖最高） */
  function getFlags() {
    const merged = Object.assign({}, DEFAULT_FLAGS, localOverrides(), _mem || {});
    // 合并既有 AsrKit.runtime flags（voice-runtime-profile 的 sm_voice_flags）
    try {
      const vrf = global.AsrKit && global.AsrKit.runtime && global.AsrKit.runtime.getFlags;
      if (typeof vrf === 'function') {
        const vf = vrf();
        if (vf && typeof vf === 'object') {
          // 映射：AsrKit 的 flag 名 → core 语义（已知别名）
          const alias = {
            adaptiveVadEnabled: 'adaptiveVad',
            voiceDraftSessionV1: 'voiceDraftSession',
            paddleWebGpuExperimental: 'ocrWebGpu',
            glmOcrOptionalEngine: 'glmOcrRescue',
          };
          for (const [srcKey, coreKey] of Object.entries(alias)) {
            if (typeof vf[srcKey] === 'boolean') merged[coreKey] = vf[srcKey];
          }
        }
      }
    } catch (e) { /* ignore */ }
    return merged;
  }

  function isEnabled(name) { return !!getFlags()[name]; }

  function setLocal(name, value) {
    const o = localOverrides();
    o[name] = !!value;
    _memLocal = o;
    try { _storage() && _storage().setItem(LS_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
  }
  /** RUNTIME_OVERRIDE：仅本次会话（不落盘） */
  function override(name, value) {
    _mem = Object.assign({}, _mem || {}, { [name]: !!value });
  }
  function resetLocal() {
    _memLocal = null;
    try { _storage() && _storage().removeItem(LS_KEY); } catch (e) { /* ignore */ }
  }
  function resetAll() { _mem = null; resetLocal(); }

  /** Emergency Kill Switch：强制关闭某 flag（本地落盘，优先级最高） */
  function kill(name) { setLocal(name, false); }
  /** 强制开启（如用户显式开启实验功能） */
  function enable(name) { setLocal(name, true); }

  global.AppCore = global.AppCore || {};
  global.AppCore.FeatureFlags = {
    DEFAULT_FLAGS, getFlags, isEnabled, setLocal, override, resetLocal, resetAll, kill, enable, LS_KEY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
