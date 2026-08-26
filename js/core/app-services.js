'use strict';
/**
 * js/core/app-services.js —— AppServices 注册表 + Core Contracts（V3.0 §二十八/§二十九）
 *
 * 1) AppServices：统一服务注册表（db/diagnostics/flags/runtime/ocr/voice/weather），
 *    逐步减少 window.* 全局污染；旧 window API 保留 compatibility adapter。
 * 2) Core Contracts：OCR/Voice/Weather 结构化契约（字段类型声明），
 *    禁止模块间传任意 object。
 */
(function (global) {
  const services = {};

  function register(name, svc) {
    services[name] = svc;
  }
  function get(name) { return services[name] || null; }
  function has(name) { return !!services[name]; }
  function keys() { return Object.keys(services); }

  // ---- 自动注册既有全局（compatibility adapter：逐步替换 window.* 调用） ----
  function autoRegister() {
    try {
      if (global.AppCore) {
        register('core', global.AppCore);
        if (global.AppCore.ErrorCodes) register('errorCodes', global.AppCore.ErrorCodes);
        if (global.AppCore.FeatureFlags) register('featureFlags', global.AppCore.FeatureFlags);
        if (global.AppCore.Capability) register('capability', global.AppCore.Capability);
        if (global.AppCore.Diagnostics) register('diagnostics', global.AppCore.Diagnostics);
        if (global.AppCore.RuntimeAssets) register('runtimeAssets', global.AppCore.RuntimeAssets);
        if (global.AppCore.ModelRouter) register('modelRouter', global.AppCore.ModelRouter);
        if (global.AppCore.DBMigration) register('dbMigration', global.AppCore.DBMigration);
        if (global.AppCore.DbHealth) register('dbHealth', global.AppCore.DbHealth);
        if (global.AppCore.ExportCSV) register('exportCsv', global.AppCore.ExportCSV);
      }
      if (global.OfflineDB) register('db', global.OfflineDB);
      if (global.VoiceSR) register('voice', global.VoiceSR);
      if (global.VoiceEngine) register('voiceEngine', global.VoiceEngine);
      if (global.WeatherKit) register('weather', global.WeatherKit);
      if (global.FxTool) register('fx', global.FxTool);
    } catch (e) { /* ignore */ }
  }

  // ================= Core Contracts（§十八） =================
  const CONTRACTS = {
    ocr: {
      OcrResult: ['text', 'fields', 'confidence', 'engine', 'durationMs', 'trace'],
      FieldCandidate: ['field', 'value', 'confidence', 'source', 'evidence'],
      ResolvedField: ['field', 'value', 'confidence', 'resolver', 'explain'],
      CorrectionEvent: ['field', 'ocrValue', 'userValue', 'attribution', 'timestamp'],
    },
    voice: {
      AsrResult: ['text', 'language', 'confidence', 'engine', 'durationMs'],
      VoiceSegment: ['text', 'startMs', 'endMs', 'confidence'],
      VoiceIntent: ['type', 'day', 'lang'],
      FieldCandidate: ['field', 'value', 'confidence', 'source'],
    },
    weather: {
      WeatherSnapshot: ['location', 'timezone', 'updatedAt', 'current', 'daily'],
      WeatherEvent: ['id', 'type', 'startTime', 'peakTime', 'endTime', 'severity', 'metrics'],
      WeatherAlert: ['type', 'message', 'severity', 'startsAt'],
    },
  };

  /** 校验对象是否符合契约（缺失字段列出） */
  function validateContract(domain, contractName, obj) {
    const fields = CONTRACTS[domain] && CONTRACTS[domain][contractName];
    if (!fields) return { ok: false, missing: ['unknown contract'], known: false };
    const missing = fields.filter(f => obj == null || obj[f] === undefined);
    return { ok: missing.length === 0, missing, known: true };
  }

  global.AppCore = global.AppCore || {};
  global.AppCore.AppServices = { register, get, has, keys, autoRegister, CONTRACTS, validateContract };
})(typeof window !== 'undefined' ? window : globalThis);
