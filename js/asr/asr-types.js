'use strict';
/**
 * AsrKit · asr-types —— ASR 引擎统一抽象层
 *
 * 所有 ASR 引擎（Whisper / WebSpeech / 未来其他）实现 AsrEngine 接口，
 * 业务层（VoiceEngine V2 / VoiceSR / 工作台）只消费 AsrResult，绝不直接碰引擎。
 *
 * 与 OCR 层对称：OcrEngine ↔ AsrEngine，最终都汇入 Finance 语义层。
 */
(function (global) {
  // 后端类型常量
  const BACKENDS = {
    WEBGPU: 'webgpu',
    WASM: 'wasm',
    WEBSPEECH: 'webspeech',
    UNAVAILABLE: 'unavailable',
  };

  // 引擎名称
  const ASR_ENGINES = {
    WHISPER: 'whisper',
    WEBSPEECH: 'webspeech',
  };

  // 状态机（VoiceSR / 引擎共享）
  const STATES = {
    IDLE: 'IDLE',
    INITIALIZING: 'INITIALIZING',
    READY: 'READY',
    LISTENING: 'LISTENING',
    PROCESSING: 'PROCESSING',
    SUCCESS: 'SUCCESS',
    ERROR: 'ERROR',
    STOPPED: 'STOPPED',
  };

  // 错误码
  const ERRORS = {
    MICROPHONE_DENIED: 'MICROPHONE_DENIED',
    MICROPHONE_UNAVAILABLE: 'MICROPHONE_UNAVAILABLE',
    BROWSER_UNSUPPORTED: 'BROWSER_UNSUPPORTED',
    WEBGPU_UNAVAILABLE: 'WEBGPU_UNAVAILABLE',
    WEBGPU_FAILED: 'WEBGPU_FAILED',
    WASM_FAILED: 'WASM_FAILED',
    MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',
    MODEL_CACHE_FAILED: 'MODEL_CACHE_FAILED',
    OUT_OF_MEMORY: 'OUT_OF_MEMORY',
    AUDIO_FORMAT_FAILED: 'AUDIO_FORMAT_FAILED',
    VAD_FAILED: 'VAD_FAILED',
    ASR_FAILED: 'ASR_FAILED',
    NO_SPEECH: 'NO_SPEECH',
    TIMEOUT: 'TIMEOUT',
    NETWORK_REQUIRED: 'NETWORK_REQUIRED',
  };

  // 友好错误提示（多语言）
  const ERROR_MESSAGES = {
    MICROPHONE_DENIED: { zh: '请允许麦克风权限后重试', es: 'Permite el acceso al micrófono', en: 'Please allow microphone access' },
    MICROPHONE_UNAVAILABLE: { zh: '没有检测到麦克风', es: 'No se detectó micrófono', en: 'No microphone detected' },
    BROWSER_UNSUPPORTED: { zh: '当前浏览器不支持语音识别', es: 'El navegador no soporta voz', en: 'Speech not supported' },
    WEBGPU_UNAVAILABLE: { zh: '当前设备不支持 WebGPU，切换到兼容模式', es: 'WebGPU no disponible, modo compatible', en: 'WebGPU unavailable, using compatible mode' },
    WEBGPU_FAILED: { zh: 'WebGPU 初始化失败，切换到兼容模式', es: 'Error WebGPU, modo compatible', en: 'WebGPU failed, using compatible mode' },
    WASM_FAILED: { zh: '本地语音引擎初始化失败', es: 'Error al iniciar motor de voz', en: 'Local speech engine failed' },
    MODEL_LOAD_FAILED: { zh: '语音模型加载失败', es: 'Error al cargar modelo', en: 'Model load failed' },
    MODEL_CACHE_FAILED: { zh: '语音模型缓存失败', es: 'Error de caché de modelo', en: 'Model cache failed' },
    OUT_OF_MEMORY: { zh: '设备内存不足，已切换到兼容模式', es: 'Memoria insuficiente, modo compatible', en: 'Low memory, using compatible mode' },
    AUDIO_FORMAT_FAILED: { zh: '音频格式处理失败', es: 'Error de formato de audio', en: 'Audio format failed' },
    VAD_FAILED: { zh: '语音检测失败', es: 'Error de detección de voz', en: 'Voice detection failed' },
    ASR_FAILED: { zh: '没有听清，请再说一次', es: 'No entendí, repite por favor', en: 'Did not catch that, please repeat' },
    NO_SPEECH: { zh: '没有检测到语音', es: 'No se detectó voz', en: 'No speech detected' },
    TIMEOUT: { zh: '识别超时，请重试', es: 'Tiempo agotado, reintenta', en: 'Timed out, please retry' },
    NETWORK_REQUIRED: { zh: '首次使用需要联网下载语音模型', es: 'Primera vez requiere conexión', en: 'First use requires network' },
  };

  function errorMessage(code, lang) {
    const m = ERROR_MESSAGES[code];
    if (!m) return '语音识别失败';
    const L = String(lang || 'zh').toLowerCase();
    if (L.startsWith('es')) return m.es;
    if (L.startsWith('en')) return m.en;
    return m.zh;
  }

  /**
   * 基类：强制接口契约
   */
  class AsrEngineBase {
    constructor(name) {
      this.name = name || 'unknown';
    }
    async initialize() { throw new Error(`${this.name}: initialize 未实现`); }
    async start() { throw new Error(`${this.name}: start 未实现`); }
    async stop() { throw new Error(`${this.name}: stop 未实现`); }
    async pause() { /* 可选 */ }
    async resume() { /* 可选 */ }
    async transcribe() { throw new Error(`${this.name}: transcribe 未实现`); }
    async dispose() { /* 可选 */ }
  }

  global.AsrKit = global.AsrKit || {};
  Object.assign(global.AsrKit, {
    BACKENDS,
    ASR_ENGINES,
    STATES,
    ERRORS,
    AsrEngineBase,
    errorMessage,
  });
})(typeof window !== 'undefined' ? window : globalThis);
