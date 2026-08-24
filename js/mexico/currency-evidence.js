'use strict';
/**
 * MexicoParser · currency-evidence —— 货币符号智能推断（V5 §12-16）
 *
 * 问题：OCR 常把 "$" 识别成 "5"（如 "TOTAL 5 60" 实为 "TOTAL $60"）。
 * 不能无条件替换（§15）："金额前通常有货币符号"只是 Evidence，不是硬规则。
 *
 * 推断依据（多证据联合）：
 *   1. 数学关系：EFECTIVO - CAMBIO = TOTAL / Subtotal + IVA = TOTAL
 *   2. 其他金额格式：同票多数金额带 $ 前缀
 *   3. 标签位置：TOTAL/SUBTOTAL/IVA 等金额标签后的数字
 *   4. 字符形态：疑似"5 60"（5 + 空格 + 数字）模式
 *
 * 典型修复：
 *   EFECTIVO $70 / CAMBIO $10 / TOTAL 5 60  →  TOTAL $60（70-10=60）
 *   SUBTOTAL $100 / IVA $16 / TOTAL 5 116     →  TOTAL $116（100+16=116）
 */
(function (global) {
  // 解析文本中的金额（保留原始串 + 数值）
  function extractAmounts(text) {
    const out = [];
    const re = /([$￥¥]?\s*-?\d[\d,.]*\d?)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1].trim();
      if (!/\d/.test(raw)) continue;
      const num = parseFloat(raw.replace(/[$￥¥\s]/g, '').replace(/,/g, ''));
      if (Number.isFinite(num)) out.push({ raw, num });
    }
    return out;
  }

  // 在文本中查找标签后的金额段（如 "TOTAL 5 60" → "5 60"；"TOTAL $116.00" → "$116.00"）
  // ⚠️ \b 必须加在 label 前：排除 SUBTOTAL（其含 "total" 子串，\btotal 因前有字母不匹配）
  function labelAmount(text, label) {
    const re = new RegExp('\\b(?:' + label + ')\\s*[:：]?\\s*([$￥¥]?\\s*[\\d][\\d,.]*(?:\\s+[\\d][\\d,.]*)*)', 'i');
    const m = text.match(re);
    return m ? m[1] : null;
  }

  /**
   * 智能推断：尝试用数学关系纠正疑似 $→5 的金额。
   * @param {Object} fields { subtotal, iva, efectivo, cambio, total }（OCR 初值，可含疑似值）
   * @param {string} fullText 完整 OCR 文本
   * @returns {Object} { total, reason, confidence, corrected }
   */
  function resolveMoney(fields, fullText) {
    const t = String(fullText || '');
    const result = { total: fields.total != null ? fields.total : null, reason: null, confidence: 0.5, corrected: false };

    // 1) 数学关系：EFECTIVO - CAMBIO = TOTAL
    const efectivo = fields.efectivo;
    const cambio = fields.cambio;
    const totalRaw = fields.total;
    if (efectivo != null && cambio != null && totalRaw != null) {
      const calc = efectivo - cambio;
      // OCR 总金额与"应得"不一致（差一个数量级/含疑似 $→5）→ 尝试修正
      if (calc > 0 && Math.abs(calc - totalRaw) > 0.01) {
        // 检查 TOTAL 后是否带疑似符号（"5 60" → "5" 是 $）
        const totalSeg = labelAmount(t, 'total|importe\\s*total|gran\\s*total|a\\s*pagar');
        if (totalSeg && /^\s*5\s+[\d]/.test(totalSeg)) {
          result.total = calc;
          result.reason = 'efectivo-cambio';
          result.confidence = 0.97;
          result.corrected = true;
          return result;
        }
        // 若 OCR total 恰好等于 calc 但原串含 $ 丢失数字（如 "TOTAL 60" 与 calc 差 0.01 级）→ 保留 OCR
        if (Math.abs(calc - totalRaw) <= 0.01) { result.confidence = 0.99; return result; }
      }
    }

    // 2) 数学关系：Subtotal + IVA = TOTAL（或 Subtotal + IVA - Discount = TOTAL）
    if (fields.subtotal != null && fields.iva != null && totalRaw != null) {
      const calc = fields.subtotal + fields.iva - (fields.discount || 0);
      if (calc > 0 && Math.abs(calc - totalRaw) > 0.01) {
        const totalSeg = labelAmount(t, 'total|importe\\s*total|gran\\s*total|a\\s*pagar');
        if (totalSeg && /^\s*5\s+[\d]/.test(totalSeg)) {
          result.total = calc;
          result.reason = 'subtotal-iva';
          result.confidence = 0.96;
          result.corrected = true;
          return result;
        }
      }
    }

    // 3) 同票多数金额带 $ 前缀 → TOTAL 的裸数字前疑似 $ 被吞
    if (totalRaw != null && /^\d{1,3}\s+\d/.test(String(totalRaw))) {
      // "TOTAL 5 60" 形态：两个数字组，取后段
      const m = String(totalRaw).match(/(\d{1,3})\s+(\d[\d,.]*)/);
      if (m) {
        result.total = parseFloat(m[2].replace(/,/g, ''));
        result.reason = 'split-symbol';
        result.confidence = 0.75; // 中等：无数学关系佐证时不置高置信
        result.corrected = true;
        return result;
      }
    }

    return result;
  }

  /** 从 OXXO/零售小票文本提取 EFECTIVO / CAMBIO / TOTAL 初值 */
  function extractCashFields(text) {
    const t = String(text || '');
    const get = (label) => {
      const m = t.match(new RegExp('(?:' + label + ')\\s*[:：]?\\s*[$￥¥]?\\s*([\\d.,]+)', 'i'));
      return m ? parseFloat(m[1].replace(/,/g, '')) : null;
    };
    return { efectivo: get('EFECTIVO|EFECTIVO RECIBIDO|ENTREGADO|RECIBIDO'), cambio: get('CAMBIO|VUELTO'), total: get('TOTAL|IMPORTE TOTAL|GRAN TOTAL|A PAGAR') };
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, { currencyEvidence: { resolveMoney, extractCashFields, extractAmounts } });
})(typeof window !== 'undefined' ? window : globalThis);
