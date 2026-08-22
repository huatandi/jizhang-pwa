'use strict';
/**
 * MexicoParser · parser —— 统一解析入口
 *
 * parse(result)：
 *   1. detectDocumentType → CFDI / SPEI / OXXO / UNKNOWN
 *   2. 分派到对应 Parser
 *   3. 输出统一 { type, document, confidence, validation }
 *
 * 业务层（工作台/批量）只调 parse()，解析器内部可独立演进。
 */
(function (global) {
  const M = global.MexicoParser;

  function parse(result) {
    if (!result || !result.words) throw new Error('MexicoParser.parse 需要 OcrResult（含 words）');

    const det = M.detectDocumentType(result);
    let document = null;
    switch (det.type) {
      case 'CFDI': document = M.parseCfdi(result); break;
      case 'SPEI': document = M.parseSpei(result); break;
      case 'OXXO': document = M.parseOxxo(result); break;
      default: document = { type: 'UNKNOWN', text: result.fullText || '' };
    }

    return {
      type: det.type,
      document,
      scores: det.scores,
      reasons: det.reasons,
      detectorConfidence: det.confidence,
      ocr: {
        engine: result.engine,
        wordCount: result.words.length,
        avgConfidence: avg(result.words),
        processingTimeMs: result.processingTimeMs,
      },
    };
  }

  function avg(words) {
    if (!words || !words.length) return 0;
    return words.reduce((s, w) => s + (Number(w.confidence) || 0), 0) / words.length;
  }

  global.MexicoParser = global.MexicoParser || {};
  Object.assign(global.MexicoParser, { parse });
})(typeof window !== 'undefined' ? window : globalThis);
