'use strict';
/**
 * AIKit · global-config —— 全球化配置（语言 / 地区 / 货币解析）
 *
 * 核心目标：OCR/ASR 不再假设用户是墨西哥用户。
 *   - 默认语言：跟随浏览器语言 + 记账系统 base_currency 推导地区
 *   - OCR 语言包：按用户语言解析为 Paddle/Tesseract 可用语言
 *   - ASR 语言：按用户语言解析为 Whisper/WebSpeech 可用语言
 *   - 地区插件：墨西哥（CFDI/SPEI/OXXO）仅在用户地区为墨西哥时激活，其余地区保留通用小票解析
 *
 * 设计：单一事实来源（one source of truth），所有引擎/UI 从这里取默认值。
 * 兼容：无依赖、纯函数、可在 Node 测试。
 */
(function (global) {
  const CFG = { version: '1.0.0' };

  /* ================== 地区 → 语言/货币 映射 ================== */

  // 国家/地区 → { lang(BCP-47), ocr(Tesseract lang), asr(Whisper hint), currency, banks[5] }
  // banks：当地知名银行（前5），用于账户下拉/识别词库
  const REGION_PROFILE = {
    MX:  { lang: 'es-MX', ocr: 'spa+eng', asr: 'es', currency: 'MXN', banks: ['BBVA', 'Banorte', 'Santander', 'Banamex', 'HSBC'] },
    US:  { lang: 'en-US', ocr: 'eng',     asr: 'en', currency: 'USD', banks: ['Chase', 'Bank of America', 'Wells Fargo', 'Citi', 'Capital One'] },
    CA:  { lang: 'en-CA', ocr: 'eng+fra', asr: 'en', currency: 'CAD', banks: ['RBC', 'TD', 'Scotiabank', 'BMO', 'CIBC'] },
    GB:  { lang: 'en-GB', ocr: 'eng',     asr: 'en', currency: 'GBP', banks: ['HSBC', 'Barclays', 'Lloyds', 'NatWest', 'Santander UK'] },
    AU:  { lang: 'en-AU', ocr: 'eng',     asr: 'en', currency: 'AUD', banks: ['Commonwealth Bank', 'Westpac', 'ANZ', 'NAB', 'ING'] },
    CN:  { lang: 'zh-CN', ocr: 'chi_sim', asr: 'zh', currency: 'CNY', banks: ['工商银行', '建设银行', '农业银行', '中国银行', '招商银行'] },
    TW:  { lang: 'zh-TW', ocr: 'chi_tra', asr: 'zh', currency: 'TWD', banks: ['台湾银行', '中国信托', '国泰世华', '玉山银行', '台北富邦'] },
    HK:  { lang: 'zh-HK', ocr: 'chi_tra', asr: 'zh', currency: 'HKD', banks: ['HSBC', '中银香港', '渣打银行', '恒生银行', '东亚银行'] },
    JP:  { lang: 'ja-JP', ocr: 'jpn',     asr: 'ja', currency: 'JPY', banks: ['三菱UFJ', '三井住友', '瑞穗银行', 'みずほ', '乐天银行'] },
    KR:  { lang: 'ko-KR', ocr: 'kor',     asr: 'ko', currency: 'KRW', banks: ['KB国民银行', '新韩银行', '友利银行', '韩亚银行', 'IBK企业银行'] },
    DE:  { lang: 'de-DE', ocr: 'deu',     asr: 'de', currency: 'EUR', banks: ['Deutsche Bank', 'Commerzbank', 'DKB', 'N26', 'Sparkasse'] },
    FR:  { lang: 'fr-FR', ocr: 'fra',     asr: 'fr', currency: 'EUR', banks: ['BNP Paribas', 'Crédit Agricole', 'Société Générale', 'LCL', 'Boursorama'] },
    ES:  { lang: 'es-ES', ocr: 'spa',     asr: 'es', currency: 'EUR', banks: ['Santander', 'BBVA', 'CaixaBank', 'Banco Sabadell', 'Bankinter'] },
    IT:  { lang: 'it-IT', ocr: 'ita',     asr: 'it', currency: 'EUR', banks: ['Intesa Sanpaolo', 'UniCredit', 'Banco BPM', 'Monte dei Paschi', 'Fineco'] },
    PT:  { lang: 'pt-PT', ocr: 'por',     asr: 'pt', currency: 'EUR', banks: ['Millennium BCP', 'Caixa Geral', 'Novo Banco', 'Santander Portugal', 'BPI'] },
    BR:  { lang: 'pt-BR', ocr: 'por',     asr: 'pt', currency: 'BRL', banks: ['Itaú', 'Bradesco', 'Santander Brasil', 'Banco do Brasil', 'Caixa'] },
    NL:  { lang: 'nl-NL', ocr: 'nld',     asr: 'nl', currency: 'EUR', banks: ['ING', 'ABN AMRO', 'Rabobank', 'SNS', 'bunq'] },
    PL:  { lang: 'pl-PL', ocr: 'pol',     asr: 'pl', currency: 'PLN', banks: ['PKO BP', 'Pekao', 'Santander Bank Polska', 'mBank', 'ING Bank Śląski'] },
    SE:  { lang: 'sv-SE', ocr: 'swe',     asr: 'sv', currency: 'SEK', banks: ['SEB', 'Handelsbanken', 'Nordea', 'Swedbank', 'ICA Banken'] },
    NO:  { lang: 'nb-NO', ocr: 'nor',     asr: 'no', currency: 'NOK', banks: ['DNB', 'Nordea', 'SpareBank 1', 'Handelsbanken', 'Sbanken'] },
    DK:  { lang: 'da-DK', ocr: 'dan',     asr: 'da', currency: 'DKK', banks: ['Danske Bank', 'Nordea', 'Jyske Bank', 'Sydbank', 'Spar Nord'] },
    FI:  { lang: 'fi-FI', ocr: 'fin',     asr: 'fi', currency: 'EUR', banks: ['Nordea', 'OP', 'Danske Bank', 'Aktia', 'S-Pankki'] },
    RU:  { lang: 'ru-RU', ocr: 'rus',     asr: 'ru', currency: 'RUB', banks: ['Сбербанк', 'ВТБ', 'Газпромбанк', 'Альфа-банк', 'Тинькофф'] },
    TR:  { lang: 'tr-TR', ocr: 'tur',     asr: 'tr', currency: 'TRY', banks: ['Ziraat', 'İş Bankası', 'Garanti BBVA', 'Yapı Kredi', 'Akbank'] },
    AR:  { lang: 'es-AR', ocr: 'spa',     asr: 'es', currency: 'ARS', banks: ['Banco Nación', 'Banco Provincia', 'Galicia', 'BBVA Argentina', 'Santander Río'] },
    CL:  { lang: 'es-CL', ocr: 'spa',     asr: 'es', currency: 'CLP', banks: ['Banco de Chile', 'Banco Estado', 'Santander Chile', 'BCI', 'Banco BICE'] },
    CO:  { lang: 'es-CO', ocr: 'spa',     asr: 'es', currency: 'COP', banks: ['Bancolombia', 'Banco de Bogotá', 'BBVA Colombia', 'Davivienda', 'Banco Popular'] },
    PE:  { lang: 'es-PE', ocr: 'spa',     asr: 'es', currency: 'PEN', banks: ['BCP', 'BBVA Continental', 'Interbank', 'Scotiabank', 'Banco de la Nación'] },
    IN:  { lang: 'en-IN', ocr: 'eng',     asr: 'en', currency: 'INR', banks: ['SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Punjab National Bank'] },
    ID:  { lang: 'id-ID', ocr: 'ind',     asr: 'id', currency: 'IDR', banks: ['BCA', 'Mandiri', 'BRI', 'BNI', 'CIMB Niaga'] },
    TH:  { lang: 'th-TH', ocr: 'tha',     asr: 'th', currency: 'THB', banks: ['Bangkok Bank', 'Krungthai', 'Kasikorn', 'SCB', 'Krungsri'] },
    VN:  { lang: 'vi-VN', ocr: 'vie',     asr: 'vi', currency: 'VND', banks: ['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank'] },
    SG:  { lang: 'en-SG', ocr: 'eng',     asr: 'en', currency: 'SGD', banks: ['DBS', 'OCBC', 'UOB', 'Standard Chartered', 'Citi'] },
    MY:  { lang: 'ms-MY', ocr: 'msa',     asr: 'ms', currency: 'MYR', banks: ['Maybank', 'CIMB', 'Public Bank', 'RHB', 'Hong Leong'] },
    PH:  { lang: 'en-PH', ocr: 'eng',     asr: 'en', currency: 'PHP', banks: ['BDO', 'BPI', 'Metrobank', 'RCBC', 'PNB'] },
  };

  // 国家/地区显示名（中文）与国旗（设置页选择器用）
  const REGION_DISPLAY = {
    MX:  { name: '墨西哥', flag: '🇲🇽' }, US: { name: '美国', flag: '🇺🇸' }, CA: { name: '加拿大', flag: '🇨🇦' },
    GB:  { name: '英国', flag: '🇬🇧' }, AU: { name: '澳大利亚', flag: '🇦🇺' }, CN: { name: '中国', flag: '🇨🇳' },
    TW:  { name: '中国台湾', flag: '🇹🇼' }, HK: { name: '中国香港', flag: '🇭🇰' }, JP: { name: '日本', flag: '🇯🇵' },
    KR:  { name: '韩国', flag: '🇰🇷' }, DE: { name: '德国', flag: '🇩🇪' }, FR: { name: '法国', flag: '🇫🇷' },
    ES:  { name: '西班牙', flag: '🇪🇸' }, IT: { name: '意大利', flag: '🇮🇹' }, PT: { name: '葡萄牙', flag: '🇵🇹' },
    BR:  { name: '巴西', flag: '🇧🇷' }, NL: { name: '荷兰', flag: '🇳🇱' }, PL: { name: '波兰', flag: '🇵🇱' },
    SE:  { name: '瑞典', flag: '🇸🇪' }, NO: { name: '挪威', flag: '🇳🇴' }, DK: { name: '丹麦', flag: '🇩🇰' },
    FI:  { name: '芬兰', flag: '🇫🇮' }, RU: { name: '俄罗斯', flag: '🇷🇺' }, TR: { name: '土耳其', flag: '🇹🇷' },
    AR:  { name: '阿根廷', flag: '🇦🇷' }, CL: { name: '智利', flag: '🇨🇱' }, CO: { name: '哥伦比亚', flag: '🇨🇴' },
    PE:  { name: '秘鲁', flag: '🇵🇪' }, IN: { name: '印度', flag: '🇮🇳' }, ID: { name: '印尼', flag: '🇮🇩' },
    TH:  { name: '泰国', flag: '🇹🇭' }, VN: { name: '越南', flag: '🇻🇳' }, SG: { name: '新加坡', flag: '🇸🇬' },
    MY:  { name: '马来西亚', flag: '🇲🇾' }, PH: { name: '菲律宾', flag: '🇵🇭' },
  };

  // 语言 → Tesseract 语言包（兜底）
  const LANG_TO_OCR = {
    zh: 'chi_sim', 'zh-cn': 'chi_sim', 'zh-tw': 'chi_tra', 'zh-hk': 'chi_tra',
    en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por',
    ja: 'jpn', ko: 'kor', ru: 'rus', ar: 'ara', hi: 'hin', th: 'tha',
    vi: 'vie', id: 'ind', ms: 'msa', nl: 'nld', pl: 'pol', tr: 'tur',
    sv: 'swe', no: 'nor', da: 'dan', fi: 'fin', uk: 'ukr', cs: 'ces',
    el: 'ell', he: 'heb', hu: 'hun', ro: 'ron', bg: 'bul', hr: 'hrv',
    sk: 'slk', sl: 'slv', lt: 'lit', lv: 'lav', et: 'est', sr: 'srp',
  };

  // 语言 → PaddleOCR.js 语言（'ch' | 'en' | 'korean' | 'japan' | 'chinese_cht' | ...）
  const LANG_TO_PADDLE = {
    'zh-cn': 'ch', 'zh': 'ch',
    'zh-tw': 'chinese_cht', 'zh-hk': 'chinese_cht',
    en: 'en', es: 'en', fr: 'en', de: 'en', it: 'en', pt: 'en',
    ja: 'japan', ko: 'korean',
    ru: 'en', ar: 'en', th: 'en', vi: 'en', id: 'en',
  };

  // 语言 → Whisper 语言 hint（ISO 639-1）
  const LANG_TO_ASR = {
    zh: 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hk': 'zh',
    en: 'en', es: 'es', fr: 'fr', de: 'de', it: 'it', pt: 'pt',
    ja: 'ja', ko: 'ko', ru: 'ru', ar: 'ar', hi: 'hi', th: 'th',
    vi: 'vi', id: 'id', ms: 'ms', nl: 'nl', pl: 'pl', tr: 'tr',
    sv: 'sv', no: 'no', da: 'da', fi: 'fi', uk: 'uk', cs: 'cs',
    el: 'el', he: 'he', hu: 'hu', ro: 'ro', bg: 'bg', hr: 'hr',
    sk: 'sk', sl: 'sl', lt: 'lt', lv: 'lv', et: 'et', sr: 'sr',
    bn: 'bn', ta: 'ta', te: 'te', ml: 'ml', kn: 'kn', ur: 'ur',
  };

  /* ================== 探测：当前用户语言 / 地区 ================== */

  // 获取浏览器语言（BCP-47，如 'es-MX' | 'zh-CN' | 'en-US'）
  // 优先显式 opts.browserLang（即使空串，测试/调用方可注入）
  function browserLang(opts) {
    const o = opts || {};
    if (Object.prototype.hasOwnProperty.call(o, 'browserLang')) return String(o.browserLang || '').trim().replace('_', '-');
    try {
      const nav = global.navigator || {};
      const langs = nav.languages && nav.languages.length
        ? nav.languages
        : [nav.language || (nav.userLanguage || '')];
      for (const l of langs) {
        if (l && /^[a-z]{2}([-_][a-zA-Z]{2})?$/i.test(String(l).trim())) return String(l).trim().replace('_', '-');
      }
    } catch (e) { /* ignore */ }
    return 'en-US';
  }

  // 浏览器地区（从语言推导，如 'es-MX' → 'MX'）
  function browserRegion(lang) {
    const l = String(lang || browserLang());
    const m = l.match(/^[a-z]{2}[-_]([a-zA-Z]{2})$/i);
    if (m) return m[1].toUpperCase();
    const langOnly = l.split('-')[0].toLowerCase();
    // 无地区后缀的语言 → 默认映射（如 'es' → MX? 不，保持中性：'es' → 无地区）
    return '';
  }

  // 从记账系统 base_currency 推导地区（若有）
  // ⚠️ 共享货币（EUR/USD/XAF 等）有多国使用 → 优先结合浏览器语言消歧
  function regionFromCurrency(currency, opts) {
    const o = opts || {};
    const c = String(currency || '').toUpperCase();
    const matches = [];
    for (const [region, p] of Object.entries(REGION_PROFILE)) {
      if (p.currency === c) matches.push(region);
    }
    if (matches.length === 1) return matches[0];
    // 多国共享货币（如 EUR：DE/FR/ES/IT/PT/NL/FI）→ 用浏览器语言地区消歧
    if (matches.length > 1) {
      // 显式 opts.browserLang 优先（与 detectRegion 一致），其次全局 navigator
      let bl = Object.prototype.hasOwnProperty.call(o, 'browserLang')
        ? String(o.browserLang || '')
        : (() => {
            try {
              const nav = global.navigator || {};
              return nav.language || (nav.languages && nav.languages[0]) || '';
            } catch (e) { return ''; }
          })();
      const m = String(bl).match(/^[a-z]{2}[-_]([a-zA-Z]{2})$/i);
      const r = m && m[1].toUpperCase();
      if (r && matches.includes(r)) return r;
      // 语言前缀消歧（如浏览器 'fr-FR' 无匹配地区 → 用 'fr' 前缀找）
      const langPref = String(bl).split('-')[0].toLowerCase();
      if (langPref) {
        for (const region of matches) {
          if (REGION_PROFILE[region].lang.toLowerCase().startsWith(langPref)) return region;
        }
      }
      // 仍无法消歧 → 保持中性返回空
      return '';
    }
    return '';
  }

  // 读取记账系统 base_currency（安全，不依赖 app.js）
  // 优先显式 opts.baseCurrency；其次 options.base_currency；再次浏览器语言推导；最后 USD
  function homeCurrency(opts) {
    const o = opts || {};
    if (o.baseCurrency) return String(o.baseCurrency).toUpperCase();
    try {
      if (typeof options !== 'undefined' && options.base_currency) return String(options.base_currency).toUpperCase();
    } catch (e) { /* ignore */ }
    // 显式传了 browserLang（即使为空串）→ 不再读全局 navigator
    const lang = Object.prototype.hasOwnProperty.call(o, 'browserLang')
      ? String(o.browserLang || '')
      : (() => {
          try {
            const nav = global.navigator || {};
            return nav.language || '';
          } catch (e) { return ''; }
        })();
    if (lang) {
      const m = String(lang).match(/^[a-z]{2}[-_]([a-zA-Z]{2})$/i);
      if (m) {
        const r = REGION_PROFILE[m[1].toUpperCase()];
        if (r) return r.currency;
      }
    }
    return 'USD';
  }

  /**
   * 解析用户地区：优先级
   *   1. base_currency 推导（用户记账本币）
   *   2. 浏览器语言地区
   *   3. 空（中性，不激活任何地区插件）
   */
  function detectRegion(opts) {
    const o = opts || {};
    const fromCurrency = regionFromCurrency(o.baseCurrency || homeCurrency(o), o);
    if (fromCurrency) return fromCurrency;
    const br = browserRegion(o.browserLang || browserLang(o));
    return br || '';
  }

  /* ================== 语言解析 ================== */

  /**
   * 解析用户首选语言（BCP-47）。
   * 优先级：显式指定 → base_currency 地区 → 浏览器语言
   */
  function detectLang(opts) {
    const o = opts || {};
    if (o.lang) return String(o.lang);
    const region = detectRegion(o);
    if (region && REGION_PROFILE[region]) return REGION_PROFILE[region].lang;
    return browserLang(o);
  }

  /** 解析 Tesseract/Paddle 语言包：'spa+eng' | 'chi_sim+eng' | ... */
  function resolveOcrLang(opts) {
    const o = opts || {};
    if (o.ocrLang) return String(o.ocrLang);
    const region = detectRegion(o);
    if (region && REGION_PROFILE[region]) return REGION_PROFILE[region].ocr;
    // 无地区 → 按浏览器语言映射，缺省补 eng
    const lang = (o.lang || browserLang(o)).toLowerCase();
    const base = lang.split('-')[0];
    const mapped = LANG_TO_OCR[lang] || LANG_TO_OCR[base];
    if (!mapped) return 'eng';
    return mapped === 'eng' ? 'eng' : mapped + '+eng';
  }

  /** 解析 PaddleOCR.js 语言代码（与 Tesseract 不同） */
  function resolvePaddleLang(opts) {
    const o = opts || {};
    if (o.paddleLang) return String(o.paddleLang);
    const region = detectRegion(o);
    // 墨西哥/西语区用 'ch'（官方 SDK 的 latin 兼容项，官方文档推荐）
    if (region && REGION_PROFILE[region]) {
      const r = REGION_PROFILE[region];
      if (r.lang.startsWith('es')) return 'ch';
      return LANG_TO_PADDLE[r.lang] || 'en';
    }
    const lang = (o.lang || browserLang(o)).toLowerCase();
    return LANG_TO_PADDLE[lang] || LANG_TO_PADDLE[lang.split('-')[0]] || 'en';
  }

  /** 解析 ASR 语言：'zh' | 'en' | 'es' ... */
  function resolveAsrLang(opts) {
    const o = opts || {};
    if (o.asrLang) return String(o.asrLang);
    const region = detectRegion(o);
    if (region && REGION_PROFILE[region]) return REGION_PROFILE[region].asr;
    const lang = (o.lang || browserLang(o)).toLowerCase();
    const base = lang.split('-')[0];
    return LANG_TO_ASR[lang] || LANG_TO_ASR[base] || 'en';
  }

  /** 解析 WebSpeech 语言（BCP-47）：优先保留完整地区码 */
  function resolveWebSpeechLang(opts) {
    const o = opts || {};
    if (o.lang) return String(o.lang);
    return detectLang(o);
  }

  /** 解析 UI 语言：'zh' | 'es' | 'en' | ...（三语系统外追加） */
  function resolveUiLang(opts) {
    const lang = detectLang(opts).toLowerCase();
    return lang.split('-')[0];
  }

  /* ================== 地区插件判断 ================== */

  /** 用户是否墨西哥用户（决定是否激活 MexicoParser 结构化解析） */
  function isMexicoRegion(opts) {
    return detectRegion(opts) === 'MX';
  }

  /** 判断某类型是否属于墨西哥票据（CFDI/SPEI/OXXO） */
  function isMexicoDocType(type) {
    return type === 'CFDI' || type === 'SPEI' || type === 'OXXO';
  }

  /* ================== 当地国家：语言 / 货币 / 银行 应用 ================== */

  /** 国家列表（设置页选择器用）：[{ code, name, flag, lang, currency, banks }] */
  function countryList() {
    return Object.keys(REGION_PROFILE).map((code) => {
      const p = REGION_PROFILE[code];
      const d = REGION_DISPLAY[code] || {};
      return {
        code, name: d.name || code, flag: d.flag || '🌍',
        lang: p.lang, currency: p.currency, banks: p.banks || [],
      };
    });
  }

  /** 应用当地国家：返回 { lang, currency, banks, region }（更新语言/货币/银行） */
  function applyCountry(regionCode, opts) {
    const code = String(regionCode || '').toUpperCase();
    const p = REGION_PROFILE[code];
    if (!p) return null;
    return {
      region: code,
      lang: p.lang,
      currency: p.currency,
      banks: p.banks || [],
      ocr: p.ocr || '',
      asr: p.asr || '',
    };
  }

  /** 国家 → 银行列表（当地知名 5 个） */
  function banksFor(regionCode) {
    const code = String(regionCode || '').toUpperCase();
    const p = REGION_PROFILE[code];
    return (p && p.banks) || [];
  }

  /** 货币 → 国家（供反查：本币 → 默认国家） */
  function regionForCurrency(currency) {
    const c = String(currency || '').toUpperCase();
    for (const [code, p] of Object.entries(REGION_PROFILE)) {
      if (p.currency === c) return code;
    }
    return '';
  }

  Object.assign(CFG, {
    REGION_PROFILE,
    REGION_DISPLAY,
    detectRegion,
    detectLang,
    resolveOcrLang,
    resolvePaddleLang,
    resolveAsrLang,
    resolveWebSpeechLang,
    resolveUiLang,
    isMexicoRegion,
    isMexicoDocType,
    homeCurrency,
    browserLang,
    countryList,
    applyCountry,
    banksFor,
    regionForCurrency,
  });

  global.AIKit = global.AIKit || {};
  global.AIKit.globalConfig = CFG;
})(typeof window !== 'undefined' ? window : globalThis);
