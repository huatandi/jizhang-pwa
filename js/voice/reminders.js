'use strict';
/**
 * reminders —— 语音提醒（从 app.js 拆分）
 *
 * 原 app.js 2130-2822 行。拆分原则：
 *   1. 保留全部全局函数名（HTML onclick + JS 生成的 onclick 直接引用）
 *   2. 依赖主文件公共设施：api / showToast / openModal / closeModal / escapeHtml / nowLocal / todayLocal / gotoPage / openPurchaseModal / openIncomeModal / openExpenseModal / options
 *   3. 依赖 quick-voice.js 的 speak / startAlarm / stopAlarm / scheduleAlarmRetries（已拆 js/voice/quick-voice.js，保持全局）
 *   4. 依赖主文件 VoiceSR / VoiceEngine 兼容层（兼容层位于 app.js，运行时覆盖 ReminderParser 解析方法）
 *   5. 本文件定义 ReminderParser 供 voice-engine-bridge.js 覆盖
 *
 * 架构：UI 层（本文件）→ Service/DB 层（js/services/*），不反向依赖 src/ui/*。
 */
(function (global) {
let reminders = [];
let editingReminderId = null;
let reminderVoiceLang = defaultReminderLang();
let reminderVoiceSessionActive = false;
let reminderVoiceBuffer = '';
let reminderVoiceTimer = null;
let reminderAutoSaveTimer = null; // 终结词后 1s 窗口内的自动保存定时器（可被"保存"提前取消）
let currentNotifyReminder = null;
// V4.5 字段状态：已确认字段（用户改口/手动改过）不被低置信新段覆盖
let reminderFieldConfirmed = {};

// 默认提醒语音语言：优先用户已保存，其次浏览器语言（global-config 检测），最后中文
function defaultReminderLang() {
  const saved = localStorage.getItem('sm_reminder_voice_lang');
  if (saved) return saved;
  const gc = global.AIKit && global.AIKit.globalConfig;
  if (gc && gc.detectLang) {
    try {
      const l = gc.detectLang();
      if (l) return l;
    } catch (e) { /* ignore */ }
  }
  try { return (global.navigator && global.navigator.language) || 'zh-CN'; }
  catch (e) { return 'zh-CN'; }
}

// 提醒语音解析：从一句话中提取 时间 / 地点 / 事项
const ReminderParser = {
  // 解析"早上9点 / 九点 / 下午三点 / 3点 / 12点半 / 9am / a las 9" → "HH:MM"
  parseTime(text) {
    const t = String(text || '').toLowerCase();
    let period = null; // am / pm
    if (/早上|上午|早晨|晨间|凌晨|temprano|mañana|en la mañana|am\b|a\.?m/i.test(t)) period = 'am';
    else if (/晚上|晚间|下午|noche|tarde|pm\b|p\.?m|de la noche|de la tarde/i.test(t)) period = 'pm';
    else if (/中午|午间|mediodía|mediodia|noon\b/i.test(t)) period = 'pm';

    // 英文/西语 am/pm 形式：9am / 9:30am / 9 a. m. / 9 pm
    let m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(?:a\.?m\.?|am|p\.?m\.?|pm|de la noche|de la tarde)\b/i);
    let hh = null, mm = 0;
    if (m) {
      hh = Number(m[1]); mm = m[2] ? Number(m[2]) : 0;
      const suffix = m[3] || '';
      if (/p/i.test(suffix) && hh < 12) hh += 12;
      if (/a/i.test(suffix) && hh === 12) hh = 0;
    }
    // 西语 a las 9 / a las 9:30 / a la 1
    if (hh == null) {
      m = t.match(/(?:a las|a la)\s+(\d{1,2})(?::(\d{2}))?/);
      if (m) { hh = Number(m[1]); mm = m[2] ? Number(m[2]) : 0; }
    }
    // 数字时:分（12:30 / 12点半）
    if (hh == null) {
      m = t.match(/(\d{1,2})\s*[点时:：]\s*(\d{1,2})\s*(?:分|分钟)?/);
      if (m) { hh = Number(m[1]); mm = Number(m[2]); }
    }
    if (hh == null) {
      // 中文大写：三点 / 九点 / 十二点半
      const cn = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
      m = t.match(/([零一二两三四五六七八九十]+)\s*点(?:\s*(半|[零一二三四五六七八九]+)\s*分?)?/);
      if (m) {
        hh = cn[m[1]] !== undefined ? cn[m[1]] : null;
        if (m[2] === '半') mm = 30;
        else if (m[2] && cn[m[2]] !== undefined) mm = cn[m[2]];
      }
    }
    // 数字 9点 / 15点
    if (hh == null) { m = t.match(/(\d{1,2})\s*点/); if (m) hh = Number(m[1]); }
    if (hh == null) return null;
    // 12小时制 + 上午/下午
    if (period === 'pm' && hh < 12) hh += 12;
    if (period === 'am' && hh === 12) hh = 0;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  },

  // 解析提前提醒：提前10分钟 / 提前一小时 / 提前一天 / 10 minutes before / 10 minutos antes → 就近档位（5/10/15/30/60/1440）
  parseAdvance(text) {
    const t = String(text || '').toLowerCase();
    const cnNum = (str) => {
      const cnMap = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
      if (/^\d+$/.test(str)) return Number(str);
      if (str.includes('十')) {
        const [a, b] = str.split('十');
        return (a ? (cnMap[a] || 0) : 1) * 10 + (b ? (cnMap[b] || 0) : 0);
      }
      return cnMap[str] || 0;
    };
    let minutes = 0;
    // 中文：提前半小时 / 提前半个小时 / 提前半个钟头（"半" = 30分钟）
    if (/(?:提前|提早)?\s*半\s*(?:个)?\s*(?:小时|钟头)/.test(t) || /(?:提前|提早)?\s*半小时/.test(t)) minutes = 30;
    // 中文：提前10分钟 / 提前一小时 / 提前一天 / 提前15分钟提醒
    let m = minutes ? null : t.match(/(?:提前|提早)\s*([零一二两三四五六七八九十百\d]+)\s*(?:个)?\s*(分钟|小时|钟头|天|日)/);
    if (m) {
      const n = cnNum(m[1]);
      if (m[2].includes('天') || m[2].includes('日')) minutes = n * 1440;
      else if (m[2].includes('小时') || m[2].includes('钟头')) minutes = n * 60;
      else minutes = n;
    }
    // 中文无"提前"：X分钟前 / X小时前
    if (!minutes) {
      m = t.match(/([零一二两三四五六七八九十百\d]+)\s*(?:个)?\s*(分钟|小时|钟头|天|日)\s*(?:前|以前|之前)/);
      if (m) {
        const n = cnNum(m[1]);
        if (m[2].includes('天') || m[2].includes('日')) minutes = n * 1440;
        else if (m[2].includes('小时') || m[2].includes('钟头')) minutes = n * 60;
        else minutes = n;
      }
    }
    // 英文：10 minutes before / 1 hour earlier / half an hour ahead
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
    // 西语：10 minutos antes / 1 hora antes / un día antes
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
    // 就近匹配到可选档位（准时0 / 5 / 10 / 15 / 30 / 60 / 1440）
    const opts = [5, 10, 15, 30, 60, 1440];
    return opts.reduce((best, o) => Math.abs(o - minutes) < Math.abs(best - minutes) ? o : best, opts[0]);
  },

  // 解析提醒整体：返回 { date, time, datetime, location, content, advance_minutes, method, note }
  parse(text) {
    const t = String(text || '').trim();
    if (!t) return { content: '', location: '', datetime: '', date: '', time: '', advance_minutes: 0, method: 'voice', note: '', repeat: 'none' };
    const date = VoiceParser.parseDate(t) || '';
    const time = ReminderParser.parseTime(t) || '';
    // 只有时间没有日期 → 默认今天
    const effectiveDate = date || todayLocal();
    let datetime = '';
    if (time) datetime = `${effectiveDate}T${time}`;
    else if (date) datetime = `${date}T09:00`;

    // 提前提醒节点
    const advance_minutes = ReminderParser.parseAdvance(t);
    // 重复提醒：每天/每日/每周/每星期/每月 → repeat 字段（none/daily/weekly/monthly）
    let repeat = 'none';
    const rptLow = t.toLowerCase();
    if (/(?:每天|每日|天天|每日重复|每天重复|daily|todos los días|todos los dias|cada día|cada dia)/.test(rptLow)) repeat = 'daily';
    else if (/(?:每周|每星期|每周重复|weekly|cada semana|cada semana)/.test(rptLow)) repeat = 'weekly';
    else if (/(?:每月|每个月|每月重复|monthly|cada mes)/.test(rptLow)) repeat = 'monthly';
    // 提醒方式：默认语音（语音添加场景）；明确说"手动"才切换为手动
    const method = /(?:提醒方式|方式)?\s*(?:是)?\s*手动(?:提醒)?|manual|manually/i.test(t) ? 'manual' : 'voice';
    // 备注：备注/附注 + 内容
    let note = '';
    const nm = t.match(/(?:备注|附注|备注信息|remark|note|nota)\s*[:：]?\s*([^，。,.!！?？]{1,50})/i);
    if (nm) note = nm[1].trim();

    // 地点：智能识别（不依赖写死地点词表）
    // 介词引导（在/去/前往/到/地点：/位置：/位于）+ 语义截断（动词/连接词/下个字段标签/标点）
    // 截断词：动作动词（开会/见客户/办/买/见/交/付/签/验/谈/拿/取/学习/上课/吃饭/聚会/盘点/培训）、
    //         连接词（和/与/及/然后/接着）、字段标签（提前/重复/备注/提醒方式/时间/日期）
    const LOC_CUT_LONG = /(?:开会|见客户|见面|盘点|培训|学习|上课|吃饭|聚会|前往|然后|接着|提前|提早|重复|每天|每周|每月|备注|提醒方式|方式|提醒|闹钟|时间|日期|大后天|明天|后天|今天|早上|下午|晚上|上午|中午|凌晨)/;
    const LOC_CUT_SHORT = /(?:买|见|拿|取|交|付|签|验|谈|去|到|和|与|及|点|号|日|月|办(?!公室))/;
    const LOC_KEEP_LIST = ['办公室', '办事处', '办公大楼', '批发市场', '百货大楼', '购物中心', '工厂', '仓库', '公司', '商店', '超市', '商场', '餐厅', '饭店', '酒店', '学校', '医院', '银行', '车站', '机场', '菜市场', '税务局'];
    const cutLoc = (raw) => {
      const s = String(raw || '').trim();
      if (!s) return '';
      // 1) 长词截断（明确字段/动作词）：任何位置
      let m = s.match(LOC_CUT_LONG);
      if (m && m.index > 0) return s.slice(0, m.index).trim();
      // 1.5) 明确地点名词最长匹配保留（"市中心办公室"→ 保留到"办公室"末尾；"新开的咖啡馆"无匹配则跳过）
      let bestEnd = -1;
      for (const p of LOC_KEEP_LIST) {
        const i = s.indexOf(p);
        if (i >= 0 && i + p.length > bestEnd) bestEnd = i + p.length;
      }
      if (bestEnd > 0) return s.slice(0, bestEnd).trim();
      // 2) 单字动词/连接词截断：仅当 index>0 且前面有内容（避免"办公室"的"办"在 index=0 误截）
      m = s.match(LOC_CUT_SHORT);
      if (m && m.index > 0) return s.slice(0, m.index).trim();
      // 3) 无截断词：原样（可能整段都是地点，如"市中心办公室"）
      return s;
    };
    let location = '';
    // 中文：在/去/前往/到/位于 + 地点（允许空格，动词处截断）
    let lm = t.match(/(?:在|去|前往|到|位于)\s*[:：]?\s*([^，。,.!！?？]{1,24})/);
    if (lm) location = cutLoc(lm[1]);
    // 中文显式标签：地点：X / 位置：X
    if (!location) {
      lm = t.match(/(?:地点|位置)\s*[:：]?\s*([^，。,.!！?？]{1,24})/);
      if (lm) location = cutLoc(lm[1]);
    }
    // 英文：优先 at the / in the，再 at/in + 非数字（排除 at 9am 时间）
    if (!location) {
      lm = t.match(/\b(?:at the|in the)\s+([A-Za-zÁÉÍÓÚÑüÜ][A-Za-zÁÉÍÓÚÑüÜ0-9&.'-]{1,23})/i) ||
           t.match(/\b(?:at|in)\s+([A-Za-zÁÉÍÓÚÑüÜ][A-Za-zÁÉÍÓÚÑüÜ0-9&.'-]{1,23})/i);
      if (lm) location = lm[1].trim();
    }
    // 西语：lugar/ubicación/en + 地点（排除 a las 9 / a la 1 时间表达）
    if (!location) {
      lm = t.match(/\b(?:lugar|ubicación|ubicacion)\s*(?:de|del|es|ser)?\s*[:：]?\s*([A-Za-zÁÉÍÓÚÑüÜ0-9&. ]{2,24})/i) ||
           t.match(/\b(?:en|a)\s+(?!\d|las?\s*\d|el\s*\d|un[ao]?\s*\d)(?:la|el|una|un)?\s*([A-Za-zÁÉÍÓÚÑüÜ]{2,24})/i);
      if (lm) location = lm[1].trim();
    }
    // 显式"地点：X"标签已覆盖；无介词时若文本含"地点/位置"标签词后的内容则已取到
    if (location) location = cutLoc(location);

    // 事项 = 去掉引导词、日期、时间（含"前/后/左右"）、提前提醒、提醒方式、备注、地点表达后的剩余内容
    let content = t
      .replace(/^(?:请说|请你说|你说|帮我|我要设|给我设|设置|提醒我|请|say\s*[:：]?|dí\s*[:：]?|di\s*[:：]?)\s*[:：]?/i, ' ')
      .replace(/大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天/g, ' ')
      .replace(/(20\d{2})\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*[日号]?/g, ' ')
      .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ')
      .replace(/[零一两二三四五六七八九十]+\s*月\s*[零一二三四五六七八九十]+\s*[日号]/g, ' ')
      .replace(/(?:早上|上午|早晨|晨间|凌晨|晚上|晚间|下午|中午|午间)?\s*[零一二两三四五六七八九十\d]{1,3}\s*点(?:钟)?(?:\s*(半|[零一二三四五六七八九\d]{1,2})\s*分?)?(?:\s*(?:前|后|左右))?/g, ' ')
      .replace(/\d{1,2}\s*[点时:：]\s*\d{1,2}\s*分?/g, ' ')
      .replace(/\d{1,2}\s*点(?:钟)?(?:前|后|左右)?/g, ' ')
      // 提前提醒表达（含"半个/半小时"）
      .replace(/(?:提前|提早)?\s*半\s*(?:个)?\s*(?:小时|钟头)(?:\s*(?:提醒|通知))?/g, ' ')
      .replace(/(?:提前|提早)?\s*半小时(?:\s*(?:提醒|通知))?/g, ' ')
      .replace(/(?:提前|提早)\s*[零一二两三四五六七八九十百\d]+\s*(?:个)?\s*(?:分钟|小时|钟头|天|日)(?:\s*(?:提醒|通知))?/g, ' ')
      .replace(/\d+\s*(?:min|mins|minutes|hour|hours|hr|hrs|day|days|minutos|minuto|horas|hora|días|dias|día|dia)\s*(?:before|earlier|ahead|prior|antes)/gi, ' ')
      .replace(/(?:half\s*an?\s*hour|an?\s*hour|a\s*day|media\s*hora|una\s*hora|un\s*día|un\s*dia)\s*(?:before|earlier|ahead|prior|antes)/gi, ' ')
      // 提醒方式表达（含"闹钟/闹铃"）
      .replace(/(?:提醒方式|方式|提醒)\s*(?:[:：]?)\s*(语音自动|语音|闹钟|闹铃|手动|automático|manual|voice|speech|alarm)/gi, ' ')
      .replace(/(?:闹钟|闹铃)\s*(?:提醒|方式)?/gi, ' ')
      // 备注表达
      .replace(/(?:备注|附注|备注信息|remark|note|nota)\s*[:：]?\s*[^，。,.!！?？]{1,50}/gi, ' ')
      // 重复提醒表达
      .replace(/(?:每天|每日|天天|每周|每星期|每月|每个月)(?:重复)?/gi, ' ')
      .replace(/(?:daily|weekly|monthly|cada día|cada dia|cada semana|cada mes)/gi, ' ')
      // 地点表达：先精确删除已识别的地点词（含中/英/西语引导词），再删孤立标签词，不吞后续动词
      .replace(location ? new RegExp('(?:在|去|前往|at the|in the|at|in|en la|en el|en|a las|a la|a)\\s*' + location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : /$^/, ' ')
      .replace(location ? new RegExp(location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : /$^/, ' ')
      .replace(/(?:地点|位置|位于)\s*[:：]?\s*/gi, ' ')
      .replace(/(?:在|去|前往)\s*[:：]?\s*/gi, ' ')
      .replace(/(?:at the|at|in the|in)\s+[A-Za-zÁÉÍÓÚÑüÜ0-9&. -]{1,24}/gi, ' ')
      .replace(/(?:lugar|ubicación|ubicacion|en)\s+(?:la|el|una|un)?\s*[A-Za-zÁÉÍÓÚÑüÜ0-9&. ]{1,24}|a\s+(?:la|el|una|un)\s+[A-Za-zÁÉÍÓÚÑüÜ0-9&. ]{1,24}/gi, ' ')
      .replace(/提醒\s*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!content && t) content = t; // 解析失败时保留原文
    return { content, location, datetime, date, time, advance_minutes, method, note, repeat };
  }
};

// 渲染提醒列表
async function renderReminders() {
  try { reminders = await api('/reminders'); } catch (e) { showToast('加载提醒失败', 'error'); return; }
  const list = document.getElementById('reminderList');
  const stats = document.getElementById('reminderStats');
  if (!list) return;
  const pending = reminders.filter(r => r.status === 'pending');
  const done = reminders.filter(r => r.status === 'done');
  const now = new Date();
  const fmtDateTime = (dt) => {
    if (!dt) return '';
    const d = dt.length >= 10 ? dt.slice(0, 10) : dt;
    const t = dt.length > 11 ? dt.slice(11, 16) : '';
    return (d ? d : '') + (t ? ' ' + t : '');
  };
  const overdue = pending.filter(r => r.remind_at && r.remind_at < nowLocal());
  if (stats) {
    stats.textContent = `待提醒 ${pending.length} · 已完成 ${done.length}${overdue.length ? ` · 已过期 ${overdue.length}` : ''}`;
  }
  if (!pending.length && !done.length) {
    list.innerHTML = `<div class="ai-empty">还没有提醒。点击「语音添加提醒」，设置事项、时间、地点，到点自动提醒。</div>`;
    return;
  }
  const card = (r) => {
    const isDone = r.status === 'done';
    const isOverdue = !isDone && r.remind_at && r.remind_at < nowLocal();
    const adv = Number(r.advance_minutes) || 0;
    const advTxt = adv === 0 ? '准时' : adv >= 1440 && adv % 1440 === 0 ? `提前${adv / 1440}天` : adv >= 60 ? `提前${adv / 60}小时` : `提前${adv}分钟`;
    const loc = r.location ? `<span class="reminder-loc">📍 ${escapeHtml(r.location)}</span>` : '';
    const method = remindModeLabel(r.remind_method);
    // 功能补充 P3：重复规则徽标 + 关联账务
    const repeatTxt = { daily: '🔁 每天', weekly: '🔁 每周', monthly: '🔁 每月' }[r.repeat] || '';
    const repeatBadge = repeatTxt ? `<span class="reminder-tag repeat">${repeatTxt}${r.repeat === 'weekly' ? '·' + (WEEKDAYS_CN[Number(r.repeat_day)] || '') : r.repeat === 'monthly' ? '·' + (r.repeat_day || '') + '号' : ''}</span>` : '';
    const linkTxt = { purchase: '📦 付货款', income: '💰 收货款', expense: '💸 支出' }[r.link_type] || '';
    const linkBadge = linkTxt ? `<span class="reminder-tag link">${linkTxt}</span>` : '';
    return `
    <div class="reminder-card ${isDone ? 'done' : ''} ${isOverdue ? 'overdue' : ''}">
      <div class="reminder-main">
        <div class="reminder-time">
          <span class="reminder-date">${fmtDateTime(r.remind_at).slice(0, 10)}</span>
          <span class="reminder-clock">${fmtDateTime(r.remind_at).slice(11) || ''}</span>
        </div>
        <div class="reminder-info">
          <div class="reminder-content">${isDone ? '<s>' : ''}${escapeHtml(r.content)}${isDone ? '</s>' : ''}</div>
          <div class="reminder-meta">${method} <span class="reminder-tag">⏱ ${advTxt}</span> ${repeatBadge} ${linkBadge} ${loc}</div>
          ${r.note ? `<div class="reminder-note">${escapeHtml(r.note)}</div>` : ''}
        </div>
      </div>
      <div class="reminder-ops">
        ${!isDone ? `<button class="action-btn done-btn" onclick="markReminderDone(${r.id})" title="标记完成">✔</button>` : ''}
        <button class="action-btn" onclick="editReminder(${r.id})" title="编辑">✏️</button>
        <button class="action-btn" onclick="deleteReminder(${r.id})" title="删除">🗑️</button>
      </div>
    </div>`;
  };
  list.innerHTML = [
    ...pending.sort((a, b) => (a.remind_at || '').localeCompare(b.remind_at || '')).map(card),
    ...done.map(card)
  ].join('');
}

// 重复提醒：周几/每月几号 下拉联动（功能补充 P3）
const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function syncRepeatDayUI() {
  const repeat = document.getElementById('rRepeat').value;
  const row = document.getElementById('rRepeatDayRow');
  const sel = document.getElementById('rRepeatDay');
  if (repeat === 'none') { row.style.display = 'none'; return; }
  row.style.display = '';
  if (repeat === 'weekly') {
    sel.innerHTML = WEEKDAYS_CN.map((w, i) => `<option value="${i}">${w}</option>`).join('');
  } else if (repeat === 'monthly') {
    let opts = '';
    for (let d = 1; d <= 31; d++) opts += `<option value="${d}">${d} 号</option>`;
    sel.innerHTML = opts;
  }
}

// 提醒方式：三开关（语音播报/响铃/震动）⇄ 存储值。
// 存储格式：逗号串如 "speak,ring,vibrate"；兼容旧值 voice（=全开）与 manual（=仅响铃，隐私）。
function parseRemindMode(v) {
  const s = String(v || '').trim();
  if (s === 'voice' || s === '' || s === null) return { speak: true, ring: true, vibrate: true };
  if (s === 'manual') return { speak: false, ring: true, vibrate: true };
  const set = s.split(',').map(x => x.trim()).filter(Boolean);
  return {
    speak: set.includes('speak'),
    ring: set.includes('ring'),
    vibrate: set.includes('vibrate'),
  };
}
function readRemindMode() {
  const g = (id) => { const el = document.getElementById(id); return el ? el.checked : true; };
  const parts = [];
  if (g('rModeSpeak')) parts.push('speak');
  if (g('rModeRing')) parts.push('ring');
  if (g('rModeVibrate')) parts.push('vibrate');
  return parts.length ? parts.join(',') : 'manual'; // 全关 = 手动（仅弹卡片）
}
function setRemindModeUI(v) {
  const m = parseRemindMode(v);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
  set('rModeSpeak', m.speak);
  set('rModeRing', m.ring);
  set('rModeVibrate', m.vibrate);
}
function remindModeLabel(v) {
  const m = parseRemindMode(v);
  const parts = [];
  if (m.speak) parts.push('🎙️ 语音');
  if (m.ring) parts.push('🔊 响铃');
  if (m.vibrate) parts.push('📳 震动');
  return parts.length ? parts.join(' ') : '🔕 仅卡片';
}

// 打开提醒弹窗（mode='voice' 时不自动开始监听——用户要求：按下"点击说话"才播"请说"并开始识别）
function openReminderModal(mode) {
  editingReminderId = null;
  document.getElementById('rContent').value = '';
  document.getElementById('rLocation').value = '';
  document.getElementById('rNote').value = '';
  document.getElementById('rAt').value = '';
  setRemindModeUI('voice'); // 默认：语音播报+响铃+震动
  document.getElementById('rAdvance').value = '0';
  document.getElementById('rRepeat').value = 'none';
  document.getElementById('rLinkType').value = '';
  syncRepeatDayUI();
  document.getElementById('btnSaveReminder').textContent = '保存提醒';
  renderReminderVoicePreview();
  openModal('reminderModal');
  if (mode === 'voice') {
    // 不自动开始监听：聚焦"点击说话"按钮，等用户按下才开始（避免一进卡片就播"请说"）
    if (!reminderVoiceSessionActive) setReminderVoiceBtnState('idle');
    setTimeout(() => {
      const btn = document.getElementById('btnReminderVoice');
      if (btn) btn.focus();
    }, 250);
  } else {
    document.getElementById('rContent').focus();
  }
}

// 编辑提醒
function editReminder(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  editingReminderId = id;
  document.getElementById('rContent').value = r.content || '';
  document.getElementById('rLocation').value = r.location || '';
  document.getElementById('rNote').value = r.note || '';
  document.getElementById('rAt').value = r.remind_at ? normalizeRemindAt(r.remind_at) : '';
  setRemindModeUI(r.remind_method || 'voice');
  document.getElementById('rAdvance').value = String(r.advance_minutes || 0);
  document.getElementById('rRepeat').value = r.repeat || 'none';
  syncRepeatDayUI();
  if (r.repeat && r.repeat !== 'none' && document.getElementById('rRepeatDay')) {
    document.getElementById('rRepeatDay').value = String(r.repeat_day || 0);
  }
  document.getElementById('rLinkType').value = r.link_type || '';
  document.getElementById('btnSaveReminder').textContent = '更新提醒';
  renderReminderVoicePreview();
  openModal('reminderModal');
}

// 保存提醒（功能补充 P3：repeat/link）
async function saveReminder() {
  const content = document.getElementById('rContent').value.trim();
  const rAt = document.getElementById('rAt').value;
  const location = document.getElementById('rLocation').value.trim();
  const method = readRemindMode();
  const advance = Number(document.getElementById('rAdvance').value) || 0;
  const note = document.getElementById('rNote').value.trim();
  const repeat = document.getElementById('rRepeat').value || 'none';
  const repeatDay = repeat === 'none' ? 0 : Number(document.getElementById('rRepeatDay').value) || 0;
  const linkType = document.getElementById('rLinkType').value || '';
  if (!content) return showToast('请填写提醒事项', 'error');
  if (!rAt) return showToast('请设置提醒时间', 'error');
  // PvM 静默学习：语音识别的原始地点 ≠ 最终保存地点 → 用户纠正（"店里"→"华泰店"）
  if (window.PersonalVoiceMemory && reminderVoiceBuffer) {
    try {
      const pvm = window.PersonalVoiceMemory;
      const rawLoc = reminderVoiceBuffer.match(/(?:在|去|前往)\s*([^，。,.!！?？]{1,12})/);
      if (rawLoc && location && rawLoc[1] !== location) {
        pvm.learn(rawLoc[1], location, { type: 'LOCATION', field: 'location', context: 'reminder', source: 'USER_CORRECTION' });
        // Learning Engine：记录纠正事件（用户修改 +30）
        if (window.LearningEngine && typeof window.LearningEngine.record === 'function') {
          window.LearningEngine.record({ input: rawLoc[1], source: 'voice', field: 'location', context: 'reminder', finalValue: location, userConfirmed: false, rules: ['modify'] });
        }
      }
    } catch (e) { /* 静默失败 */ }
  }
  const body = { content, remind_at: rAt.replace('T', ' '), location, remind_method: method, advance_minutes: advance, note, repeat, repeat_day: repeatDay, link_type: linkType };
  try {
    if (editingReminderId) await api('/reminders/' + editingReminderId, 'PUT', body);
    else await api('/reminders', 'POST', body);
    stopReminderVoice();
    closeModal('reminderModal');
    showToast(editingReminderId ? '提醒已更新 ✅' : '提醒已创建 ✅');
    renderReminders();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}

// 删除提醒
async function deleteReminder(id) {
  if (!confirm('确定删除这条提醒？')) return;
  await api('/reminders/' + id, 'DELETE');
  showToast('提醒已删除');
  renderReminders();
}

// 关闭提醒卡片并停止闹铃（"知道了" / × / 点外围）
function dismissReminderNotify() {
  stopAlarm();
  closeModal('reminderNotifyModal');
}

// 标记完成（功能补充 P3：关联账务提醒完成时跳转到记账页）
async function markReminderDone(id) {
  const target = id || currentNotifyReminder;
  if (!target) return;
  const r = reminders.find(x => x.id === Number(target));
  await api('/reminders/' + target, 'PUT', { status: 'done' });
  notifiedReminderIds.delete(target);
  currentNotifyReminder = null;
  closeModal('reminderNotifyModal');
  stopAlarm();
  showToast('提醒已完成 ✔');
  renderReminders();
  // 关联账务跳转：付货款→进货、收货款→收入、支出→支出
  if (r && r.link_type) {
    if (r.link_type === 'purchase') { openPurchaseModal(); gotoPage('purchase'); }
    else if (r.link_type === 'income') { openIncomeModal(); gotoPage('income'); }
    else if (r.link_type === 'expense') { openExpenseModal(); gotoPage('expense'); }
  }
}

// 稍后提醒（snooze）：把 remind_at 推迟 minutes 分钟，并复位为 pending
async function snoozeReminder(minutes) {
  const target = currentNotifyReminder;
  if (!target) return showToast('没有待处理的提醒', 'error');
  try {
    const cur = reminders.find(x => x.id === Number(target)) || {};
    const curAt = cur.remind_at || '';
    const base = curAt && curAt.includes('T') ? curAt.replace('T', ' ') : curAt;
    const d = base ? new Date(base.replace(/-/g, '/')) : new Date();
    d.setMinutes(d.getMinutes() + minutes);
    const pad = n => String(n).padStart(2, '0');
    const nextAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    await api('/reminders/' + target, 'PUT', { remind_at: nextAt, status: 'pending' });
    notifiedReminderIds.delete(target);
    currentNotifyReminder = null;
    closeModal('reminderNotifyModal');
    stopAlarm();
    showToast(minutes === 1440 ? '已推迟到明天提醒 🌅' : `已推迟 ${minutes} 分钟 ⏳`);
    renderReminders();
  } catch (e) {
    showToast('推迟失败: ' + e.message, 'error');
  }
}

// 提醒语音语言切换（三语）
const REMINDER_VOICE_LANGS = [
  { code: 'zh-CN', label: '中文', tip: '🎙️ 说：明天早上九点 在办公室 开会' },
  { code: 'en-US', label: 'English', tip: '🎙️ Say: meeting at office tomorrow 9am' },
  { code: 'es-MX', label: 'Español', tip: '🎙️ Di: reunión en oficina mañana 9am' },
];
function switchReminderVoiceLang() {
  const idx = REMINDER_VOICE_LANGS.findIndex(l => l.code === reminderVoiceLang);
  reminderVoiceLang = REMINDER_VOICE_LANGS[(idx + 1) % REMINDER_VOICE_LANGS.length].code;
  localStorage.setItem('sm_reminder_voice_lang', reminderVoiceLang);
  syncReminderVoiceLangUI();
}
function syncReminderVoiceLangUI() {
  const btn = document.getElementById('btnReminderVoiceLang');
  if (btn) btn.textContent = getReminderVoiceLangMeta().label;
  const tip = document.getElementById('reminderVoiceTip');
  if (tip && !reminderVoiceSessionActive) tip.textContent = getReminderVoiceLangMeta().tip;
}
function getReminderVoiceLangMeta() {
  return REMINDER_VOICE_LANGS.find(l => l.code === reminderVoiceLang) || REMINDER_VOICE_LANGS[0];
}

// 提醒语音会话
function toggleReminderVoice() {
  const cap = (typeof window.checkVoiceCapability === 'function') ? window.checkVoiceCapability() : null;
  if (cap && !cap.ok) {
    setReminderVoiceBtnState('error');
    return showToast(cap.message, 'error');
  }
  if (reminderVoiceSessionActive) { stopReminderVoice(); return; }
  startReminderVoice();
}
function startReminderVoice() {
  // 先停掉快速记账的语音会话，避免两个识别器冲突
  if (window.getVoiceSessionActive && window.getVoiceSessionActive()) stopVoiceSession();
  window.__reminderVoiceRetryCount = 0;
  reminderVoiceBuffer = '';
  reminderFieldHistory = []; // 新会话：清空字段历史（撤销栈）
  reminderFieldConfirmed = {}; // 新会话：清空字段确认状态
  setReminderVoiceBtnState('listening');
  reminderVoiceSessionActive = true;
  resetReminderIdleTimer(); // 60 秒无有效语音自动停止
  // 先播放"请说"提示音，等语音播完（约1秒）再启动麦克风。
  // 否则 speechSynthesis 的输出会被麦克风采集 → 触发 VAD 把提示音当语音 → 无谓推理甚至崩溃。
  const announce = () => speak('请说');
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('请说');
      u.lang = reminderVoiceLang === 'es-MX' ? 'es-MX' : reminderVoiceLang === 'en-US' ? 'en-US' : 'zh-CN';
      u.onend = () => {
        if (reminderVoiceSessionActive && !VoiceSR.isListening()) {
          VoiceSR.listen({ lang: reminderVoiceLang, continuous: true }, reminderVoiceHandleResult);
        }
      };
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      // 兜底：某些浏览器不触发 onend（静音/后台），1.2 秒后无论如何启动监听
      setTimeout(() => {
        if (reminderVoiceSessionActive && !VoiceSR.isListening()) {
          VoiceSR.listen({ lang: reminderVoiceLang, continuous: true }, reminderVoiceHandleResult);
        }
      }, 1200);
    } else {
      announce();
      VoiceSR.listen({ lang: reminderVoiceLang, continuous: true }, reminderVoiceHandleResult);
    }
  } catch (e) {
    announce();
    VoiceSR.listen({ lang: reminderVoiceLang, continuous: true }, reminderVoiceHandleResult);
  }
}
function stopReminderVoice() {
  reminderVoiceSessionActive = false;
  if (reminderIdleTimer) { clearTimeout(reminderIdleTimer); reminderIdleTimer = null; }
  VoiceSR.stop();
  setReminderVoiceBtnState('idle');
}
// 60 秒无有效语音 → 自动停止（用户要求：1 分钟内无法完成就主动取消/结束）
let reminderIdleTimer = null;
function resetReminderIdleTimer() {
  if (reminderIdleTimer) clearTimeout(reminderIdleTimer);
  reminderIdleTimer = setTimeout(() => {
    if (reminderVoiceSessionActive) {
      reminderVoiceSessionActive = false;
      VoiceSR.stop();
      setReminderVoiceBtnState('idle');
      showToast('⏱ 60 秒未识别到有效语音，已自动停止（可再次点击说话）', 'error');
    }
  }, 60000);
}
function setReminderVoiceBtnState(state) {
  const btn = document.getElementById('btnReminderVoice');
  if (!btn) return;
  btn.classList.toggle('listening', state === 'listening');
  btn.classList.toggle('done', state === 'done');
  const textEl = document.getElementById('btnReminderVoiceText');
  if (textEl) textEl.textContent = { idle: '点击说话', listening: '点击结束', done: '已识别', error: '再试' }[state] || '点击说话';
}
function reminderVoiceHandleResult(r) {
  if (r.error) {
    if (r.error === 'not-allowed' || r.error === 'service-not-allowed') {
      reminderVoiceSessionActive = false;
      setReminderVoiceBtnState('error');
      showToast('未获得麦克风权限，请点击「点击说话」并允许麦克风后重试', 'error');
    } else if (r.error === 'network') {
      reminderVoiceSessionActive = false;
      setReminderVoiceBtnState('error');
      showToast('语音识别网络不可用，可手动填写', 'error');
    } else if (r.error === 'no-speech') {
      // 没听到声音：保持监听状态即可
      if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening');
    } else if (r.error === 'aborted' || r.error === 'unsupported') {
      // 引擎启动失败/浏览器不支持：自动重试。
      // 第1次原样重试（Whisper 可能正在下载）；第2次起强制 WebSpeech（跳过 Whisper 反复初始化）；
      // 仍失败则明确引导手动填写保存（避免"语音识别失败→无法保存"的断链）。
      const wasActive = reminderVoiceSessionActive;
      reminderVoiceSessionActive = false;
      setReminderVoiceBtnState('error');
      const retryCount = window.__reminderVoiceRetryCount || 0;
      if (r.error === 'aborted' && wasActive && retryCount < 3) {
        window.__reminderVoiceRetryCount = retryCount + 1;
        const useOnline = retryCount >= 1; // 第2次起强制在线（跳过本地 Whisper）
        showToast(useOnline ? `语音引擎重试中（改用系统语音）…` : `语音引擎启动失败，正在重试…`, 'error');
        setTimeout(() => {
          if (!reminderVoiceSessionActive) {
            reminderVoiceSessionActive = true;
            setReminderVoiceBtnState('listening');
            // 强制在线模式：WebSpeech 系统语音（Whisper 连续失败的可靠兜底）
            VoiceSR.listen({ lang: reminderVoiceLang, continuous: true, forceOnline: useOnline }, reminderVoiceHandleResult);
          }
        }, 1500);
        return;
      }
      window.__reminderVoiceRetryCount = 0;
      showToast(r.error === 'unsupported' ? '当前浏览器不支持语音识别，可手动填写后保存' : '语音引擎启动失败，可手动填写后保存', 'error');
    } else if (reminderVoiceSessionActive) {
      if (reminderVoiceTimer) clearTimeout(reminderVoiceTimer);
      reminderVoiceTimer = setTimeout(() => { if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening'); }, 1200);
    }
    return;
  }
  if (r.final) {
    resetReminderIdleTimer(); // 有识别内容 → 重置超时
    // V4：mergeTranscript 去重合并（iOS 单次识别每轮重开可能重复返回同一句 final）
    reminderVoiceBuffer = (window.VoiceSR && VoiceSR.mergeTranscript) ? VoiceSR.mergeTranscript(reminderVoiceBuffer, r.final) : (reminderVoiceBuffer + ' ' + r.final).trim();
    applyReminderVoiceText(reminderVoiceBuffer);
    // 语音命令：检测整个累积 buffer（而非单段 final），宽松模式容忍 ASR 偏差：
    //   说"保存" → 停止录音后自动保存；说"完毕/结束/完成/好了"等 → 仅终止录音（事情已说完）
    const buf = reminderVoiceBuffer;
    const SAVE_RE = /(?:保\s*存|保存|存好|确定|确认|记好|存下|submit|save|guardar|guarda|guárdalo|confirma)/i;
    // 终结词：表示"说完了"。说完后 ~1s 内若说"保存"→立即保存；否则自动保存（不再要求手动点保存）。
    const DONE_RE = /(?:完\s*毕|完\s*成|结\s*束|完毕|完成|结束|好了|搞定|可以了|就这样|完事|说完了|关闭|关掉|close|cerrar|listo|finish|done|terminado|terminar)/i;
    // 用最后一段 final 与累积 buffer 都检测：单字终结词（"好了"/"行"/"关闭"）可能被识别成单独一段
    const hitSave = SAVE_RE.test(buf) || SAVE_RE.test(r.final);
    const hitDone = DONE_RE.test(buf) || DONE_RE.test(r.final);
    if (hitSave) {
      stopReminderVoice();
      if (reminderAutoSaveTimer) { clearTimeout(reminderAutoSaveTimer); reminderAutoSaveTimer = null; }
      // 延迟让最后一段 final 先写入表单再校验保存
      setTimeout(() => autoSaveReminderByVoice(), 600);
    } else if (hitDone) {
      stopReminderVoice();
      if (reminderAutoSaveTimer) { clearTimeout(reminderAutoSaveTimer); reminderAutoSaveTimer = null; }
      showToast('✔ 已识别完毕，即将自动保存…');
      speak(reminderVoiceLang === 'es-MX' ? 'Listo, guardando…' : reminderVoiceLang === 'en-US' ? 'Done, saving…' : '已识别完毕，即将保存');
      // ~1s 窗口：若此时说"保存"会走 hitSave 提前保存并取消此定时器；否则自动保存
      reminderAutoSaveTimer = setTimeout(() => { reminderAutoSaveTimer = null; autoSaveReminderByVoice(); }, 1000);
    }
  } else if (r.interim) {
    applyReminderVoiceText(reminderVoiceBuffer + ' ' + r.interim);
  }
  if (r.end && reminderVoiceSessionActive) {
    // 浏览器中断后自动续听（静默重启，不重播"请说"——避免连续识别时提示音吞话）
    if (reminderVoiceTimer) clearTimeout(reminderVoiceTimer);
    reminderVoiceTimer = setTimeout(() => {
      if (!reminderVoiceSessionActive) return;
      VoiceSR.stop(); // 彻底停旧实例（序列化竞态修复）
      if (VoiceSR.isListening()) return;
      reminderVoiceSessionActive = true;
      setReminderVoiceBtnState('listening');
      resetReminderIdleTimer();
      VoiceSR.listen({ lang: reminderVoiceLang, continuous: true }, reminderVoiceHandleResult);
    }, 600);
  }
}
// 语音"清空/删除 某字段里面的内容"命令：清空 事项/地点/备注/时间 等字段。
// 例："清空 地点里的内容、文字、数据" → 地点框清空；"清空 事项 框内数据" → 事项框清空。
// 命中后清空并重置该字段"已确认"标记，随后新语句（"事项 更换轮胎"）可重新填充。
function tryClearReminderField(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const CLEAR_RE = /(?:清空|清除|删除|删掉|删|去掉|清掉|擦除|擦掉|清|vaciar|borrar|eliminar|quitar)/i;
  if (!CLEAR_RE.test(t)) return false;
  // 特异性优先：地点/位置 > 事项 > 备注 > 时间/日期 > 提前；"内容/文字/数据"为泛化描述，缺省归事项
  let field = null;
  if (/(?:地点|位置|地方|哪里|在哪|location|lugar|ubicación|ubicacion|donde|dónde|dónde)/i.test(t)) field = 'location';
  else if (/(?:事项|事情|做什么|content|asunto|que hacer)/i.test(t)) field = 'content';
  else if (/(?:备注|附注|说明|note|nota|remark)/i.test(t)) field = 'note';
  else if (/(?:时间|日期|几点|提醒时间|time|fecha|hora|date)/i.test(t)) field = 'time';
  else if (/(?:提前|提早|advance)/i.test(t)) field = 'advance';
  else if (/(?:内容|文字|数据|信息|东西|值)/i.test(t)) field = 'content';
  if (!field) return false; // 没指明字段 → 不误清
  const idMap = { content: 'rContent', location: 'rLocation', note: 'rNote', time: 'rAt', advance: 'rAdvance' };
  const el = document.getElementById(idMap[field]);
  if (!el) return false;
  reminderFieldHistory.push({ field, oldValue: el.value }); // 可撤销
  if (reminderFieldHistory.length > 10) reminderFieldHistory.shift();
  el.value = '';
  reminderFieldConfirmed[field] = false; // 重置已确认 → 允许后续新值重新填充
  renderReminderVoicePreview();
  showToast('已清空' + reminderFieldLabel(field) + ' 🧹');
  if (window.speak) speak('已清空' + reminderFieldLabel(field));
  setReminderVoiceBtnState('done');
  setTimeout(() => { if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening'); }, 1100);
  return true;
}
// 语音选择"提醒方式"(语音播报/响铃/震动)：
//   "只要震动" → 只开震动、关其他；"关闭语音播报" → 关语音播报；"开启响铃" / "响铃" → 开响铃
function tryRemindModeByVoice(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const SPEAK = /(?:语音播报|语音朗读|语音|播报|朗读|voz|hablar|speak)/i;
  const RING = /(?:响铃|铃声|闹铃|ring|timbre|sonar)/i;
  const VIBRATE = /(?:震动|振动|vibrar|vibrate|vibra)/i;
  const has = { speak: SPEAK.test(t), ring: RING.test(t), vibrate: VIBRATE.test(t) };
  if (!(has.speak || has.ring || has.vibrate)) return false;
  const ONLY = /(?:只要|仅|只|只开|solo|sólo|only|solamente)/i;
  const OFF = /(?:不要|不用|无需|关掉|关闭|关|去掉|取消|no\b|off|quitar|desactivar|apagar)/i;
  const only = ONLY.test(t);
  const off = OFF.test(t);
  const set = (id, on) => { const el = document.getElementById(id); if (el) el.checked = on; };
  const changed = (id, on) => { const el = document.getElementById(id); return !!el && el.checked !== on; };
  let any = false;
  if (only) {
    // "只要 X" → 只开 X，其余关
    any |= changed('rModeSpeak', has.speak); set('rModeSpeak', has.speak);
    any |= changed('rModeRing', has.ring);    set('rModeRing', has.ring);
    any |= changed('rModeVibrate', has.vibrate); set('rModeVibrate', has.vibrate);
  } else if (off) {
    if (has.speak)   { any |= changed('rModeSpeak', false);   set('rModeSpeak', false); }
    if (has.ring)    { any |= changed('rModeRing', false);    set('rModeRing', false); }
    if (has.vibrate) { any |= changed('rModeVibrate', false); set('rModeVibrate', false); }
  } else {
    if (has.speak)   { any |= changed('rModeSpeak', true);    set('rModeSpeak', true); }
    if (has.ring)    { any |= changed('rModeRing', true);     set('rModeRing', true); }
    if (has.vibrate) { any |= changed('rModeVibrate', true);  set('rModeVibrate', true); }
  }
  const modeDesc = (only ? '仅 ' : '') + [has.speak && '语音播报', has.ring && '响铃', has.vibrate && '震动'].filter(Boolean).join('、');
  renderReminderVoicePreview();
  if (any) {
    showToast('✔ 提醒方式已设为：' + (off ? '已关闭' : modeDesc));
    speak(off ? '已关闭提醒方式' : ('提醒方式已设为：' + modeDesc));
  }
  setReminderVoiceBtnState('done');
  setTimeout(() => { if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening'); }, 1100);
  return true; // 命中方式关键词 → 当作命令消费，不落入内容解析
}
// 应用语音解析结果到提醒表单
function applyReminderVoiceText(buffer) {
  // 0.5) 语音"清空某字段"命令：最高优先级，命中即清空该字段并重开聆听
  if (tryClearReminderField(String(buffer || ''))) { reminderVoiceBuffer = ''; return; }
  // 0.6) 语音选择"提醒方式"(语音播报/响铃/震动)
  if (tryRemindModeByVoice(String(buffer || ''))) { reminderVoiceBuffer = ''; return; }
  // 0) 说错改口（V3 Correction Engine）："不是明天是后天" / "不是办公室是银行" / "撤销"
  if (window.CorrectionEngine) {
    const corr = CorrectionEngine.parse(buffer);
    if (corr && corr.matched) {
      if (corr.action === 'undo') {
        if (reminderFieldHistory.length) {
          const last = reminderFieldHistory.pop();
          restoreReminderField(last.field, last.oldValue);
          reminderFieldConfirmed[last.field] = false; // 撤销 → 字段回到可更新状态
          renderReminderVoicePreview();
          showToast('已撤销' + reminderFieldLabel(last.field) + ' ↩️');
        } else {
          showToast('没有可撤销的字段', 'error');
        }
        setReminderVoiceBtnState('done');
        setTimeout(() => { if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening'); }, 1100);
        return;
      }
      if (corr.action === 'ask') {
        const f = corr.field;
        showToast('请说' + reminderFieldLabel(f)); speak('请说' + reminderFieldLabel(f));
        setReminderVoiceBtnState('done');
        setTimeout(() => { if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening'); }, 1100);
        return;
      }
      // update：覆盖字段（日期/时间/地点/事项/备注）
      const label = reminderFieldLabel(corr.field);
      let ok = false;
      if (corr.field === 'time' || corr.field === 'date' || corr.field === 'advance') {
        // 时间/日期/提前：交给 ReminderParser 从"新值"解析
        const sub = ReminderParser.parse(corr.value);
        if (corr.field === 'time' && sub.datetime) { writeReminderField('rAt', sub.datetime); reminderFieldConfirmed.time = true; ok = true; }
        else if (corr.field === 'date' && sub.datetime) { writeReminderField('rAt', sub.datetime); reminderFieldConfirmed.time = true; ok = true; }
        else if (corr.field === 'advance' && sub.advance_minutes) { writeReminderField('rAdvance', String(sub.advance_minutes)); reminderFieldConfirmed.advance = true; ok = true; }
        else { writeReminderField(corr.field === 'time' ? 'rAt' : corr.field === 'advance' ? 'rAdvance' : 'rAt', corr.value); reminderFieldConfirmed.time = true; ok = true; }
      } else if (corr.field === 'location') {
        writeReminderField('rLocation', corr.value); reminderFieldConfirmed.location = true; ok = true;
      } else if (corr.field === 'content') {
        writeReminderField('rContent', corr.value); reminderFieldConfirmed.content = true; ok = true;
      } else if (corr.field === 'note') {
        writeReminderField('rNote', corr.value); reminderFieldConfirmed.note = true; ok = true;
      }
      renderReminderVoicePreview();
      showToast(ok ? ('✔ ' + label + '已改为 ' + corr.value) : label + '未识别', ok ? undefined : 'error');
      if (ok) speak(label + '改为' + corr.value);
      setReminderVoiceBtnState('done');
      reminderVoiceBuffer = ''; // 改口后不再整体重解析
      setTimeout(() => { if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening'); }, 1100);
      return;
    }
  }

  // 语音终结词（保存/完毕/完成/结束/好了/搞定 等）表示"说完了"，不进入任何字段
  const FINAL_RE = /(?:保存|完毕|完成|结束|好了|搞定|可以了|就这样|保存提醒|确定|存好|submit|save|finish|done|listo|guardar)\s*[:：]?/gi;
  const clean = String(buffer || '').replace(FINAL_RE, ' ').replace(/\s+/g, ' ').trim();
  const parsed = ReminderParser.parse(clean);
  const filled = [];
  // V4.5 字段保护：已确认字段不被后续新段覆盖（除非改口分支）
  const skipField = (field, newVal) => {
    if (!reminderFieldConfirmed[field]) return false;
    const cur = readReminderField(field === 'time' || field === 'date' ? 'rAt' : field === 'location' ? 'rLocation' : field === 'content' ? 'rContent' : field === 'advance' ? 'rAdvance' : field === 'note' ? 'rNote' : null);
    if (cur && String(cur) === String(newVal)) return false;
    return true;
  };
  if (parsed.datetime && !skipField('time', parsed.datetime)) { writeReminderField('rAt', parsed.datetime); filled.push('时间'); }
  if (parsed.location && !skipField('location', parsed.location)) { writeReminderField('rLocation', parsed.location); filled.push('地点'); }
  if (parsed.content && !skipField('content', parsed.content)) { writeReminderField('rContent', parsed.content); filled.push('事项'); }
  if (parsed.advance_minutes && !skipField('advance', parsed.advance_minutes)) { writeReminderField('rAdvance', String(parsed.advance_minutes)); filled.push('提前'); }
  if (parsed.note && !skipField('note', parsed.note)) { writeReminderField('rNote', parsed.note); filled.push('备注'); }
  if (parsed.repeat && parsed.repeat !== 'none') {
    const rp = document.getElementById('rRepeat');
    if (rp && [...rp.options].some(o => o.value === parsed.repeat)) { rp.value = parsed.repeat; filled.push('重复'); }
    if (typeof syncRepeatDayUI === 'function') syncRepeatDayUI();
  }
  setRemindModeUI(parsed.method === 'manual' ? 'manual' : 'voice'); // 语音说"手动"→仅响铃；默认全开
  renderReminderVoicePreview();
  setReminderVoiceBtnState('done');
  if (reminderVoiceLang === 'es-MX') showToast(filled.length ? '✔ Reconocido: ' + filled.join(', ') : 'Texto reconocido, di la hora');
  else if (reminderVoiceLang === 'en-US') showToast(filled.length ? '✔ Recognized: ' + filled.join(', ') : 'Text recognized, say the time');
  else showToast(filled.length ? '✔ 已识别：' + filled.join('、') : '已识别文本，请说时间');
  setTimeout(() => { if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening'); }, 1100);
}

// 提醒字段历史（说错改口"撤销"用）
let reminderFieldHistory = [];
function reminderFieldLabel(field) {
  const map = { time: '时间', date: '日期', location: '地点', content: '事项', advance: '提前', note: '备注', repeat: '重复' };
  return map[field] || field;
}
// 提醒时间框是 <input type=datetime-local>，只接受 "YYYY-MM-DDTHH:MM"。
// 数据库存的是 "YYYY-MM-DD HH:MM"(空格)；回填时若原样写入会因非 ISO 而显示成 □□□/乱码。
// 统一在此归一化；无法解析 → ''(清空，提示用户重选)。
function normalizeRemindAt(val) {
  const v = String(val || '').trim();
  if (!v) return '';
  const p2 = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
  const dateStr = (v.split(/[T ]/)[0] || '').trim();
  let y = 0, m = 0, d = 0;
  let mm = dateStr.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else {
    mm = dateStr.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (mm) { d = +mm[1]; m = +mm[2]; y = +mm[3]; if (m > 12 && d <= 12) { const t = d; d = m; m = t; } if (y < 100) y += 2000; }
  }
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  let hh = 0, mi = 0, hasT = false;
  let tm = v.match(/(\d{1,2}):(\d{2})/);
  if (tm && +tm[1] <= 23 && +tm[2] <= 59) { hh = +tm[1]; mi = +tm[2]; hasT = true; }
  if (!hasT) {
    tm = v.match(/(\d{1,2})[点时:：](\d{1,2})/);
    if (tm && +tm[1] <= 23 && +tm[2] <= 59) { hh = +tm[1]; mi = +tm[2]; hasT = true; }
  }
  return `${iso(y, m, d)}T${p2(hasT ? hh : 0)}:${p2(hasT ? mi : 0)}`;
}
function readReminderField(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function writeReminderField(id, value, pushHistory) {
  if (id === 'rAt') value = normalizeRemindAt(value); // 保证 datetime-local 写入合法 ISO(T) 值
  if (pushHistory !== false) {
    const fieldName = id === 'rAt' ? 'time' : id === 'rLocation' ? 'location' : id === 'rContent' ? 'content' : id === 'rAdvance' ? 'advance' : id === 'rNote' ? 'note' : id;
    reminderFieldHistory.push({ field: fieldName, oldValue: readReminderField(id) });
    if (reminderFieldHistory.length > 10) reminderFieldHistory.shift();
  }
  const el = document.getElementById(id);
  if (el) el.value = value;
}
function restoreReminderField(field, oldValue) {
  const id = field === 'time' || field === 'date' ? 'rAt' : field === 'location' ? 'rLocation' : field === 'content' ? 'rContent' : field === 'advance' ? 'rAdvance' : field === 'note' ? 'rNote' : null;
  if (id) writeReminderField(id, oldValue, false);
}

// 语音"保存"命令触发自动保存：内容/时间齐全直接保存；时间缺失自动兜底当前+1小时；内容缺失才引导补充
async function autoSaveReminderByVoice() {
  // 防重入（连续两个终结词片段）
  if (window._autoSavingReminder) return;
  window._autoSavingReminder = true;
  try {
    const content = document.getElementById('rContent').value.trim();
    let rAt = document.getElementById('rAt').value;
    if (!content) {
      showToast('请说出提醒事项（如：明天九点 在办公室 开会）', 'error');
      restartReminderVoiceAfterSaveFail();
      return;
    }
    // 时间缺失 → 自动兜底：当前时间 +1 小时（用户说"保存"即表示现在要设提醒）
    if (!rAt) {
      const d = new Date();
      d.setHours(d.getHours() + 1);
      const p = (n) => String(n).padStart(2, '0');
      rAt = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
      document.getElementById('rAt').value = rAt;
      showToast('未识别到时间，已设为 1 小时后（可在表单修改）');
    }
    // 保存（saveReminder 内部会关闭弹窗 + 停止语音）
    await saveReminder();
  } finally {
    setTimeout(() => { window._autoSavingReminder = false; }, 1500);
  }
}
// 语音保存失败后 1.2s 自动重启会话，让用户直接补充缺失字段
function restartReminderVoiceAfterSaveFail() {
  setTimeout(() => {
    if (!reminderVoiceSessionActive) {
      reminderVoiceSessionActive = true;
      setReminderVoiceBtnState('listening');
      VoiceSR.listen({ lang: reminderVoiceLang, continuous: true }, reminderVoiceHandleResult);
    }
  }, 1200);
}
function renderReminderVoicePreview() {
  const box = document.getElementById('reminderVoicePreview');
  if (!box) return;
  const content = document.getElementById('rContent').value.trim();
  const rAt = document.getElementById('rAt').value;
  const loc = document.getElementById('rLocation').value.trim();
  const chips = [];
  if (content) chips.push(`📝 ${escapeHtml(content)}`);
  if (rAt) chips.push(`⏰ ${escapeHtml(rAt.replace('T', ' '))}`);
  if (loc) chips.push(`📍 ${escapeHtml(loc)}`);
  box.innerHTML = chips.length
    ? chips.map(c => `<span class="voice-chip">${c}</span>`).join('')
    : `<span class="voice-chip muted">说：明天早上九点 在办公室 开会</span>`;
}

// 到期提醒检测 + 通知
let reminderCheckTimer = null;
let notifiedReminderIds = new Set(); // 已弹出过的提醒，避免重复打扰
async function checkRemindersDue() {
  try {
    const data = await api('/reminders/due');
    if (data.reminders && data.reminders.length) {
      // 多条到期时：弹第一条，其余用 toast 提示（修复：原实现只弹第一条，其余被静默标完成丢失）
      const r = data.reminders[0];
      // 已经通知过的提醒不再重复弹窗/播报（直到被标记完成或修改）
      if (notifiedReminderIds.has(r.id)) return;
      notifiedReminderIds.add(r.id);
      currentNotifyReminder = r.id;
      const msg = document.getElementById('remindNotifyMsg');
      if (msg) {
        const adv = Number(r.advance_minutes) || 0;
        msg.innerHTML = `
          <div class="remind-notify-icon">⏰</div>
          <div class="remind-notify-content">${escapeHtml(r.content)}</div>
          ${r.location ? `<div class="remind-notify-loc">📍 ${escapeHtml(r.location)}</div>` : ''}
          <div class="remind-notify-at">${escapeHtml((r.remind_at || '').replace('T', ' '))}</div>
          ${adv ? `<div class="remind-notify-adv">已提前 ${adv >= 1440 && adv % 1440 === 0 ? adv / 1440 + '天' : adv >= 60 ? adv / 60 + '小时' : adv + '分钟'} 提醒</div>` : ''}
        `;
      }
      openModal('reminderNotifyModal');
      // 提醒方式：三开关（语音播报/响铃/震动），兼容旧值 voice（全开）/ manual（仅响铃+震动，隐私）
      const mode = parseRemindMode(r.remind_method);
      // 渐进式重响（10/20/30 分钟）：按提醒方式传递震动开关
      scheduleAlarmRetries(mode.vibrate);
      // 其余到期提醒：toast 提示，避免静默丢失
      if (data.reminders.length > 1) {
        const others = data.reminders.slice(1).map(x => x.content).filter(Boolean).join('、');
        if (others) setTimeout(() => showToast('还有 ' + (data.reminders.length - 1) + ' 条到期提醒：' + others), 600);
      }
      // 功能补充 P3：系统级桌面通知（页面在后台也能看到）
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          const n = new Notification('⏰ ' + r.content, {
            body: (r.location ? '📍 ' + r.location + '\n' : '') + '时间: ' + (r.remind_at || '').replace('T', ' ') + (adv ? `（提前${adv >= 1440 && adv % 1440 === 0 ? adv / 1440 + '天' : adv >= 60 ? adv / 60 + '小时' : adv + '分钟'}）` : ''),
            tag: 'reminder-' + r.id,
          });
          n.onclick = () => { window.focus(); closeModal('reminderNotifyModal'); };
        }
      } catch (e) { /* 通知失败不影响 */ }
      // TTS 语音播报：按提醒方式执行
      const ttsText = `${r.content}${r.location ? '，地点' + r.location : ''}，时间到了`;
      // 震动：立即 + 循环（与响铃节奏同步，由 stopAlarm 统一停止）
      if (mode.vibrate) {
        try {
          if (navigator.vibrate) navigator.vibrate([1000, 500, 1000, 500, 1000]);
        } catch (e) { /* iOS 不支持 vibrate 忽略 */ }
      }
      if (mode.speak) {
        // 语音播报：播完后启动持续响铃（若开启）
        speak(ttsText, () => {
          const ov = document.getElementById('reminderNotifyModal');
          if (ov && ov.classList.contains('active') && currentNotifyReminder) {
            if (mode.ring) startAlarm(0, { vibrate: mode.vibrate });
            else if (mode.vibrate) { try { if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]); } catch (e) {} }
          }
        });
      } else if (mode.ring) {
        // 仅响铃（不播报内容，隐私）：稍后直接持续响铃
        setTimeout(() => {
          const ov = document.getElementById('reminderNotifyModal');
          if (ov && ov.classList.contains('active') && currentNotifyReminder) {
            startAlarm(0, { vibrate: mode.vibrate });
          }
        }, 800);
      } else {
        // 仅震动/仅卡片：单独循环震动（响铃关闭时）
        if (mode.vibrate) {
          try {
            if (navigator.vibrate) {
              window.__reminderVibrateTimer = setInterval(() => { try { navigator.vibrate([1000, 500, 1000]); } catch (e) {} }, 3000);
            }
          } catch (e) { /* ignore */ }
        }
      }
    }
  } catch (e) { /* 静默失败，不影响其他功能 */ }
}
function startReminderChecker() {
  if (reminderCheckTimer) clearInterval(reminderCheckTimer);
  // 功能补充 P3：请求系统通知权限
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (e) { /* ignore */ }
  // 首次立即检查 + 每 15 秒检查一次（更准时；30s 曾导致最多 30 秒延迟）
  checkRemindersDue();
  reminderCheckTimer = setInterval(checkRemindersDue, 15000);
  // iOS 后台会挂起定时器：页面切回前台立即补查一次，避免"该提醒却没弹"
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkRemindersDue();
  });
  // 页面刚加载完成（含从后台唤醒）也检查
  window.addEventListener('focus', () => checkRemindersDue());
}

  // ===== 显式暴露全局函数名（HTML onclick + JS 生成的 onclick 需要） =====
  // ================== 个人语音学习管理（PvM 设置页） ==================
  const pvmTypeLabel = { PERSON: '人', COMPANY: '公司', BANK: '银行', MERCHANT: '商户', SUPPLIER: '供应商', CUSTOMER: '客户', LOCATION: '地点', PRODUCT: '商品', SERVICE: '服务', ACCOUNT: '账户', CATEGORY: '分类', PROJECT: '项目', TAG: '标签', OTHER: '其他' };
  async function pvmList() {
    const pvm = window.PersonalVoiceMemory;
    const box = document.getElementById('pvmListBox');
    if (!pvm || !box) return;
    const list = await pvm.list();
    if (!list.length) { box.innerHTML = '<div class="settings-sub">暂无记忆。用语音记账/提醒并纠正识别结果，系统会自动学习。</div>'; return; }
    box.innerHTML = '<div class="settings-sub" style="margin-bottom:4px">共 ' + list.length + ' 条</div>' +
      list.slice(0, 200).map(e =>
        `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #f0f0f0">
          <span style="flex:0 0 40px;opacity:.7">${pvmTypeLabel[e.type] || e.type}</span>
          <span style="flex:1">“${escapeHtml(e.phrase)}” → <b>${escapeHtml(e.target)}</b></span>
          <span style="opacity:.6;font-size:11px">${pvm.memoryStrength ? pvm.memoryStrength(e) : ''} ${Math.round((e.confidence || 0) * 100)}%${pvm.memoryScore ? ' · 分' + Math.round((pvm.memoryScore(e) || 0) * 100) : ''}</span>
          <button class="btn-small" onclick="pvmRemove('${e.id.replace(/'/g, '')}')">✕</button>
        </div>`).join('');
  }
  // 学习日志（Learning Engine）：展示最近学习事件
  async function pvmLog() {
    const box = document.getElementById('pvmListBox');
    if (!box) { showToast('请先打开设置页', 'error'); return; }
    if (!window.LearningEngine || typeof window.LearningEngine.list !== 'function') { box.innerHTML = '<div class="settings-sub">学习引擎未加载。</div>'; return; }
    const logs = window.LearningEngine.list();
    if (!logs.length) { box.innerHTML = '<div class="settings-sub">暂无学习日志。识别后被纠正/确认的内容会记录在这里。</div>'; return; }
    const levelLabel = { none: '未学习', short: '短期', personal: '个人', stable: '稳定' };
    box.innerHTML = '<div class="settings-sub" style="margin-bottom:4px">共 ' + logs.length + ' 条学习记录</div>' +
      logs.slice(0, 100).map(ev =>
        `<div style="padding:4px 0;border-bottom:1px solid #f0f0f0;font-size:12px">
          <div><b>“${escapeHtml(ev.input)}”</b> → ${escapeHtml(ev.target)} <span style="opacity:.6">${ev.field || ''}${ev.context ? ' · ' + ev.context : ''}</span></div>
          <div style="opacity:.65;font-size:11px">次数 ${ev.count} · 确认 ${ev.confirmed} · 拒绝 ${ev.rejected} · 得分 ${ev.score}（${levelLabel[window.LearningEngine.scoreLevel(ev.score)] || ''}）${ev.conflict ? ' · ⚠️ 冲突' : ''}</div>
        </div>`).join('');
  }
  async function pvmRemove(id) {
    const pvm = window.PersonalVoiceMemory;
    if (!pvm) return;
    await pvm.remove(id);
    showToast('已删除该条记忆 🗑️');
    pvmList();
  }
  async function pvmClear() {
    const pvm = window.PersonalVoiceMemory;
    if (!pvm) return;
    if (!confirm('确定清除全部个人语音记忆？此操作不可恢复。')) return;
    await pvm.clearAll();
    const box = document.getElementById('pvmListBox');
    if (box) box.innerHTML = '<div class="settings-sub">已清空。</div>';
    showToast('已清空全部语音记忆 🗑️');
  }
  async function pvmExport() {
    const pvm = window.PersonalVoiceMemory;
    if (!pvm) return;
    const json = await pvm.exportJSON();
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'voice-memory-' + todayLocal() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      showToast('已导出语音记忆 📤');
    } catch (e) {
      // iOS 不支持 download 时回退：弹出文本供复制
      prompt('复制以下 JSON（换手机时导入）：', json);
    }
  }
  async function pvmImport(input) {
    const pvm = window.PersonalVoiceMemory;
    if (!pvm || !input || !input.files || !input.files[0]) return;
    try {
      const text = await input.files[0].text();
      const r = await pvm.importJSON(text);
      showToast(r.ok ? `已导入 ${r.count} 条记忆 📥` : '导入失败：' + r.msg, r.ok ? undefined : 'error');
      if (r.ok) pvmList();
    } catch (e) {
      showToast('导入失败：' + e.message, 'error');
    }
    input.value = '';
  }

  Object.assign(global, {
    ReminderParser, normalizeRemindAt, tryClearReminderField, tryRemindModeByVoice,
    renderReminders, syncRepeatDayUI, openReminderModal, editReminder, saveReminder, deleteReminder,
    markReminderDone, snoozeReminder, dismissReminderNotify, switchReminderVoiceLang, syncReminderVoiceLangUI, getReminderVoiceLangMeta,
    toggleReminderVoice, startReminderVoice, stopReminderVoice, setReminderVoiceBtnState, reminderVoiceHandleResult,
    applyReminderVoiceText, autoSaveReminderByVoice, renderReminderVoicePreview, checkRemindersDue, startReminderChecker,
    pvmList, pvmLog, pvmRemove, pvmClear, pvmExport, pvmImport,
    // 只读状态访问器（quick-voice 需判断提醒语音会话是否活跃，避免双识别器冲突）
    isReminderVoiceActive: () => reminderVoiceSessionActive,
  });
})(typeof window !== 'undefined' ? window : globalThis);
