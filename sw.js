'use strict';
/**
 * Service Worker —— PWA 离线缓存
 * 缓存策略：App 壳（HTML/CSS/JS/vendor/图标）安装时预缓存；运行时网络优先 + 缓存回退。
 */
const CACHE_NAME = 'jizhang-pwa-v5';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/offline-db.js',
  './js/offline-backend.js',
  './js/offline-ocr.js',
  './manifest.json',
  './vendor/echarts/echarts.min.js',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/spa.traineddata.gz',
  './vendor/tesseract/eng.traineddata.gz',
  './vendor/tesseract/chi_sim.traineddata.gz',
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
