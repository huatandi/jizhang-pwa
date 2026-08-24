'use strict';
/**
 * OcrKit · execution-planner —— FAST/SMART/RESCUE 执行计划（V5 §68-70）
 *
 * criticalFieldConfidence(result)：关键字段（金额/日期形态词）独立置信——
 * 废除"只依赖全图平均置信"（§70）。
 *
 * planExecution：
 *   FAST   清晰 + 关键字段高置信 → 早退（§69，不 multipass 不回退）
 *   RESCUE 关键字段缺失 / 平均置信极低 / 关键置信过低 → 强制 multipass + 回退合并
 *   SMART  其余 → 维持现有阈值逻辑（avgConf < fallbackThreshold 才重试）
 *
 * 纯函数（可单测）。
 */
(function (global) {
  /**
   * 关键字段置信：金额形态词 + 日期形态词的平均置信。
   * @param {Object} result OcrResult
   * @returns {{ confidence, strong, missing }}
   */
  function criticalFieldConfidence(result) {
    const words = (result && result.words) || [];
    const amountWords = words.filter(w => /^\$?[¥€£￥]?\s*\d[\d,]*(\.\d{1,2})?$/.test(String(w.text || '').trim()));
    const dateWords = words.filter(w => /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(String(w.text || '')));
    const refs = amountWords.concat(dateWords);
    const conf = refs.length ? refs.reduce((s, w) => s + (Number(w.confidence) || 0), 0) / refs.length : 0;
    return {
      confidence: Math.round(conf * 100) / 100,
      strong: conf >= 0.7 && amountWords.length >= 1,
      missing: amountWords.length === 0,
    };
  }

  /**
   * 执行计划选择（§68）。
   * @param {Object} o { avgConf, criticalMissing, criticalConf }
   * @returns {'fast'|'smart'|'rescue'}
   */
  function planExecution(o) {
    const avgConf = o.avgConf || 0;
    const missing = !!o.criticalMissing;
    const crit = o.criticalConf != null ? o.criticalConf : 0;
    if (!missing && avgConf >= 0.75 && crit >= 0.7) return 'fast';   // 早退
    if (missing || avgConf < 0.45 || crit < 0.5) return 'rescue';     // 强制重试
    return 'smart';
  }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.executionPlanner = { criticalFieldConfidence, planExecution };
})(typeof window !== 'undefined' ? window : globalThis);
