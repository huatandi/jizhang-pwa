'use strict';
/**
 * frankfurter-provider —— Frankfurter API Provider（v2）
 *
 * 数据源：https://api.frankfurter.dev/v2
 * - 免费 / 开源 / 无 API Key / CORS 开放
 * - 201 种货币，数据来自 84 家央行
 * - 支持 ?providers=BANXICO（墨西哥央行 FIX 参考汇率）
 *
 * API URL 不允许散落，集中管理。
 * Provider 补齐：provider / rateType / fetchedAt / source。
 */
(function (global) {
  const T = global.ExchangeRateTypes;
  const Http = global.FxHttpClient;

  const FRANKFURTER_API = 'https://api.frankfurter.dev/v2';

  // BANXICO 覆盖的货币对（FIX 参考汇率）。BANXICO 只覆盖有限货币，未列出的走 blend。
  // 实际请求时对 MXN 相关对尝试 providers=BANXICO，失败则 fallback。
  function normalizeCurrency(code) {
    return String(code || '').toUpperCase();
  }

  /**
   * 获取单一汇率。
   * @param {string} base 基准货币
   * @param {string} quote 报价货币
   * @param {object} opts { providerMode, timeoutMs }
   */
  async function getLatestRate(base, quote, opts = {}) {
    const b = normalizeCurrency(base);
    const q = normalizeCurrency(quote);
    const mode = opts.providerMode || T.ProviderMode.AUTO;
    const urlBase = `${FRANKFURTER_API}/rate/${b}/${q}`;

    // BANXICO 策略：AUTO 且任一端为 MXN 时优先 BANXICO（USD/MXN 或 MXN/USD 都走 FIX）
    const tryBanxico = (mode === T.ProviderMode.BANXICO) || (mode === T.ProviderMode.AUTO && (q === 'MXN' || b === 'MXN'));
    if (tryBanxico) {
      try {
        const data = await Http.requestJson(urlBase + '?providers=BANXICO', { timeoutMs: opts.timeoutMs });
        return normalizeSingle(data, b, q, T.RateSource.BANXICO, T.RateType.OFFICIAL);
      } catch (e) {
        // BANXICO 失败 → fallback blend（调用方会在 UI 显示实际 provider）
      }
    }
    const data = await Http.requestJson(urlBase, { timeoutMs: opts.timeoutMs });
    return normalizeSingle(data, b, q, T.RateSource.FRANKFURTER_BLEND, T.RateType.BLENDED);
  }

  /**
   * 获取多币种汇率（相对同一 base）。
   * @param {string} base
   * @param {string[]} quotes
   */
  async function getLatestRates(base, quotes, opts = {}) {
    const b = normalizeCurrency(base);
    const qs = (quotes || []).map(normalizeCurrency).filter((c) => c !== b);
    if (!qs.length) return [];
    const urlBase = `${FRANKFURTER_API}/rates?base=${b}&quotes=${qs.join(',')}`;
    // 批量接口返回数组：每条独立
    const data = await Http.requestJson(urlBase, { timeoutMs: opts.timeoutMs });
    if (!Array.isArray(data)) return [];
    return data
      .filter((r) => r && r.base && r.quote && typeof r.rate === 'number' && Number.isFinite(r.rate) && r.rate > 0)
      .map((r) => ({
        base: normalizeCurrency(r.base),
        quote: normalizeCurrency(r.quote),
        rate: String(r.rate), // 保留原始精度（String 存储）
        rawRate: r.rate,
        date: r.date || '',
        provider: T.RateSource.FRANKFURTER_BLEND,
        rateType: T.RateType.BLENDED,
        fetchedAt: new Date().toISOString(),
        source: 'Frankfurter',
        isCached: false,
      }));
  }

  /**
   * 获取历史汇率。
   * @param {string} base
   * @param {string} quote
   * @param {string} date YYYY-MM-DD
   */
  async function getHistoricalRate(base, quote, date, opts = {}) {
    const b = normalizeCurrency(base);
    const q = normalizeCurrency(quote);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      const err = new Error('日期格式无效');
      err.code = 'invalid_date';
      throw err;
    }
    const data = await Http.requestJson(`${FRANKFURTER_API}/rates?date=${date}&base=${b}&quotes=${q}`, { timeoutMs: opts.timeoutMs });
    // 历史接口同样返回数组
    if (Array.isArray(data)) {
      const hit = data.find((r) => r && r.base === b && r.quote === q);
      if (hit) return normalizeSingle(hit, b, q, T.RateSource.FRANKFURTER_BLEND, T.RateType.BLENDED);
    }
    const err = new Error('该日期无数据');
    err.code = 'no_data';
    throw err;
  }

  function normalizeSingle(data, base, quote, provider, rateType) {
    if (!data || typeof data.rate !== 'number' || !Number.isFinite(data.rate) || data.rate <= 0) {
      const err = new Error('汇率数据无效');
      err.code = 'invalid_rate';
      throw err;
    }
    return {
      base,
      quote,
      rate: String(data.rate),
      rawRate: data.rate,
      date: data.date || '',
      provider,
      providerName: provider === T.RateSource.BANXICO ? 'Banco de México' : 'Frankfurter',
      rateType,
      fetchedAt: new Date().toISOString(),
      source: provider === T.RateSource.BANXICO ? 'Banco de México / BANXICO via Frankfurter' : 'Frankfurter (ECB blend)',
      isCached: false,
    };
  }

  // 获取货币列表（v2 返回 currencies 元数据或直接代码列表）
  async function getCurrencies() {
    try {
      const data = await Http.requestJson(FRANKFURTER_API + '/currencies');
      // 可能返回 { code: name } 或数组
      if (Array.isArray(data)) return data.map((c) => (typeof c === 'string' ? c : c.code)).filter(Boolean);
      if (data && typeof data === 'object') return Object.keys(data);
      return [];
    } catch (e) { return []; }
  }

  global.FrankfurterProvider = {
    name: 'Frankfurter',
    baseUrl: FRANKFURTER_API,
    getLatestRate,
    getLatestRates,
    getHistoricalRate,
    getCurrencies,
  };
})(typeof window !== 'undefined' ? window : globalThis);
