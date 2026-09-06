'use strict';
/**
 * AsrKit · ContextBias V1
 * 领域热词 + 转写后安全纠错。目标是保护金额数量级/银行/记账命令，不凭空猜金额。
 * 真正底层 hotwords 由支持 contextual bias 的 ASR Provider（如 sherpa transducer）消费；
 * Whisper/WebSpeech 则至少共享这里的后处理与词表。
 */
(function (global) {
  const MONEY_ZH = ['十','百','千','万','十万','百万','千万','亿','元','块','毛','角','分'];
  const INTENTS_ZH = ['收入','支出','转账','现金','已付款','未付款','退款','报销','修改','改正','删除','清空','完成','结束'];
  const MONEY_ES = ['peso','pesos','mil','millón','millones','cien','ciento','cientos','efectivo','transferencia','ingreso','gasto','reembolso'];
  const MONEY_EN = ['dollar','dollars','hundred','thousand','million','billion','cash','transfer','income','expense','refund','reimbursement'];
  const DEFAULT_BANKS = ['BBVA','Banorte','Santander','Banamex','HSBC'];

  function unique(arr) { return Array.from(new Set((arr || []).map(x => String(x || '').trim()).filter(Boolean))); }
  function localeBase(lang) { return String(lang || '').toLowerCase().split('-')[0]; }

  function bankWords() {
    const out = DEFAULT_BANKS.slice();
    try {
      const gc = global.AIKit && global.AIKit.globalConfig;
      const region = gc && gc.detectRegion ? gc.detectRegion() : null;
      const p = gc && gc.REGION_PROFILE && region ? gc.REGION_PROFILE[region] : null;
      if (p && Array.isArray(p.banks)) out.push.apply(out, p.banks);
    } catch (e) {}
    return unique(out);
  }

  function modeWords(mode, lang) {
    const base=localeBase(lang), m=String(mode||'ledger');
    if(base==='zh'){
      if(m==='reminder') return ['今天','明天','后天','上午','下午','晚上','提醒','分钟','小时','星期','每周','每月'];
      if(m==='transfer') return ['转账','转入','转出','账户','现金','银行','手续费'];
      return ['收入','支出','进货','退款','报销','转账','现金','已付款','未付款','修改','改正','删除','清空','完成','结束'];
    }
    if(base==='es' && m==='reminder') return ['hoy','mañana','recordar','minuto','hora','semana','mes'];
    if(base==='en' && m==='reminder') return ['today','tomorrow','remind','minute','hour','week','month'];
    return [];
  }

  function hotwords(lang, extra, mode) {
    const base = localeBase(lang);
    let words = [];
    if (base === 'zh') words = MONEY_ZH.concat(INTENTS_ZH);
    else if (base === 'es') words = MONEY_ES;
    else if (base === 'en') words = MONEY_EN;
    return unique(words.concat(modeWords(mode, lang), bankWords(), extra || []));
  }

  function isDigitLike(ch) { return /[0-9零〇一二两三四五六七八九十百千万亿]/.test(ch || ''); }
  function surroundedByNumber(s, i) {
    const left = s[i - 1] || '', right = s[i + 1] || '';
    return isDigitLike(left) || isDigitLike(right);
  }

  /**
   * 只在“数字邻域”纠正常见 ASR 同音错字，避免普通句子被篡改。
   * 不做缺失单位猜测：例如“一三千”不会擅自补成“一万三千”。
   */
  function normalizeMoneyUnits(text, lang) {
    let s = String(text || '');
    if (localeBase(lang) !== 'zh' && !/[万亿千百十]/.test(s)) return s.trim();
    const chars = Array.from(s);
    const map = { '完':'万', '玩':'万', '晚':'万', '腕':'万', '拜':'百', '白':'百', '佰':'百', '仟':'千' };
    for (let i = 0; i < chars.length; i++) {
      if (map[chars[i]] && surroundedByNumber(chars.join(''), i)) chars[i] = map[chars[i]];
    }
    s = chars.join('');
    // ASR 偶尔把“十 万 / 一 万”拆开；仅压缩数字/中文数量词之间的空格，不碰英西语词边界。
    s = s.replace(/([0-9零〇一二两三四五六七八九十百千万亿])\s+(?=[0-9零〇一二两三四五六七八九十百千万亿])/g, '$1');
    return s.trim();
  }

  function normalizeTranscript(text, opts) {
    const o = opts || {};
    let s = String(text || '').trim();
    if (!s) return { text:'', changed:false, reasons:[] };
    const before = s, reasons = [];
    const n = normalizeMoneyUnits(s, o.lang);
    if (n !== s) { s = n; reasons.push('MONEY_UNIT_CONTEXT_FIX'); }
    return { text:s, changed:s !== before, original:before, reasons, hotwords:hotwords(o.lang, o.extraHotwords, o.mode) };
  }

  global.AsrKit = global.AsrKit || {};
  global.AsrKit.contextBias = { hotwords, modeWords, normalizeTranscript, normalizeMoneyUnits, VERSION:2 };
})(typeof window !== 'undefined' ? window : globalThis);
