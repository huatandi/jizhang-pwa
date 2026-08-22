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

  // 国家/地区 → { lang(BCP-47), ocr(Tesseract lang), asr(Whisper hint), currency }
  const REGION_PROFILE = {
    MX:  { lang: 'es-MX', ocr: 'spa+eng', asr: 'es', currency: 'MXN' },   // 墨西哥
    US:  { lang: 'en-US', ocr: 'eng',     asr: 'en', currency: 'USD' },
    CA:  { lang: 'en-CA', ocr: 'eng+fra', asr: 'en', currency: 'CAD' },
    GB:  { lang: 'en-GB', ocr: 'eng',     asr: 'en', currency: 'GBP' },
    AU:  { lang: 'en-AU', ocr: 'eng',     asr: 'en', currency: 'AUD' },
    CN:  { lang: 'zh-CN', ocr: 'chi_sim', asr: 'zh', currency: 'CNY' },
    TW:  { lang: 'zh-TW', ocr: 'chi_tra', asr: 'zh', currency: 'TWD' },
    HK:  { lang: 'zh-HK', ocr: 'chi_tra', asr: 'zh', currency: 'HKD' },
    JP:  { lang: 'ja-JP', ocr: 'jpn',     asr: 'ja', currency: 'JPY' },
    KR:  { lang: 'ko-KR', ocr: 'kor',     asr: 'ko', currency: 'KRW' },
    DE:  { lang: 'de-DE', ocr: 'deu',     asr: 'de', currency: 'EUR' },
    FR:  { lang: 'fr-FR', ocr: 'fra',     asr: 'fr', currency: 'EUR' },
    ES:  { lang: 'es-ES', ocr: 'spa',     asr: 'es', currency: 'EUR' },
    IT:  { lang: 'it-IT', ocr: 'ita',     asr: 'it', currency: 'EUR' },
    PT:  { lang: 'pt-PT', ocr: 'por',     asr: 'pt', currency: 'EUR' },
    BR:  { lang: 'pt-BR', ocr: 'por',     asr: 'pt', currency: 'BRL' },
    NL:  { lang: 'nl-NL', ocr: 'nld',     asr: 'nl', currency: 'EUR' },
    PL:  { lang: 'pl-PL', ocr: 'pol',     asr: 'pl', currency: 'PLN' },
    SE:  { lang: 'sv-SE', ocr: 'swe',     asr: 'sv', currency: 'SEK' },
    NO:  { lang: 'nb-NO', ocr: 'nor',     asr: 'no', currency: 'NOK' },
    DK:  { lang: 'da-DK', ocr: 'dan',     asr: 'da', currency: 'DKK' },
    FI:  { lang: 'fi-FI', ocr: 'fin',     asr: 'fi', currency: 'EUR' },
    RU:  { lang: 'ru-RU', ocr: 'rus',     asr: 'ru', currency: 'RUB' },
    TR:  { lang: 'tr-TR', ocr: 'tur',     asr: 'tr', currency: 'TRY' },
    AR:  { lang: 'es-AR', ocr: 'spa',     asr: 'es', currency: 'ARS' },
    CL:  { lang: 'es-CL', ocr: 'spa',     asr: 'es', currency: 'CLP' },
    CO:  { lang: 'es-CO', ocr: 'spa',     asr: 'es', currency: 'COP' },
    PE:  { lang: 'es-PE', ocr: 'spa',     asr: 'es', currency: 'PEN' },
    IN:  { lang: 'en-IN', ocr: 'eng',     asr: 'en', currency: 'INR' },
    ID:  { lang: 'id-ID', ocr: 'ind',     asr: 'id', currency: 'IDR' },
    TH:  { lang: 'th-TH', ocr: 'tha',     asr: 'th', currency: 'THB' },
    VN:  { lang: 'vi-VN', ocr: 'vie',     asr: 'vi', currency: 'VND' },
    SG:  { lang: 'en-SG', ocr: 'eng',     asr: 'en', currency: 'SGD' },
    MY:  { lang: 'ms-MY', ocr: 'msa',     asr: 'ms', currency: 'MYR' },
    PH:  { lang: 'en-PH', ocr: 'eng',     asr: 'en', currency: 'PHP' },
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

  Object.assign(CFG, {
    REGION_PROFILE,
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
  });

  global.AIKit = global.AIKit || {};
  global.AIKit.globalConfig = CFG;
})(typeof window !== 'undefined' ? window : globalThis);
