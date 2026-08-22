'use strict';
/**
 * exchange-rate-types —— 汇率引擎类型/常量定义（Reference Exchange Rate Engine V1.0）
 *
 * 定位：参考汇率（Reference Rate），仅用于记账/估算/信息展示。
 * 不是交易汇率 / 结算汇率 / 支付汇率 / 转账汇率。
 * 不参与任何支付、结算、兑换、转账、投资服务。
 */
(function (global) {
  const RateSource = {
    BANXICO: 'BANXICO',
    ECB: 'ECB',
    FRED: 'FRED',
    FRANKFURTER_BLEND: 'FRANKFURTER_BLEND',
    CACHE: 'CACHE',
  };

  const RateType = {
    REFERENCE: 'reference',
    OFFICIAL: 'official',
    INDICATIVE: 'indicative',
    SPOT: 'spot',
    BLENDED: 'blended',
  };

  const RateQuality = {
    OFFICIAL: 'official',
    REFERENCE: 'reference',
    BLENDED: 'blended',
    CACHED: 'cached',
  };

  const ProviderMode = {
    AUTO: 'auto',
    BANXICO: 'BANXICO',
    ECB: 'ECB',
    FRED: 'FRED',
  };

  // 缓存 TTL（毫秒）：latest 1 小时
  const CACHE_TTL_MS = 60 * 60 * 1000;
  // 历史汇率永久缓存（历史数据不变）
  const HISTORY_CACHE_TTL_MS = Number.MAX_SAFE_INTEGER;

  const HTTP_TIMEOUT_MS = 10000;
  const MAX_RETRIES = 2;
  const RETRY_DELAYS = [500, 1500];

  // 汇率异常检测阈值：与缓存相比变化 > 30% 视为可疑
  const SUSPICIOUS_CHANGE_RATIO = 0.3;

  global.ExchangeRateTypes = {
    RateSource,
    RateType,
    RateQuality,
    ProviderMode,
    CACHE_TTL_MS,
    HISTORY_CACHE_TTL_MS,
    HTTP_TIMEOUT_MS,
    MAX_RETRIES,
    RETRY_DELAYS,
    SUSPICIOUS_CHANGE_RATIO,
  };
})(typeof window !== 'undefined' ? window : globalThis);
