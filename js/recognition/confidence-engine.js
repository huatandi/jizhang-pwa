'use strict';
/**
 * RecognitionCore · confidence-engine —— 统一置信度与决策（§三十四 / §四十七）
 *
 * 置信度分层：
 *   0.90+  AUTO_ACCEPT   自动通过
 *   0.75+  SOFT_CONFIRM  轻确认（提示可跳过）
 *   0.55+  HARD_CONFIRM  人工确认
 *   <0.55  RETRY         重新识别 / 要求重说
 *
 * 综合置信度 = Recognition + Semantic + Domain + Consistency 加权。
 * 关键字段（金额/日期/账户）阈值更严。
 */
(function (global) {
  // 字段 → 决策阈值（金额/日期/账户最严，防错账）
  const FIELD_THRESHOLDS = {
    amount: { auto: 0.90, soft: 0.75, hard: 0.55 },
    date: { auto: 0.90, soft: 0.75, hard: 0.55 },
    account: { auto: 0.88, soft: 0.72, hard: 0.55 },
    category: { auto: 0.85, soft: 0.70, hard: 0.50 },
    merchant: { auto: 0.80, soft: 0.65, hard: 0.45 },
    default: { auto: 0.85, soft: 0.70, hard: 0.50 },
  };

  function thresholds(field) {
    return FIELD_THRESHOLDS[field] || FIELD_THRESHOLDS.default;
  }

  /** 单字段决策 */
  function decideField(field, confidence) {
    const c = Number(confidence) || 0;
    const th = thresholds(field);
    if (c >= th.auto) return { action: 'AUTO_ACCEPT', confidence: c };
    if (c >= th.soft) return { action: 'SOFT_CONFIRM', confidence: c };
    if (c >= th.hard) return { action: 'HARD_CONFIRM', confidence: c };
    return { action: 'RETRY', confidence: c };
  }

  /**
   * 综合置信度：加权多源
   * @param {Object} parts { recognition, semantic, domain, consistency } 各 0~1
   */
  function composite(parts) {
    const p = parts || {};
    const weights = { recognition: 0.4, semantic: 0.3, domain: 0.15, consistency: 0.15 };
    let sum = 0, wsum = 0;
    for (const k of Object.keys(weights)) {
      const v = Number(p[k]);
      if (Number.isFinite(v) && v >= 0 && v <= 1) { sum += v * weights[k]; wsum += weights[k]; }
    }
    return wsum ? Math.round((sum / wsum) * 100) / 100 : 0;
  }

  /**
   * 多字段整体决策：任一关键字段 HARD/RETRY → 整体需要人工确认
   * @param {Object} fields  { amount: {confidence}, date: {...}, ... }
   */
  function decideRecord(fields) {
    const critical = ['amount', 'date', 'account'];
    let worst = 'AUTO_ACCEPT';
    let worstConf = 1;
    for (const [name, f] of Object.entries(fields || {})) {
      const conf = f && Number.isFinite(f.confidence) ? f.confidence : 0;
      const d = decideField(critical.includes(name) ? name : 'default', conf);
      if (d.action === 'RETRY') { worst = 'RETRY'; worstConf = Math.min(worstConf, conf); }
      else if (d.action === 'HARD_CONFIRM' && (worst === 'AUTO_ACCEPT' || worst === 'SOFT_CONFIRM')) { worst = 'HARD_CONFIRM'; worstConf = Math.min(worstConf, conf); }
      else if (d.action === 'SOFT_CONFIRM' && worst === 'AUTO_ACCEPT') { worst = 'SOFT_CONFIRM'; worstConf = Math.min(worstConf, conf); }
      else worstConf = Math.min(worstConf, conf);
    }
    return { action: worst, worstConfidence: worstConf, fields: Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, decideField(k, v && v.confidence)])) };
  }

  global.RecognitionCore = global.RecognitionCore || {};
  Object.assign(global.RecognitionCore, {
    confidenceEngine: { decideField, decideRecord, composite, thresholds },
  });
})(typeof window !== 'undefined' ? window : globalThis);
