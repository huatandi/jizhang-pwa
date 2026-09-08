'use strict';
/**
 * Recognition release model catalog.
 * Production deployment should set same-origin manifest URLs here.
 * Empty URL = capability not published yet; UI will not pretend it is installable.
 */
(function(global){
  global.RECOGNITION_RELEASE_MODELS = Object.freeze({
    sherpaZh: {
      label: '中文增强语音识别',
      manifest: '',
      optional: true,
      requiredFamily: 'transducer',
      requiredDecodingMethod: 'modified_beam_search',
      requiredCapabilities: ['hotwords','streaming']
    },
    paddleOcr: {
      label: 'PaddleOCR 本地模型包',
      manifest: '',
      optional: true,
      note: '发布后必须使用同源 manifest，并提供 det/rec 的 size + SHA-256'
    },
    neuralVad: {
      label: '环境语音检测增强',
      manifest: '',
      optional: true,
      requiredSampleRate: 16000,
      preferredHopSize: 256,
      fallback: 'adaptive-vad'
    }
  });
})(typeof window!=='undefined'?window:globalThis);
