// 验证汇率模块核心逻辑（node 环境，模拟浏览器全局）
const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\seejee\\GitHub\\jizhang-pwa\\js\\exchange-rate';

global.window = global;
global.AbortController = AbortController;

// 按依赖顺序加载
function load(f) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  // 模拟 IIFE 尾部 (typeof window !== 'undefined' ? window : globalThis) → globalThis=global
  eval(code.replace(/typeof window !== 'undefined' \? window : globalThis/g, 'global'));
}
load('exchange-rate-types.js');
load('currency-registry.js');
load('http-client.js');
load('rate-cache.js');
load('frankfurter-provider.js');
load('rate-calculator.js');
load('exchange-rate-engine.js');

(async () => {
  const T = global.ExchangeRateTypes;
  const Engine = global.ExchangeRateEngine;
  const Calc = global.RateCalculator;
  const Provider = global.FrankfurterProvider;

  // 1. BANXICO 单一汇率
  console.log('--- 1. USD/MXN BANXICO ---');
  try {
    const r = await Provider.getLatestRate('USD', 'MXN', { providerMode: T.ProviderMode.AUTO });
    console.log('provider:', r.provider, '| rate:', r.rate, '| date:', r.date, '| type:', r.rateType, '| source:', r.source);
  } catch (e) { console.log('ERR:', e.message); }

  // 2. 批量（含 CNY）
  console.log('--- 2. 批量 USD→MXN,CAD,EUR,GBP,JPY,CNY ---');
  try {
    const rs = await Provider.getLatestRates('USD', ['MXN', 'CAD', 'EUR', 'GBP', 'JPY', 'CNY']);
    rs.forEach((r) => console.log(r.quote, r.rate, r.date));
  } catch (e) { console.log('ERR:', e.message); }

  // 3. 历史汇率
  console.log('--- 3. 历史 USD/MXN 2026-01-15 ---');
  try {
    const r = await Provider.getHistoricalRate('USD', 'MXN', '2026-01-15');
    console.log('rate:', r.rate, '| date:', r.date);
  } catch (e) { console.log('ERR:', e.message); }

  // 4. 换算
  console.log('--- 4. 换算 100 USD → MXN ---');
  const r1 = await Engine.getReferenceRate('MXN', 'USD');
  console.log('1 MXN =', r1.rate, 'USD');
  const conv = Calc.convertForDisplay({ amount: 100, rate: String(1 / Number(r1.rate)), fromCurrency: 'USD', toCurrency: 'MXN' });
  console.log('100 USD ≈', conv.value, 'MXN');

  // 5. 同币种
  console.log('--- 5. MXN→MXN ---');
  const same = await Engine.getReferenceRate('MXN', 'MXN');
  console.log('rate:', same.rate, '| isCached:', same.isCached);

  // 6. 缓存
  console.log('--- 6. 缓存命中 ---');
  const again = await Engine.getReferenceRate('MXN', 'USD');
  console.log('第二次 isCached:', again.isCached, '| rate:', again.rate);

  // 6.5 非 MXN 本币（全球化验证）：CNY 本币 → 常见货币
  console.log('--- 6.5 CNY 本币批量（全球用户）---');
  try {
    const rs = await Engine.getFavoriteRates('CNY', ['USD', 'EUR', 'JPY', 'GBP', 'MXN']);
    rs.forEach((r) => console.log('1 CNY ≈', r.rate, r.quote, '| provider:', r.provider, '| cached:', r.isCached));
  } catch (e) { console.log('ERR:', e.message); }

  // 7. 异常检测
  console.log('--- 7. 异常检测 ---');
  console.log('17.18 vs 17.18:', Calc.isSuspicious('17.18', '17.18'));
  console.log('17.18 vs 23.0:', Calc.isSuspicious('23.0', '17.18'));
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
