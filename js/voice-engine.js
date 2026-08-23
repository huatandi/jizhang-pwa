'use strict';
/**
 * VoiceEngine —— 统一智能语音解析引擎（V2 重构）
 *
 * 设计核心：字段消耗式提取管线（Field-Consuming Pipeline）
 *   每个字段解析器返回 { value, consumed, weight }：
 *     - value   解析出的字段值
 *     - consumed 该字段从原文中"吃掉"的文本片段（用于从剩余文本中剔除）
 *     - weight  命中强度（用于多候选消歧）
 *   主管线按"明确标签 > 强语义 > 兜底"的优先级依次提取：
 *     金额 → 收支类型 → 日期 → 时间 → 分类 → 账户 → 地点 → 备注
 *   所有字段提取完毕后，剩余文本自动归入"什么事情/备注"。
 *
 * 覆盖语言：中文 / English / Español
 * 覆盖场景：快速记账（金额/分类/日期/账户/收支/备注）+ 语音提醒（时间/日期/地点/事项/提前量）
 */
(function (global) {
  'use strict';

  // 选项（分类/账户列表，由 app.js 通过 setOptions 注入）
  let __opts = null;

  // ================================================================
  // 一、多语言数字
  // ================================================================

  const CN_MAP = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

  // 中文大写/数字混合 → 数值（支持 一万五 / 三千五 / 一百二 / 12万 / 1万5）
  function parseCnNumber(s) {
    const str = String(s || '').trim();
    if (!str) return null;
    // 纯阿拉伯
    if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
    let num = 0, section = 0, cur = 0;
    let hasDigit = false, lastUnit = 0;
    for (const ch of str) {
      if (ch >= '0' && ch <= '9') { cur = cur * 10 + (ch - '0'); hasDigit = true; }
      else if (CN_MAP[ch] !== undefined) { cur = CN_MAP[ch]; hasDigit = true; }
      else if (ch === '十') {
        if (cur === 0 && num === 0 && section === 0) cur = 1;
        num += cur * 10; cur = 0; lastUnit = 10;
      }
      else if (ch === '百') { num += (cur || 1) * 100; cur = 0; lastUnit = 100; }
      else if (ch === '千') { num += (cur || 1) * 1000; cur = 0; lastUnit = 1000; }
      else if (ch === '万') { section = (num + cur) * 10000; num = 0; cur = 0; lastUnit = 10000; }
      else if (ch === '亿') { section = (num + cur) * 100000000; num = 0; cur = 0; lastUnit = 100000000; }
    }
    if (cur > 0 && cur < 10 && lastUnit >= 10) cur = cur * lastUnit / 10; // 三千五=3500
    const total = section + num + cur;
    return (hasDigit || total > 0) ? total : null;
  }

  // 英文/西语数字单词 → 数值
  function parseEnNumber(text) {
    const t = String(text || '').toLowerCase();
    const ones = { zero: 0, uno: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9 };
    const articleNums = { un: 1, una: 1, uno: 1, one: 1, a: 1 };
    const teens = { diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12, trece: 13, thirteen: 13, catorce: 14, fourteen: 14, quince: 15, fifteen: 15, dieciseis: 16, sixteen: 16, diecisiete: 17, seventeen: 17, dieciocho: 18, eighteen: 18, diecinueve: 19, nineteen: 19 };
    const tens = { veinte: 20, twenty: 20, treinta: 30, thirty: 30, cuarenta: 40, forty: 40, cincuenta: 50, fifty: 50, sesenta: 60, sixty: 60, setenta: 70, seventy: 70, ochenta: 80, eighty: 80, noventa: 90, ninety: 90 };
    const hundreds = { cien: 100, ciento: 100, hundred: 100, doscientos: 200, doscientas: 200, quinientos: 500, quinientas: 500, setecientos: 700, setecientas: 700, novecientos: 900, novecientas: 900, seiscientos: 600, seiscientas: 600, ochocientos: 800, ochocientas: 800, cuatrocientos: 400, cuatrocientas: 400, trescientos: 300, trescientas: 300 };
    const scales = { cien: 100, ciento: 100, hundred: 100, mil: 1000, thousand: 1000, millon: 1000000, million: 1000000, 'mil millones': 1000000000, billion: 1000000000 };
    const tensEs = { veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
    const unitWords = new Set(['dollar', 'dollars', 'dólar', 'dólares', 'dolar', 'dolares', 'peso', 'pesos', 'mxn', 'usd', 'yuan', '元', '块', 'y', 'and', 'con', 'cents', 'centavos']);
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
      else if (unitWords.has(w)) { /* 单位忽略 */ }
      else {
        if (cur > 0) { total += cur; cur = 0; lastScale = 0; }
      }
    }
    total += cur;
    return (total > 0 && sawNumber) ? total : null;
  }

  // ================================================================
  // 二、金额解析（多语言 + 口语小数 + 单位）
  // ================================================================

  // 金额正则（用于识别文本中的金额片段）
  const AMOUNT_PATTERNS = [
    // 1) 带符号/单位的阿拉伯数字：$50 / ¥100 / 50块 / 50元 / 50 pesos / $50.50
    { re: /(?:¥|￥|\$|MX\$)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd|mxn)?/i, weight: 3 },
    // 2) 口语小数：一块五 / 两块三 / 三块五毛
    { re: /([0-9零一两二三四五六七八九十]+)\s*块\s*([0-9零一二三四五六七八九]+)\s*(?:毛|角)?/, weight: 4 },
    // 3) 中文大写 + 单位：一百二十块 / 三千五 / 一万五
    { re: /([零一两二三四五六七八九十百千万亿0-9]+)\s*(?:块|元|圆|块钱)?/, weight: 2 },
    // 4) 英文/西语数字单词 + 币种：one hundred pesos / quince dólares / forty five
    { re: /([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+)*)\s*(?:pesos?|dólares?|dolares?|usd|mxn|dollars?)?/i, weight: 2, word: true },
  ];

  // 从文本中提取金额：返回 { value, consumed, weight } 或 null
  function extractAmount(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    // 带单位优先（weight 更高且更可靠）
    // a) 阿拉伯数字+单位 / $数字
    let m = t.match(/(?:¥|￥|\$|MX\$)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd|mxn)/i);
    if (m) {
      const val = Number(m[1].replace(/,/g, ''));
      if (val > 0) return { value: val, consumed: m[0], weight: 4 };
    }
    // b) 口语小数：一块五 / 两块三
    m = t.match(/([0-9零一两二三四五六七八九十]+)\s*块\s*([0-9零一二三四五六七八九]+)\s*(?:毛|角)?/);
    if (m) {
      const w = parseCnNumber(m[1]);
      const f = parseCnNumber(m[2]);
      if (w > 0 && f != null) return { value: w + f / 10, consumed: m[0], weight: 5 };
    }
    // c) 中文大写 + 单位（至少2位才认为金额，避免"五十"在"五十斤米"误判）
    m = t.match(/([零一两二三四五六七八九十百千万亿]{2,})\s*(?:块|元|圆|块钱)/);
    if (m) {
      const n = parseCnNumber(m[1]);
      if (n > 0) return { value: n, consumed: m[0], weight: 3 };
    }
    // c2) 混合数字+万/千/百：1万5 / 2万3 / 3千5 / 1.5万
    m = t.match(/(\d+(?:\.\d+)?)\s*([万亿千百])\s*(\d{1,4})?\s*(?:块|元|圆|块钱)?/);
    if (m) {
      const head = Number(m[1]);
      const unit = m[2];
      const tail = m[3] ? Number(m[3]) : 0;
      const UNIT = { '万': 10000, '亿': 100000000, '千': 1000, '百': 100 };
      const u = UNIT[unit] || 1;
      // 1万5 → 10000 + 5*1000；2万3 → 20000 + 3*1000；3千5 → 3000 + 5*100；1.5万 → 15000
      let val;
      if (/\./.test(String(head))) val = head * u; // 1.5万
      else val = head * u + tail * (u / 10);
      if (val > 0) return { value: val, consumed: m[0], weight: 3 };
    }
    // c3) 纯中文大写（无单位，≥3位 或 含 千/万/百/十）：工资五千 / 收了一千二 / 花了三百
    m = t.match(/([零一两二三四五六七八九十百千万亿]{3,})/);
    if (m) {
      const n = parseCnNumber(m[1]);
      if (n > 0 && n >= 100) return { value: n, consumed: m[0], weight: 2 };
    }
    m = t.match(/([一二两三四五六七八九十][千百十])/);
    if (m) {
      const n = parseCnNumber(m[1]);
      if (n > 0 && n >= 10) return { value: n, consumed: m[0], weight: 2 };
    }
    // d) 纯 $ 数字（$50 无单位）
    m = t.match(/(?:¥|￥|\$|MX\$)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+\.\d{1,2})/);
    if (m) {
      const val = Number(m[1].replace(/,/g, ''));
      if (val > 0) return { value: val, consumed: m[0], weight: 4 };
    }
    // e) 3位以上阿拉伯数字（无单位）：仅当 >=100 或带小数，避免"50斤米"的50、日期"8月15"的15
    m = t.match(/(?<![\d.])(\d{3,}(?:\.\d{1,2})?|\d+\.\d{1,2})(?![\d.])/);
    if (m) {
      const val = Number(m[1]);
      if (val >= 100 || /\.\d/.test(m[1])) return { value: val, consumed: m[0], weight: 1 };
    }
    // f) 英文/西语数字单词（仅匹配以数字单词开头、后跟币种或独立数字表达的段）
    //    防止 "bought groceries for fifty dollars" 整段被吞
    const wordNumRe = /(?:^|[\s，,、])((?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|quinientos|quinientas|mil|millon|un|una)(?:\s+(?:y|and)?\s*(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|quinientos|quinientas|mil|millon|un|una)*)?)\s*(?:pesos?|dólares?|dolares?|dollars?|usd|mxn)?/i;
    m = t.match(wordNumRe);
    if (m && m[1]) {
      const n = parseEnNumber(m[1]);
      if (n != null && n > 0) {
        const after = t.slice(m.index + m[0].length);
        const followedByCurrency = /(pesos?|dólares?|dolares?|dollars?|usd|mxn)/i.test(m[0]);
        // 仅接受：后跟币种词，或数字本身 >= 10（避免 una despensa 误判）
        if (followedByCurrency || n >= 10) {
          return { value: n, consumed: m[0], weight: 2 };
        }
      }
    }
    return null;
  }

  // 兼容旧接口
  function parseAmount(text) {
    const r = extractAmount(text);
    return r ? r.value : null;
  }

  // ================================================================
  // 三、日期解析（多语言 + 相对日期）
  // ================================================================

  function parseDate(text, nowDate) {
    const t = String(text || '');
    const now = nowDate || new Date();
    const y = now.getFullYear();
    // 相对日期（中文）
    const rel = { '大前天': -3, '前天': -2, '昨天': -1, '昨日': -1, '今天': 0, '今日': 0, '明天': 1, '明日': 1, '后天': 2, '大后天': 3 };
    for (const k of Object.keys(rel).sort((a, b) => b.length - a.length)) {
      if (t.includes(k)) {
        const d = new Date(y, now.getMonth(), now.getDate() + rel[k]);
        return fmtDate(d);
      }
    }
    // 完整日期：2026年8月13日 / 2026-08-13 / 2026/8/13
    let m = t.match(/(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*[日号]?/);
    if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
    // 阿拉伯数字：8月13日 / 8月13号
    m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
    if (m) return `${y}-${p2(m[1])}-${p2(m[2])}`;
    // 中文月 + 阿拉伯日：八月15号
    m = t.match(/([一二三四五六七八九十]{1,2}|[0-9]{1,2})\s*月\s*([0-9]{1,2})\s*[日号]/);
    if (m) {
      let mv = Number(m[1]);
      if (isNaN(mv)) mv = cnMonth(m[1]) || now.getMonth() + 1;
      if (mv >= 1 && mv <= 12) return `${y}-${p2(mv)}-${p2(Number(m[2]))}`;
    }
    // 中文大写：八月十三号
    const cnM = [['十二', 12], ['十一', 11], ['十', 10], ['九', 9], ['八', 8], ['七', 7], ['六', 6], ['五', 5], ['四', 4], ['三', 3], ['二', 2], ['一', 1]];
    for (const [mk, mv] of cnM) {
      if (t.includes(`${mk}月`)) {
        let day = now.getDate();
        const cnD = [['三十一', 31], ['三十', 30], ['二十九', 29], ['二十八', 28], ['二十七', 27], ['二十六', 26], ['二十五', 25], ['二十四', 24], ['二十三', 23], ['二十二', 22], ['二十一', 21], ['二十', 20], ['十九', 19], ['十八', 18], ['十七', 17], ['十六', 16], ['十五', 15], ['十四', 14], ['十三', 13], ['十二', 12], ['十一', 11], ['十', 10], ['九', 9], ['八', 8], ['七', 7], ['六', 6], ['五', 5], ['四', 4], ['三', 3], ['二', 2], ['一', 1]];
        for (const [dk, dv] of cnD) {
          if (t.includes(`${dk}日`) || t.includes(`${dk}号`)) { day = dv; break; }
        }
        return `${y}-${p2(mv)}-${p2(day)}`;
      }
    }
    // 西语：13/08/2026、13 ago 2026、13 de agosto 2026
    m = t.match(/(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/);
    if (m) {
      const dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${yy}-${p2(mm)}-${p2(dd)}`;
    }
    const esM = { enero: 1, feb: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, ago: 8, agos: 8, sep: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
    m = t.match(/(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)\s*(?:de\s+)?(20\d{2})/i);
    if (m) return `${m[3]}-${p2(esM[m[2].toLowerCase()] || 1)}-${p2(Number(m[1]))}`;
    // 英文：Aug 13 2026 / 13 Aug 2026 / August 13, 2026
    const enM = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
    m = t.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?,?\s*(20\d{2})/i);
    if (m) return `${m[3]}-${p2(enM[m[2].toLowerCase()] || 1)}-${p2(Number(m[1]))}`;
    m = t.match(/(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?,?\s*(\d{1,2})\s*,?\s*(20\d{2})/i);
    if (m) return `${m[3]}-${p2(enM[m[1].toLowerCase()] || 1)}-${p2(Number(m[2]))}`;
    m = t.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i);
    if (m) {
      const mm = enM[m[1].toLowerCase()] || 1, dd = Number(m[2]);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${y}-${p2(mm)}-${p2(dd)}`;
    }
    m = t.match(/(20\d{2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})/);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
    m = t.match(/(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2})/);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
      const yy2 = Number(m[3]) < 50 ? 2000 + Number(m[3]) : 1900 + Number(m[3]);
      return `${yy2}-${p2(m[2])}-${p2(m[1])}`;
    }
    // 西语相对日期
    const esRel = { ayer: -1, hoy: 0, mañana: 1, manana: 1, pasado: -2, anteayer: -2 };
    for (const k of Object.keys(esRel)) {
      if (t.toLowerCase().includes(k)) return fmtDate(new Date(y, now.getMonth(), now.getDate() + esRel[k]));
    }
    // 英文相对日期
    const enRel = { 'the day after tomorrow': 2, 'day after tomorrow': 2, 'day before yesterday': -2, yesterday: -1, today: 0, tomorrow: 1, 'the day before yesterday': -2 };
    for (const k of Object.keys(enRel).sort((a, b) => b.length - a.length)) {
      if (t.toLowerCase().includes(k)) return fmtDate(new Date(y, now.getMonth(), now.getDate() + enRel[k]));
    }
    return null;
  }

  function p2(n) { return String(Number(n)).padStart(2, '0'); }
  function fmtDate(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
  function cnMonth(s) {
    const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
    return map[s] !== undefined ? map[s] : null;
  }

  // ================================================================
  // 四、时间解析（提醒用）：早上9点 / 下午三点 / 12点半 / 9am / a las 9
  //    增强：相对时间（半小时后 / 一小时后 / 10分钟后 / in half an hour）
  // ================================================================

  function parseTime(text, nowDate) {
    const t = String(text || '').toLowerCase();
    const now = nowDate || new Date();
    // 相对时间：X分钟后 / 半小时后 / 一小时后 / 两小时后
    const rel = t.match(/(?:半个|半小时|半)\s*(?:小时|钟头)?\s*(?:后|以后|之后)/);
    const relNum = t.match(/(?:(\d+|[零一二两三四五六七八九十]+))\s*(?:个)?\s*(分钟|小时|钟头|天|日)\s*(?:后|以后|之后)/);
    const relEn = t.match(/(?:in|after)\s+(\d+)\s*(?:minutes|mins|min|hours|hour|hrs|hr|days|day)/i);
    const relEs = t.match(/(?:en|dentro de|después de)\s+(\d+)\s*(minutos|minuto|horas|hora|días|dias|día|dia)/i);
    if (rel) {
      const d = new Date(now); d.setMinutes(d.getMinutes() + 30);
      return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    }
    if (relNum) {
      const n = /^\d+$/.test(relNum[1]) ? Number(relNum[1]) : parseCnNumber(relNum[1]);
      const unit = relNum[2];
      const d = new Date(now);
      if (unit.includes('天') || unit.includes('日')) d.setDate(d.getDate() + n);
      else if (unit.includes('小时') || unit.includes('钟头')) d.setHours(d.getHours() + n);
      else d.setMinutes(d.getMinutes() + n);
      return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    }
    if (relEn) {
      const n = Number(relEn[1]);
      const d = new Date(now);
      if (/^d/.test(relEn[2])) d.setDate(d.getDate() + n);
      else if (/^h/.test(relEn[2])) d.setHours(d.getHours() + n);
      else d.setMinutes(d.getMinutes() + n);
      return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    }
    if (relEs) {
      const n = Number(relEs[1]);
      const d = new Date(now);
      if (/^d/.test(relEs[2])) d.setDate(d.getDate() + n);
      else if (/^h/.test(relEs[2])) d.setHours(d.getHours() + n);
      else d.setMinutes(d.getMinutes() + n);
      return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    }
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
      // 先匹配"X点半"（12点半 / 三点半）→ 分钟=30
      let m30 = t.match(/(\d{1,2}|[零一二两三四五六七八九十]+)\s*点\s*半/);
      if (m30) {
        const v = m30[1];
        const cnT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
        hh = /^\d+$/.test(v) ? Number(v) : (cnT[v] !== undefined ? cnT[v] : null);
        if (hh == null) { const p30 = v.indexOf('十'); hh = (p30 >= 0 ? 10 : 0) + (p30 >= 0 ? (cnT[v.slice(p30 + 1)] || 0) : 0); if (hh === 0 && v.includes('十')) hh = 10; }
        mm = 30;
      }
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
    return `${p2(hh)}:${p2(mm)}`;
  }

  // ================================================================
  // 五、分类解析（支出/收入分类，强规则 + 通用规则 + 序号指代）
  // ================================================================

  // 分类关键词库（规则名 → 关键词），与旧版兼容并扩充
  const CATEGORY_RULES = {
    '餐饮': ['餐', '饭', '吃', '奶茶', '咖啡', '外卖', '买菜', '饭店', '早点', '夜宵', '食堂', '火锅', 'pizza', 'comida', 'restaurante', 'restaurant', 'lunch', 'dinner', 'breakfast', 'food', 'eat', 'taco', 'burger', 'cafe', 'almuerzo', 'cena', 'desayuno', 'tacos', 'mercado', 'despensa', 'carne', 'frutas', 'verduras', 'pan', 'leche', 'tortilla', 'super', 'fruta', 'verdura', 'sopa', 'bebida', 'comprar comida', 'agua'],
    '购物': ['买', '购', '淘宝', '京东', '拼多多', '超市', '商场', '衣服', '鞋', '包', 'shopping', 'compra', 'shop', 'clothes', 'supermarket', 'walmart', 'buy', 'store', 'tienda', 'ropa', 'zapatos', 'compras', 'compré', 'supermercado'],
    '交通': ['车', '油', '加油', '地铁', '公交', '出租', '滴滴', '打车', '停车', '高铁', '机票', 'taxi', 'uber', 'gasolina', 'transporte', 'gas', 'gasoline', 'metro', 'bus', 'train', 'car', 'parking', 'didi', 'transport', 'fuel', 'bici', 'bike'],
    '住房': ['房租', '房贷', '物业', '水电', '水费', '电费', '气费', '燃气', 'renta', 'rent', 'house', 'home', 'mortgage', 'property', 'alquiler', 'apartment', 'luz', 'agua'],
    '通讯': ['话费', '手机', '流量', '宽带', '网费', '电话', 'teléfono', 'telefono', 'phone', 'internet', 'mobile', 'cell', 'data', 'wifi', 'bill'],
    '医疗': ['药', '医院', '看病', '诊所', '挂号', '体检', '牙', 'farmacia', 'médico', 'medico', 'hospital', 'doctor', 'clinic', 'medicine', 'medical', 'pharmacy', 'dentist'],
    '教育': ['书', '学费', '课', '培训', '文具', '幼儿园', '学校', 'escuela', 'school', 'class', 'course', 'tuition', 'book', 'university', 'college', 'education', 'estudio'],
    '娱乐': ['电影', 'ktv', '游戏', '演唱会', '旅游', '门票', 'cine', 'juego', 'movie', 'game', 'concert', 'travel', 'ticket', 'fun', 'entertainment', 'pelicula'],
    '人情往来': ['红包', '礼金', '请客', '送礼', '份子', 'regalo', 'gift', 'present', 'give'],
    '工资': ['工资', '薪水', '薪资', '发钱', 'salario', 'sueldo', 'nómina', 'nomina', 'salary', 'wage', 'pay', 'income', 'payroll'],
    '奖金': ['奖金', '分红', 'bonus', 'dividend'],
    '投资': ['利息', '理财', '基金', '股票', 'inversión', 'inversion', 'investment', 'interest', 'stock', 'fund', 'finanzas'],
    '退款': ['退款', '退货', 'reembolso', 'refund', 'return'],
    '店租': ['店租', '门面', '铺租', '店面', '摊位', 'local', 'tienda', 'renta de local', 'store rent', 'shop rent', 'premises'],
    '材料': ['材料', '进货', '采购', '原料', '批发', '货物', '库存', '货', 'material', 'mercancia', 'mercancía', 'inventario', 'supplies', 'materials', 'inventory', 'stock', 'wholesale', 'purchase'],
    '设备': ['设备', '机器', '器械', '冰箱', '空调', '收银', 'equipo', 'maquina', 'máquina', 'equipment', 'machine', 'appliance', 'computer'],
    '装修': ['装修', '装潢', '翻新', 'renovacion', 'renovación', 'renovation', 'remodel'],
    '商厦管理费': ['商厦', '管理费', '维护', '保养', 'mantenimiento', 'administración', 'maintenance', 'mall fee', 'administration'],
    '财会': ['财会', '会计', '记账', '账本', 'contador', 'contabilidad', 'accounting', 'accountant'],
    '律师': ['律师', '法律', '法务', 'abogado', 'legal', 'lawyer', 'attorney'],
    '杂费': ['杂费', '杂项', '零花', '其他支出', 'otro', 'otros', 'misc', 'other', 'miscellaneous', 'varios'],
  };
  // 规则名 → 当前分类别名映射
  const CATEGORY_ALIAS = {
    '餐饮': ['餐饮', '伙食', '食品', '饮食'], '购物': ['购物', '日用', '杂费', '百货'],
    '交通': ['交通', '车费', '出行'], '住房': ['住房', '房租', '物业', '房贷'],
    '通讯': ['通讯', '话费', '通信'], '医疗': ['医疗', '医药', '健康'],
    '教育': ['教育', '学习', '学费'], '娱乐': ['娱乐', '休闲'],
    '人情往来': ['人情往来', '人情', '社交'], '工资': ['工资', '薪水', '薪资'],
    '奖金': ['奖金', '分红'], '投资': ['投资', '理财'], '退款': ['退款', '退货'],
    '店租': ['店租', '门面', '铺租', '店面'], '材料': ['材料', '原料', '货物', '进货'],
    '设备': ['设备', '机器'], '装修': ['装修', '装潢'],
    '商厦管理费': ['商厦管理费', '管理费'], '财会': ['财会', '会计'],
    '律师': ['律师', '法律'], '杂费': ['杂费', '杂项'],
  };
  // 强关键词（专有名词优先，避免被"买"等宽泛词抢走）
  const STRONG_RULES = {
    '设备': ['设备', '机器', '器械', '冰箱', '空调', '收银', 'equipo', 'maquina', 'máquina', 'equipment', 'machine', 'appliance', 'computer'],
    '电费': ['电费', '交电', '电费单', 'electricidad', 'luz', 'electricity', 'electric'],
    '水费': ['水费', '交水', 'agua', 'water'],
    '气费': ['气费', '煤气', '燃气费', 'gas'],
    '材料': ['材料', '进货', '采购', '原料', '批发', '货物', '库存', 'material', 'mercancia', 'mercancía', 'inventario', 'supplies', 'materials', 'inventory', 'stock', 'wholesale'],
    '店租': ['店租', '门面', '铺租', '店面', '摊位', 'renta de local', 'store rent', 'shop rent'],
    '装修': ['装修', '装潢', '翻新', 'renovacion', 'renovación', 'renovation', 'remodel'],
    '商厦管理费': ['商厦', '管理费', '维护', 'mantenimiento', 'maintenance', 'administration'],
    '财会': ['财会', '会计', '记账', 'contador', 'contabilidad', 'accounting', 'accountant'],
    '律师': ['律师', '法律', '法务', 'abogado', 'lawyer', 'attorney'],
    '网费': ['网费', '宽带费', '网络费', 'internet'],
    '话费': ['话费', '手机费', '流量费', 'telefono', 'teléfono', 'phone bill'],
    '房租': ['房租', '房贷', 'renta', 'rent', 'mortgage'],
    '工资': ['工资', '薪水', '薪资', 'salario', 'sueldo', 'nómina', 'nomina', 'salary', 'wage', 'payroll'],
    '医疗': ['医院', '看病', '诊所', '挂号', '体检', '药费', '买药', 'farmacia', 'médico', 'medico', 'hospital', 'doctor', 'clinic', 'pharmacy', 'dentist'],
    '教育': ['学费', '幼儿园', '学校', '补课', '培训班', 'escuela', 'school', 'tuition'],
    '餐饮': ['买菜', '吃饭', '早餐', '午餐', '晚餐', '外卖', '奶茶', '咖啡', '超市买菜', 'comida', 'restaurante', 'comprar comida', 'despensa'],
  };

  function matchCategory(text, kind, cats) {
    const list = cats || (kind === 'expense'
      ? (__opts && __opts.expense_categories)
      : (__opts && __opts.departments));
    if (!list || !list.length) return null;
    const low = String(text || '').toLowerCase();
    const wordHit = (w) => /[a-záéíóúñü]/i.test(w)
      ? new RegExp(`(^|[^a-záéíóúñü])${w}([^a-záéíóúñü]|$)`, 'i').test(low)
      : low.includes(w);
    // 第一轮：强关键词
    for (const [rule, words] of Object.entries(STRONG_RULES)) {
      if (words.some(wordHit)) {
        const names = CATEGORY_ALIAS[rule] || [rule];
        const exact = list.find(c => names.includes(String(c)));
        if (exact) return exact;
        const loose = list.find(c => names.some(n => String(c).includes(n) || n.includes(String(c))));
        if (loose) return loose;
        break;
      }
    }
    // 第二轮：通用规则计分
    let ruleHit = null, ruleScore = 0;
    for (const [rule, words] of Object.entries(CATEGORY_RULES)) {
      const score = words.reduce((acc, w) => acc + (wordHit(w) ? 1 : 0), 0);
      if (score > ruleScore) { ruleScore = score; ruleHit = rule; }
    }
    if (ruleHit) {
      const names = CATEGORY_ALIAS[ruleHit] || [ruleHit];
      const exact = list.find(c => names.includes(String(c)));
      if (exact) return exact;
      const loose = list.find(c => names.some(n => String(c).includes(n) || n.includes(String(c))));
      if (loose) return loose;
    }
    // 序号分类指代
    const cnOrd = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    const hasOrdCat = list.some(c => /^[一二两三四五六七八九十]{1,2}$/.test(String(c)));
    if (hasOrdCat) {
      const m = low.match(/(?:第|分类|项目|序号|选|项)?\s*([一二两三四五六七八九十\d]{1,2})\s*(?:项|个|号|分类|项目)?(?=$|\s|[，。,])/);
      const m2 = low.match(/(?:收入|收|记)\s*([一二两三四五六七八九十\d])\s*$/);
      const toNum = (s) => cnOrd[String(s).replace('两', '二')] !== undefined ? cnOrd[String(s).replace('两', '二')] : (Number(s) > 0 ? Number(s) : null);
      const n = m ? toNum(m[1]) : (m2 ? toNum(m2[1]) : null);
      if (n != null && n >= 1 && n <= list.length) return list[n - 1];
    }
    // 直接包含分类名
    const direct = list.find(c => {
      if (/^[一二两三四五六七八九十]{1,2}$/.test(String(c))) return false;
      return low.includes(String(c).toLowerCase());
    });
    return direct || null;
  }

  // ================================================================
  // 六、账户解析
  // ================================================================

  function parseAccount(text, accounts) {
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
  }

  // ================================================================
  // 七、地点解析（提醒用，动词截断 + 地点词表 + 时间排除）
  // ================================================================

  const LOC_PLACES = ['会议室', '办公室', '批发市场', '菜市场', '税务局', '银行', '工厂', '仓库', '公司', '店铺', '商店', '市场', '超市', '商场', '车站', '机场', '医院', '学校', '餐厅', '饭店', '车间', '工地', 'OXXO', 'WALMART', 'BANORTE', 'BBVA', '家里', '家'];
  const LOC_ACTIONS = ['开会提醒', '见客户', '开会', '见面', '盘点', '培训', '学习', '上课', '吃饭', '聚会', '办', '买', '去', '见', '拿', '取', '交', '付', '签', '验', '谈'];

  function cutAtAction(s) {
    let bestEnd = -1;
    for (const p of LOC_PLACES) {
      const i = s.indexOf(p);
      if (i >= 0 && i + p.length > bestEnd) bestEnd = i + p.length;
    }
    if (bestEnd > 0) return s.slice(0, bestEnd).trim();
    for (const a of LOC_ACTIONS) {
      const i = s.indexOf(a);
      if (i > 0) return s.slice(0, i).trim();
    }
    return s.split(/和|与|及/)[0].trim();
  }

  function parseLocation(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    let location = null;
    let lm = t.match(/(?:在|去|前往)\s*[:：]?\s*([^，。,.!！?？]{1,24})/);
    if (lm) location = cutAtAction(lm[1]);
    if (!location) {
      lm = t.match(/(?:地点|位置|位于)\s*[:：]?\s*([^，。,.!！?？]{1,24})/);
      if (lm) location = cutAtAction(lm[1]);
    }
    if (!location) {
      lm = t.match(/\b(?:at the|in the)\s+([A-Za-zÁÉÍÓÚÑüÜ][A-Za-zÁÉÍÓÚÑüÜ0-9&.'-]{1,23})/i) ||
           t.match(/\b(?:at|in)\s+([A-Za-zÁÉÍÓÚÑüÜ][A-Za-zÁÉÍÓÚÑüÜ0-9&.'-]{1,23})/i);
      if (lm) location = lm[1].trim();
    }
    if (!location) {
      lm = t.match(/\b(?:lugar|ubicación|ubicacion)\s*(?:de|del|es|ser)?\s*[:：]?\s*([A-Za-zÁÉÍÓÚÑüÜ0-9&. ]{2,24})/i) ||
           t.match(/\b(?:en|a)\s+(?!\d|las?\s*\d|el\s*\d|un[ao]?\s*\d)(?:la|el|una|un)?\s*([A-Za-zÁÉÍÓÚÑüÜ]{2,24})/i);
      if (lm) location = lm[1].trim();
    }
    if (!location) {
      for (const kw of LOC_PLACES) {
        const i = t.indexOf(kw);
        if (i >= 0) { location = kw; break; }
      }
    }
    if (location) location = cutAtAction(location);
    return location || null;
  }

  // ================================================================
  // 八、语音指令（保存/清空/收支切换/改日期/改账户/新建提醒）
  // ================================================================

  function parseCommand(text) {
    const t = String(text || '').trim();
    if (!t) return { cmd: null, text: t };
    const low = t.toLowerCase();
    const saveRe = /(?:^(保存|记好|记好了|好了|完成|确认记账|guardar|save|ok|done|listo|confirm)|(?:帮我|请|麻烦|麻烦你|可以)?(?:保存|记好|记好了|guardar|save|done|listo|确认保存|保存一下|确认记账|全部保存)(?:吧|啦|了|好|完成)?$|保存完成)/i;
    if (saveRe.test(low)) {
      const text2 = t.replace(/(?:帮我|请|麻烦|麻烦你|可以)?\s*(?:保存一下|记好了|确认保存|全部保存|保存|记好|guardar|save|done|listo|确认记账)\s*(?:吧|啦|了|好|完成|一下)?/ig, ' ').replace(/\s+/g, ' ').trim();
      return { cmd: 'save', text: text2 };
    }
    if (/^(清空|清除|重新来|重新|重来|撤销|取消|清理|borrar|limpiar|borra|undo|clear|reset|start over)/.test(low)) {
      return { cmd: 'clear', text: t.replace(/^(清空|清除|重新来|重新|重来|撤销|取消|清理|borrar|limpiar|borra|undo|clear|reset|start over)\s*/, '') };
    }
    if (/^(收入|收钱|记收入|入账|income|ingreso|ingresos|earnings|deposit)/.test(low)) {
      return { cmd: 'income', text: t.replace(/^(收入|收钱|记收入|入账|income|ingreso|ingresos|earnings|deposit)\s*/, '') };
    }
    if (/^(支出|花钱|花销|消费|记支出|花了|买了|expense|gasto|gastos|compra|paid|bought|spent)/.test(low)) {
      return { cmd: 'expense', text: t.replace(/^(支出|花钱|花销|消费|记支出|花了|买了|expense|gasto|gastos|compra|paid|bought|spent)\s*/, '') };
    }
    if (/^(日期|改日期|date|set date)/i.test(t)) return { cmd: 'date', text: t.replace(/^(日期|改日期|date|set date)\s*/i, '') };
    if (/^(账户|改账户|account|set account)/i.test(t)) return { cmd: 'account', text: t.replace(/^(账户|改账户|account|set account)\s*/i, '') };
    return { cmd: null, text: t };
  }

  // ================================================================
  // 九、字段消耗式提取管线（核心！）
  // ================================================================
  // extract(text, opts) → { fields: {amount, kind, date, time, category, account, location, note, content, remark}, cmd, rest }
  // opts: { mode: 'quick'|'reminder', kind: 'expense'|'income', cats: [...], accounts: [...], now }
  // 管线顺序（按明确度）：
  //   1. 显式标签（"金额50 / 分类餐饮 / 日期明天 / 时间9点 / 地点办公室 / 备注xxx"）
  //   2. 强语义提取（金额 → 收支类型 → 日期 → 时间 → 分类 → 账户 → 地点）
  //   3. 剩余文本 → content/remark（什么事情）

  const LABEL_RE = {
    amount: /(?:金额|多少钱|钱数|monto|importe|amount)\s*[:：为是]?\s*([0-9零一两二三四五六七八九十百千万亿.,]+(?:\s*(?:块|元|圆|块钱|pesos?|dólares?|dolares?|usd|mxn))?)/i,
    date: /(?:日期|date|fecha)\s*[:：为是]?\s*(大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天|(?:20\d{2}\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?)|(?:\d{1,2}\s*月\s*\d{1,2}\s*[日号])|(?:[一二三四五六七八九十]{1,2}\s*月\s*(?:\d{1,2}|[一二三四五六七八九十]{1,2})\s*[日号])|(?:tomorrow|yesterday|today|mañana|hoy|ayer))/i,
    time: /(?:时间|几点|time|hora|a las|a la)\s*[:：为是]?\s*(\d{1,2}\s*[点时:：]\s*\d{0,2}\s*(?:分|分钟)?|[零一二两三四五六七八九十]+\s*点(?:\s*(?:半|[零一二三四五六七八九]+)\s*分?)?|\d{1,2}\s*(?:am|pm|a\.?m\.?|p\.?m\.?))/i,
    category: /(?:分类|类别|category|categoría|categoria|项目)\s*[:：为是]?\s*([^，。,.!！?？]{1,12})/i,
    account: /(?:账户|账号|account|cuenta)\s*[:：为是]?\s*([^，。,.!！?？]{1,12})/i,
    location: /(?:地点|位置|地方|location|lugar|ubicación|ubicacion)\s*[:：为是]?\s*([^，。,.!！?？]{1,24})/i,
    note: /(?:备注|附注|备注信息|remark|note|nota)\s*[:：为是]?\s*([^，。,.!！?？]{1,50})/i,
    content: /(?:什么事情|事项|内容|做什么|content|qué|que hacer|do)\s*[:：为是]?\s*([^，。,.!！?？]{1,40})/i,
  };

  // 显式标签提取：返回 { field → {value, consumed} }
  function extractLabels(text) {
    const labels = {};
    let rest = String(text || '');
    // 按字段名从长到短处理，避免"日期"与"时间"交叉
    const order = ['note', 'location', 'category', 'account', 'amount', 'date', 'time', 'content'];
    // 所有标签词（用于截断：标签值遇到下一个标签词即停止）
    const NEXT_LABEL = /(?:金额|多少钱|钱数|monto|importe|amount|日期|date|fecha|时间|几点|time|hora|分类|类别|category|categoría|categoria|项目|账户|账号|account|cuenta|地点|位置|地方|location|lugar|ubicación|ubicacion|备注|附注|备注信息|remark|note|nota|什么事情|事项|内容|做什么|content|qué|que hacer|do)\s*[:：为是]?/i;
    for (const f of order) {
      const re = LABEL_RE[f];
      if (!re) continue;
      const m = rest.match(re);
      if (m) {
        let val = m[1].trim();
        // 在下一个标签词处截断（避免"地点工厂仓库 事项盘点货物"吞并）
        const nm = val.match(NEXT_LABEL);
        if (nm && nm.index > 0) val = val.slice(0, nm.index).trim();
        // consumed 只包含"标签词 + 截断后的值"，不吞并后续标签
        const labelWord = m[0].replace(m[1], '');
        const consumed = labelWord + val;
        // 金额标签再解析数值
        if (f === 'amount') {
          const amt = extractAmount(val);
          if (amt) labels.amount = { value: amt.value, consumed };
        } else if (f === 'date') {
          const d = parseDate(val);
          if (d) labels.date = { value: d, consumed };
        } else if (f === 'time') {
          const tm = parseTime(val);
          if (tm) labels.time = { value: tm, consumed };
        } else {
          if (val) labels[f] = { value: val, consumed };
        }
        // 移除已消耗片段（仅标签词+值）
        rest = rest.replace(consumed, ' ');
      }
    }
    return { labels, rest: rest.replace(/\s+/g, ' ').trim() };
  }

  // 从文本中剔除指定片段（保留其他文字）
  function strip(text, consumed) {
    if (!consumed) return String(text || '');
    return String(text || '').replace(consumed, ' ');
  }

  // 主提取：返回结构化字段 + 剩余文本
  function extract(text, opts) {
    opts = opts || {};
    const mode = opts.mode || 'quick';
    const t = String(text || '').trim();
    const out = {
      cmd: null, kind: opts.kind || 'expense',
      amount: null, date: null, time: null, category: null,
      account: null, location: null, note: null,
      content: null, remark: null,
      rest: t,
    };
    if (!t) return out;

    // 0) 指令
    const cmdR = parseCommand(t);
    if (cmdR.cmd && cmdR.cmd !== 'save' && cmdR.cmd !== 'clear') {
      out.cmd = cmdR.cmd;
      if (cmdR.cmd === 'income' || cmdR.cmd === 'expense') out.kind = cmdR.cmd;
    }
    let body = (cmdR.cmd && cmdR.cmd !== 'save' && cmdR.cmd !== 'clear') ? cmdR.text : t;
    if (cmdR.cmd === 'save' || cmdR.cmd === 'clear') out.cmd = cmdR.cmd;

    // 1) 显式标签
    const { labels, rest: restAfterLabels } = extractLabels(body);
    body = restAfterLabels;
    if (labels.amount) out.amount = labels.amount.value;
    if (labels.date) out.date = labels.date.value;
    if (labels.time) out.time = labels.time.value;
    if (labels.category) out.category = labels.category.value;
    if (labels.account) out.account = labels.account.value;
    if (labels.location) out.location = labels.location.value;
    if (labels.note) out.note = labels.note.value;
    if (labels.content) out.content = labels.content.value;

    // 2) 语义提取（跳过已有值的字段）
    // 2a) 金额
    if (out.amount == null) {
      const amt = extractAmount(body);
      if (amt) { out.amount = amt.value; body = strip(body, amt.consumed); }
    }
    // 2b) 收支类型（语义判断：收入词/支出词出现在句中）
    if (mode === 'quick' && !cmdR.cmd) {
      const low = body.toLowerCase();
      const incomeWords = /(收入|收钱|入账|到账|工资|薪水|奖金|退回|退款|收入款|ingreso|deposito|depósito|earnings|salary|refund)/i;
      const expenseWords = /(支出|花了|花销|消费|买菜|买了|付了|交费|缴费|支付|付款|gasto|gastos|compra|pago|paid|bought|spent|expense)/i;
      if (incomeWords.test(low) && !expenseWords.test(low)) out.kind = 'income';
      else if (expenseWords.test(low) && !incomeWords.test(low)) out.kind = 'expense';
    }
    // 2c) 日期
    if (out.date == null) {
      const d = parseDate(body, opts.now); // opts.now：测试/调用方可注入"今天"，保证相对日期可预期
      if (d) {
        out.date = d;
        // 移除日期表达
        body = body
          .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
          .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
          .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
          .replace(/[一二三四五六七八九十]{1,2}\s*月\s*(?:\d{1,2}|[一二三四五六七八九十]{1,2})\s*[日号]/g, ' ')
          .replace(/[一二三四五六七八九十]+月[一二三四五六七八九十]+[日号]?/g, ' ');
      }
    }
    // 2d) 时间（提醒模式必提；记账模式若出现"X点"也提）
    if (out.time == null && mode === 'reminder') {
      const tm = parseTime(body);
      if (tm) out.time = tm;
    }
    // 2e) 分类
    if (out.category == null && mode === 'quick') {
      const cats = opts.cats;
      const cat = matchCategory(body, out.kind, cats);
      if (cat) out.category = cat;
    }
    // 2f) 账户
    if (out.account == null && mode === 'quick') {
      const acc = parseAccount(body, opts.accounts || optsAccounts());
      if (acc) { out.account = acc; body = strip(body, acc); }
    }
    // 2g) 地点（提醒模式）
    if (out.location == null && mode === 'reminder') {
      const loc = parseLocation(body);
      if (loc) out.location = loc;
    }

    // 3) 剩余文本 → 什么事情/备注（按模式清理已识别字段的表达）
    let rest = body.replace(/\s+/g, ' ').trim();
    if (mode === 'reminder') {
      // 删除时间表达（X点/X点半/9am/a las 9）
      rest = rest
        .replace(/(?:早上|上午|早晨|晨间|凌晨|晚上|晚间|下午|中午|午间)?\s*[零一二两三四五六七八九十\d]{1,3}\s*点(?:钟)?(?:\s*(?:半|[零一二三四五六七八九\d]{1,2})\s*分?)?(?:\s*(?:前|后|左右))?/g, ' ')
        .replace(/\d{1,2}\s*[点时:：]\s*\d{1,2}\s*分?/g, ' ')
        .replace(/\d{1,2}\s*(?:am|pm|a\.?m\.?|p\.?m\.?|a las|a la)\s*\d{0,2}/gi, ' ')
        .replace(/\b(?:at|in)\s+\d{1,2}\s*(?:am|pm|a\.?m\.?|p\.?m\.?)/gi, ' ')
        // 删除提前提醒表达
        .replace(/(?:提前|提早)?\s*(?:半\s*小时|半小时|半个钟头)?\s*(?:提前|提早)?\s*[零一二两三四五六七八九十百\d]+\s*(?:个)?\s*(?:分钟|小时|钟头|天|日)(?:\s*(?:前|以后|之前|提醒|通知))?/gi, ' ')
        .replace(/\d+\s*(?:min|mins|minutes|hour|hours|hr|hrs|day|days|minutos|minuto|horas|hora|días|dias|día|dia)\s*(?:before|earlier|ahead|prior|antes)/gi, ' ');
      // 删除"引导词+地点"（去银行/在办公室），尾随动作（办转账/开会）保留为事项
      if (out.location) {
        const locEsc = out.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rest = rest
          .replace(new RegExp('(?:去|到|前往|在|at the|in the|at|in|en la|en el|en|a las|a la|a)\\s*' + locEsc, 'gi'), ' ')
          .replace(new RegExp(locEsc, 'gi'), ' ')
          .replace(/(?:在|去|前往|地点|位置|位于)\s*[:：]?\s*[^，。,.!！?？]{1,24}/gi, ' ');
      } else {
        rest = rest
          .replace(/(?:在|去|前往|地点|位置|位于)\s*[:：]?\s*[^，。,.!！?？]{1,24}/gi, ' ')
          .replace(/\b(?:at the|at|in the|in)\s+[A-Za-zÁÉÍÓÚÑüÜ0-9&. -]{1,24}/gi, ' ')
          .replace(/\b(?:en|a)\s+(?:la|el|una|un)?\s*[A-Za-zÁÉÍÓÚÑüÜ0-9&. ]{1,24}/gi, ' ');
      }
    } else {
      // quick 模式：清理日期/账户/支付词残留
      if (out.date) {
        rest = rest
          .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
          .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
          .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
          .replace(/[一二三四五六七八九十]{1,2}\s*月\s*(?:\d{1,2}|[一二三四五六七八九十]{1,2})\s*[日号]/g, ' ')
          .replace(/[一二三四五六七八九十]+月[一二三四五六七八九十]+[日号]?/g, ' ');
      }
      if (out.account) rest = rest.split(out.account).join(' ');
    }
    // 通用噪声词（保留动作宾语如"转账/货款/手续"——它们是有意义的事项内容）
    rest = rest
      .replace(/(支付|付款|付了|完成|帮我|请|麻烦|微信支付|到账|提醒我|记得|需要|要|用了|花费|花了|消费|帮我记|帮我写)/g, ' ')
      .replace(/\s+/g, ' ').trim();
    // 修正"办转账"等：若 rest 只剩孤立动词（办/做/开/买/交/付/签/验/谈/去），保留（可作事项）
    out.rest = rest;
    if (out.content == null) out.content = rest;
    if (out.note) out.remark = out.note;
    else out.remark = rest;
    return out;
  }

  // ================================================================
  // 十、提醒专用入口：parseReminder(text)
  //    返回 { content, location, datetime, date, time, advance_minutes, method, note, rest }
  // ================================================================

  function parseAdvance(text) {
    const t = String(text || '').toLowerCase();
    const cnNum = (str) => {
      const map = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
      if (/^\d+$/.test(str)) return Number(str);
      if (str.includes('十')) {
        const [a, b] = str.split('十');
        return (a ? (map[a] || 0) : 1) * 10 + (b ? (map[b] || 0) : 0);
      }
      return map[str] || 0;
    };
    let minutes = 0;
    if (/(?:提前|提早)?\s*半\s*(?:个)?\s*(?:小时|钟头)/.test(t) || /(?:提前|提早)?\s*半小时/.test(t)) minutes = 30;
    let m = minutes ? null : t.match(/(?:提前|提早)\s*([零一二两三四五六七八九十百\d]+)\s*(?:个)?\s*(分钟|小时|钟头|天|日)/);
    if (m) {
      const n = cnNum(m[1]);
      if (m[2].includes('天') || m[2].includes('日')) minutes = n * 1440;
      else if (m[2].includes('小时') || m[2].includes('钟头')) minutes = n * 60;
      else minutes = n;
    }
    if (!minutes) {
      m = t.match(/([零一二两三四五六七八九十百\d]+)\s*(?:个)?\s*(分钟|小时|钟头|天|日)\s*(?:前|以前|之前)/);
      if (m) {
        const n = cnNum(m[1]);
        if (m[2].includes('天') || m[2].includes('日')) minutes = n * 1440;
        else if (m[2].includes('小时') || m[2].includes('钟头')) minutes = n * 60;
        else minutes = n;
      }
    }
    if (!minutes) {
      m = t.match(/(\d+)\s*(?:minutes|mins|min|hours|hour|hrs|hr|days|day)\s*(?:before|earlier|ahead|prior)/);
      if (m) {
        const n = Number(m[1]);
        if (/^d/.test(m[2])) minutes = n * 1440;
        else if (/^h/.test(m[2])) minutes = n * 60;
        else minutes = n;
      }
      if (!minutes) {
        if (/half\s*an?\s*hour/.test(t)) minutes = 30;
        else if (/an?\s*hour/.test(t)) minutes = 60;
        else if (/a\s*day/.test(t)) minutes = 1440;
      }
    }
    if (!minutes) {
      m = t.match(/(\d+)\s*(minutos|minuto|min|horas|hora|días|dias|día|dia)\s*antes/);
      if (m) {
        const n = Number(m[1]);
        if (/^d/.test(m[2])) minutes = n * 1440;
        else if (/^h/.test(m[2])) minutes = n * 60;
        else minutes = n;
      }
      if (!minutes) {
        if (/media\s*hora/.test(t)) minutes = 30;
        else if (/una\s*hora/.test(t)) minutes = 60;
        else if (/un\s*(?:día|dia)/.test(t)) minutes = 1440;
      }
    }
    if (minutes <= 0) return 0;
    const opts = [5, 10, 15, 30, 60, 1440];
    return opts.reduce((best, o) => Math.abs(o - minutes) < Math.abs(best - minutes) ? o : best, opts[0]);
  }

  function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  }

  function parseReminder(text, opts) {
    opts = opts || {};
    const t = String(text || '').trim();
    if (!t) return { content: '', location: '', datetime: '', date: '', time: '', advance_minutes: 0, method: 'voice', note: '', rest: '' };
    const ex = extract(t, { mode: 'reminder', kind: 'expense', cats: opts.cats, accounts: opts.accounts, now: opts.now });
    const date = ex.date || '';
    const time = ex.time || '';
    const effectiveDate = date || (opts.now ? fmtDate(opts.now) : todayLocal());
    let datetime = '';
    if (time) datetime = `${effectiveDate}T${time}`;
    else if (date) datetime = `${date}T09:00`;
    const advance_minutes = parseAdvance(t);
    const method = /(?:提醒方式|方式)?\s*(?:是)?\s*手动(?:提醒)?|manual|manually/i.test(t) ? 'manual' : 'voice';
    return {
      content: ex.content || '',
      location: ex.location || '',
      datetime,
      date,
      time,
      advance_minutes,
      method,
      note: ex.note || '',
      rest: ex.rest || '',
    };
  }

  // ================================================================
  // 十一、多笔切分（一句话多笔：按分隔符/多金额位置）
  // ================================================================

  function splitEntries(text, kind) {
    const t = String(text || '').trim();
    if (!t) return { entries: [], save: false };
    let body = t;
    let save = false;
    const saveRe = /(?:帮我|请|麻烦|麻烦你)?\s*(?:保存|记好|记好了|guardar|save|done|listo)\s*(?:吧|啦|了|好)?\s*$/i;
    const saveM = body.match(saveRe);
    if (saveM) { save = true; body = body.replace(saveRe, '').trim(); }
    const date = parseDate(body);
    body = body
      .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
      .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
      .replace(/[一二三四五六七八九十]{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
      .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
      .replace(/[一二三四五六七八九十]+月[一二三四五六七八九十]+[日号]?/g, ' ')
      .replace(/\s+/g, ' ').trim();
    let parts = body.split(/[，,。;；\n]+|然后|接着|还有|另外|以及|再|随后|之后|最后/).map(s => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      const amtReG = /(?:¥|￥|\$|MX\$)?\s*(?:[0-9]{3,}(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)|[零一两二三四五六七八九十百千万]{2,}(?:万|千|百|十)?|[零一二两三四五六七八九十](?:块|元|圆|块钱|万|千|百|十))\s*(?:块|元|圆|块钱|pesos?|比索|刀|dólares?|dolares?|usd)?/gi;
      const matches = [...body.matchAll(amtReG)];
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
    const entries = parts.map(seg => {
      const ex = extract(seg, { mode: 'quick', kind, cats: optsCats(), accounts: optsAccounts() });
      return {
        date: ex.date || date || '',
        kind: ex.kind || kind,
        amount: ex.amount != null ? Number(ex.amount) : null,
        category: ex.category || '',
        account: ex.account || '',
        remark: ex.remark || '',
      };
    });
    return { entries, save };
  }

  // 选项访问（由 app.js 注入）
  function optsCats() { return (__opts && __opts.expense_categories) || null; }
  function optsAccounts() { return (__opts && __opts.accounts) || null; }

  // ================================================================
  // 导出
  // ================================================================
  const VoiceEngine = {
    parseCnNumber,
    parseEnNumber,
    parseAmount,
    extractAmount,
    parseDate,
    parseTime,
    parseAdvance,
    matchCategory,
    parseAccount,
    parseLocation,
    parseCommand,
    extract,
    parseReminder,
    splitEntries,
    // 供 app.js 注入当前选项（分类/账户列表）
    setOptions: (o) => { __opts = o || null; },
    getOptions: () => __opts,
  };

  global.VoiceEngine = VoiceEngine;
})(typeof window !== 'undefined' ? window : globalThis);
