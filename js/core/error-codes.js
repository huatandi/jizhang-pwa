'use strict';
/**
 * js/core/error-codes.js —— ErrorCode Registry（V3.0 §十七）
 *
 * 统一错误码，禁止散落 console.error('failed')。
 * 所有模块（OCR/ASR/DB/Weather/Currency/Reminder/Core）共用一套枚举。
 * 附带 i18n 消息映射（zh/es/en）与中文默认。
 */
(function (global) {
  const CODES = {
    // ---- 通用 ----
    UNKNOWN: 'UNKNOWN',
    NOT_SUPPORTED: 'NOT_SUPPORTED',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    TIMEOUT: 'TIMEOUT',
    ABORTED: 'ABORTED',
    NETWORK: 'NETWORK',
    INVALID_INPUT: 'INVALID_INPUT',
    // ---- OCR ----
    OCR_INIT_FAILED: 'OCR_INIT_FAILED',
    OCR_INFERENCE_TIMEOUT: 'OCR_INFERENCE_TIMEOUT',
    OCR_LOW_CONFIDENCE: 'OCR_LOW_CONFIDENCE',
    OCR_ENGINE_ERROR: 'OCR_ENGINE_ERROR',
    OCR_NO_TEXT: 'OCR_NO_TEXT',
    OCR_WASM_FAILED: 'OCR_WASM_FAILED',
    OCR_WEBGPU_FAILED: 'OCR_WEBGPU_FAILED',
    OCR_MODEL_FETCH_FAILED: 'OCR_MODEL_FETCH_FAILED',
    // ---- ASR / Voice ----
    ASR_MODEL_FETCH_FAILED: 'ASR_MODEL_FETCH_FAILED',
    ASR_INIT_FAILED: 'ASR_INIT_FAILED',
    ASR_MIC_UNAVAILABLE: 'ASR_MIC_UNAVAILABLE',
    ASR_NO_SPEECH: 'ASR_NO_SPEECH',
    ASR_FAILED: 'ASR_FAILED',
    VOICE_UNSUPPORTED: 'VOICE_UNSUPPORTED',
    // ---- DB ----
    DB_MIGRATION_FAILED: 'DB_MIGRATION_FAILED',
    DB_OPEN_FAILED: 'DB_OPEN_FAILED',
    DB_QUERY_FAILED: 'DB_QUERY_FAILED',
    DB_INTEGRITY_FAILED: 'DB_INTEGRITY_FAILED',
    // ---- Weather ----
    WEATHER_PROVIDER_FAILED: 'WEATHER_PROVIDER_FAILED',
    WEATHER_GEOCODE_FAILED: 'WEATHER_GEOCODE_FAILED',
    WEATHER_NO_CITY: 'WEATHER_NO_CITY',
    // ---- Exchange ----
    FX_PROVIDER_FAILED: 'FX_PROVIDER_FAILED',
    FX_RATE_MISSING: 'FX_RATE_MISSING',
    // ---- Reminder ----
    REMINDER_SAVE_FAILED: 'REMINDER_SAVE_FAILED',
    REMINDER_PERMISSION_DENIED: 'REMINDER_PERMISSION_DENIED',
    // ---- Core ----
    CORE_CONFIG_INVALID: 'CORE_CONFIG_INVALID',
  };

  const MESSAGES = {
    UNKNOWN: { zh: '未知错误', es: 'Error desconocido', en: 'Unknown error' },
    NOT_SUPPORTED: { zh: '当前环境不支持', es: 'No compatible', en: 'Not supported' },
    PERMISSION_DENIED: { zh: '权限被拒绝', es: 'Permiso denegado', en: 'Permission denied' },
    TIMEOUT: { zh: '操作超时', es: 'Tiempo agotado', en: 'Timeout' },
    ABORTED: { zh: '操作已中止', es: 'Operación cancelada', en: 'Aborted' },
    NETWORK: { zh: '网络错误', es: 'Error de red', en: 'Network error' },
    INVALID_INPUT: { zh: '输入无效', es: 'Entrada inválida', en: 'Invalid input' },
    OCR_INIT_FAILED: { zh: 'OCR 初始化失败', es: 'Fallo al iniciar OCR', en: 'OCR init failed' },
    OCR_INFERENCE_TIMEOUT: { zh: 'OCR 识别超时', es: 'Tiempo de OCR agotado', en: 'OCR inference timeout' },
    OCR_LOW_CONFIDENCE: { zh: 'OCR 置信度过低', es: 'Confianza baja de OCR', en: 'OCR low confidence' },
    OCR_ENGINE_ERROR: { zh: 'OCR 引擎错误', es: 'Error del motor OCR', en: 'OCR engine error' },
    OCR_NO_TEXT: { zh: '未识别到文字', es: 'Sin texto detectado', en: 'No text detected' },
    OCR_WASM_FAILED: { zh: 'OCR WASM 加载失败', es: 'Fallo WASM de OCR', en: 'OCR WASM failed' },
    OCR_WEBGPU_FAILED: { zh: 'OCR WebGPU 失败', es: 'Fallo WebGPU de OCR', en: 'OCR WebGPU failed' },
    OCR_MODEL_FETCH_FAILED: { zh: 'OCR 模型下载失败', es: 'Fallo al descargar modelo OCR', en: 'OCR model fetch failed' },
    ASR_MODEL_FETCH_FAILED: { zh: '语音模型下载失败', es: 'Fallo al descargar modelo ASR', en: 'ASR model fetch failed' },
    ASR_INIT_FAILED: { zh: '语音引擎初始化失败', es: 'Fallo al iniciar ASR', en: 'ASR init failed' },
    ASR_MIC_UNAVAILABLE: { zh: '麦克风不可用', es: 'Micrófono no disponible', en: 'Microphone unavailable' },
    ASR_NO_SPEECH: { zh: '没有听清，请再说一次', es: 'No entendí, repite por favor', en: 'No speech detected' },
    ASR_FAILED: { zh: '语音识别失败', es: 'Fallo de reconocimiento', en: 'ASR failed' },
    VOICE_UNSUPPORTED: { zh: '当前浏览器不支持语音', es: 'El navegador no soporta voz', en: 'Speech not supported' },
    DB_MIGRATION_FAILED: { zh: '数据库升级失败，请勿继续写入', es: 'Error de migración de BD', en: 'DB migration failed' },
    DB_OPEN_FAILED: { zh: '数据库打开失败', es: 'Fallo al abrir BD', en: 'DB open failed' },
    DB_QUERY_FAILED: { zh: '数据库查询失败', es: 'Error de consulta BD', en: 'DB query failed' },
    DB_INTEGRITY_FAILED: { zh: '数据库完整性异常', es: 'Integridad de BD comprometida', en: 'DB integrity failed' },
    WEATHER_PROVIDER_FAILED: { zh: '天气服务获取失败', es: 'Fallo del servicio meteorológico', en: 'Weather provider failed' },
    WEATHER_GEOCODE_FAILED: { zh: '天气城市定位失败', es: 'Fallo al geocodificar ciudad', en: 'Weather geocode failed' },
    WEATHER_NO_CITY: { zh: '未设置天气城市', es: 'Ciudad no configurada', en: 'Weather city not set' },
    FX_PROVIDER_FAILED: { zh: '汇率服务获取失败', es: 'Fallo del servicio de divisas', en: 'FX provider failed' },
    FX_RATE_MISSING: { zh: '缺少汇率数据', es: 'Sin tipo de cambio', en: 'FX rate missing' },
    REMINDER_SAVE_FAILED: { zh: '提醒保存失败', es: 'Fallo al guardar recordatorio', en: 'Reminder save failed' },
    REMINDER_PERMISSION_DENIED: { zh: '通知权限被拒绝', es: 'Permiso de notificación denegado', en: 'Notification permission denied' },
    CORE_CONFIG_INVALID: { zh: '核心配置无效', es: 'Configuración inválida', en: 'Core config invalid' },
  };

  function message(code, lang) {
    const m = MESSAGES[code] || MESSAGES.UNKNOWN;
    const l = lang || 'zh';
    return m[l] || m.zh;
  }

  /** 创建带错误码的 Error（ErrorCode Registry 规范化出口） */
  function error(code, detail, cause) {
    const e = new Error(message(code) + (detail ? ' · ' + detail : ''));
    e.code = code;
    e.weather = code.indexOf('WEATHER') === 0;
    e.detail = detail;
    if (cause) e.cause = cause;
    return e;
  }

  global.AppCore = global.AppCore || {};
  global.AppCore.ErrorCodes = { CODES, MESSAGES, message, error };
})(typeof window !== 'undefined' ? window : globalThis);
