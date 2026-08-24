'use strict';
/**
 * OcrKit · ServerOcrEngine —— 服务器 OCR 引擎（V5 §75，可选，默认不注册）
 *
 * 实现统一 OcrEngineBase 接口（recognize/initialize/dispose），走现有
 * /api/ai/documents 上传 + /extract 提取 两段式流程。
 *
 * ⚠️ 不是默认依赖：
 *   - 仅在显式启用时注册（localStorage 'sm_ocr_server_engine' === '1'）；
 *   - 服务器不可用/超时 → OcrManager 回退链继续（失败静默降级）；
 *   - 业务层不需要任何特殊判断——它就是注册表里的一个普通引擎。
 *
 * 依赖：fetch + FormData（浏览器环境）；Node 测试仅验证接口契约与参数组装。
 */
(function (global) {
  const DEFAULT_CONFIG = {
    timeoutMs: 30000,
    pollMs: 1500,
    maxPolls: 40,
    ocrLang: 'auto',
  };

  function _formData(canvas) {
    // canvas → blob（FormData 上传）
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('canvas 转 blob 失败'));
          const fd = new FormData();
          fd.append('file', blob, 'receipt.png');
          fd.append('ocrLang', 'auto');
          resolve(fd);
        }, 'image/png');
      } catch (e) { reject(e); }
    });
  }

  class ServerOcrEngine extends global.OcrKit.OcrEngineBase {
    constructor(config) {
      super('server');
      this.config = Object.assign({}, DEFAULT_CONFIG, config || {});
      this._ready = false;
    }

    async initialize() {
      // 服务器存在性探测（轻量）：/api/ai/jobs 可访问即视为可用
      if (this._ready) return true;
      try {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
        const res = await fetch('/api/ai/jobs', { signal: ctrl ? ctrl.signal : undefined });
        if (timer) clearTimeout(timer);
        this._ready = res.ok || res.status === 200;
      } catch (e) {
        this._ready = false;
      }
      return this._ready;
    }

    /**
     * 识别：上传图片 → 轮询提取 → 归一化为 OcrResult。
     * @param {HTMLCanvasElement} image
     * @returns {Promise<Object>} OcrResult（server 输出结构映射）
     */
    async recognize(image, opts) {
      if (typeof fetch === 'undefined' || typeof FormData === 'undefined') {
        throw new Error('SERVER_UNAVAILABLE');
      }
      const ready = await this.initialize();
      if (!ready) throw new Error('SERVER_UNAVAILABLE');

      // 1) 上传
      const fd = await _formData(image);
      const upRes = await fetch('/api/ai/documents', { method: 'POST', body: fd });
      if (!upRes.ok) throw new Error('SERVER_UPLOAD_FAILED:' + upRes.status);
      const up = await upRes.json();
      const docId = up.id || (up.doc && up.doc.id);
      if (!docId) throw new Error('SERVER_UPLOAD_NO_ID');

      // 2) 轮询提取（extract 完成后返回）
      const o = opts || {};
      const lang = o.ocrLang || this.config.ocrLang;
      let lastErr = null;
      for (let i = 0; i < this.config.maxPolls; i++) {
        try {
          const exRes = await fetch('/api/ai/documents/' + docId + '/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ocrLang: lang, force: !!o.force }),
          });
          if (exRes.ok) {
            const data = await exRes.json();
            return this._normalize(data);
          }
          lastErr = new Error('SERVER_EXTRACT:' + exRes.status);
        } catch (e) { lastErr = e; }
        await new Promise((r) => setTimeout(r, this.config.pollMs));
      }
      throw lastErr || new Error('SERVER_TIMEOUT');
    }

    /** 服务器响应 → 统一 OcrResult */
    _normalize(data) {
      const text = data.normalized_text || data.ocr_text || '';
      const lines = Array.isArray(data.ocr_lines) ? data.ocr_lines : [];
      // 服务器无词级 bbox：构造行级 words（供 clusterLines/语义解析）
      const words = lines
        .filter(l => l && l.text)
        .map((l, i) => ({
          text: String(l.text),
          confidence: l.confidence != null ? Number(l.confidence) : 70,
          box: (l.bbox && Array.isArray(l.bbox) && l.bbox.length === 4)
            ? [[l.bbox[0], l.bbox[1]], [l.bbox[2], l.bbox[1]], [l.bbox[2], l.bbox[3]], [l.bbox[0], l.bbox[3]]]
            : [[0, i * 20], [100, i * 20], [100, i * 20 + 14], [0, i * 20 + 14]],
        }));
      const result = global.OcrKit.normalizeResult('server', words, 0, 0, 0, {
        fullText: text,
        documentType: data.document_type || null,
        // 服务器 core_fields 透出（业务层可消费）
        serverCoreFields: data.core_fields || null,
        serverConfidence: data.ocr_confidence != null ? Number(data.ocr_confidence) : null,
        serverCached: !!data.cached,
        languages: data.languages || null,
      });
      result.engine = 'server';
      return result;
    }

    async dispose() { this._ready = false; }
  }

  global.OcrKit = global.OcrKit || {};
  global.OcrKit.ServerOcrEngine = ServerOcrEngine;
})(typeof window !== 'undefined' ? window : globalThis);
