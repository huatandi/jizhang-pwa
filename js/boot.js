'use strict';
/**
 * Boot —— PWA 启动引导
 * 顺序：sql.js(已在 head 加载) → OfflineDB 打开 → OfflineBackend 安装 → 动态加载 app.js
 * 确保前端所有 fetch('/api/*') 都先被离线伪后端接管。
 * PWA 修复：加启动画面（防黑屏）+ 超时容错（加载超时则继续，避免卡死）。
 */
(function () {
  // 启动画面：防黑屏（用户能看到"正在加载"）
  function showSplash() {
    try {
      let sp = document.getElementById('pwaSplash');
      if (!sp) {
        sp = document.createElement('div');
        sp.id = 'pwaSplash';
        sp.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0b1120;color:#e2e8f0;font-family:sans-serif;gap:16px';
        sp.innerHTML = '<div style="font-size:42px">📋</div><div style="font-size:16px;font-weight:600">飞常明细 · 正在加载…</div><div style="width:40px;height:40px;border:3px solid rgba(255,176,32,.2);border-top-color:#ffb020;border-radius:50%;animation:pwaSpin 1s linear infinite"></div><style>@keyframes pwaSpin{to{transform:rotate(360deg)}}</style>';
        document.body.appendChild(sp);
      }
    } catch (e) { /* ignore */ }
  }
  function hideSplash() {
    try { const sp = document.getElementById('pwaSplash'); if (sp) sp.remove(); } catch (e) { /* ignore */ }
  }

  async function boot() {
    // iOS 防横向溢出：内联强制样式（CSS 加载失败也生效，先于一切渲染）
    try {
      const docEl = document.documentElement, b = document.body;
      if (docEl) {
        docEl.style.overflowX = 'clip';
        docEl.style.maxWidth = '100%';
        docEl.style.width = '100%';
      }
      if (b) {
        b.style.overflowX = 'clip';
        b.style.maxWidth = '100%';
        b.style.width = '100%';
      }
    } catch (e) { /* ignore */ }
    showSplash();
    let offlineReady = false;
    try {
      // 1. 打开离线数据库（IndexedDB 持久化），带超时（10 秒）
      await Promise.race([
        window.OfflineDB.openDB(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('数据库加载超时')), 10000)),
      ]);
      // 2. 安装伪后端（劫持 fetch）
      await window.OfflineBackend.installOfflineBackend();
      offlineReady = true;
      // 3. 注册 Service Worker（离线缓存）
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[pwa] SW 注册失败:', e));
      }
    } catch (e) {
      console.error('[boot] 离线初始化失败（进入联网模式）:', e);
      offlineReady = false;
    }
    // 4. 加载主应用
    const s = document.createElement('script');
    s.src = 'js/app.js?v=96';
    s.onload = () => hideSplash();
    s.onerror = () => { hideSplash(); console.error('[boot] app.js 加载失败'); };
    document.body.appendChild(s);
    // 兜底：10 秒后隐藏启动画面（防止加载卡住黑屏）
    setTimeout(hideSplash, 10000);
  }
  boot();
})();
