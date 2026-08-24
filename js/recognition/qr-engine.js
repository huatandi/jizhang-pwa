'use strict';
/**
 * RecognitionCore · qr-engine —— QR 读取（§十六 / §三九）
 *
 * BarcodeDetector（浏览器原生）优先；不支持时回退 jsQR（本地 vendor/jsQR）。
 * 用途：CFDI 二维码 → 提取结构化字段（UUID/RFC/Total），与 OCR 融合验证。
 *
 * CFDI QR 内容格式（SAT 标准，URL-encoded 分号分隔）：
 *   https://verificacfdi.facturaelectronica.sat.gob.mx/?id=UUID&re=RFC_EMISOR&rr=RFC_RECEPTOR&tt=TOTAL&fe=SELLO
 */
(function (global) {
  let jsQRModule = null;
  let _qrFailed = false; // 加载失败过 → 不再重复拉取（减少 404 噪音）

  function loadJsQR() {
    if (jsQRModule) return jsQRModule;
    if (_qrFailed) return null;
    // 本地 vendor 优先（若已内置）；否则 CDN 回退（esm.run，与 paddle/whisper 一致）
    const local = (() => {
      try { return new URL('vendor/jsQR/jsQR.js', global.location && global.location.href).href; }
      catch (e) { return 'vendor/jsQR/jsQR.js'; }
    })();
    return import(/* @vite-ignore */ local)
      .then((m) => { jsQRModule = m.default || m.jsQR || m; return jsQRModule; })
      .catch(() => import(/* @vite-ignore */ 'https://esm.run/jsqr')
        .then((m) => { jsQRModule = m.default || m.jsQR || m; return jsQRModule; })
        .catch(() => { jsQRModule = null; _qrFailed = true; return null; }));
  }

  /** 检测浏览器 BarcodeDetector 可用性 */
  function supported() {
    return !!(global.BarcodeDetector && typeof global.BarcodeDetector.getSupportedFormats === 'function');
  }

  /**
   * 从图片（Canvas/Image/Blob/dataURL）读取二维码
   * @returns {Promise<Array<{text, format, confidence, points}>>}
   */
  async function detect(image) {
    const results = [];
    // 1) BarcodeDetector 原生优先
    if (supported()) {
      try {
        const detector = new global.BarcodeDetector({ formats: ['qr_code'] });
        const codes = await detector.detect(image);
        (codes || []).forEach((c) => results.push({ text: c.rawValue || '', format: 'qr_code', confidence: 1, points: c.cornerPoints }));
      } catch (e) { console.warn('[qr] BarcodeDetector 失败，回退 jsQR:', e); }
    }
    // 2) jsQR 回退（需要 Canvas ImageData）
    if (!results.length) {
      try {
        const jsQR = await loadJsQR();
        if (!jsQR) return results;
        const ctx = image instanceof HTMLCanvasElement ? image.getContext('2d') : null;
        const cv = ctx ? image : await imageToCanvas(image);
        if (cv) {
          const c2 = cv.getContext('2d', { willReadFrequently: true });
          const imgData = c2.getImageData(0, 0, cv.width, cv.height);
          const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) results.push({ text: code.data, format: 'qr_code', confidence: 0.95, points: code.location });
        }
      } catch (e) { console.warn('[qr] jsQR 失败:', e); }
    }
    return results;
  }

  async function imageToCanvas(image) {
    if (image instanceof HTMLCanvasElement) return image;
    return new Promise((resolve) => {
      const img = image instanceof HTMLImageElement ? image : null;
      if (!img) { resolve(null); return; }
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth || img.width || 0;
      cv.height = img.naturalHeight || img.height || 0;
      if (!cv.width || !cv.height) { resolve(null); return; }
      cv.getContext('2d').drawImage(img, 0, 0);
      resolve(cv);
    });
  }

  /** 解析 CFDI QR 文本 → 结构化字段（§二四） */
  function parseCfdiQr(text) {
    const t = String(text || '');
    const m = t.match(/[?&]([^=&#]+)=([^&#]*)/g);
    const params = {};
    if (m) {
      m.forEach((seg) => {
        const eq = seg.indexOf('=');
        const k = decodeURIComponent(seg.slice(1, eq)).toLowerCase();
        const v = decodeURIComponent(seg.slice(eq + 1));
        if (k && v) params[k] = v;
      });
    }
    // SAT 字段：id=UUID, re=emisor RFC, rr=receptor RFC, tt=total
    const rfcEmisor = params.re || params.rfc || '';
    const rfcReceptor = params.rr || '';
    const uuid = params.id || params.uuid || '';
    const total = params.tt != null ? Number(String(params.tt).replace(/,/g, '')) : NaN;
    const hasCfdi = !!(uuid || rfcEmisor || rfcReceptor || Number.isFinite(total));
    if (!hasCfdi) return null;
    return {
      source: 'qr',
      uuid: uuid || null,
      rfc_emisor: rfcEmisor || null,
      rfc_receptor: rfcReceptor || null,
      total: Number.isFinite(total) ? total : null,
      raw: t,
      confidence: 0.99,
    };
  }

  global.RecognitionCore = global.RecognitionCore || {};
  Object.assign(global.RecognitionCore, {
    qrEngine: { detect, parseCfdiQr, supported },
  });
})(typeof window !== 'undefined' ? window : globalThis);
