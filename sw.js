'use strict';
/**
 * Service Worker —— PWA 离线缓存
 * 缓存策略：App 壳（HTML/CSS/JS/vendor/图标）安装时预缓存；运行时网络优先 + 缓存回退。
 * 
 * 🔧 修复：版本号升级到 v3，强制浏览器更新缓存（解决黑屏/白屏问题）
 */
const CACHE_NAME = 'jizhang-pwa-v3';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/offline-db.js',
  './js/offline-backend.js',
  './manifest.json',
  './vendor/echarts/echarts.min.js',
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/sqljs/sql-wasm.js',
  './vendor/sqljs/sql-wasm.wasm',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // 🔧 修复：逐个添加，某个失败不影响整体
        return Promise.allSettled(
          APP_SHELL.map(url => cache.add(url).catch(err => console.warn('[SW] 缓存失败:', url, err)))
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => {
        // 🔧 修复：删除所有旧版本缓存
        return Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // API 请求不缓存（走 IndexedDB 伪后端）
  if (url.pathname.startsWith('/api/')) return;
  
  // 🔧 修复：语言包（大文件）缓存优先
  if (url.pathname.includes('traineddata') || url.pathname.includes('wasm')) {
    e.respondWith(
      caches.match(e.request).then((c) => {
        if (c) return c;
        return fetch(e.request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return res;
        });
      }).catch(() => {
        // 🔧 修复：缓存失败时尝试网络，不阻塞
        return fetch(e.request);
      })
    );
    return;
  }

  // 其余：网络优先，缓存回退
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => {
        // 🔧 修复：缓存回退，找不到则返回 index.html（避免白屏）
        return caches.match(e.request).then((cached) => {
          if (cached) return cached;
          return caches.match('./index.html');
        });
      })
  );
});