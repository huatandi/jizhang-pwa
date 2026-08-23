'use strict';
/**
 * Service Worker —— PWA 离线缓存
 * 缓存策略：App 壳（HTML/CSS/JS/vendor/图标）安装时预缓存；运行时网络优先 + 缓存回退。
 */
const CACHE_NAME = 'jizhang-pwa-v62';
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
  './js/ocr/preprocess.js',
  './js/ocr/tesseract-engine.js',
  './js/ocr/paddle-engine.js',
  './js/ocr/ocr-manager.js',
  './js/mexico/money.js',
  './js/mexico/field-normalizer.js',
  './js/mexico/document-detector.js',
  './js/mexico/cfdi-parser.js',
  './js/mexico/spei-parser.js',
  './js/mexico/oxxo-parser.js',
  './js/mexico/parser.js',
  './js/asr/asr-types.js',
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
  // app.js 拆分模块（app.js v69 拆分）
  './js/voice/reminders.js',
  './js/voice/quick-voice.js',
  './js/ledger-crud.js',
  './js/ai/global-config.js',
  './js/ai/ai-workbench.js',
  './js/ai/engine-manager.js',
  './js/ai/multimodal.js',
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
  // API 请求不缓存（走 IndexedDB 伪后端，本地 fetch 已被劫持，SW 只处理真实网络资源）
  if (url.pathname.startsWith('/api/')) return;
  // 语言包（大文件）缓存优先
  if (url.pathname.includes('traineddata') || url.pathname.includes('wasm')) {
    e.respondWith(
      caches.match(e.request).then((c) => c || fetch(e.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return res;
      }))
    );
    return;
  }
  // 其余：网络优先，缓存回退
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request).then((c) => c || caches.match('./index.html')))
  );
});
