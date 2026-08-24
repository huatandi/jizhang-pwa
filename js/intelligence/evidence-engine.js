'use strict';
/**
 * EvidenceEngine —— 字段证据与溯源（V4 Phase 1 核心）
 *
 * 原则（§4-§6）：Voice / OCR / QR / Manual 都不能直接修改业务字段，
 * 统一先产生 Field Evidence，由本引擎做多源融合与决策。
 *
 * Evidence 结构：
 *   {
 *     field, value, confidence, source, evidence, resolver,
 *     original, timestamp, editable
 *   }
 *
 * 来源优先级（数字越大越可信，用于多源同值时取优）：
 *   user(1.0) > qr(0.99) > memory(0.95) > voice(0.90) > ocr(0.85) > fuzzy(0.45)
 *
 * 决策复用 RecognitionCore.confidenceEngine（AUTO/SOFT/HARD/RETRY，阈值配置化）。
 */
(function (global) {
  // 来源优先级（多源融合时取最高者）
  const SOURCE_PRIORITY = {
    user: 1.00, qr: 0.99, memory: 0.95, voice: 0.90, ocr: 0.85,
    manual: 1.00, fusion: 0.97, tesseract: 0.86, paddle: 0.88, fuzzy: 0.45, default: 0.50,
  };
  function sourceWeight(source) { return SOURCE_PRIORITY[source] != null ? SOURCE_PRIORITY[source] : SOURCE_PRIORITY.default; }

  /**
   * 创建一条字段证据
   * @param {Object} o { field, value, confidence, source, evidence, resolver, original, editable }
   */
  function create(o) {
    return {
      field: o.field,
      value: o.value,
      confidence: Math.min(1, Math.max(0, Number(o.confidence) || 0)),
      source: o.source || 'default',
      evidence: o.evidence || null,   // { transcript } / { engine, text, bbox } / { type:'qr' }
      resolver: o.resolver || null,   // { type, match }
      original: o.original != null ? o.original : (o.value != null ? o.value : null),
      timestamp: o.timestamp || Date.now(),
      editable: o.editable !== false,
    };
  }

  /** 用户手动输入/修改（最高可信） */
  function user(field, value) { return create({ field, value, confidence: 1, source: 'user' }); }

  /**
   * 多源融合：同字段的若干条证据 → 决策
   * - 所有候选值一致 → 取最高置信证据（含来源加权），AUTO/SOFT 决策
   * - 存在不同值 → CONFLICT，返回按综合分排序的候选
   * @returns {{
   *   field, action: 'AUTO_ACCEPT'|'SOFT_CONFIRM'|'HARD_CONFIRM'|'RETRY'|'CONFLICT',
   *   value, confidence, source, evidence, all, candidates, conflict
   * }}
   */
  function fuse(field, evidences, opts) {
    const list = (evidences || []).filter(Boolean);
    const o = opts || {};
    if (!list.length) return { field, action: 'RETRY', value: null, confidence: 0, source: null, evidence: null, all: [], candidates: [], conflict: false };

    // 按 (值) 分组，组内取"置信度 × 来源权重"最高者
    const groups = {};
    for (const ev of list) {
      const key = String(ev.value);
      if (!groups[key]) groups[key] = [];
      groups[key].push(ev);
    }
    const candidates = Object.keys(groups).map((key) => {
      const g = groups[key];
      let best = g[0];
      let bestScore = -1;
      for (const e of g) {
        const score = e.confidence * sourceWeight(e.source);
        if (score > bestScore) { bestScore = score; best = e; }
      }
      // 组综合置信：最高证据置信（可被用户确认提升）
      return {
        value: best.value,
        confidence: best.confidence,
        source: best.source,
        evidence: best.evidence,
        resolver: best.resolver,
        original: best.original,
        score: Math.round(bestScore * 100) / 100,
      };
    });
    candidates.sort((a, b) => b.score - a.score);

    const conflict = candidates.length > 1;
    const chosen = candidates[0];

    // 决策阈值（配置化；关键字段更严）
    const th = (o.thresholds && o.thresholds[field]) || (global.RecognitionCore && global.RecognitionCore.confidenceEngine
      ? global.RecognitionCore.confidenceEngine.thresholds(field) : { auto: 0.90, soft: 0.75, hard: 0.55 });

    let action;
    if (conflict) action = 'CONFLICT';
    else if (chosen.confidence >= th.auto) action = 'AUTO_ACCEPT';
    else if (chosen.confidence >= th.soft) action = 'SOFT_CONFIRM';
    else if (chosen.confidence >= th.hard) action = 'HARD_CONFIRM';
    else action = 'RETRY';

    return {
      field,
      action,
      value: chosen.value,
      confidence: chosen.confidence,
      source: chosen.source,
      evidence: chosen.evidence,
      resolver: chosen.resolver,
      original: chosen.original,
      all: list,
      candidates,
      conflict,
    };
  }

  /**
   * 生成"解释"（Debug/展示用，§28）：为什么填这个值。
   * @returns {string[]} 原因列表
   */
  function explain(fused) {
    if (!fused) return [];
    const reasons = [];
    if (fused.source) reasons.push(`来源：${fused.source}`);
    if (fused.evidence && fused.evidence.transcript) reasons.push(`语音原文：${fused.evidence.transcript}`);
    if (fused.evidence && fused.evidence.text) reasons.push(`OCR 原文：${fused.evidence.text}`);
    if (fused.resolver && fused.resolver.type) reasons.push(`匹配：${fused.resolver.type}`);
    if (fused.original != null && String(fused.original) !== String(fused.value)) reasons.push(`原始值：${fused.original}`);
    reasons.push(`置信度：${Math.round(fused.confidence * 100)}%`);
    if (fused.action === 'CONFLICT') reasons.push('存在多个候选，需用户选择');
    return reasons;
  }

  global.EvidenceEngine = { create, user, fuse, explain, sourceWeight, SOURCE_PRIORITY };
})(typeof window !== 'undefined' ? window : globalThis);
