'use strict';
/**
 * js/core/model-source-router.js —— ModelSourceRouter（V3.0 §十三）
 *
 * 每个模型配置多个候选源（local / selfHosted / jsDelivr / huggingface），
 * 按健康状态选择；失败源在会话内不连续重试（负缓存）。
 * 不做默认 hf-mirror（V7 已确认其 CORS 会阻断 GitHub Pages）。
 *
 * 纯配置/路由层；实际加载仍由各引擎（whisper/paddle）调用本路由取 URL。
 */
(function (global) {
  // source → 健康状态（会话内）
  const health = {};   // key: 'modelRepo|source' → { failures, until }
  const NEGATIVE_CACHE_MS = 10 * 60 * 1000; // 失败源 10 分钟负缓存

  /**
   * 模型源定义（按优先级）
   * @returns {Array<{name, base, resolve(repo,file):string}>}
   */
  function defaultSources() {
    return [
      { name: 'local', base: '', resolve: (repo, file) => null }, // 本地缓存由引擎自持
      { name: 'jsdelivr', base: 'https://cdn.jsdelivr.net/gh/huggingface/transformers.js@main', resolve: null },
      { name: 'huggingface', base: 'https://huggingface.co', resolve: null },
    ];
  }

  function key(repo, src) { return repo + '|' + src; }

  /** 标记源失败（负缓存） */
  function markFailure(repo, source) {
    health[key(repo, source)] = { failures: (health[key(repo, source)] || {}).failures || 0, until: Date.now() + NEGATIVE_CACHE_MS };
  }
  function markSuccess(repo, source) {
    health[key(repo, source)] = { failures: 0, until: 0 };
  }

  /** 该源当前是否可用（未负缓存） */
  function isHealthy(repo, source) {
    const h = health[key(repo, source)];
    if (!h) return true;
    if (h.until && Date.now() < h.until) return false;
    return h.failures < 3;
  }

  /**
   * 生成模型文件候选 URL 列表（按健康度过滤后）。
   * @param {string} repo  如 'Xenova/whisper-tiny'
   * @param {string} file  如 'onnx/model_quantized.onnx'
   * @returns {Array<{source, url}>}
   */
  function resolveCandidates(repo, file) {
    const out = [];
    const f = String(file || '').replace(/^\//, '');
    for (const src of defaultSources()) {
      if (!isHealthy(repo, src.name)) continue;
      if (src.name === 'local') { out.push({ source: 'local', url: null }); continue; }
      if (src.name === 'huggingface') { out.push({ source: 'huggingface', url: 'https://huggingface.co/' + repo + '/resolve/main/' + f }); continue; }
      if (src.name === 'jsdelivr') { out.push({ source: 'jsdelivr', url: 'https://cdn.jsdelivr.net/gh/' + repo + '@main/' + f }); continue; }
    }
    return out;
  }

  function resetSession() {
    for (const k of Object.keys(health)) delete health[k];
  }

  global.AppCore = global.AppCore || {};
  global.AppCore.ModelRouter = { defaultSources, resolveCandidates, markFailure, markSuccess, isHealthy, resetSession };
})(typeof window !== 'undefined' ? window : globalThis);
