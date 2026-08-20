'use strict';
/**
 * Boot —— PWA 启动引导
 * 顺序：sql.js(已在 head 加载) → OfflineDB 打开 → OfflineBackend 安装 → 动态加载 app.js
 * 确保前端所有 fetch('/api/*') 都先被离线伪后端接管。
 */
(function () {
  async function boot() {
    try {
      // 1. 打开离线数据库（IndexedDB 持久化）
      await window.OfflineDB.openDB();
      // 2. 安装伪后端（劫持 fetch）
      await window.OfflineBackend.installOfflineBackend();
      // 3. 注册 Service Worker（离线缓存）
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[pwa] SW 注册失败:', e));
      }
      // 4. 加载主应用
      const s = document.createElement('script');
      s.src = 'js/app.js?v=55';
      document.body.appendChild(s);
    } catch (e) {
      console.error('[boot] 离线初始化失败:', e);
      // 回退：直接加载 app.js（联网模式，走远程后端）
      const s = document.createElement('script');
      s.src = 'js/app.js?v=55';
      document.body.appendChild(s);
    }
  }
  boot();
})();
