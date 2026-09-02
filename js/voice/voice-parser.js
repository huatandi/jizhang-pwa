'use strict';
/**
 * VoiceParser V3 —— 语音文本 → 记账字段解析（独立模块，无 DOM 依赖）
 *
 * 从 app.js 的 VoiceParser 抽取并增强：
 *  - 三语数字解析（中/英/西）保留原逻辑
 *  - 金额解析增强：接 ValidateKit 归一化
 *  - 新增 parseDate（语音日期 → ISO）
 *  - 与 VoiceEngine V2 的兼容层：旧 VoiceParser 仍是 app.js 的 const，
 *    本模块提供 VoiceKit 命名空间供新代码 / 未来迁移使用
 */
(function (global) {
  const VK = {};

  /* ================== 数字解析 ================== */
  VK.parseCnNumber = function (s) {
    const cnMap = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    let num = 0, section = 0, cur = 0;
    let hasDigit = false, lastUnit = 0;
    for (const ch of String(s || '')) {
      if (ch >= '0' && ch <= '9') { cur = cur * 10 + (ch - '0'); hasDigit = true; }
      else if (cnMap[ch] !== undefined) { cur = cnMap[ch]; hasDigit = true; }
      else if (ch === '十') {
        if (cur === 0 && num === 0 && section === 0) cur = 1;
        num += cur * 10; cur = 0; lastUnit = 10;
      }
      else if (ch === '百') { num += (cur || 1) * 100; cur = 0; lastUnit = 100; }
      else if (ch === '千') { num += (cur || 1) * 1000; cur = 0; lastUnit = 1000; }
      else if (ch === '万') { section = (num + cur) * 10000; num = 0; cur = 0; lastUnit = 10000; }
    }
    if (cur > 0 && cur < 10 && lastUnit >= 10) cur = cur * lastUnit / 10;
    const total = section + num + cur;
    if (!hasDigit && total === 0) return null;
    return total;
  };

  VK.parseEnNumber = function (text) {
    const t = String(text || '').toLowerCase();
    const ones = { zero: 0, uno: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9 };
    const articleNums = { un: 1, una: 1, uno: 1, one: 1, a: 1 };
    const teens = { diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12, trece: 13, thirteen: 13, catorce: 14, fourteen: 14, quince: 15, fifteen: 15, dieciseis: 16, sixteen: 16, diecisiete: 17, seventeen: 17, dieciocho: 18, eighteen: 18, diecinueve: 19, nineteen: 19 };
    const tens = { veinte: 20, twenty: 20, treinta: 30, thirty: 30, cuarenta: 40, forty: 40, cincuenta: 50, fifty: 50, sesenta: 60, sixty: 60, setenta: 70, seventy: 70, ochenta: 80, eighty: 80, noventa: 90, ninety: 90 };
    const hundreds = { cien: 100, ciento: 100, hundred: 100, doscientos: 200, doscientas: 200, quinientos: 500, quinientas: 500, setecientos: 700, setecientas: 700, novecientos: 900, novecientas: 900, seiscientos: 600, seiscientas: 600, ochocientos: 800, ochocientas: 800, cuatrocientos: 400, cuatrocientas: 400, trescientos: 300, trescientas: 300 };
    const scales = { cien: 100, ciento: 100, hundred: 100, mil: 1000, thousand: 1000, millon: 1000000, million: 1000000 };
    const tensEs = { veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
    const unitWords = new Set(['dollar', 'dollars', 'dólar', 'dólares', 'dolar', 'dolares', 'peso', 'pesos', 'mxn', 'usd', 'yuan', '元', '块', 'y', 'and', 'con']);
    const words = t.split(/[\s\-]+/).filter(w => w);
    let total = 0, cur = 0, sawNumber = false, lastScale = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const next = words[i + 1] || '';
      if (ones[w] !== undefined) { cur += ones[w]; sawNumber = true; }
      else if (articleNums[w] !== undefined) {
        if (scales[next] !== undefined || unitWords.has(next)) { cur += articleNums[w]; sawNumber = true; }
      }
      else if (teens[w] !== undefined) { cur += teens[w]; sawNumber = true; }
      else if (tensEs[w] !== undefined) { cur += tensEs[w]; sawNumber = true; }
      else if (tens[w] !== undefined) { cur += tens[w]; sawNumber = true; }
      else if (hundreds[w] !== undefined && scales[w] === undefined) {
        total += hundreds[w]; sawNumber = true; lastScale = Math.max(lastScale, 100);
      }
      else if (scales[w] !== undefined) {
        const s = scales[w];
        if (s > lastScale) { cur = (cur === 0 ? 1 : cur) * s; total += cur; cur = 0; lastScale = s; }
        else { total += cur * s; cur = 0; }
        sawNumber = true;
      }
      else if (unitWords.has(w)) { /* 单位词忽略 */ }
      else {
        if (cur > 0) { total += cur; cur = 0; lastScale = 0; }
      }
    }
    total += cur;
    return (total > 0 && sawNumber) ? total : null;
  };

  /* ================== 金额解析 ================== */
  const CN_D = { '零':0,'○':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
  const CN_SMALL = { '十':10,'百':100,'千':1000 };
  // 中文整数 → 数字（万/千/百/十/零 + 阿拉伯数字混排；<亿）
  VK._cnInt = function (s) {
    const str = String(s || '').replace(/[，,\s]/g, '');
    if (!str) return null;
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    let total = 0, section = 0, num = 0;
    for (const ch of str) {
      if (ch >= '0' && ch <= '9') num = num * 10 + Number(ch);
      else if (CN_D[ch] !== undefined) num = CN_D[ch];
      else if (CN_SMALL[ch]) { if (num === 0) num = 1; section += num * CN_SMALL[ch]; num = 0; }
      else if (ch === '万') { section = (section + num) * 10000; total += section; section = 0; num = 0; }
      else if (ch === '亿') { total = (total + section + num) * 100000000; section = 0; num = 0; }
      // 零：占位，无值
    }
    total += section + num;
    return total;
  };
  // 中文金额（万 零 块/元 毛/角/分 点 + 数字）→ 数字，如 "10万零78.36"→100078.36、"1万零3百二十六块7毛三"→10326.73
  VK.parseCnMoney = function (text) {
    const t = String(text || '').trim().replace(/[，,\s]/g, '');
    if (!t) return null;
    let s = t.replace(/^(?:人民币|￥|¥|CNY|元|块)?/i, '');
    let sign = 1;
    if (/^[-负]/.test(s)) { sign = -1; s = s.replace(/^[-负]/, ''); }
    // 尾部缩放："3.5万"/"1.2亿" → ×1万/×1亿
    let scale = 1;
    const sm = s.match(/([万亿])$/);
    if (sm) { scale = (sm[1] === '亿') ? 1e8 : 1e4; s = s.slice(0, -1); }
    const dval = (x) => (CN_D[x] != null ? CN_D[x] : (/^\d$/.test(x) ? Number(x) : 0));
    let intStr = s, fracStr = '', splitMode = null;
    let m = String(s).match(/^(.*?)[点.]\s*(.*)$/);
    if (m && m[1]) { intStr = m[1]; fracStr = m[2]; splitMode = 'point'; }
    else { m = String(s).match(/^(.*?)(?:块|元|圆)\s*(.*)$/); if (m) { intStr = m[1] || s; fracStr = m[2]; splitMode = 'yuan'; } }
    intStr = intStr.replace(/^(?:块|元|圆)+/, '').trim();
    let intVal = VK._cnInt(intStr);
    if (intVal == null) return null;
    // 口语化 "三万五" = 35000、"2万5" = 25000（X万 + 单个裸数字 = 该数字×千）
    const colloq = intStr.match(/^(.*万)([零一二两三四五六七八九0-9])$/);
    if (colloq && !intStr.includes('零')) intVal = (VK._cnInt(colloq[1]) || 0) + dval(colloq[2]) * 1000;
    let fracVal = 0;
    if (fracStr) {
      if (splitMode === 'point') {
        fracVal = parseFloat('0.' + fracStr); if (isNaN(fracVal)) fracVal = 0;
      } else {
        const dv = (x) => (CN_D[x] != null ? CN_D[x] : (/^\d$/.test(x) ? Number(x) : 0));
        let jiao = 0, fen = 0, handled = false;
        const mj = fracStr.match(/^([0-9零一二两三四五六七八九]+)\s*(?:毛|角)\s*([0-9零一二两三四五六七八九])?\s*(?:分|厘)?/);
        const mf = fracStr.match(/^([0-9零一二两三四五六七八九]+)\s*(?:分|厘)/);
        if (mj) { jiao = dv(mj[1]); handled = true; if (mj[2]) fen = dv(mj[2]); }
        else if (mf) { fen = dv(mf[1]); handled = true; }               // "三分"=0.03（无毛时的分）
        else if (/^[0-9零一二两三四五六七八九]{1,2}$/.test(fracStr)) {
          if (/^\d{2}$/.test(fracStr)) { fracVal = Number('0.' + fracStr); handled = true; } // "98"=0.98
          else if (fracStr.length === 1) { jiao = dv(fracStr); handled = true; }            // "三"=3毛
          else { jiao = dv(fracStr[0]); fen = dv(fracStr[1]); handled = true; }             // "三八"=3毛8分
        }
        if (handled) { if (!fracVal) fracVal = jiao / 10 + fen / 100; }
        else { fracVal = parseFloat('0.' + fracStr); if (isNaN(fracVal)) fracVal = 0; }
      }
    }
    let total = (intVal + fracVal) * scale;
    return sign < 0 ? -total : (Math.round(total * 100) / 100);
  };
  VK.parseAmount = function (text) {
    const t = String(text || '').trim();
    if (!t) return null;
    // 中文金额（万/零/块/毛/角/分/亿）
    if (/[零一两二三四五六七八九十百千万亿元块钱毛角分点]/.test(t)) {
      const cn = VK.parseCnMoney(t);
      if (cn != null) return cn;
    }
    let m = t.match(/(?:¥|￥|\$|MX\$)?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)?/i);
    if (m) return Number(m[1]);
    const enNum = VK.parseEnNumber(t);
    if (enNum != null) return enNum;
    return null;
  };

  // 金额置信度估算（V2 原则：低置信度不直接写库，先询问）
  // 保守策略：正常"单一金额"高置信；仅当原文存在 ≥2 个不同金额候选（可能把日期/其它数字误当金额）才低置信。
  VK.amountConfidence = function (amount, text) {
    const a = Number(amount);
    if (!(a > 0)) return 0.3;
    let t = String(text || '').trim();
    if (!t) return 0.8;
    // 先剥离日期/时间短语与命令词，避免"8月15号"的15、"3点"的3被当成金额候选
    if (VK.stripDatePhrases) t = VK.stripDatePhrases(t);
    if (VK.stripFieldCommandWords) t = VK.stripFieldCommandWords(t);
    const re = /[0-9零一二两三四五六七八九十百千万亿]{2,}(?:[点.][0-9]{1,2})?(?:块|元|圆|块钱|比索|pesos|dólares|dolares|usd|万|千|百)?/gi;
    const seen = new Set();
    let mm;
    while ((mm = re.exec(t))) {
      const v = VK.parseAmount(mm[0]);
      if (v && v > 0) seen.add(Math.round(v * 100) / 100);
    }
    const n = seen.size;
    if (n === 0) return 0.55;   // 有金额却找不到可信候选（异常）→ 要求确认
    if (n === 1) return 0.95;   // 唯一金额 → 高置信
    return Math.max(0.4, 0.95 - (n - 1) * 0.25); // 多个不同候选 → 拿不准哪个是金额
  };

  /* ================== 日期解析（语音 → ISO YYYY-MM-DD） ================== */
  // 支持：今天 / 明天 / 昨天 / 后天 / 大后天 / 8月15号 / 八月十五 / 下周一 / 本周五 / 12 de agosto
  VK.parseDate = function (text, baseDate) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    const base = baseDate ? new Date(baseDate + 'T00:00:00') : new Date();
    base.setHours(0, 0, 0, 0);
    const dayMs = 86400000;
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

    // 相对词（中/西/英）
    if (/今天|今日|现在|hoy|today|ahora/.test(t)) return iso(base);
    if (/明天|明日|mañana|manana|tomorrow/.test(t)) return iso(new Date(base.getTime() + dayMs));
    if (/后天|pasado mañana|pasado manana|day after tomorrow/.test(t)) return iso(new Date(base.getTime() + 2 * dayMs));
    if (/大后天|day after the day after tomorrow/.test(t)) return iso(new Date(base.getTime() + 3 * dayMs));
    if (/昨天|昨日|ayer|yesterday/.test(t)) return iso(new Date(base.getTime() - dayMs));
    if (/前天|anteayer|day before yesterday/.test(t)) return iso(new Date(base.getTime() - 2 * dayMs));

    // 星期（下周一 / 这周五 / el lunes / next monday）
    const week = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
    let m = t.match(/(下|下个|下个星期|下周|el próximo|el proximo|next)\s*(星期|周|sunday|monday|tuesday|wednesday|thursday|friday|saturday|domingo|lunes|martes|miercoles|jueves|viernes|sabado)/);
    if (m) {
      const day = week[m[2]] !== undefined ? week[m[2]] : (week[m[2].replace(/s$/, '')] !== undefined ? week[m[2].replace(/s$/, '')] : null);
      if (day != null) {
        const cur = base.getDay();
        let diff = (day - cur + 7) % 7; if (diff === 0) diff = 7;
        return iso(new Date(base.getTime() + diff * dayMs));
      }
    }
    m = t.match(/(这|这个|本周|este|esta|this)\s*(星期|周|sunday|monday|tuesday|wednesday|thursday|friday|saturday|domingo|lunes|martes|miercoles|jueves|viernes|sabado)/);
    if (m) {
      const day = week[m[2]] !== undefined ? week[m[2]] : (week[m[2].replace(/s$/, '')] !== undefined ? week[m[2].replace(/s$/, '')] : null);
      if (day != null) {
        const cur = base.getDay();
        const diff = (day - cur + 7) % 7;
        return iso(new Date(base.getTime() + diff * dayMs));
      }
    }

    // 具体日期：8月15号 / 八月十五 / 15号 / 12 de agosto / 15 de septiembre
    const cnMonth = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
    const esMonth = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

    m = t.match(/(\d{1,2})\s*(?:月|号|日|de|del)\s*(\d{1,2})?/);
    if (m) {
      let mo = Number(m[1]);
      let day = m[2] ? Number(m[2]) : null;
      if (mo >= 1 && mo <= 12 && day) {
        return iso(new Date(base.getFullYear(), mo - 1, day));
      }
      // "15号" → 本月该日
      if (day == null && mo >= 1 && mo <= 31 && /号|日/.test(t)) {
        return iso(new Date(base.getFullYear(), base.getMonth(), mo));
      }
    }
    m = t.match(/([零一二三四五六七八九十]+)\s*月\s*([零一二三四五六七八九十]+)?\s*[号日]?/);
    if (m && cnMonth[m[1]]) {
      const mo = cnMonth[m[1]];
      const day = m[2] ? VK.parseCnNumber(m[2]) : null;
      if (day) return iso(new Date(base.getFullYear(), mo - 1, day));
    }
    m = t.match(/(\d{1,2})\s*de\s*([a-z]+)/);
    if (m && esMonth[m[2]]) {
      return iso(new Date(base.getFullYear(), esMonth[m[2]] - 1, Number(m[1])));
    }
    // 西语字母数字日期：el quince de agosto / el veinticinco de diciembre
    const esCardinal = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, dieciséis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintidós: 22, veintitres: 23, veintitrés: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintiséis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, 'treinta y uno': 31, 'treinta y una': 31 };
    m = t.match(/(el\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintidós|veintitres|veintitrés|veinticuatro|veinticinco|veintiseis|veintiséis|veintisiete|veintiocho|veintinueve|treinta(?:\s+y\s+uno|una)?)\s+de\s*([a-z]+)/);
    if (m && esMonth[m[3]]) {
      const day = esCardinal[m[2].trim()];
      if (day) return iso(new Date(base.getFullYear(), esMonth[m[3]] - 1, day));
    }
    return null;
  };

  /* ================== 日期剥离（解析金额前必须先剥离日期短语，防日期数字污染金额） ================== */
  // 中/英/西 日期短语 → 空格。返回 { text, date }：剥离后的文本 + 解析出的 ISO 日期
  const CN_REL = /大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g;
  const CN_MONTH_DAY_RE = /(?:\d{1,2}|[零一二两三四五六七八九十]{1,2})\s*月\s*(?:\d{1,2}|[零一二两三四五六七八九十]{1,2})?\s*[日号]?/g;
  const CN_DAY_RE = /(?:\d{1,2}|[零一二两三四五六七八九十]{1,2})\s*[号日](?![元角分块])/g;
  const CN_WEEK_RE = /(?:下个?|这|本|上个?)?\s*(?:周|星期|礼拜)[一二三四五六日天]/g;
  // 时间短语（防"十点/三点半"被误当金额）
  const CN_TIME_RE = /(?:[零一二两三四五六七八九十\d]{1,2})\s*(?:点|時|时)\s*(?:半|[零一二三四五六七八九十\d]{1,2}\s*(?:分|分钟)?)?/g;
  const EN_TIME_RE = /\d{1,2}\s*(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm|o'?clock|hours?|h)\b/gi;
  const ES_TIME_RE = /(?:a las|a la|las|la)\s+\d{1,2}\s*(?::\d{2})?\s*(?:de la (?:mañana|noche|tarde))?/gi;
  const ES_MONTH_RE = /enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre/;
  const EN_MONTH_RE = /january|february|march|april|may|june|july|august|september|october|november|december/;

  VK.stripDatePhrases = function (t) {
    let s = String(t || '');
    s = s.replace(CN_REL, ' ');
    s = s.replace(CN_MONTH_DAY_RE, ' ');
    s = s.replace(CN_DAY_RE, ' ');
    s = s.replace(CN_WEEK_RE, ' ');
    s = s.replace(CN_TIME_RE, ' ');
    s = s.replace(EN_TIME_RE, ' ');
    s = s.replace(ES_TIME_RE, ' ');
    // 西语：el quince de agosto / el 15 de agosto / 15 de agosto / el 25 de diciembre
    s = s.replace(new RegExp(`(?:el\\s+)?(?:\\d{1,2}|[a-záéíóúñ]+(?:\\s+y\\s+uno)?)\\s+de\\s+(?:${ES_MONTH_RE.source})`, 'gi'), ' ');
    // 西语：los días / el lunes / martes ...（星期）
    s = s.replace(/(?:el|los|los días|este|esta)?\s*(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/gi, ' ');
    // 英文：on the 15th / next monday / january 5th（限定：有序数后缀，或有英文限定词，避免误剥金额数字）
    s = s.replace(/(?:on\s+)?(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b/gi, ' ');
    s = s.replace(/(?:on|the|next|last|this|by|before|after)\s+\d{1,2}\b/gi, ' ');
    s = s.replace(new RegExp(`(?:${EN_MONTH_RE.source})\\s*\\d{1,2}(?:st|nd|rd|th)?`, 'gi'), ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  };

  /* ================== 语音指令解析（与旧版保持兼容） ================== */
  VK.parseCommand = function (text) {
    const t = String(text || '').trim();
    if (!t) return { cmd: null, text: t };
    const low = t.toLowerCase();
    const saveRe = /(?:^(保存|记好|记好了|好了|完成|确认记账|guardar|save|ok|done|listo|confirm)|(?:帮我|请|麻烦|麻烦你|可以)?(?:保存|记好|记好了|guardar|save|done|listo|确认保存|保存一下|确认记账|全部保存)(?:吧|啦|了|好|完成)?$|保存完成)/i;
    if (saveRe.test(low)) {
      const text2 = t.replace(/(?:帮我|请|麻烦|麻烦你|可以)?\s*(?:保存一下|记好了|确认保存|全部保存|保存|记好|guardar|save|done|listo|确认记账)\s*(?:吧|啦|了|好|完成|一下)?/ig, ' ').replace(/\s+/g, ' ').trim();
      return { cmd: 'save', text: text2 };
    }
    if (/^(清空|清除|删除|删掉|移除|去除|擦掉|擦除|清空一下|全部清空|清空全部|重新来|重新|重来|撤销|取消|清理|borrar|limpiar|borra|undo|clear|reset|start over)/.test(low)) return { cmd: 'clear', text: t.replace(/^(清空|清除|删除|删掉|移除|去除|擦掉|擦除|清空一下|全部清空|清空全部|重新来|重新|重来|撤销|取消|清理|borrar|limpiar|borra|undo|clear|reset|start over)\s*/, '') };
    if (/^(选择收入|选收入|要收入|转收入|收入记账|记收入|收入|收钱|入账|income|ingreso|ingresos|earnings|deposit)/.test(low)) {
      return { cmd: 'income', text: t.replace(/^(选择收入|选收入|要收入|转收入|收入记账|记收入|收入|收钱|入账|income|ingreso|ingresos|earnings|deposit)\s*/, '') };
    }
    if (/^(选择支出|选支出|要支出|转支出|支出记账|记支出|支出|花钱|花销|消费|花了|买了|expense|gasto|gastos|compra|paid|bought|spent)/.test(low)) {
      return { cmd: 'expense', text: t.replace(/^(选择支出|选支出|要支出|转支出|支出记账|记支出|支出|花钱|花销|消费|花了|买了|expense|gasto|gastos|compra|paid|bought|spent)\s*/, '') };
    }
    if (/^(日期|改日期|date|set date)/i.test(t)) {
      return { cmd: 'date', text: t.replace(/^(日期|改日期|date|set date)\s*/i, '') };
    }
    if (/^(账户|改账户|account|set account)/i.test(t)) {
      return { cmd: 'account', text: t.replace(/^(账户|改账户|account|set account)\s*/i, '') };
    }
    return { cmd: null, text: t };
  };

  /* ================== 字段操作命令（清空/删除/去掉/更改/改为 + 项目） ================== */
  // 需求：语音里的 "清空/删除/去掉/更改/改为 + 某个项目(日期/金额/支出分类/账户/备注/事项/提醒时间/地点/提醒方式/提醒节点/重复提醒/关联服务)"
  // 以及 "同时清空/删除/去除/更改/改为 …" 都是【命令】，不是内容：
  //   1) 命令命中时被整体消费，绝不写入任何内容字段（事项/备注/商户等）；
  //   2) 内容解析兜底时也会剥离命令词与字段标签，保证"事项"只收真实内容。
  const FIELD_CMD_OPS = [
    // 清空/删除类（长词优先，避免"清"吞掉"清空"；"撤销/取消刚才/undo"留给改口引擎）
    { op: 'clear', re: /(?:清空|清除|删掉|删除|删去|去掉|去除|移除|抹掉|擦掉|擦除|清掉|vaciar|borrar|eliminar|quitar|clear|delete|remove|erase)/ig },
    // 更改/改为类
    { op: 'set', re: /(?:更改为|更改|改为|改成|设为|设定为|设置为|更新为|换成|调整为|修改为|变更|改到|改至|set|change|update|establecer|poner|cambiar)/ig },
    // "改 + 字段"（改日期/改时间/改金额…）
    { op: 'set', re: /改(?=[^，。；、\s]{0,3}(?:日期|时间|金额|数额|账户|账号|分类|类别|事项|内容|地点|位置|备注|提醒|重复|关联))/ig }
  ];
  const FIELD_LABEL_ENTRIES = [
    { field: 'amount', re: /(?:金额|数额|多少钱|amount|monto|importe)/ig },
    { field: 'category', re: /(?:费用分类|支出分类|收入分类|分类|类别|类目|category|categoría|categoria|tipo)/ig },
    { field: 'account', re: /(?:账户|账号|银行|卡号|account|cuenta)/ig },
    { field: 'remark', re: /(?:备注|附注|说明|remark|note|nota)/ig },
    { field: 'merchant', re: /(?:商户|商家|merchant|comercio)/ig },
    { field: 'content', re: /(?:事项|事情|做什么|content|asunto)/ig },
    { field: 'content', re: /(?:内容|文字|数据|信息|东西|值)/ig, generic: true },
    { field: 'time', re: /(?:提醒时间|时间|几点|time|hora)/ig },
    { field: 'location', re: /(?:地点|位置|地方|location|lugar|ubicación|ubicacion)/ig },
    { field: 'method', re: /(?:提醒方式|方式|method|método|metodo)/ig },
    { field: 'advance', re: /(?:提醒节点|提前|提早|advance|anticipación|anticipacion)/ig },
    { field: 'repeat', re: /(?:重复提醒|重复|repeat|repetir|frecuencia)/ig },
    { field: 'link', re: /(?:关联服务|关联账务|关联|link|vincular|asociar)/ig },
    { field: 'date', re: /(?:日期|date|fecha)/ig }
  ];
  function _reHits(re, text) {
    const hits = [];
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(text))) {
      hits.push({ index: m.index, word: m[0] });
      if (m[0].length === 0) r.lastIndex++;
    }
    return hits;
  }
  // set 命令的新值：去引导词/连接词/残留字段标签与命令词
  VK._extractFieldValue = function (raw) {
    let v = String(raw || '').trim();
    v = v.replace(/^(?:为|成|到|至|是|设为|改成|改为|设定为|设置为|更新为|换成|调整为|修改为|改到|改至)\s*[:：]?\s*/i, '');
    v = v.replace(/^(?:同时|还有|然后|接着|以及|和|与|跟|及|、|，|,|。|；|;)\s*/, '');
    for (const { re } of FIELD_LABEL_ENTRIES) {
      v = v.replace(new RegExp('^(?:' + re.source + ')\\s*[:：]?\\s*', 'i'), '');
    }
    v = v.replace(/^(?:清空|清除|删掉|删除|删去|去掉|去除|移除|更改|改为|改成|变更|撤销|重说|重新说|重新来|重来)\s*/i, '');
    return v.replace(/[，。；、,;！!？?\s]+$/g, '').trim();
  };
  // 解析"操作词 + 字段"命令。命中条件：至少一个操作词 + 至少一个字段标签（防裸"清空"误判、防"改为500"被改口引擎抢走）。
  // 返回 { matched, commands:[{op:'clear',fields:[...]}|{op:'set',field,value}], rest }
  VK.parseFieldCommands = function (text) {
    const t = String(text || '').trim();
    const out = { matched: false, commands: [], rest: t };
    if (!t) return out;
    const opHits = [];
    for (const { op, re } of FIELD_CMD_OPS) {
      for (const h of _reHits(re, t)) opHits.push({ op, index: h.index, word: h.word });
    }
    if (!opHits.length) return out;
    const fieldHits = [];
    for (const { field, re, generic } of FIELD_LABEL_ENTRIES) {
      for (const h of _reHits(re, t)) fieldHits.push({ field, index: h.index, word: h.word, generic: !!generic });
    }
    // 泛化标签（内容/文字/数据/信息）让位给具体字段："清空账户里的内容" → 只清账户
    if (fieldHits.some((h) => !h.generic) && fieldHits.some((h) => h.generic)) {
      const keep = fieldHits.filter((h) => !h.generic);
      fieldHits.length = 0; fieldHits.push(...keep);
    }
    if (!fieldHits.length) return out; // 无字段 → 交给全清/改口/内容解析
    out.matched = true;
    // 每个字段归属最近的（前/后）操作词
    const byOp = new Map();
    for (const f of fieldHits) {
      let best = null, bestDist = Infinity;
      for (const o of opHits) {
        const d = Math.abs(f.index - o.index);
        if (d < bestDist) { bestDist = d; best = o; }
      }
      if (best) {
        if (!byOp.has(best)) byOp.set(best, []);
        byOp.get(best).push(f);
      }
    }
    for (const [o, fs] of [...byOp.entries()]) {
      const fields = fs.sort((a, b) => a.index - b.index).map((x) => x.field);
      if (o.op === 'clear') out.commands.push({ op: 'clear', fields });
      else {
        const f = fs[fs.length - 1]; // set 取最后一个字段标签，其后为新值
        out.commands.push({ op: 'set', field: f.field, value: VK._extractFieldValue(t.slice(f.index + f.word.length)) });
      }
    }
    // rest：剥掉已消费的操作词与字段标签（供调试/校验）
    const consumed = [...opHits, ...fieldHits].sort((a, b) => b.index - a.index);
    let rest = t;
    for (const c of consumed) rest = rest.slice(0, c.index) + ' ' + rest.slice(c.index + c.word.length);
    out.rest = rest.replace(/\s+/g, ' ').trim();
    return out;
  };
  // 纯命令句（只有"清空/删除/去掉/清除/重新说"等，未指明字段）→ 由调用方清空整个表单
  VK.isBareClearUtterance = function (text) {
    const t = String(text || '').trim();
    if (!t) return false;
    const t2 = t
      .replace(/^(?:请|帮我|麻烦|麻烦你|你|给我)\s*/i, ' ')
      .replace(/(?:清空|清除|删掉|删除|删去|去掉|去除|移除|抹掉|擦掉|擦除|清掉|清一下|全部清空|清空全部|全部删除|删除全部|重新说|重说|重新来|重来|重录|重新录|重录一遍|vaciar|borrar|eliminar|quitar|clear|delete|remove|erase|reset|borra|limpiar)/gi, ' ')
      .replace(/(?:表单|全部|所有|一切|内容|文字|数据|信息|东西|这次的|刚才的)/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return t2.length === 0;
  };
  // 供内容解析兜底：剥离残留的命令词（不含单字"清"，防"清晨"误伤）
  VK.stripFieldCommandWords = function (text) {
    return String(text || '')
      .replace(/(?:清空|清除|删掉|删除|删去|去掉|去除|移除|抹掉|擦掉|擦除|清掉|清一下|vaciar|borrar|eliminar|quitar|clear|delete|remove|erase|更改|改为|改成|更改为|变更|设为|设定为|设置为|更新为|换成|调整为|修改为|改到|改至|撤销|重说|重新说|重新来|重来|undo|reset)\s*/gi, ' ')
      .replace(/\s+/g, ' ').trim();
  };

  /* ================== 时间解析（提醒用，与 ReminderParser 兼容） ================== */
  VK.parseTime = function (text) {
    const t = String(text || '').toLowerCase();
    let period = null;
    if (/早上|上午|早晨|晨间|凌晨|temprano|mañana|en la mañana|am\b|a\.?m/i.test(t)) period = 'am';
    else if (/晚上|晚间|下午|noche|tarde|pm\b|p\.?m|de la noche|de la tarde/i.test(t)) period = 'pm';
    else if (/中午|午间|mediodía|mediodia|noon\b/i.test(t)) period = 'pm';

    let m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(?:a\.?m\.?|am|p\.?m\.?|pm|de la noche|de la tarde)\b/i);
    let hh = null, mm = 0;
    if (m) {
      hh = Number(m[1]); mm = m[2] ? Number(m[2]) : 0;
      const suffix = m[3] || '';
      if (/p/i.test(suffix) && hh < 12) hh += 12;
      if (/a/i.test(suffix) && hh === 12) hh = 0;
    }
    if (hh == null) {
      m = t.match(/(?:a las|a la)\s+(\d{1,2})(?::(\d{2}))?/);
      if (m) { hh = Number(m[1]); mm = m[2] ? Number(m[2]) : 0; }
    }
    if (hh == null) {
      m = t.match(/(\d{1,2})\s*[点时:：]\s*(\d{1,2})\s*(?:分|分钟)?/);
      if (m) { hh = Number(m[1]); mm = Number(m[2]); }
    }
    if (hh == null) {
      const cn = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
      m = t.match(/([零一二两三四五六七八九十]+)\s*点(?:\s*(半|[零一二三四五六七八九]+)\s*分?)?/);
      if (m) {
        hh = cn[m[1]] !== undefined ? cn[m[1]] : null;
        if (m[2] === '半') mm = 30;
        else if (m[2] && cn[m[2]] !== undefined) mm = cn[m[2]];
      }
    }
    if (hh == null) { m = t.match(/(\d{1,2})\s*点/); if (m) hh = Number(m[1]); }
    if (hh == null) return null;
    if (period === 'pm' && hh < 12) hh += 12;
    if (period === 'am' && hh === 12) hh = 0;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  /* ================== 选项注入（options 在 app.js 是顶层 let，不挂 window） ================== */
  let _optionsGetter = null;
  VK.setOptionsGetter = function (fn) { _optionsGetter = fn; };
  function _getOptions() {
    if (_optionsGetter) { try { return _optionsGetter() || {}; } catch (e) {} }
    return global.options || {};
  }

  /* ================== 分类关键词匹配（与旧版兼容） ================== */
  const CATEGORY_RULES = {
    '餐饮': ['餐', '饭', '吃', '奶茶', '咖啡', '外卖', '买菜', '饭店', '早点', '夜宵', '食堂', '火锅', '牛奶', '面包', '早餐', '午餐', '晚餐', '菜', '肉', '蛋', '水果', '蔬菜', '零食', 'pizza', 'comida', 'restaurante', 'restaurant', 'lunch', 'dinner', 'breakfast', 'food', 'eat', 'grocery', 'groceries', 'taco', 'burger', 'cafe', 'break', 'almuerzo', 'cena', 'desayuno', 'tacos', 'mercado', 'despensa', 'carne', 'frutas', 'verduras', 'pan', 'leche', 'tortilla', 'super', 'comprar comida', 'fruta', 'verdura', 'sopa', 'bebida', 'alimento', 'alimentos'],
    '购物': ['买', '购', '淘宝', '京东', '拼多多', '超市', '商场', '衣服', '鞋', '包', 'shopping', 'compra', 'shop', 'clothes', 'supermarket', 'walmart', 'buy', 'store', 'tienda', 'ropa', 'zapatos', 'compras', 'compré', 'compra de', 'mercadotecnia', 'costo', 'supermercado'],
    '交通': ['车', '油', '加油', '地铁', '公交', '出租', '滴滴', '打车', '停车', '高铁', '机票', 'taxi', 'uber', 'gasolina', 'transporte', 'gas', 'gasoline', 'metro', 'bus', 'train', 'car', 'parking', 'uber', 'didi', 'transport', 'fuel'],
    '住房': ['房租', '房贷', '物业', '水电', '水费', '电费', '气费', '燃气', 'renta', 'rent', 'house', 'home', 'mortgage', 'property', 'alquiler', 'apartment'],
    '通讯': ['话费', '手机', '流量', '宽带', '网费', '电话', 'teléfono', 'telefono', 'phone', 'internet', 'mobile', 'cell', 'data', 'wifi', 'bill'],
    '医疗': ['药', '医院', '看病', '诊所', '挂号', '体检', '牙', 'farmacia', 'médico', 'medico', 'medico', 'hospital', 'doctor', 'clinic', 'medicine', 'medical', 'pharmacy', 'dentist'],
    '教育': ['书', '学费', '课', '培训', '文具', '幼儿园', '学校', 'escuela', 'school', 'class', 'course', 'tuition', 'book', 'university', 'college', 'education', 'estudio'],
    '娱乐': ['电影', 'ktv', '游戏', '演唱会', '旅游', '门票', 'cine', 'juego', 'movie', 'game', 'concert', 'travel', 'ticket', 'fun', 'entertainment', 'pelicula'],
    '人情往来': ['红包', '礼金', '请客', '送礼', '份子', 'regalo', 'gift', 'present', 'give'],
    '工资': ['工资', '薪水', '薪资', '发钱', 'salario', 'sueldo', 'nómina', 'nomina', 'salary', 'wage', 'pay', 'income', 'payroll'],
    '奖金': ['奖金', '分红', 'bonus', 'bonus', 'dividend'],
    '投资': ['利息', '理财', '基金', '股票', 'inversión', 'inversion', 'investment', 'interest', 'stock', 'fund', 'finanzas'],
    '退款': ['退款', '退货', 'reembolso', 'refund', 'return', 'reembolso'],
    '礼金': ['礼金', '红包', '份子'],
    '店租': ['店租', '门面', '铺租', '店面', '摊位', 'local', 'tienda', 'renta de local', 'store rent', 'shop rent', 'premises'],
    '材料': ['材料', '进货', '采购', '原料', '批发', '货物', '库存', '货', 'material', 'mercancia', 'mercancía', 'inventario', 'compra mercancia', 'supplies', 'materials', 'inventory', 'stock', 'wholesale', 'purchase'],
    '设备': ['设备', '机器', '器械', '冰箱', '空调', '收银', 'equipo', 'maquina', 'máquina', 'equipment', 'machine', 'appliance', 'computer'],
    '装修': ['装修', '装潢', '翻新', 'renovacion', 'renovación', 'renovation', 'remodel'],
    '商厦管理费': ['商厦', '管理费', '维护', '保养', 'mantenimiento', 'administración', 'maintenance', 'mall fee', 'administration'],
    '财会': ['财会', '会计', '记账', '账本', 'contador', 'contabilidad', 'accounting', 'accountant'],
    '律师': ['律师', '法律', '法务', 'abogado', 'legal', 'lawyer', 'attorney'],
    '杂费': ['杂费', '杂项', '零花', '其他支出', 'otro', 'otros', 'misc', 'other', 'miscellaneous', 'varios']
  };
  const CATEGORY_ALIAS = {
    '餐饮': ['餐饮', '伙食', '食品', '饮食'],
    '购物': ['购物', '日用', '杂费', '百货'],
    '交通': ['交通', '车费', '出行'],
    '住房': ['住房', '房租', '物业', '房贷'],
    '通讯': ['通讯', '话费', '通信'],
    '医疗': ['医疗', '医药', '健康'],
    '教育': ['教育', '学习', '学费'],
    '娱乐': ['娱乐', '休闲'],
    '人情往来': ['人情往来', '人情', '社交'],
    '工资': ['工资', '薪水', '薪资'],
    '奖金': ['奖金', '分红'],
    '投资': ['投资', '理财'],
    '退款': ['退款', '退货'],
    '店租': ['店租', '门面', '铺租', '店面'],
    '材料': ['材料', '原料', '货物', '进货'],
    '设备': ['设备', '机器'],
    '装修': ['装修', '装潢'],
    '商厦管理费': ['商厦管理费', '管理费'],
    '财会': ['财会', '会计'],
    '律师': ['律师', '法律'],
    '杂费': ['杂费', '杂项']
  };
  const STRONG_RULES = {
    '设备': ['设备', '机器', '器械', '冰箱', '空调', '收银', 'equipo', 'maquina', 'máquina', 'equipment', 'machine', 'appliance', 'computer'],
    '电费': ['电费', '交电', '电费单', 'electricidad', 'luz', 'electricity', 'electric'],
    '水费': ['水费', '交水', 'agua', 'water'],
    '气费': ['气费', '煤气', '燃气费', 'gas'],
    '材料': ['材料', '进货', '采购', '原料', '批发', '货物', '库存', 'material', 'mercancia', 'mercancía', 'inventario', 'supplies', 'materials', 'inventory', 'stock', 'wholesale'],
    '店租': ['店租', '门面', '铺租', '店面', '摊位', 'renta de local', 'renta local', 'store rent', 'shop rent'],
    '装修': ['装修', '装潢', '翻新', 'renovacion', 'renovación', 'renovation', 'remodel'],
    '商厦管理费': ['商厦', '管理费', '维护', 'mantenimiento', 'maintenance', 'administration'],
    '财会': ['财会', '会计', '记账', 'contador', 'contabilidad', 'accounting', 'accountant'],
    '律师': ['律师', '法律', '法务', 'abogado', 'lawyer', 'attorney'],
    '网费': ['网费', '宽带费', '网络费', 'internet'],
    '话费': ['话费', '手机费', '流量费', 'telefono', 'teléfono', 'phone bill'],
    '房租': ['房租', '房贷', 'renta', 'rent', 'mortgage'],
    '工资': ['工资', '薪水', '薪资', 'salario', 'sueldo', 'nómina', 'nomina', 'salary', 'wage', 'payroll'],
    '医疗': ['医院', '看病', '诊所', '挂号', '体检', '药费', '买药', 'farmacia', 'médico', 'medico', 'hospital', 'doctor', 'clinic', 'pharmacy', 'dentist'],
    '教育': ['学费', '幼儿园', '学校', '补课', '培训班', 'escuela', 'school', 'tuition']
  };

  function _wordHit(low, w) {
    return /[a-záéíóúñü]/i.test(w)
      ? new RegExp(`(^|[^a-záéíóúñü])${w}([^a-záéíóúñü]|$)`, 'i').test(low) ? 1 : 0
      : low.includes(w) ? 1 : 0;
  }

  VK.matchCategory = function (text, kind) {
    const opts = _getOptions();
    const cats = (kind === 'expense' ? opts.expense_categories : opts.departments) || [];
    const low = String(text || '').toLowerCase();
    // 0) 显式提到某分类名 / 别名 → 最高优先，避免被规则猜测或"其他"这类泛指兜底覆盖
    for (const c of cats) {
      const nm = String(c).trim();
      if (/^[一二两三四五六七八九十]{1,2}$/.test(nm)) continue; // 序号分类（一/二…）跳过
      if (low.includes(nm.toLowerCase())) return c;
    }
    // 第一轮：强关键词（设备/电费/材料/进货/店租等专有名词优先）
    for (const [rule, words] of Object.entries(STRONG_RULES)) {
      const hit = words.some(w => _wordHit(low, w));
      if (hit) {
        const names = CATEGORY_ALIAS[rule] || [rule];
        const exact = cats.find(c => names.includes(c));
        if (exact) return exact;
        const loose = cats.find(c => names.some(n => c.includes(n) || n.includes(c)));
        if (loose) return loose;
        break;
      }
    }
    // 第二轮：通用规则关键词匹配
    let ruleHit = null, ruleScore = 0;
    for (const [rule, words] of Object.entries(CATEGORY_RULES)) {
      const score = words.reduce((acc, w) => acc + _wordHit(low, w), 0);
      if (score > ruleScore) { ruleScore = score; ruleHit = rule; }
    }
    if (ruleHit) {
      const names = CATEGORY_ALIAS[ruleHit] || [ruleHit];
      const exact = cats.find(c => names.includes(c));
      if (exact) return exact;
      const loose = cats.find(c => names.some(n => c.includes(n) || n.includes(c)));
      if (loose) return loose;
    }
    // 序号分类指代（收入分类常为"一 二 三 四 五"）
    const cnOrd = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    const hasOrdCat = cats.some(c => /^[一二两三四五六七八九十]{1,2}$/.test(String(c)));
    if (hasOrdCat) {
      const m = low.match(/(?:第|分类|项目|序号|选|项)?\s*([一二两三四五六七八九十\d]{1,2})\s*(?:项|个|号|分类|项目)?(?=$|\s|[，。,])/);
      const m2 = low.match(/(?:收入|收|记)\s*([一二两三四五六七八九十\d])\s*$/);
      const toNum = (s) => cnOrd[s.replace('两', '二')] !== undefined ? cnOrd[s.replace('两', '二')] : (Number(s) > 0 ? Number(s) : null);
      const n = m ? toNum(m[1]) : (m2 ? toNum(m2[1]) : null);
      if (n != null && n >= 1 && n <= cats.length) return cats[n - 1];
    }
    const direct = cats.find(c => {
      if (/^[一二两三四五六七八九十]{1,2}$/.test(String(c))) return false;
      return low.includes(String(c).toLowerCase());
    });
    return direct || null;
  };

  /* ================== 账户解析 ================== */
  VK.parseAccount = function (text, accounts) {
    const t = String(text || '');
    const low = t.toLowerCase();
    const tokens = (low.match(/[a-záéíóúñü0-9]{2,}/g) || []).join(' ');
    for (const acc of accounts || []) {
      const name = String(acc || '').trim();
      if (!name || name === '未填' || name === '未填写') continue;
      if (low.includes(name.toLowerCase())) return name;
      const nameWords = name.toLowerCase().match(/[a-záéíóúñü0-9]{3,}/g);
      if (nameWords) {
        for (const w of nameWords) {
          if (tokens.includes(w)) return name;
        }
      }
    }
    return null;
  };

  /* ================== 主解析入口 ================== */
  const AMOUNT_RE = /(?:¥|￥|\$|MX\$)?\s*[0-9零一二两三四五六七八九十百千万亿][0-9,，零一二两三四五六七八九十百千万亿点.]*(?:\s*(?:块钱|元|圆|块))?(?:\s*(?:[0-9零一二两三四五六七八九]{1,2})?\s*(?:毛|角)\s*(?:[0-9一二两三四五六七八九])?\s*(?:分|厘)?)?/gi;

  VK.cleanRemark = function (remark, date) {
    let r = String(remark || '');
    r = r.replace(AMOUNT_RE, ' ');
    if (date) {
      r = r
        .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
        .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
        .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
        .replace(/[一二三四五六七八九十]+月[一二三四五六七八九十]+[日号]?/g, ' ');
    }
    r = r.replace(/^(收入|收|入账|支出|花|消费|买了|花了|income|ingreso|ingresos|earnings|expense|gasto|gastos|compra|paid)\s*/i, '');
    r = r.replace(/(支付|付款|付了|完成|帮我|请|麻烦|微信支付|转账|转帐|到账)/g, ' ');
    // 命令词与字段标签不进备注（"清空金额"这类命令由字段命令引擎整体消费，这里是兜底）
    r = VK.stripFieldCommandWords(r);
    r = r.replace(/^(?:同时\s*)?(?:日期|金额|数额|支出分类|收入分类|分类|类别|账户|账号|备注|附注|事项|内容|提醒时间|时间|地点|位置|提醒方式|方式|提醒节点|提前|提早|重复提醒|重复|关联服务|关联|商户|商家)\s*[:：]?\s*/i, ' ');
    r = r.replace(/(^|[\s,，、])\d{1,2}(?=$|[\s,，、。])/g, ' ');
    return r.replace(/\s+/g, ' ').trim();
  };

  VK.parse = function (text, kind) {
    const t = String(text || '').trim();
    if (!t) return { text: t, remark: t, cmd: null };
    const cmdR = VK.parseCommand(t);
    const body = cmdR.cmd && cmdR.cmd !== 'save' && cmdR.cmd !== 'clear' ? cmdR.text : t;
    const effectiveKind = cmdR.cmd === 'income' ? 'income' : cmdR.cmd === 'expense' ? 'expense' : kind;
    const out = { text: t, remark: body, cmd: cmdR.cmd, kind: effectiveKind };
    // 先剥离日期短语，再解析日期/金额（防日期数字污染金额：如"八月十五号"的 15）
    const stripped = VK.stripDatePhrases(body);
    out.date = VK.parseDate(body);
    out.account = VK.parseAccount(body, _getOptions().accounts);
    out.amount = VK.parseAmount(stripped);
    let remainder = stripped.replace(AMOUNT_RE, ' ').trim();
    remainder = remainder.replace(/\s+/g, ' ');
    if (out.date) {
      remainder = remainder
        .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
        .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
        .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
        .replace(/[一二三四五六七八九十]+月[一二三四五六七八九十]+[日号]?/g, ' ')
        .trim();
    }
    if (out.account) remainder = remainder.split(out.account).join(' ').replace(/\s+/g, ' ').trim();
    out.category = VK.matchCategory(remainder || stripped, effectiveKind);
    if (out.amount != null || out.category) out.remark = remainder || body;
    else out.remark = '';
    return out;
  };

  /* ================== 多条目切分（快记多条） ================== */
  VK.splitEntries = function (text, kind) {
    const t = String(text || '').trim();
    if (!t) return { entries: [], save: false };
    let body = t;
    let save = false;
    const saveRe = /(?:帮我|请|麻烦|麻烦你)?\s*(?:保存|记好|记好了|guardar|save|done|listo)\s*(?:吧|啦|了|好)?\s*$/i;
    const saveM = body.match(saveRe);
    if (saveM) { save = true; body = body.replace(saveRe, '').trim(); }
    const date = VK.parseDate(body);
    body = body
      .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
      .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
      .replace(/[一二三四五六七八九十]{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
      .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
      .replace(/[一二三四五六七八九十]+月[一二三四五六七八九十]+[日号]?/g, ' ')
      .replace(/\s+/g, ' ').trim();
    let parts = body.split(/[，,。;；\n]+|然后|接着|还有|另外|以及|再|随后|之后|最后|还有/).map(s => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      const matches = [...body.matchAll(AMOUNT_RE)];
      if (matches.length >= 2) {
        const newParts = [];
        for (let i = 0; i < matches.length; i++) {
          const start = matches[i].index;
          const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
          const seg = body.slice(start, end).trim();
          if (i === 0) {
            const prefix = body.slice(0, start).trim();
            newParts.push((prefix ? prefix + ' ' : '') + seg);
          } else {
            newParts.push(seg);
          }
        }
        parts = newParts;
      }
    }
    if (parts.length <= 1) return { entries: [], save };
    const entries = [];
    for (let part of parts) {
      if (!part) continue;
      const segKind = /^(收入|收|入账|income|ingreso|ingresos|earnings)/i.test(part) ? 'income'
        : /^(支出|花|消费|买了|花了|expense|gasto|gastos|compra|paid)/i.test(part) ? 'expense' : kind;
      const amount = VK.parseAmount(part);
      const account = VK.parseAccount(part, _getOptions().accounts);
      const category = VK.matchCategory(part, segKind);
      if (amount != null) {
        let rem0 = part;
        if (account) rem0 = rem0.split(account).join(' ').replace(/\s+/g, ' ').trim();
        entries.push({ date, kind: segKind, amount, category, account, remark: rem0 });
      } else if (entries.length) {
        const last = entries[entries.length - 1];
        if (account && !last.account) last.account = account;
        if (category && !last.category) last.category = category;
        let rem = part;
        if (account) rem = rem.split(account).join(' ').replace(/\s+/g, ' ').trim();
        if (rem && !last.remark.includes(rem)) last.remark += ' ' + rem;
      }
    }
    for (const e of entries) e.remark = VK.cleanRemark(e.remark, e.date);
    return { entries, save };
  };

  // 兼容：解析后统一走 ValidateKit 归一化金额（若已加载）
  VK.normalizeMoney = function (raw) {
    if (global.ValidateKit && global.ValidateKit.parseMoney) return global.ValidateKit.parseMoney(raw);
    return VK.parseAmount(String(raw));
  };

  global.VoiceKit = global.VoiceKit || {};
  Object.assign(global.VoiceKit, VK);
})(typeof window !== 'undefined' ? window : globalThis);
