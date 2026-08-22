'use strict';
/**
 * MexicoParser · document-detector —— 票据类型检测
 *
 * OCR 结果 → CFDI / SPEI / OXXO / UNKNOWN
 * 依据：特征词计分（带权重）+ 结构信号（UUID 存在、表格列头等）。
 */
(function (global) {
  // 特征词表：key → [{ re, w }]
  const FEATURES = {
    CFDI: [
      { re: /\bCFDI\b/i, w: 3 },
      { re: /\bFACTURA\b/i, w: 2 },
      { re: /\bSAT\b/i, w: 1 },
      { re: /\bRFC\b/i, w: 1 },
      { re: /folio\s*fiscal/i, w: 2 },
      { re: /\bUUID\b/i, w: 3 },
      { re: /\bEmisor\b/i, w: 1 },
      { re: /\bReceptor\b/i, w: 1 },
      { re: /r[eé]gimen\s*fiscal/i, w: 1 },
      { re: /uso\s*cfdi/i, w: 2 },
      { re: /\bSubtotal\b/i, w: 1 },
      { re: /\bIVA\b/i, w: 1 },
      { re: /\bConceptos?\b/i, w: 1 },
      { re: /Lugar\s*y\s*fecha/i, w: 1 },
      { re: /m[eé]todo\s*de\s*pago/i, w: 1 },
      { re: /forma\s*de\s*pago/i, w: 1 },
    ],
    SPEI: [
      { re: /\bSPEI\b/i, w: 4 },
      { re: /clave\s*de\s*rastreo/i, w: 3 },
      { re: /\bOrdenante\b/i, w: 1 },
      { re: /\bBeneficiario\b/i, w: 1 },
      { re: /banco\s*(ordenante|beneficiario)/i, w: 1 },
      { re: /\bReferencia\b/i, w: 1 },
      { re: /transferencia/i, w: 2 },
      { re: /instituci[oó]n\s*(ordenante|beneficiaria)/i, w: 1 },
      { re: /operaci[oó]n\s*(exitosa|realizada)/i, w: 1 },
    ],
    OXXO: [
      { re: /\bOXXO\b/i, w: 4 },
      { re: /\bTicket\b/i, w: 2 },
      { re: /\bVenta\b/i, w: 1 },
      { re: /tienda\s*o\s*farmacia/i, w: 1 },
      { re: /\bFolio\b/i, w: 1 },
      { re: /efectivo|tarjeta/i, w: 1 },
      { re: /cantidad\s+producto/i, w: 2 },
      { re: /importe\s+total/i, w: 1 },
    ],
  };

  // 类型别名（返回统一类型名）
  const TYPE_ALIAS = { CFDI: 'CFDI', FACTURA: 'CFDI', SPEI: 'SPEI', OXXO: 'OXXO', TICKET: 'OXXO' };

  /** 检测票据类型：返回 { type, scores, reasons, confidence } */
  function detect(result) {
    const fullText = (result && result.fullText) || '';
    const words = (result && result.words) || [];
    const scores = {};
    const reasons = {};
    for (const [type, feats] of Object.entries(FEATURES)) {
      let s = 0;
      const hits = [];
      for (const f of feats) {
        if (f.re.test(fullText)) { s += f.w; hits.push(f.re.source); }
      }
      scores[type] = s;
      reasons[type] = hits;
    }

    // 结构信号：UUID 出现（CFDI 强信号）
    if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(fullText)) {
      scores.CFDI += 2;
      reasons.CFDI.push('uuid');
    }
    // 结构信号：多行表格列头（小票信号）
    const hasItemTable = words.filter(w => /cantidad|producto|descripcion|importe|precio/i.test(w.text)).length >= 3;
    if (hasItemTable && scores.OXXO > 0) scores.OXXO += 1;

    let type = 'UNKNOWN';
    let max = 0;
    for (const [t, s] of Object.entries(scores)) {
      if (s > max) { max = s; type = t; }
    }
    if (max < 1) type = 'UNKNOWN';

    return { type, scores, reasons, alias: TYPE_ALIAS[type] || type, confidence: max };
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, { detectDocumentType: detect });
})(typeof window !== 'undefined' ? window : globalThis);
