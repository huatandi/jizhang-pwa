'use strict';
/**
 * CorrectionEngine —— 语音"说错改口"识别（V3 第8/9/12节）
 *
 * 用户自然改口时，系统应覆盖字段而非把新旧值叠加：
 *   "买菜 500" → "不对，是 50"           → amount = 50
 *   "不是现金，是 BBVA"                   → account = BBVA
 *   "金额改成 80"                        → amount = 80
 *   "分类是交通"                          → category = 交通
 *   "不是明天，是后天"                    → date = 后天
 *   "撤销"                               → 撤销上一字段变更（undo）
 *
 * 用法：
 *   const c = CorrectionEngine.parse(buffer);
 *   if (c && c.matched) { ...覆盖字段... }
 */
(function (global) {
  // 改口触发词（必须命中，否则视为普通陈述，避免"是50"被误判为改口）
  const CORRECT_RE = /(?:不对|不是|错了|我说错|说错|更正|改一下|改成|改为|应该是|其实是|其实|重新说|重说|更正为)/i;
  // 撤销
  const UNDO_RE = /^(?:撤销|去掉|不要|不要了|取消刚才|undo|borrar|quitar)/i;

  // 字段词 → 规范字段名（快速记账 + 提醒通用）
  const FIELD_RE = /(?:金额|多少钱|数额|账户|账号|银行|卡号|分类|类别|类目|日期|哪天|时间|几点|地点|哪里|位置|事项|内容|备注|说明|商户|提前|提醒时间)/i;
  function detectField(text) {
    if (/(?:金额|多少钱|数额)/.test(text)) return 'amount';
    if (/(?:账户|账号|银行|卡号)/.test(text)) return 'account';
    if (/(?:分类|类别|类目)/.test(text)) return 'category';
    if (/(?:日期|哪天)/.test(text)) return 'date';
    if (/(?:时间|几点|提醒时间)/.test(text)) return 'time';
    if (/(?:地点|哪里|位置)/.test(text)) return 'location';
    if (/(?:事项|内容)/.test(text)) return 'content';
    if (/(?:备注|说明)/.test(text)) return 'note';
    if (/(?:商户)/.test(text)) return 'merchant';
    if (/(?:提前)/.test(text)) return 'advance';
    return null;
  }

  // 提取字段新值
  function extractValue(text, field) {
    const t = String(text || '').trim();
    if (field === 'amount') {
      // 金额：阿拉伯数字（含千分位/小数），或中文数字
      let m = t.match(/(\d[\d,\.]*)\s*(?:比索|pesos|块|元|比索|MXN)?/);
      if (m) {
        const n = Number(m[1].replace(/,/g, ''));
        if (!isNaN(n) && n > 0) return n;
      }
      // 中文数字：五十/五百/一千二
      const cnNum = { 零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9 };
      m = t.match(/([零一二两三四五六七八九十百千]+)\s*(?:比索|pesos|块|元)?/);
      if (m) {
        const s = m[1];
        let total = 0, cur = 0;
        for (const ch of s) {
          if (cnNum[ch] !== undefined) cur = cnNum[ch];
          else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
          else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
          else if (ch === '千') { total += (cur || 1) * 1000; cur = 0; }
        }
        total += cur;
        if (total > 0) return total;
      }
      return null;
    }
    if (field === 'account' || field === 'category' || field === 'merchant' || field === 'location' || field === 'content' || field === 'note') {
      // "重新说分类" 等：无新值 → 返回 null（上层走 ask）
      if (/(?:重新说|重说)\s*[^，。；、,.!?！？]*$/.test(t)) return null;
      // 取最后一个"是/改成/改为/为"后的文本（去标点），长度 1~24 字
      let m = t.match(/(?:是|改成|改为|为|用|刷|付)\s*([^，。；、,.!?！？\s]+(?:\s+[^，。；、,.!?！？]+){0,3})$/);
      if (m && m[1] && m[1].trim().length <= 24) return m[1].trim();
      // 无"是"：整句即值
      const clean = t.replace(CORRECT_RE, '').replace(/[，。；、,.!?！？\s]+$/g, '').trim();
      if (clean && clean.length <= 24) return clean;
      return null;
    }
    if (field === 'date' || field === 'time' || field === 'advance') {
      // 交给上层 VoiceParser 解析（返回原词，上层按语言解析）
      const m = t.match(/(?:是|改成|改为|为)\s*([^，。；、,.!?！？]+)$/);
      if (m && m[1]) return m[1].trim();
      const clean = t.replace(CORRECT_RE, '').trim();
      if (clean) return clean;
      return null;
    }
    return null;
  }

  /**
   * 解析一句话是否为改口/撤销意图。
   * @returns {null|{matched:true,action:'update',field,value}|{matched:true,action:'undo'}}
   */
  function parse(buffer) {
    const text = String(buffer || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    // 1) 撤销上一动作
    if (UNDO_RE.test(text)) return { matched: true, action: 'undo' };

    // 2) 必须有改口触发词
    if (!CORRECT_RE.test(text)) return null;

    // 3) "不是X，是Y" 模式：优先按 Y 推断字段（X 是旧值，Y 是新值）
    //    例："不是现金，是BBVA" → Y=BBVA（账户）；"不是明天，是后天" → Y=后天（日期）
    //    X 非贪婪到第一个"是/为"（允许 X 内部带标点）
    const notXY = text.match(/(?:不是|不是的)\s*(.+?)\s*[,，]?\s*(?:是|为)\s*([^，。；、,.!?！？]{1,24})$/);
    if (notXY) {
      const newVal = notXY[2].trim();
      const oldVal = notXY[1].trim();
      // 字段推断：先看句子里的字段词；否则比较新旧值形态
      let field = detectField(text);
      if (!field) {
        // 新旧值都像账户名/分类词 → 账户优先；含时间词 → 日期
        if (/(?:明天|后天|今天|昨天|星期|周[一二三四五六日天]|\d+日|\d+号|mañana|ayer|hoy|tomorrow|manana)/i.test(newVal)) field = 'date';
        else if (/(?:点|时|:|\d{1,2}:\d{2}|am|pm|a\.m|p\.m)/i.test(newVal)) field = 'time';
        else field = 'account';
      }
      return { matched: true, action: 'update', field, value: field === 'amount' ? Number(newVal) : newVal, oldValue: oldVal };
    }

    // 4) 常规模式："金额改成80" / "改成80" / "不对是50" / "分类是交通"
    const field = detectField(text);
    const effectiveField = field || 'amount'; // 无字段词默认改金额（快速记账最常见改口）
    const value = extractValue(text, effectiveField);
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return { matched: true, action: 'update', field: effectiveField, value };
    }
    // 5) 有字段词但取不到值（如"重新说分类"）→ 提示重说该字段
    if (field) return { matched: true, action: 'ask', field };
    return null;
  }

  global.CorrectionEngine = { parse };
})(typeof window !== 'undefined' ? window : globalThis);
