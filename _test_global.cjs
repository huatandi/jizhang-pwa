// 验证 global-config 全球化逻辑（node 环境，显式 opts 传参，不依赖全局 navigator）
const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\seejee\\GitHub\\jizhang-pwa\\js';

global.window = global;

function load(f) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  eval(code.replace(/typeof window !== 'undefined' \? window : globalThis/g, 'global'));
}
load('ai/global-config.js');

const gc = global.AIKit.globalConfig;

function section(name) {
  console.log('\n=== ' + name + ' ===');
}
function show(label, v) { console.log(label + ':', JSON.stringify(v)); }

// 1. 墨西哥用户（本币 MXN + 浏览器 es-MX）
section('墨西哥用户（baseCurrency=MXN, 浏览器 es-MX）');
show('region', gc.detectRegion({ baseCurrency: 'MXN', browserLang: 'es-MX' }));
show('lang', gc.detectLang({ baseCurrency: 'MXN', browserLang: 'es-MX' }));
show('ocr', gc.resolveOcrLang({ baseCurrency: 'MXN', browserLang: 'es-MX' }));
show('paddle', gc.resolvePaddleLang({ baseCurrency: 'MXN', browserLang: 'es-MX' }));
show('asr', gc.resolveAsrLang({ baseCurrency: 'MXN', browserLang: 'es-MX' }));
show('webspeech', gc.resolveWebSpeechLang({ baseCurrency: 'MXN', browserLang: 'es-MX' }));
show('isMexico', gc.isMexicoRegion({ baseCurrency: 'MXN', browserLang: 'es-MX' }));

// 2. 中国用户（本币 CNY + 浏览器 zh-CN）
section('中国用户（baseCurrency=CNY, 浏览器 zh-CN）');
show('region', gc.detectRegion({ baseCurrency: 'CNY', browserLang: 'zh-CN' }));
show('lang', gc.detectLang({ baseCurrency: 'CNY', browserLang: 'zh-CN' }));
show('ocr', gc.resolveOcrLang({ baseCurrency: 'CNY', browserLang: 'zh-CN' }));
show('paddle', gc.resolvePaddleLang({ baseCurrency: 'CNY', browserLang: 'zh-CN' }));
show('asr', gc.resolveAsrLang({ baseCurrency: 'CNY', browserLang: 'zh-CN' }));
show('isMexico', gc.isMexicoRegion({ baseCurrency: 'CNY', browserLang: 'zh-CN' }));

// 3. 美国用户（本币 USD + 浏览器 en-US）
section('美国用户（baseCurrency=USD, 浏览器 en-US）');
show('region', gc.detectRegion({ baseCurrency: 'USD', browserLang: 'en-US' }));
show('lang', gc.detectLang({ baseCurrency: 'USD', browserLang: 'en-US' }));
show('ocr', gc.resolveOcrLang({ baseCurrency: 'USD', browserLang: 'en-US' }));
show('paddle', gc.resolvePaddleLang({ baseCurrency: 'USD', browserLang: 'en-US' }));
show('asr', gc.resolveAsrLang({ baseCurrency: 'USD', browserLang: 'en-US' }));

// 4. 日本用户（无本币，仅浏览器 ja-JP）
section('日本用户（无本币, 浏览器 ja-JP）');
show('region', gc.detectRegion({ browserLang: 'ja-JP' }));
show('lang', gc.detectLang({ browserLang: 'ja-JP' }));
show('ocr', gc.resolveOcrLang({ browserLang: 'ja-JP' }));
show('paddle', gc.resolvePaddleLang({ browserLang: 'ja-JP' }));
show('asr', gc.resolveAsrLang({ browserLang: 'ja-JP' }));

// 5. 中性兜底（无本币、浏览器语言为空 → en-US 兜底）
section('中性兜底（无本币, 浏览器语言为空）');
show('region', gc.detectRegion({ browserLang: '' }));
show('lang', gc.detectLang({ browserLang: '' }));
show('ocr', gc.resolveOcrLang({ browserLang: '' }));
show('paddle', gc.resolvePaddleLang({ browserLang: '' }));
show('asr', gc.resolveAsrLang({ browserLang: '' }));
show('isMexico', gc.isMexicoRegion({ browserLang: '' }));

