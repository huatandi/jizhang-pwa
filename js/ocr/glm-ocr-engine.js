'use strict';
/**
 * GLM-OCR Engine Adapter (OPTIONAL, disabled by default)
 *
 * GLM-OCR is a ~0.9B multimodal document model and is not bundled into this PWA.
 * This adapter is for a user-controlled local/LAN/server endpoint when a hard document
 * needs a second opinion. Local-first behavior remains Paddle/Tesseract.
 *
 * Expected endpoint contract:
 * POST <endpoint> multipart/form-data {file, lang, mode}
 * response { text, lines:[{text,confidence,bbox}], fields?, documentType? }
 */
(function (global) {
  class GlmOcrEngine extends global.OcrKit.OcrEngineBase {
    constructor(config) {
      super('glm-ocr');
      this.config = Object.assign({ endpoint: '', timeoutMs: 45000, lang: 'auto', mode: 'document' }, config || {});
      this._ready = false;
    }
    async initialize() {
      if (!this.config.endpoint) throw new Error('GLM_OCR_ENDPOINT_NOT_CONFIGURED');
      this._ready = true;
      return true;
    }
    async recognize(image, opts) {
      await this.initialize();
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), this.config.timeoutMs) : null;
      try {
        const blob = await new Promise((resolve, reject) => image.toBlob(b => b ? resolve(b) : reject(new Error('CANVAS_TO_BLOB_FAILED')), 'image/jpeg', 0.92));
        const fd = new FormData();
        fd.append('file', blob, 'document.jpg');
        fd.append('lang', (opts && opts.lang) || this.config.lang);
        fd.append('mode', (opts && opts.mode) || this.config.mode);
        const res = await fetch(this.config.endpoint, { method: 'POST', body: fd, signal: ctrl ? ctrl.signal : undefined });
        if (!res.ok) throw new Error('GLM_OCR_HTTP_' + res.status);
        const data = await res.json();
        const lines = Array.isArray(data.lines) ? data.lines : [];
        const words = lines.map((l, i) => ({
          text: String(l.text || ''),
          confidence: l.confidence == null ? 80 : Number(l.confidence),
          box: Array.isArray(l.bbox) && l.bbox.length === 4
            ? [[l.bbox[0],l.bbox[1]],[l.bbox[2],l.bbox[1]],[l.bbox[2],l.bbox[3]],[l.bbox[0],l.bbox[3]]]
            : [[0,i*20],[100,i*20],[100,i*20+16],[0,i*20+16]],
        })).filter(w => w.text);
        const out = global.OcrKit.normalizeResult('glm-ocr', words, image.width || 0, image.height || 0, 0, {});
        if (data.text) { out.text = out.fullText = String(data.text); }
        out.documentType = data.documentType || data.document_type || null;
        out.glmFields = data.fields || null;
        out._remote = true;
        return out;
      } finally { if (timer) clearTimeout(timer); }
    }
    async dispose() { this._ready = false; }
  }
  global.OcrKit = global.OcrKit || {};
  global.OcrKit.GlmOcrEngine = GlmOcrEngine;
})(typeof window !== 'undefined' ? window : globalThis);
