'use strict';
/**
 * PullRefresh —— 手机端下拉刷新（PWA 无原生 pull-to-refresh，自实现）
 *
 * 原理：触摸事件检测。仅在以下条件触发：
 *   1. 移动端（触摸设备）
 *   2. 页面/主容器滚动条在顶部（scrollTop === 0）
 *   3. 下拉位移超过阈值
 * 松手后执行刷新回调，显示刷新指示器（顶部下拉动画）。
 *
 * 刷新内容由调用方注入（默认刷新仪表盘/收入/支出/进货/汇率）。
 * 设计为独立模块，不反向依赖 app.js（通过 window 全局函数回调，符合 F-01 兼容桥）。
 */
(function (global) {
  let enabled = false;
  let pulling = false;        // 正在下拉中
  let startY = 0;
  let startX = 0;
  let pullDist = 0;          // 当前下拉位移
  let refreshCb = null;      // 刷新回调
  let refreshing = false;    // 刷新中（防重复）
  let indicator = null;      // 指示器 DOM

  // 触发阈值（px）：原始下拉距离超过此值松手才刷新
  const TRIGGER = 70;
  // 最大视觉下拉距离（阻尼后）
  const MAX_PULL = 90;

  const DEFAULT_REFRESH = async () => {
    // 刷新主要数据视图（通过 window 全局函数，避免静态依赖）
    if (global.refreshDashboards) global.refreshDashboards();
    if (global.renderIncome) global.renderIncome();
    if (global.renderExpense) global.renderExpense();
    if (global.renderPurchase) global.renderPurchase();
    if (global.FxTool && global.FxTool.refresh) global.FxTool.refresh();
    if (global.AIKit && global.AIKit.globalConfig) { /* 配置无需刷新 */ }
  };

  function createIndicator() {
    if (indicator) return indicator;
    const el = document.createElement('div');
    el.id = 'pullRefreshIndicator';
    el.className = 'pull-refresh-indicator';
    el.innerHTML = '<div class="pull-refresh-spinner"></div><span class="pull-refresh-text">下拉刷新</span>';
    document.body.appendChild(el);
    indicator = el;
    return el;
  }

  function removeIndicator() {
    if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
    indicator = null;
  }

  function setIndicator(dist, over) {
    const el = createIndicator();
    el.style.transform = `translate(-50%, ${Math.max(0, dist - 40)}px)`;
    const text = el.querySelector('.pull-refresh-text');
    if (text) {
      if (refreshing) text.textContent = '刷新中…';
      else if (dist >= TRIGGER) text.textContent = '松开刷新';
      else text.textContent = '下拉刷新';
    }
    el.classList.toggle('pull-refresh-over', over);
  }

  // 判断触摸点是否在可滚动容器内（这些区域不触发下拉刷新）
  function inScrollableContainer(el) {
    if (!el || !el.closest) return false;
    const SCROLL_CTX = '.table-card, .modal, .modal-body, .query-panel, .workbench-body, .settings-section, .fx-card, .chart-card, .ai-panel, .voice-preview, .page-header';
    const ctx = el.closest(SCROLL_CTX);
    if (ctx) {
      // 容器内部自身可滚动（overflow auto/scroll）→ 在顶部才允许
      const cs = window.getComputedStyle(ctx);
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
        return ctx.scrollTop > 0;
      }
      return true;
    }
    return false;
  }

  function init(opts) {
    if (enabled || typeof document === 'undefined') return;
    if (!('ontouchstart' in window)) return; // 仅触摸设备
    refreshCb = (opts && opts.onRefresh) || DEFAULT_REFRESH;

    document.addEventListener('touchstart', (e) => {
      // 仅单指、且页面滚动在顶部
      if (e.touches && e.touches.length !== 1) return;
      if (window.pageYOffset > 0) return;
      if (inScrollableContainer(e.target)) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pullDist = 0;
      pulling = true;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!pulling || refreshing || !e.touches || e.touches.length !== 1) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      // 横移为主 → 不是下拉
      if (Math.abs(dx) > Math.abs(dy)) { pulling = false; removeIndicator(); return; }
      if (dy <= 0) { pullDist = 0; removeIndicator(); return; }
      // 阻尼：视觉位移衰减（判定用原始 dy，松手时用 dy >= TRIGGER）
      pullDist = dy * 0.6;
      if (pullDist > MAX_PULL) pullDist = MAX_PULL;
      setIndicator(pullDist, dy >= TRIGGER);
      // 阻止页面原生滚动（下拉期间）
      if (e.cancelable && pullDist > 8) e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
      if (!pulling) return;
      pulling = false;
      if (refreshing) return;
      const dy = e.changedTouches && e.changedTouches[0]
        ? e.changedTouches[0].clientY - startY
        : pullDist;
      if (dy >= TRIGGER) {
        // 触发刷新
        refreshing = true;
        const el = createIndicator();
        el.classList.add('pull-refresh-active');
        el.style.transform = 'translate(-50%, 8px)';
        const text = el.querySelector('.pull-refresh-text');
        if (text) text.textContent = '刷新中…';
        Promise.resolve()
          .then(() => refreshCb && refreshCb())
          .catch((err) => { console.warn('[pull-refresh]', err); })
          .finally(() => {
            refreshing = false;
            el.classList.remove('pull-refresh-active');
            setTimeout(removeIndicator, 300);
          });
      } else {
        removeIndicator();
      }
    }, { passive: true });

    enabled = true;
  }

  global.PullRefresh = {
    init,
    get enabled() { return enabled; },
    setRefreshCb: (cb) => { refreshCb = cb || DEFAULT_REFRESH; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
