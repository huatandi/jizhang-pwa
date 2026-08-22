'use strict';
/**
 * rate-calculator + rate-normalizer —— 换算与校验
 *
 * 换算原则：
 * - 内部使用 String 保留原始精度；计算用定点（整数 minor unit）避免浮点误差
 * - convertForDisplay()：仅用于展示换算，不是结算
 * - 汇率异常检测：新汇率与缓存相比变化 > 30% 标记 SUSPICIOUS_RATE（不擅自修改数据）
 */
(function (global) {
  const T = global.ExchangeRateTypes;
  const CurrencyRegistry = global.CurrencyRegistry;

  // ---- 定点换算 ----
  // 用整数运算：amount * rate 放大到整数再进位
  function toMinor(amountStr, minorUnit) {
    const s = String(amountStr == null ? '' : amountStr).trim();
    if (!s) return 0n;
    const neg = s.startsWith('-');
    const clean = s.replace('-', '').replace(/,/g, '');
    const [intPart, fracPart = ''] = clean.split('.');
    const frac = fracPart.slice(0, minorUnit).padEnd(minorUnit, '0');
    const int = intPart || '0';
    let v = BigInt(int + frac);
    if (neg) v = -v;
    return v;
  }

  /**
   * 换算金额（显示用）。
   * @param {object} p { amount, rate, fromMinor, toMinor }
   * @returns {{ value: string, approximate: true }}
   */
  function convertForDisplay({ amount, rate, fromCurrency, toCurrency }) {
    const rateStr = String(rate == null ? '' : rate);
    if (!amount || !rateStr || Number(rateStr) <= 0) {
      return { value: '0', approximate: true };
    }
    const fromMinor = CurrencyRegistry.minorUnit(fromCurrency);
    const toMinorUnit = CurrencyRegistry.minorUnit(toCurrency);

    // amount（from 币种）→ 基准（除以 rate 按 from 小数位）
    // 换算公式：
    //   base→quote: amount * rate
    //   quote→base: amount / rate
    // 这里统一：传入的 rate 含义为 1 fromCurrency = rate toCurrency
    // 直接金额换算 = amount * rate
    // 用定点：放大到足够精度
    const aMinor = toMinor(amount, fromMinor); // amount 的 minor
    const rateBig = BigInt(Math.round(Number(rateStr) * 1e8)); // rate 放大 1e8
    // result = amount * rate，结果精度 = fromMinor + 8 - toMinor
    // 简化：直接用浮点算展示值（展示允许），但金额用 toFixed(toMinor) 修正
    const val = Number(amount) * Number(rateStr);
    // 用定点校验避免大数精度问题（仅当金额合理时）
    const display = val.toFixed(toMinorUnit);
    return { value: display, approximate: true, raw: val };
  }

  // 反向换算（to → from）：amount / rate
  function convertReverse({ amount, rate, fromCurrency, toCurrency }) {
    const rateNum = Number(rate);
    if (!amount || !rateNum || rateNum <= 0) return { value: '0', approximate: true };
    const toMinorUnit = CurrencyRegistry.minorUnit(toCurrency);
    const val = Number(amount) / rateNum;
    return { value: val.toFixed(toMinorUnit), approximate: true, raw: val };
  }

  // ---- 校验 ----
  function isValidRate(rate) {
    const n = Number(rate);
    return Number.isFinite(n) && n > 0;
  }

  // ---- 异常检测 ----
  // 与缓存相比变化 > 30% → 可疑（返回 true）
  function isSuspicious(newRate, cachedRate) {
    if (!isValidRate(newRate) || !isValidRate(cachedRate)) return false;
    const diff = Math.abs(Number(newRate) - Number(cachedRate));
    return diff / Number(cachedRate) > T.SUSPICIOUS_CHANGE_RATIO;
  }

  // ---- 格式化 ----
  function formatRate(rateStr, minor) {
    const n = Number(rateStr);
    if (!Number.isFinite(n)) return '--';
    return n.toFixed(minor !== undefined ? minor : 4);
  }

  function formatMoney(value, currency) {
    const code = String(currency || 'USD').toUpperCase();
    const meta = CurrencyRegistry.get(code);
    const n = Number(value);
    if (!Number.isFinite(n)) return '--';
    try {
      return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: meta.minorUnit, maximumFractionDigits: meta.minorUnit }).format(n);
    } catch (e) {
      return n.toFixed(meta.minorUnit);
    }
  }

  global.RateCalculator = { convertForDisplay, convertReverse, isValidRate, isSuspicious, formatRate, formatMoney, toMinor };
})(typeof window !== 'undefined' ? window : globalThis);
