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
let currentNotifyReminder = null;

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
    const method = r.remind_method === 'voice' ? '<span class="reminder-tag voice">🎙️ 语音</span>' : '<span class="reminder-tag">✍️ 手动</span>';
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

// 打开提醒弹窗（mode='voice' 时打开后自动开始语音监听）
function openReminderModal(mode) {
  editingReminderId = null;
  document.getElementById('rContent').value = '';
  document.getElementById('rLocation').value = '';
  document.getElementById('rNote').value = '';
  document.getElementById('rAt').value = '';
  document.getElementById('rMethod').value = 'manual';
  document.getElementById('rAdvance').value = '0';
  document.getElementById('rRepeat').value = 'none';
  document.getElementById('rLinkType').value = '';
  syncRepeatDayUI();
  document.getElementById('btnSaveReminder').textContent = '保存提醒';
  renderReminderVoicePreview();
  openModal('reminderModal');
  // 语音添加提醒：打开弹窗后自动开始监听（无需再点话筒）
  if (mode === 'voice') {
    setTimeout(() => {
      if (!VoiceSR.supported) return showToast('当前浏览器不支持语音识别，可手动填写', 'error');
      if (!reminderVoiceSessionActive) startReminderVoice();
    }, 350);
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
  document.getElementById('rAt').value = r.remind_at ? r.remind_at.slice(0, 16) : '';
  document.getElementById('rMethod').value = r.remind_method || 'manual';
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
  const method = document.getElementById('rMethod').value;
  const advance = Number(document.getElementById('rAdvance').value) || 0;
  const note = document.getElementById('rNote').value.trim();
  const repeat = document.getElementById('rRepeat').value || 'none';
  const repeatDay = repeat === 'none' ? 0 : Number(document.getElementById('rRepeatDay').value) || 0;
  const linkType = document.getElementById('rLinkType').value || '';
  if (!content) return showToast('请填写提醒事项', 'error');
  if (!rAt) return showToast('请设置提醒时间', 'error');
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
  setReminderVoiceBtnState('listening');
  reminderVoiceSessionActive = true;
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
  VoiceSR.stop();
  setReminderVoiceBtnState('idle');
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
    reminderVoiceBuffer = (reminderVoiceBuffer + ' ' + r.final).trim();
    applyReminderVoiceText(reminderVoiceBuffer);
    // 语音命令：检测整个累积 buffer（而非单段 final），宽松模式容忍 ASR 偏差：
    //   说"保存" → 停止录音后自动保存；说"完毕/结束/完成/好了"等 → 仅终止录音（事情已说完）
    const buf = reminderVoiceBuffer;
    const SAVE_RE = /(?:保\s*存|保存|存好|确定|确认|记好|存下|submit|save|guardar|guarda|guárdalo|confirma)/i;
    const DONE_RE = /(?:完\s*毕|完\s*成|结\s*束|完毕|完成|结束|好了|搞定|可以了|就这样|完事|说完了|listo|finish|done|terminado|terminar)/i;
    // 用最后一段 final 与累积 buffer 都检测：单字终结词（"好了"/"行"）可能被识别成单独一段
    const hitSave = SAVE_RE.test(buf) || SAVE_RE.test(r.final);
    const hitDone = DONE_RE.test(buf) || DONE_RE.test(r.final);
    if (hitSave) {
      stopReminderVoice();
      // 延迟让最后一段 final 先写入表单再校验保存
      setTimeout(() => autoSaveReminderByVoice(), 600);
    } else if (hitDone) {
      stopReminderVoice();
      showToast('✔ 已停止录音，检查后点「保存提醒」即可');
    }
  } else if (r.interim) {
    applyReminderVoiceText(reminderVoiceBuffer + ' ' + r.interim);
  }
  if (r.end && reminderVoiceSessionActive) {
    // 浏览器中断后自动续听
    if (reminderVoiceTimer) clearTimeout(reminderVoiceTimer);
    reminderVoiceTimer = setTimeout(() => {
      if (reminderVoiceSessionActive && !VoiceSR.isListening()) startReminderVoice();
    }, 800);
  }
}
// 应用语音解析结果到提醒表单
function applyReminderVoiceText(buffer) {
  // 语音终结词（保存/完毕/完成/结束/好了/搞定 等）表示"说完了"，不进入任何字段
  const FINAL_RE = /(?:保存|完毕|完成|结束|好了|搞定|可以了|就这样|保存提醒|确定|存好|submit|save|finish|done|listo|guardar)\s*[:：]?/gi;
  const clean = String(buffer || '').replace(FINAL_RE, ' ').replace(/\s+/g, ' ').trim();
  const parsed = ReminderParser.parse(clean);
  const filled = [];
  if (parsed.datetime) { document.getElementById('rAt').value = parsed.datetime; filled.push('时间'); }
  if (parsed.location) { document.getElementById('rLocation').value = parsed.location; filled.push('地点'); }
  if (parsed.content) { document.getElementById('rContent').value = parsed.content; filled.push('事项'); }
  if (parsed.advance_minutes) { document.getElementById('rAdvance').value = String(parsed.advance_minutes); filled.push('提前'); }
  if (parsed.note) { document.getElementById('rNote').value = parsed.note; filled.push('备注'); }
  if (parsed.repeat && parsed.repeat !== 'none') {
    const rp = document.getElementById('rRepeat');
    if (rp && [...rp.options].some(o => o.value === parsed.repeat)) { rp.value = parsed.repeat; filled.push('重复'); }
    if (typeof syncRepeatDayUI === 'function') syncRepeatDayUI();
  }
  document.getElementById('rMethod').value = parsed.method || 'voice';
  renderReminderVoicePreview();
  setReminderVoiceBtnState('done');
  if (reminderVoiceLang === 'es-MX') showToast(filled.length ? '✔ Reconocido: ' + filled.join(', ') : 'Texto reconocido, di la hora');
  else if (reminderVoiceLang === 'en-US') showToast(filled.length ? '✔ Recognized: ' + filled.join(', ') : 'Text recognized, say the time');
  else showToast(filled.length ? '✔ 已识别：' + filled.join('、') : '已识别文本，请说时间');
  setTimeout(() => { if (reminderVoiceSessionActive) setReminderVoiceBtnState('listening'); }, 1100);
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
      // 先语音播报，播报完成后启动持续闹铃（用户要求：语音提示完成后必须有铃声，持续直到手动取消/确认）
      scheduleAlarmRetries();
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
      // TTS 语音播报：仅"语音自动"提醒播报内容（隐私保护：手动提醒不播报内容，只响铃+卡片）
      // 播完（约数秒）后启动持续闹铃
      const ttsText = `${r.content}${r.location ? '，地点' + r.location : ''}，时间到了`;
      const doSpeak = String(r.remind_method || 'manual') !== 'manual';
      if (doSpeak) {
        speak(ttsText, () => {
          const ov = document.getElementById('reminderNotifyModal');
          if (ov && ov.classList.contains('active') && currentNotifyReminder) {
            startAlarm();
          }
        });
      } else {
        // 手动提醒：不播报内容（隐私），稍后直接持续响铃
        setTimeout(() => {
          const ov = document.getElementById('reminderNotifyModal');
          if (ov && ov.classList.contains('active') && currentNotifyReminder) {
            startAlarm();
          }
        }, 800);
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
  Object.assign(global, {
    ReminderParser,
    renderReminders, syncRepeatDayUI, openReminderModal, editReminder, saveReminder, deleteReminder,
    markReminderDone, snoozeReminder, dismissReminderNotify, switchReminderVoiceLang, syncReminderVoiceLangUI, getReminderVoiceLangMeta,
    toggleReminderVoice, startReminderVoice, stopReminderVoice, setReminderVoiceBtnState, reminderVoiceHandleResult,
    applyReminderVoiceText, autoSaveReminderByVoice, renderReminderVoicePreview, checkRemindersDue, startReminderChecker,
    // 只读状态访问器（quick-voice 需判断提醒语音会话是否活跃，避免双识别器冲突）
    isReminderVoiceActive: () => reminderVoiceSessionActive,
  });
})(typeof window !== 'undefined' ? window : globalThis);
