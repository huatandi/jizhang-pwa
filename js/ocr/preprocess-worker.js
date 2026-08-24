'use strict';
/**
 * OcrKit · preprocess-worker —— 预处理 Worker（V5 §71）
 *
 * 主线程把 ImageBitmap transfer 进来，本 Worker 用 OffscreenCanvas 完成
 * smartResize(长票保高) → autoRotate → perspective → deskew → glare → enhance，
 * 再把结果 OffscreenCanvas transfer 回主线程。
 *
 * 实现：importScripts 复用 js/ocr/preprocess.js（其函数仅在调用时触碰 DOM，
 * 这里用 document.createElement → OffscreenCanvas 桩替换）。
 *
 * ⚠️ 特性开关：客户端 opts.worker === true 才启用（默认关，真机验证后开启）；
 *    不支持/失败时主线程 pipeline 自动回退。
 *
 * 协议：
 *   in : { id, bitmap, opts }（bitmap 随消息 transfer）
 *   out: { id, ok, canvas?, deskewAngle?, perspectiveAngle?, longMode?, error? }
 */
/* global self, OffscreenCanvas, importScripts */
if (typeof OffscreenCanvas === 'undefined') {
  // 环境不支持 OffscreenCanvas：直接宣告失败，客户端会回退主线程
  self.onmessage = (ev) => {
    self.postMessage({ id: ev.data && ev.data.id, ok: false, error: 'OffscreenCanvas unavailable' });
  };
} else {
  // document 桩：preprocess.js 内所有 canvas 创建走 OffscreenCanvas
  self.document = {
    createElement: () => new OffscreenCanvas(1, 1),
  };
  try {
    importScripts('preprocess.js');
  } catch (e) {
    self.__ppLoadError = String((e && e.message) || e);
  }

  self.onmessage = async (ev) => {
    const { id, bitmap, opts } = ev.data || {};
    try {
      if (!self.OcrKit || !self.OcrKit.preprocess) {
        throw new Error('preprocess 未加载' + (self.__ppLoadError ? '：' + self.__ppLoadError : ''));
      }
      const P = self.OcrKit.preprocess;
      const o = opts || {};
      // 主线程已把图缩放好传入（rawCanvas 路径）：直接跑剩余管线
      // （若 opts.rawCanvas 传入则使用；否则按 bitmap 尺寸缩放）
      let rawCanvas = o.rawCanvas || null;
      if (!rawCanvas) {
        const limit = o.maxEdge || 1800;
        const w = bitmap.width, h = bitmap.height;
        const k = Math.min(1, limit / Math.max(1, w));
        const tw = Math.max(1, Math.round(w * k));
        const th = Math.min(Math.round(h * k), Math.round(limit * 4));
        rawCanvas = new OffscreenCanvas(tw, th);
        const ctx = rawCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, tw, th);
      }
      const res = await P.pipeline(rawCanvas, Object.assign({}, o, {
        rawCanvas: true, // 跳过 loadImage/smartResize（已在上面完成）
      }));
      self.postMessage({
        id,
        ok: true,
        canvas: res.canvas,
        deskewAngle: res.deskewAngle || 0,
        perspectiveAngle: res.perspectiveAngle || 0,
        longMode: !!res.longMode,
        glowUsed: !!res.glowUsed,
      }, [res.canvas]);
    } catch (e) {
      self.postMessage({ id, ok: false, error: String((e && e.message) || e) });
    }
  };
}
