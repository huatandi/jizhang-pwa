'use strict';
/**
 * RecognitionCore · index —— 统一导出与初始化
 *
 * 加载顺序：本文件须在 knowledge-base / entity-resolver / confidence-engine / qr-engine 之后。
 * 对外统一命名空间 RecognitionCore：
 *   RecognitionCore.knowledgeBase / entityResolver / confidenceEngine / qrEngine
 *
 * 初始化：预载用户知识库（IndexedDB），不阻塞 UI。
 */
(function (global) {
  function init() {
    const kb = global.RecognitionCore && global.RecognitionCore.knowledgeBase;
    if (kb && kb.dump) {
      // 预载用户词库（异步，不阻塞）
      try { kb.dump().catch(() => {}); } catch (e) { /* ignore */ }
    }
    // 暴露统一入口（供 voice/ocr 模块使用）
    global.RecognitionCore.init = init;
    return global.RecognitionCore;
  }

  global.RecognitionCore = global.RecognitionCore || {};
  if (typeof global.RecognitionCore.init !== 'function') {
    global.RecognitionCore.init = init;
  }
})(typeof window !== 'undefined' ? window : globalThis);
