'use strict';
/**
 * ValidateKit · confidence —— 多源置信度合成引擎
 *
 * OCR/ASR 提取的每个字段都携带多层分数：
 *   ocrScore   引擎原始置信（0~1）
 *   regexScore 正则/校验器命中（0~1）
 *   posScore   几何位置匹配度（标签-值相对位置，0~1）
 *   semantic   语义一致性（如金额合理性、日期不超限，0~1）
 *
 * 最终置信 = 加权平均 + 惩罚项（字段缺失/冲突）。
 * 阈值建议：>=0.7 自动填入 / 0.5~0.7 待确认 / <0.5 重识别。
 */
(function (global) {
  const FIELD_WEIGHTS = {
    total:      { ocr: 0.35, regex: 0.25, pos: 0.2, semantic: 0.2 },
    date:       { ocr: 0.3,  regex: 0.35, pos: 0.2, semantic: 0.15 },
    merchant:   { ocr: 0.5,  regex: 0.1,  pos: 0.25, semantic: 0.15 },
    folio:      { ocr: 0.4,  regex: 0.3,  pos: 0.3,  semantic: 0 },
    rfc:        { ocr: 0.35, regex: 0.4,  pos: 0.15, semantic: 0.1 },
    uuid:       { ocr: 0.3,  regex: 0.45, pos: 0.15, semantic: 0.1 },
    items:      { ocr: 0.4,  regex: 0.2,  pos: 0.4,  semantic: 0 },
  };

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  /**
   * 合成单个字段置信。
   * @param {Object} meta { ocr, regex, pos, semantic }
   * @param {string} field
   */
  function scoreField(meta, field) {
    const w = FIELD_WEIGHTS[field] || FIELD_WEIGHTS.total;
    const parts = [];
    let wsum = 0;
    if (meta.ocr != null)   { parts.push(meta.ocr * w.ocr);   wsum += w.ocr; }
    if (meta.regex != null) { parts.push(meta.regex * w.regex); wsum += w.regex; }
    if (meta.pos != null)   { parts.push(meta.pos * w.pos);   wsum += w.pos; }
    if (meta.semantic != null) { parts.push(meta.semantic * w.semantic); wsum += w.semantic; }
    if (!wsum) return 0;
    return clamp01(parts.reduce((a, b) => a + b, 0) / wsum);
  }

  /**
   * 整体置信：所有已提取字段的加权平均 × 覆盖率。
   * @param {Object} fields 字段名 → { score, extracted }
   * @param {Object} expected 期望字段列表（缺失惩罚）
   */
  function scoreDocument(fields, expected) {
    const keys = Object.keys(fields).filter(k => fields[k].extracted !== false);
    if (!keys.length) return 0;
    let sum = 0;
    for (const k of keys) sum += fields[k].score || 0;
    const avg = sum / keys.length;
    // 覆盖率惩罚：期望字段缺失 → 降分
    let cov = 1;
    if (expected && expected.length) {
      const present = expected.filter(k => fields[k] && fields[k].extracted).length;
      cov = present / expected.length;
    }
    return clamp01(avg * (0.4 + 0.6 * cov));
  }

  /** 字段级判定：auto / confirm / retry */
  function decision(score) {
    if (score >= 0.7) return 'auto';
    if (score >= 0.5) return 'confirm';
    return 'retry';
  }

  function color(score) {
    if (score >= 0.7) return 'green';
    if (score >= 0.5) return 'orange';
    return 'red';
  }

  global.ValidateKit = global.ValidateKit || {};
  Object.assign(global.ValidateKit, {
    confidence: { scoreField, scoreDocument, decision, color, FIELD_WEIGHTS },
  });
})(typeof window !== 'undefined' ? window : globalThis);
