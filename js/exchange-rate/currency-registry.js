'use strict';
/**
 * currency-registry —— 货币注册表（代码/符号/名称/小数位）
 *
 * 原则：不要所有货币统一 2 位小数（JPY=0、KWD=3 等）。
 * 小数位用于显示格式化（Intl.NumberFormat）与换算精度控制。
 * 货币符号冲突（USD/MXN/CAD/AUD 都用 $）：UI 层必须带货币代码，如 "MXN $1,000"。
 */
(function (global) {
  // code → { symbol, name, nativeName, minorUnit }
  const REGISTRY = {
    MXN: { symbol: '$', name: 'Mexican Peso', nativeName: 'Peso Mexicano', minorUnit: 2 },
    USD: { symbol: '$', name: 'US Dollar', nativeName: 'Dólar Estadounidense', minorUnit: 2 },
    CAD: { symbol: '$', name: 'Canadian Dollar', nativeName: 'Dólar Canadiense', minorUnit: 2 },
    AUD: { symbol: '$', name: 'Australian Dollar', nativeName: 'Dólar Australiano', minorUnit: 2 },
    EUR: { symbol: '€', name: 'Euro', nativeName: 'Euro', minorUnit: 2 },
    GBP: { symbol: '£', name: 'British Pound', nativeName: 'Libra Esterlina', minorUnit: 2 },
    JPY: { symbol: '¥', name: 'Japanese Yen', nativeName: 'Yen Japonés', minorUnit: 0 },
    CNY: { symbol: '¥', name: 'Chinese Yuan', nativeName: '人民币', minorUnit: 2 },
    CHF: { symbol: 'Fr', name: 'Swiss Franc', nativeName: 'Franco Suizo', minorUnit: 2 },
    HKD: { symbol: 'HK$', name: 'Hong Kong Dollar', nativeName: 'Dólar de Hong Kong', minorUnit: 2 },
    KRW: { symbol: '₩', name: 'South Korean Won', nativeName: 'Won Surcoreano', minorUnit: 0 },
    BRL: { symbol: 'R$', name: 'Brazilian Real', nativeName: 'Real Brasileño', minorUnit: 2 },
    ARS: { symbol: '$', name: 'Argentine Peso', nativeName: 'Peso Argentino', minorUnit: 2 },
    COP: { symbol: '$', name: 'Colombian Peso', nativeName: 'Peso Colombiano', minorUnit: 2 },
    CLP: { symbol: '$', name: 'Chilean Peso', nativeName: 'Peso Chileno', minorUnit: 0 },
    PEN: { symbol: 'S/', name: 'Peruvian Sol', nativeName: 'Sol Peruano', minorUnit: 2 },
    BTC: { symbol: '₿', name: 'Bitcoin', nativeName: 'Bitcoin', minorUnit: 8 },
  };

  function get(code) {
    const c = String(code || '').toUpperCase();
    return REGISTRY[c] || { symbol: c, name: c, nativeName: c, minorUnit: 2 };
  }

  function minorUnit(code) {
    return get(code).minorUnit;
  }

  // 常用货币：默认仅 USD + EUR，其余由用户手动添加（对应"常用外汇默认两个，需要时再添加"）
  function favoritesFor(base) {
    return ['USD', 'EUR'];
  }

  // 默认常用货币（无本币偏好时的兜底：国际主流）
  const DEFAULT_FAVORITES = ['USD', 'EUR'];

  // 本地化货币名称（浏览器语言）
  let _displayNames = null;
  function localizedName(code) {
    try {
      if (!_displayNames) _displayNames = new Intl.DisplayNames([navigator.language || 'zh-CN'], { type: 'currency' });
      const n = _displayNames.of(code);
      if (n && n !== code) return n;
    } catch (e) { /* ignore */ }
    return get(code).name;
  }

  global.CurrencyRegistry = { get, minorUnit, favoritesFor, DEFAULT_FAVORITES, localizedName, REGISTRY };
})(typeof window !== 'undefined' ? window : globalThis);
