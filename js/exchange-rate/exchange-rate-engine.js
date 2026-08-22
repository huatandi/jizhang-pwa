'use strict';
/**
 * exchange-rate-engine —— 汇率引擎（编排层）
 *
 * 核心流程：
 *   UI → Engine → ProviderRegistry(FrankfurterProvider) → Frankfurter API
 *   Memory Cache → IndexedDB → Network（stale-while-revalidate）
 *
 * 原则：
 * - UI 不直接访问 API
 * - Provider 可替换
 * - 不伪造汇率、不把缓存标成实时
 * - 离线显示缓存 + 时间戳
 * - 请求合并（Promise deduplication）
 * - 涉及 MXN 的货币对优先 BANXICO（地区增强），fallback 时 UI 显示真实 provider
 */
(function (global) {
  const T = global.ExchangeRateTypes;
  const Provider = global.FrankfurterProvider;
  const Cache = global.FxRateCache;
  const Calc = global.RateCalculator;

  // 请求合并：同一 key 的进行中请求复用同一 Promise
  const inflight = new Map();

  // 内存 TTL（毫秒）
  const MEM_TTL = T.CACHE_TTL_MS;

  function cacheKey(base, quote, provider, date) {
    return `${base}_${quote}_${provider}_${date}`;
  }

  /**
   * 获取参考汇率（latest）。策略：
   * 1. 内存缓存（TTL 1h）→ 直接返回
   * 2. IndexedDB 缓存 → 返回（isCached=true）+ 后台刷新
   * 3. 网络 → 缓存并返回
   *
   * @param {string} base
   * @param {string} quote
   * @param {object} opts { providerMode, useCache, refreshInBackground }
   */
  async function getReferenceRate(base, quote, opts = {}) {
    const b = String(base || '').toUpperCase();
    const q = String(quote || '').toUpperCase();
    if (b === q) {
      // 同币种：无需请求
      return {
        base: b, quote: q, rate: '1', date: todayLocalStr(), provider: T.RateSource.CACHE,
        rateType: T.RateType.REFERENCE, fetchedAt: new Date().toISOString(), source: 'Same currency', isCached: true,
      };
    }
    const mode = opts.providerMode || T.ProviderMode.AUTO;
    const provider = mode === T.ProviderMode.BANXICO || (mode === T.ProviderMode.AUTO && (b === 'MXN' || q === 'MXN')) ? T.RateSource.BANXICO : T.RateSource.FRANKFURTER_BLEND;
    const key = cacheKey(b, q, provider, 'latest');

    // 1. 内存缓存
    const mem = Cache.get(key);
    if (mem) return mem;

    // 2. 请求合并
    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
      // 3. 尝试 IndexedDB（返回缓存 + 后台刷新）
      const idbHit = await Cache.getAsync(key);
      if (idbHit && opts.useCache !== false) {
        // stale-while-revalidate：立即返回缓存，后台刷新
        if (opts.refreshInBackground !== false) {
          refreshInBackground(key, b, q, mode, provider);
        }
        return Object.assign({}, idbHit, { isCached: true });
      }
      // 4. 网络获取
      try {
        const rate = await Provider.getLatestRate(b, q, { providerMode: mode });
        await Cache.set(key, rate, MEM_TTL);
        return rate;
      } catch (e) {
        // 5. 网络失败 → 任何缓存兜底
        if (idbHit) return Object.assign({}, idbHit, { isCached: true });
        const err = new Error(e && e.message || '获取汇率失败');
        err.code = 'fetch_failed';
        throw err;
      }
    })();

    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => {});
    return p;
  }

  // 后台刷新（不阻塞 UI，失败静默）
  function refreshInBackground(key, b, q, mode, provider) {
    setTimeout(async () => {
      try {
        const rate = await Provider.getLatestRate(b, q, { providerMode: mode });
        await Cache.set(key, rate, MEM_TTL);
        // 广播事件，UI 监听刷新
        try {
          if (global.dispatchEvent) {
            global.dispatchEvent(new CustomEvent('fx:rate-updated', { detail: { base: b, quote: q, rate } }));
          }
        } catch (e) { /* ignore */ }
      } catch (e) { /* 静默 */ }
    }, 50);
  }

  // 多币种批量获取（常用货币列表）
  async function getFavoriteRates(base, quotes, opts = {}) {
    const b = String(base || 'USD').toUpperCase();
    const qs = (quotes || []).filter((c) => String(c).toUpperCase() !== b);
    const results = [];
    // 逐对走统一缓存逻辑（Frankfurter 批量接口虽快，但逐对走缓存更一致）
    const items = await Promise.all(qs.map((q) => {
      return getReferenceRate(b, String(q).toUpperCase(), opts).catch(() => null);
    }));
    items.forEach((r, i) => { if (r) results.push(r); });
    return results;
  }

  // 历史汇率（永久缓存）
  async function getHistoricalRate(base, quote, date, opts = {}) {
    const b = String(base || '').toUpperCase();
    const q = String(quote || '').toUpperCase();
    const histProvider = T.RateSource.FRANKFURTER_BLEND;
    const key = cacheKey(b, q, histProvider, date);

    const cached = await Cache.getAsync(key);
    if (cached) return cached;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const err = new Error('离线且无缓存');
      err.code = 'offline_no_cache';
      throw err;
    }
    const rate = await Provider.getHistoricalRate(b, q, date, { providerMode: opts.providerMode });
    await Cache.set(key, rate, T.HISTORY_CACHE_TTL_MS);
    return rate;
  }

  // 最近可用工作日（历史查询兜底：日期无数据时用最近日期）
  function nearestAvailableDate(dateStr, usedDates) {
    const d = new Date(dateStr);
    for (let i = 0; i < 7; i++) {
      const dt = new Date(d);
      dt.setDate(d.getDate() - i);
      const s = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      if (!usedDates.includes(s)) return s;
    }
    return dateStr;
  }

  // 工具：本地时区今天 YYYY-MM-DD
  function todayLocalStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 判断是否离线
  function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  global.ExchangeRateEngine = {
    getReferenceRate,
    getFavoriteRates,
    getHistoricalRate,
    nearestAvailableDate,
    isOffline,
    todayLocal: todayLocalStr,
  };
})(typeof window !== 'undefined' ? window : globalThis);