// 6. 巴西用户（本币 BRL + 浏览器 pt-BR）
section('巴西用户（baseCurrency=BRL, 浏览器 pt-BR）');
show('region', gc.detectRegion({ baseCurrency: 'BRL', browserLang: 'pt-BR' }));
show('lang', gc.detectLang({ baseCurrency: 'BRL', browserLang: 'pt-BR' }));
show('ocr', gc.resolveOcrLang({ baseCurrency: 'BRL', browserLang: 'pt-BR' }));
show('asr', gc.resolveAsrLang({ baseCurrency: 'BRL', browserLang: 'pt-BR' }));

// 7. 阿根廷用户（西语但非墨西哥 → 不应激活 MexicoParser）
section('阿根廷用户（baseCurrency=ARS, 浏览器 es-AR）');
show('region', gc.detectRegion({ baseCurrency: 'ARS', browserLang: 'es-AR' }));
show('lang', gc.detectLang({ baseCurrency: 'ARS', browserLang: 'es-AR' }));
show('ocr', gc.resolveOcrLang({ baseCurrency: 'ARS', browserLang: 'es-AR' }));
show('asr', gc.resolveAsrLang({ baseCurrency: 'ARS', browserLang: 'es-AR' }));
show('isMexico', gc.isMexicoRegion({ baseCurrency: 'ARS', browserLang: 'es-AR' }));

// 8. 地区插件判断
section('地区插件（isMexicoDocType）');
show('CFDI', gc.isMexicoDocType('CFDI'));
show('RECEIPT', gc.isMexicoDocType('RECEIPT'));
show('BANK_TRANSFER', gc.isMexicoDocType('BANK_TRANSFER'));

// 9. EUR 共享货币歧义消歧（法国用户：本币 EUR + 浏览器 fr-FR → 应解析为 FR 而非 DE）
section('EUR 共享货币消歧（baseCurrency=EUR, 浏览器 fr-FR）');
show('region', gc.detectRegion({ baseCurrency: 'EUR', browserLang: 'fr-FR' }));
show('lang', gc.detectLang({ baseCurrency: 'EUR', browserLang: 'fr-FR' }));
show('ocr', gc.resolveOcrLang({ baseCurrency: 'EUR', browserLang: 'fr-FR' }));
show('asr', gc.resolveAsrLang({ baseCurrency: 'EUR', browserLang: 'fr-FR' }));

// 10. EUR 共享货币无浏览器消歧 → 中性（不硬选 DE）
section('EUR 无消歧（baseCurrency=EUR, 浏览器语言为空）');
show('region', gc.detectRegion({ baseCurrency: 'EUR', browserLang: '' }));
show('lang', gc.detectLang({ baseCurrency: 'EUR', browserLang: '' }));
show('ocr', gc.resolveOcrLang({ baseCurrency: 'EUR', browserLang: '' }));
show('asr', gc.resolveAsrLang({ baseCurrency: 'EUR', browserLang: '' }));

// 11. USD 共享货币（美国用户 + 浏览器 en-US）
section('USD 共享货币消歧（baseCurrency=USD, 浏览器 en-US）');
show('region', gc.detectRegion({ baseCurrency: 'USD', browserLang: 'en-US' }));
show('lang', gc.detectLang({ baseCurrency: 'USD', browserLang: 'en-US' }));

// 12. 西语共享 EUR + 浏览器 es-ES（西班牙）
section('EUR 消歧·西班牙（baseCurrency=EUR, 浏览器 es-ES）');
show('region', gc.detectRegion({ baseCurrency: 'EUR', browserLang: 'es-ES' }));
show('lang', gc.detectLang({ baseCurrency: 'EUR', browserLang: 'es-ES' }));
show('ocr', gc.resolveOcrLang({ baseCurrency: 'EUR', browserLang: 'es-ES' }));

console.log('\n✅ 全部用例执行完成');
