'use strict';
/**
 * WeatherReminderEngine —— 天气提醒（§13-§16, §20）
 *
 * - 提前提醒：RainEvent.start - advanceMinutes 时提醒
 * - 防重复：WeatherNotificationLedger（eventId + forecastVersion + type + sentAt）
 * - 复用现有 Reminder 输出通道：speak(TTS) / showToast / Notification
 * - 提醒文案：简短自然，有时间/强度/持续（§14/§15）
 * - iOS PWA 无后台常驻：仅前台触发时评估（§32），诚实不做后台承诺
 */
(function (global) {
  const LS_KEY = 'sm_weather_ledger';
  let ledger = null;

  function loadLedger() {
    if (ledger) return ledger;
    try {
      const raw = global.localStorage && global.localStorage.getItem(LS_KEY);
      ledger = raw ? JSON.parse(raw) : [];
    } catch (e) { ledger = []; }
    return ledger;
  }
  function saveLedger() {
    try { global.localStorage && global.localStorage.setItem(LS_KEY, JSON.stringify(ledger)); } catch (e) { /* ignore */ }
  }
  /** 清理 48h 前旧记录，防无限增长 */
  function pruneLedger() {
    const cutoff = Date.now() - 48 * 3600 * 1000;
    ledger = (ledger || []).filter(r => !r.sentAt || r.sentAt > cutoff);
  }
  function alreadySent(eventId, forecastVersion, type) {
    const l = loadLedger();
    return l.some(r => r.eventId === eventId && r.forecastVersion === forecastVersion && r.type === type);
  }
  function markSent(eventId, forecastVersion, type) {
    const l = loadLedger();
    pruneLedger();
    l.push({ eventId, forecastVersion, type, sentAt: Date.now() });
    ledger = l;
    saveLedger();
  }

  /** 输出通道（可注入，便于测试与替换） */
  function defaultSink() {
    const g = global;
    return {
      speak: (typeof g.speak === 'function') ? g.speak : null,
      toast: (typeof g.showToast === 'function') ? g.showToast : null,
      notify: (typeof g.Notification !== 'undefined' && g.Notification.permission === 'granted')
        ? (title, body) => { try { new g.Notification(title, { body }); } catch (e) { /* ignore */ } }
        : null,
    };
  }

  /** 自然语言时间（"下午 4 点"，多语言） */
  function naturalTime(iso, lang) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const h = d.getHours();
    const m = d.getMinutes();
    const mm = m ? ':' + String(m).padStart(2, '0') : '';
    if (lang === 'zh' || !lang) {
      const part = h < 6 ? '凌晨' : h < 12 ? '上午' : h < 18 ? '下午' : '晚上';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${part}${h12}点${mm}`;
    }
    if (lang === 'es') return `${h}:${String(m).padStart(2, '0')}`;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }

  /** 生成降雨提醒文案（§14） */
  function rainMessage(ev, lang) {
    const met = ev.metrics || {};
    const t = lang === 'es' ? 'lluvia' : lang === 'en' ? 'rain' : '降雨';
    const start = naturalTime(ev.startTime, lang);
    const peak = naturalTime(ev.peakTime, lang);
    const hrs = Math.max(1, Math.round((ev.durationMinutes || 60) / 60));
    const mm = met.peakRate != null ? met.peakRate : met.precipitationSum;
    const cm = lang === 'es' ? `≈${met.precipitationSum} mm` : lang === 'en' ? `≈${met.precipitationSum} mm` : `累计约 ${met.precipitationSum} 毫米`;
    if (lang === 'es') return `Alerta: ${t} desde ${start}, más fuerte ${peak}, durará unas ${hrs} horas.`;
    if (lang === 'en') return `Weather: rain from ${start}, heaviest ${peak}, lasting ~${hrs}h (${cm}).`;
    return `天气提醒：预计${start}开始下雨，${peak}左右雨势最强，预计持续约${hrs}小时（${cm}）。`;
  }

  /** 生成大风提醒文案（§15） */
  function windMessage(ev, lang) {
    const met = ev.metrics || {};
    const start = naturalTime(ev.startTime, lang);
    const peak = naturalTime(ev.peakTime, lang);
    const hrs = Math.max(1, Math.round((ev.durationMinutes || 60) / 60));
    const gust = met.maxWindGust || met.maxWindSpeed || 0;
    const unit = lang === 'es' ? 'km/h' : lang === 'en' ? 'km/h' : '公里每小时';
    if (lang === 'es') return `Alerta: viento fuerte desde ${start}, máximo ${peak}, ráfagas hasta ${gust} ${unit}, durará ~${hrs}h.`;
    if (lang === 'en') return `Weather: strong wind from ${start}, peak ${peak}, gusts up to ${gust} ${unit}, lasting ~${hrs}h.`;
    return `天气提醒：预计${start}风力增强，${peak}左右最强，最大阵风约 ${gust} ${unit}，预计持续约${hrs}小时。`;
  }

  /**
   * 评估并触发提醒（Service 在刷新后调用）
   * @param {Array<Object>} events 事件列表（RainEvent/WindEvent）
   * @param {Object} opts { lang, forecastVersion, now, sink }
   */
  function evaluate(events, opts) {
    const o = opts || {};
    const now = o.now ? new Date(o.now) : new Date();
    const lang = o.lang || 'zh';
    const ver = o.forecastVersion || 'v1';
    const sink = o.sink || defaultSink();
    const cfg = global.WeatherKit.WeatherConfig;
    const rem = cfg ? cfg.getReminder() : { rainEnabled: true, windEnabled: true, rainAdvanceMin: 30, windAdvanceMin: 30 };
    const fired = [];

    for (const ev of (events || [])) {
      const t = ev.type;
      if (t === 'rain' && !rem.rainEnabled) continue;
      if (t === 'wind' && !rem.windEnabled) continue;
      // 只提醒"未来"事件（开始时间在 now 之后）
      const start = new Date(ev.startTime);
      if (isNaN(start.getTime()) || start <= now) continue;
      const advance = t === 'rain' ? (rem.rainAdvanceMin || 30) : (rem.windAdvanceMin || 30);
      const dueAt = start.getTime() - advance * 60000;
      // 触发窗口：dueAt 已到（或已过 5 分钟内），且事件尚未开始
      if (now.getTime() >= dueAt && now.getTime() < start.getTime()) {
        const msg = t === 'rain' ? rainMessage(ev, lang) : windMessage(ev, lang);
        const type = t + '_advance';
        if (!alreadySent(ev.id, ver, type)) {
          markSent(ev.id, ver, type);
          if (sink.toast) { try { sink.toast(msg, 'weather'); } catch (e) {} }
          if (sink.speak) { try { sink.speak(msg); } catch (e) {} }
          if (sink.notify) { try { sink.notify('⛅ 天气提醒', msg); } catch (e) {} }
          fired.push({ eventId: ev.id, type, message: msg });
        }
      }
    }
    return fired;
  }

  /** 变化提醒（§19）：MAJOR_CHANGE / CANCELLED 通知一次 */
  function evaluateChange(diffResult, opts) {
    const o = opts || {};
    const lang = o.lang || 'zh';
    const ver = o.forecastVersion || 'v1';
    const sink = o.sink || defaultSink();
    const fired = [];
    const CHANGE = global.WeatherKit.EVENT_CHANGE;
    for (const item of (diffResult && diffResult.events) || []) {
      if (!item.change) continue;
      if (item.change === CHANGE.MAJOR_CHANGE && item.newEvent) {
        const msg = item.newEvent.type === 'rain'
          ? (lang === 'es' ? 'Cambio de pronóstico: la lluvia se mueve a ' + naturalTime(item.newEvent.startTime, lang)
            : lang === 'en' ? 'Forecast change: rain now from ' + naturalTime(item.newEvent.startTime, lang)
            : '预报更新：降雨时间调整为' + naturalTime(item.newEvent.startTime, lang) + '开始')
          : (lang === 'es' ? 'Cambio: viento fuerte desde ' + naturalTime(item.newEvent.startTime, lang)
            : lang === 'en' ? 'Change: strong wind from ' + naturalTime(item.newEvent.startTime, lang)
            : '预报更新：大风时间调整为' + naturalTime(item.newEvent.startTime, lang) + '开始');
        const type = 'change_' + item.newEvent.type;
        if (!alreadySent(item.newEvent.id, ver, type)) {
          markSent(item.newEvent.id, ver, type);
          if (sink.toast) { try { sink.toast(msg, 'weather'); } catch (e) {} }
          if (sink.speak) { try { sink.speak(msg); } catch (e) {} }
          fired.push({ eventId: item.newEvent.id, type, message: msg });
        }
      }
      if (item.change === CHANGE.CANCELLED && item.oldEvent) {
        const msg = lang === 'es' ? 'Pronóstico: el evento de ' + item.oldEvent.type + ' ya no se espera.'
          : lang === 'en' ? 'Forecast: the ' + item.oldEvent.type + ' event is no longer expected.'
          : (item.oldEvent.type === 'rain' ? '预报更新：预计的降雨已取消。' : '预报更新：预计的大风已取消。');
        const type = 'cancel_' + item.oldEvent.type;
        if (!alreadySent(item.oldEvent.id, ver, type)) {
          markSent(item.oldEvent.id, ver, type);
          if (sink.toast) { try { sink.toast(msg, 'weather'); } catch (e) {} }
          fired.push({ eventId: item.oldEvent.id, type, message: msg });
        }
      }
    }
    return fired;
  }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.WeatherReminderEngine = {
    evaluate, evaluateChange, rainMessage, windMessage, naturalTime,
    alreadySent, markSent, clearLedger: () => { ledger = []; saveLedger(); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
