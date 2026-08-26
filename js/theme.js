'use strict';
/**
 * 主题切换 —— 秋色「试穿」主题
 * 只做一件事：把 <html data-theme="…"> 与 localStorage('sm_theme') 同步。
 * 默认（无缓存的 theme）不设 data-theme → 沿用 :root 暗色兜底。
 * 目前支持的离散取值：'autumn'（亮色暖调）。空字符串/其他 → 移除 data-theme（回暗色）。
 */
(function () {
  var KEY = 'sm_theme';
  var SUPPORTED = ['autumn'];

  function currentTheme() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  // 允许 URL ?theme=autumn 临时预览（覆盖缓存本地值），便于截图/分享；不写回 localStorage
  function queryTheme() {
    try {
      var m = /[?&]theme=([^&]+)/.exec(window.location.search || '');
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  function apply(theme) {
    var docEl = document.documentElement;
    if (!docEl) return;
    // 非空白且受支持 → 设置；否则移除（回暗色）
    if (theme && SUPPORTED.indexOf(theme) !== -1) {
      docEl.setAttribute('data-theme', theme);
    } else {
      docEl.removeAttribute('data-theme');
    }
    // 联动 <meta name="theme-color">（iOS 状态栏 / PWA 启动色）
    try {
      var m = docEl.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', (theme === 'autumn') ? '#f7f0e6' : '#0b1120');
    } catch (e) { /* ignore */ }
  }

  function setTheme(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) { /* ignore */ }
    apply(theme);
  }

  function toggleTheme() {
    var next = (currentTheme() === 'autumn') ? '' : 'autumn';
    setTheme(next);
    return next;
  }

  // 载入时读缓存并应用（放在 head 尽早执行，避免主题闪烁）。
  // 优先级：URL ?theme=（临时预览）> localStorage 缓存 > HTML 上已有的静态 data-theme。
  var initialTheme = queryTheme();
  if (!initialTheme) {
    var cached = currentTheme();
    if (cached) {
      initialTheme = cached;
    } else {
      // 无缓存：若 HTML 已写静态 data-theme（分享/预览页），沿用；否则回暗色
      initialTheme = document.documentElement.getAttribute('data-theme') || '';
    }
  }
  apply(initialTheme);

  // 暴露给全局，index.html 里的切换按钮调用
  window.SmTheme = {
    get: currentTheme,
    set: setTheme,
    toggle: toggleTheme,
    apply: apply,
  };

  // 绑定设置页的主题切换按钮（DOM 就绪后，避免 head 阶段元素未渲染）
  function bindToggleButton() {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var label = btn.querySelector('.tt-label');
    function refreshLabel() {
      if (!label) return;
      var on = (currentTheme() === 'autumn');
      label.textContent = on ? '🌙 暗色' : '🍂 秋色试穿';
      btn.title = on ? '切换为暗色（默认）' : '切换为秋色主题';
    }
    refreshLabel();
    btn.addEventListener('click', function () {
      toggleTheme();
      refreshLabel();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindToggleButton);
  } else {
    bindToggleButton();
  }
})();
