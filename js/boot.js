'use strict';
/**
 * Boot —— PWA 启动引导
 * 顺序：sql.js(已在 head 加载) → OfflineDB 打开 → OfflineBackend 安装 → 动态加载 app.js
 * 确保前端所有 fetch('/api/*') 都先被离线伪后端接管。
 * 
 * 🔧 修复：黑屏兜底 - 增加重试机制
 */
(function () {
  async function boot() {
    let retryCount = 0;
    const maxRetries = 3;

    async function tryBoot() {
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
        return true;
      } catch (e) {
        console.warn('[boot] 离线初始化失败 (尝试 ' + (retryCount + 1) + '/' + maxRetries + '):', e);
        return false;
      }
    }

    // 首次尝试
    let success = await tryBoot();
    
    // 如果失败，等待 1 秒后重试
    if (!success) {
      await new Promise(r => setTimeout(r, 1000));
      retryCount++;
      success = await tryBoot();
    }

    // 如果仍然失败，等待 2 秒后最后一次重试
    if (!success && retryCount < maxRetries) {
      await new Promise(r => setTimeout(r, 2000));
      retryCount++;
      success = await tryBoot();
    }

    // 所有尝试都失败 → 回退到联网模式（直接加载 app.js）
    if (!success) {
      console.warn('[boot] 所有离线初始化尝试失败，回退到联网模式');
      const s = document.createElement('script');
      s.src = 'js/app.js?v=55';
      document.body.appendChild(s);
      
      // 显示提示（非阻塞）
      try {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#f59e0b;color:#fff;padding:10px 20px;border-radius:10px;z-index:9999;font-size:14px;text-align:center;max-width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
        toast.textContent = '⚠️ 离线模式初始化失败，已切换到在线模式（数据仍可正常使用）';
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; setTimeout(() => toast.remove(), 600); }, 4000);
      } catch (e) { /* ignore */ }
    }
  }

  // 🔧 黑屏兜底：确保在 DOM 加载完成后执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();