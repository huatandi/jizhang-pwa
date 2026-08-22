'use strict';
/**
 * MexicoParser · field-normalizer —— 字段规范化
 *
 * OCR 原始标签（TOTAL / Total / TOTAL: / TOTAL MXN / TOTAL A PAGAR ...）统一映射为标准键。
 * 结合 bbox 位置原语（nearestRight / sameLine / sameColumn）供各 Parser 复用。
 */
(function (global) {
  // 标签 → 标准键（覆盖常见 OCR 变体；值会先 trim + 去冒号）
  const LABEL_MAP = [
    // 金额相关
    [/^total(\s*a\s*pagar|\s*mxn|\s*pesos)?$/i, 'total'],
    [/^subtotal$/i, 'subtotal'],
    [/^iva$/i, 'iva'],
    [/^ieps$/i, 'ieps'],
    [/^descuento$/i, 'descuento'],
    [/^monto$/i, 'monto'],
    [/^importe$/i, 'importe'],
    [/^pago total$/i, 'total'],
    // 票号 / 凭证
    [/^folio(\s*fiscal)?$/i, 'folio'],
    [/^ticket$/i, 'ticket'],
    [/^no\.?\s*(ticket|boleto|folio)$/i, 'ticket'],
    // 日期时间
    [/^fecha(\s*de\s*(emision|pago|operacion))?$/i, 'fecha'],
    [/^fecha\s*y\s*hora$/i, 'fecha'],
    [/^hora$/i, 'hora'],
    // 身份/税号
    [/^r\.?f\.?c\.?$/i, 'rfc'],
    [/^rfc\s*(emisor|receptor)?$/i, 'rfc'],
    [/^uuid$/i, 'uuid'],
    [/^folio\s*fiscal$/i, 'folio_fiscal'],
    // 当事人
    [/^emisor$/i, 'emisor'],
    [/^receptor$/i, 'receptor'],
    [/^ordenante$/i, 'ordenante'],
    [/^beneficiario$/i, 'beneficiario'],
    [/^raz[oó]n\s*social$/i, 'razon_social'],
    [/^nombre$/i, 'nombre'],
    // 银行
    [/^banco\s*ordenante$/i, 'banco_ordenante'],
    [/^banco\s*beneficiario$/i, 'banco_beneficiario'],
    [/^instituci[oó]n\s*ordenante$/i, 'banco_ordenante'],
    [/^instituci[oó]n\s*beneficiaria$/i, 'banco_beneficiario'],
    // 账号/参考
    [/^clave\s*de\s*rastreo$/i, 'tracking_key'],
    [/^referencia$/i, 'referencia'],
    [/^cuenta$/i, 'cuenta'],
    [/^clabe$/i, 'clabe'],
    // 支付
    [/^forma\s*de\s*pago$/i, 'forma_pago'],
    [/^m[eé]todo\s*de\s*pago$/i, 'metodo_pago'],
    [/^moneda$/i, 'moneda'],
    [/^tipo\s*de\s*cambio$/i, 'tipo_cambio'],
    // 税务
    [/^uso\s*cfdi$/i, 'uso_cfdi'],
    [/^r[eé]gimen\s*fiscal$/i, 'regimen'],
    [/^concepto$/i, 'concepto'],
  ];

  /** 规范化标签：去冒号/空白/点，查表 → 标准键（未命中返回 null） */
  function normalizeLabel(text) {
    if (text == null) return null;
    let t = String(text)
      .replace(/[:：]/g, ' ')
      .replace(/\./g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return null;
    for (const [re, key] of LABEL_MAP) {
      if (re.test(t)) return key;
    }
    return null;
  }

  /** 行内按出现顺序取文本（bbox 行合并） */
  function lineText(words) {
    if (!Array.isArray(words)) return '';
    return words.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
  }

  // ---------- bbox 几何原语（核心：字段解析利用左右/上下关系，而非纯 Regex） ----------

  function boxCenterX(box) {
    if (!box || !box.length) return 0;
    return (box[0][0] + box[2][0]) / 2;
  }
  function boxCenterY(box) {
    if (!box || !box.length) return 0;
    return (box[0][1] + box[2][1]) / 2;
  }
  function boxTop(box) { return box && box[0] ? box[0][1] : 0; }
  function boxBottom(box) { return box && box[2] ? box[2][1] : 0; }
  function boxHeight(box) { return boxBottom(box) - boxTop(box); }

  /** 两 box 是否大致同一行（中心 Y 差 < 行高一半，且垂直有重叠） */
  function sameLine(a, b, tol) {
    if (!a || !b) return false;
    const t = tol == null ? Math.min(boxHeight(a), boxHeight(b)) * 0.6 : tol;
    const overlap = Math.min(boxBottom(a), boxBottom(b)) - Math.max(boxTop(a), boxTop(b));
    return overlap > 0 && Math.abs(boxCenterY(a) - boxCenterY(b)) <= t;
  }

  /** 目标右侧最近的词（同一行内 x 最近；可选同列过滤） */
  function nearestRight(targetBox, words, opts) {
    const o = opts || {};
    let best = null, bestDist = Infinity;
    const tx = boxCenterX(targetBox), ty = boxCenterY(targetBox);
    for (const w of words) {
      if (!w.box) continue;
      const wx = boxCenterX(w.box);
      if (wx <= tx) continue; // 必须在右侧
      if (o.sameLine !== false && !sameLine(targetBox, w.box, o.tol)) continue;
      const dist = wx - tx;
      if (dist < bestDist) { bestDist = dist; best = w; }
    }
    return best;
  }

  /** 目标下方最近的词（同列/近列优先） */
  function nearestBelow(targetBox, words, opts) {
    const o = opts || {};
    let best = null, bestDist = Infinity;
    const tx = boxCenterX(targetBox), ty = boxCenterY(targetBox);
    for (const w of words) {
      if (!w.box) continue;
      const wy = boxCenterY(w.box);
      if (wy <= ty) continue;
      if (o.sameColumn && Math.abs(boxCenterX(w.box) - tx) > (o.colTol || 40)) continue;
      const dist = wy - ty;
      if (dist < bestDist) { bestDist = dist; best = w; }
    }
    return best;
  }

  /** 把同行的词按 x 排序拼成一行（供行级解析） */
  function rowWords(words) {
    return [...(words || [])].sort((a, b) => boxCenterX(a.box) - boxCenterX(b.box));
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, {
    normalizeLabel,
    lineText,
    sameLine,
    nearestRight,
    nearestBelow,
    boxCenterX,
    boxCenterY,
    boxTop,
    boxBottom,
    boxHeight,
    rowWords,
  });
})(typeof window !== 'undefined' ? window : globalThis);
