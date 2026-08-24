'use strict';
/**
 * Service Worker —— PWA 离线缓存
 * 缓存策略：App 壳（HTML/CSS/JS/vendor/图标）安装时预缓存；运行时网络优先 + 缓存回退。
 */
const CACHE_NAME = 'jizhang-pwa-v119';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/boot.js',
  './js/app.js',
  './js/offline-db.js',
  './js/offline-backend.js',
  './js/offline-ocr.js',
  './js/voice-engine.js',
  './js/validation/validators.js',
  './js/validation/confidence.js',
  './js/validation/transaction.js',
  './js/ocr/ocr-types.js',
  './js/ocr/image-quality.js',
  './js/ocr/preprocess.js',
  './js/ocr/tesseract-engine.js',
  './js/ocr/paddle-engine.js',
  './js/ocr/ocr-manager.js',
  './js/ocr/ocr-job-manager.js',
  './js/ocr/execution-planner.js',
  './js/ocr/server-engine.js',
  './js/ocr/preprocess-worker.js',
  './js/ocr/region-retry.js',
  './js/ocr/ocr-candidate-pool.js',
  './js/mexico/money.js',
  './js/mexico/field-normalizer.js',
  './js/mexico/currency-evidence.js',
  './js/mexico/document-detector.js',
  './js/mexico/cfdi-parser.js',
  './js/mexico/spei-parser.js',
  './js/mexico/oxxo-parser.js',
  './js/mexico/parser.js',
  './js/regions/router.js',
  './js/regions/mx.js',
  './js/regions/cn.js',
  './js/asr/asr-types.js',
  // RecognitionCore：本地知识库/实体解析/银行词典/置信度/QR（语音+OCR 共享）
  './js/recognition/knowledge-base.js',
  './js/recognition/entity-resolver.js',
  './js/recognition/bank-dictionary.js',
  './js/recognition/bank-resolver.js',
  './js/recognition/confidence-engine.js',
  './js/recognition/qr-engine.js',
  './js/recognition/index.js',
  './js/asr/audio-processor.js',
  './js/asr/audio-capture.js',
  './js/asr/vad.js',
  './js/asr/whisper-engine.js',
  './js/asr/webspeech-engine.js',
  './js/asr/model-manager.js',
  './js/asr/asr-manager.js',
  './js/voice/voice-parser.js',
  './js/voice/voice-sr.js',
  './js/voice/voice-qa.js',
  './js/voice/personal-voice-memory.js',
  './js/intelligence/evidence-engine.js',
  './js/intelligence/conflict-resolver.js',
  './js/intelligence/constraint-engine.js',
  './js/intelligence/ocr-confusion-model.js',
  './js/intelligence/ocr-memory-store.js',
  './js/intelligence/document-fingerprint.js',
  './js/intelligence/template-engine.js',
  './js/intelligence/correction-learner.js',
  './js/learning/learning-engine.js',
  // app.js 拆分模块（app.js v69 拆分）
  './js/voice/reminders.js',
  './js/voice/correction-engine.js',
  './js/voice/quick-voice.js',
  './js/ledger-crud.js',
  './js/ai/global-config.js',
  './js/ai/ai-workbench.js',
  './js/ai/engine-manager.js',
  './js/ai/multimodal.js',
  './js/ai/ai-provider.js',
  './js/ai/ai-privacy.js',
  './js/ai/ai-cache.js',
  './js/ai/ai-validator.js',
  './js/ai/ai-router.js',
  './js/ai/ai-manager.js',
  // 手机端下拉刷新
  './js/pull-refresh.js',
  // 参考汇率工具（Exchange Rate Engine）
  './js/exchange-rate/exchange-rate-types.js',
  './js/exchange-rate/currency-registry.js',
  './js/exchange-rate/http-client.js',
  './js/exchange-rate/rate-cache.js',
  './js/exchange-rate/frankfurter-provider.js',
  './js/exchange-rate/rate-calculator.js',
  './js/exchange-rate/exchange-rate-engine.js',
  './js/exchange-rate/fx-tool.js',
  './manifest.json',
  './vendor/echarts/echarts.min.js',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm',
  './vendor/tesseract/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-lstm.wasm',
  './vendor/tesseract/spa.traineddata.gz',
  './vendor/tesseract/eng.traineddata.gz',
  './vendor/tesseract/chi_sim.traineddata.gz',
  // 高级引擎本地自托管（Whisper ASR / PaddleOCR / ONNX Runtime）
  './vendor/transformers/transformers.min.js',
  './vendor/transformers/transformers.js',
  './vendor/transformers/transformers.web.min.js',
  './vendor/onnx/ort.all.min.mjs',
  './vendor/onnx/ort-wasm-simd-threaded.wasm',
  './vendor/onnx/ort-wasm-simd-threaded.mjs',
  './vendor/paddleocr/index.mjs',
  './vendor/paddleocr/assets/worker-entry-C9UNuyOJ.js',
  './vendor/sqljs/sql-wasm.js',
  './vendor/sqljs/sql-wasm.wasm',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 只处理 http/https；忽略 chrome-extension 等不支持的 scheme（避免 Cache.put 抛错）
  if (!/^https?:$/.test(url.protocol)) return;
  // API 请求不缓存（走 IndexedDB 伪后端，本地 fetch 已被劫持，SW 只处理真实网络资源）
  if (url.pathname.startsWith('/api/')) return;
  // 缓存键统一用"去 query 的规范化 URL"：boot.js 加载 app.js?v=100、index.html 加载 css?v=46，
  // 若按完整 URL（含 query）匹配，离线时会 miss 并 fallback 到 index.html 导致启动崩溃。
  // 版本更新靠 CACHE_NAME 换代（install 预缓存新资源 + activate 清旧缓存），query 仅作在线强刷信号。
  const cacheKey = url.origin + url.pathname;
  const cacheRequest = new Request(cacheKey, { method: 'GET', mode: e.request.mode });
  // 语言包（大文件）缓存优先
  if (url.pathname.includes('traineddata') || url.pathname.includes('wasm')) {
    e.respondWith(
      caches.match(cacheRequest).then((c) => c || fetch(e.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(cacheRequest, clone));
        return res;
      }))
    );
    return;
  }
  // 其余：网络优先，缓存回退（回退按 pathname 匹配，避免离线把 index.html 当脚本返回）
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(cacheRequest, clone));
      }
      return res;
    }).catch(() => caches.match(cacheRequest).then((c) => {
      if (c) return c;
      // 精确 pathname miss：仅当请求是 HTML 才 fallback index.html（避免 JS/CSS 拿到 HTML 崩溃）
      const isHtml = url.pathname === '/' || url.pathname.endsWith('.html') || !/\.[a-z0-9]+$/i.test(url.pathname);
      return isHtml ? caches.match('./index.html') : Response.error();
    }))
  );
});
