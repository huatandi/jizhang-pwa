'use strict';
/**
 * WeatherService —— 天气模块门面（§44/§54）
 *
 * 职责编排：
 *   WeatherProvider → Normalizer → Cache → EventEngine → DiffEngine → ReminderEngine
 *   + WeatherVoiceIntent 回答
 *
 * 对外唯一入口。业务层（UI/语音/设置）只依赖 WeatherService，
 * 不直接碰 Provider / EventEngine / Reminder。
 *
 * 完全可降级（§40）：任何失败只影响天气，不影响记账/语音/提醒/OCR。
 */
(function (global) {
  let _providerName = null;
  let _lastData = null;      // 最近一次成功 WeatherData（内存）
  let _lastEvents = [];      // 最近一次事件
  let _lastDiff = null;      // 最近一次变化检测结果
  let _forecastVersion = 0;  // 每次成功刷新递增（ledger 防重复用）
  let _intervalTimer = null;

  function provider() {
    if (!_providerName) _providerName = 'open-meteo';
    const P = global.WeatherKit.WeatherProvider;
    const inst = P && P.get(_providerName);
    if (inst) return inst;
    // 懒注册默认 Provider
    if (P && global.WeatherKit.OpenMeteoProvider) {
      P.register('open-meteo', new global.WeatherKit.OpenMeteoProvider());
      return P.get('open-meteo');
    }
    throw new Error('无可用天气 Provider');
  }

  /** 位置解析：设置城市或 {lat,lon} */
  function resolveLocation() {
    const cfg = global.WeatherKit.WeatherConfig;
    const saved = cfg && cfg.get('location');
    if (saved) return saved; // { name, latitude, longitude } 或城市名
    return '';
  }

  function ttlOf(kind) {
    const C = global.WeatherKit.WeatherConfig;
    const D = C && C.DEFAULTS || {};
    const t = (C && C.get('cacheTTL')) || D.cacheTTL || {};
    return (t && t[kind]) || 10 * 60 * 1000;
  }

  /**
   * 刷新天气（读缓存 or 请求 Provider）
   * @param {Object} opts { force:boolean, location, lang, sink }
   * @returns {Promise<{data, events, fromCache}>}
   */
  async function refresh(opts) {
    const o = opts || {};
    const Cache = global.WeatherKit.WeatherCache;
    try {
      // 1) 缓存优先（非 force）
      if (!o.force) {
        const cached = Cache && Cache.getWeather(ttlOf('current'));
        if (cached) {
          _lastData = cached;
          _lastEvents = global.WeatherKit.WeatherEventEngine.detectEvents(cached);
          return { data: cached, events: _lastEvents, fromCache: true };
        }
      }
      // 2) 请求 Provider
      const loc = o.location || resolveLocation();
      if (!loc) throw new Error('未设置天气地点');
      const inst = provider();
      const data = await inst.fetchWeather(loc, { forecastDays: 7 });
      // 3) 变化检测（旧 vs 新事件）
      const newEvents = global.WeatherKit.WeatherEventEngine.detectEvents(data);
      const oldEvents = _lastEvents || [];
      _lastDiff = global.WeatherKit.WeatherDiffEngine.compareEvents(oldEvents, newEvents);
      _forecastVersion++;
      // 4) 缓存 + 内存
      if (Cache) Cache.putWeather(data);
      _lastData = data;
      _lastEvents = newEvents;
      // 5) 提醒评估
      const rem = global.WeatherKit.WeatherReminderEngine;
      if (rem) {
        rem.evaluate(newEvents, { lang: o.lang || 'zh', forecastVersion: 'v' + _forecastVersion, sink: o.sink });
        rem.evaluateChange(_lastDiff, { lang: o.lang || 'zh', forecastVersion: 'v' + _forecastVersion, sink: o.sink });
      }
      return { data, events: newEvents, fromCache: false, diff: _lastDiff };
    } catch (e) {
      // 完全降级：返回缓存（若有），绝不向上抛影响主应用
      const cached = Cache && Cache.getWeather(null);
      if (cached) {
        _lastData = cached;
        _lastEvents = global.WeatherKit.WeatherEventEngine.detectEvents(cached);
        return { data: cached, events: _lastEvents, fromCache: true, error: e };
      }
      console.warn('[weather] 刷新失败（不影响主应用）:', e && e.message || e);
      return { data: null, events: [], fromCache: false, error: e };
    }
  }

  /** 便捷：只读当前内存/缓存数据 */
  function current() {
    if (_lastData) return { data: _lastData, events: _lastEvents, diff: _lastDiff };
    const cached = global.WeatherKit.WeatherCache && global.WeatherKit.WeatherCache.getWeather(null);
    return { data: cached || null, events: cached ? global.WeatherKit.WeatherEventEngine.detectEvents(cached) : [], diff: null };
  }

  /** 前台时机刷新（§32：启动/回前台/打开卡片/间隔） */
  function scheduleAutoRefresh(opts) {
    const C = global.WeatherKit.WeatherConfig;
    const D = C && C.DEFAULTS || {};
    const on = (C && C.get('refreshOn')) || D.refreshOn || {};
    const interval = on && on.intervalMs || 60 * 60 * 1000;
    if (on.startup) refresh(opts || {}).catch(() => {});
    if (typeof document !== 'undefined' && on.foreground) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refresh(opts || {}).catch(() => {});
      });
    }
    if (_intervalTimer) clearInterval(_intervalTimer);
    if (typeof setInterval !== 'undefined') {
      _intervalTimer = setInterval(() => refresh(opts || {}).catch(() => {}), interval);
    }
  }
  function stopAutoRefresh() { if (_intervalTimer) { clearInterval(_intervalTimer); _intervalTimer = null; } }

  /**
   * 语音回答（§33）：意图 → 从当前数据生成回答文本。不编造数据。
   * @returns {string|null}
   */
  function answer(text, opts) {
    const o = opts || {};
    const intent = global.WeatherKit.WeatherVoiceIntent.parse(text, o);
    if (!intent.type) return null;
    const cur = current();
    const data = cur.data;
    if (!data) return o.lang === 'es' ? 'Aún sin datos del tiempo.' : o.lang === 'en' ? 'Weather data not available yet.' : '天气数据尚未获取。';
    const lang = intent.lang || o.lang || 'zh';
    const daily = data.daily || [];
    const events = cur.events || [];
    const dayIdx = dayIndex(intent.day, data, lang);
    const today = daily[dayIdx];

    const r = (zh, es, en) => lang === 'es' ? es : lang === 'en' ? en : zh;

    // 未来几天概要
    if (intent.type === 'day' && today) {
      const icon = global.WeatherKit.codeToIcon(today.weatherCode);
      const iconTxt = r(iconZh(icon), iconEs(icon), iconEn(icon));
      const rainPct = today.precipitationProbabilityMax || 0;
      return r(
        `${dayName(dayIdx, 'zh')}${iconTxt}，最高 ${Math.round(today.temperatureMax)}°，最低 ${Math.round(today.temperatureMin)}°，降雨概率 ${rainPct}%`,
        `${dayName(dayIdx, 'es')}${iconEs(icon)}, máx ${Math.round(today.temperatureMax)}°, mín ${Math.round(today.temperatureMin)}°, lluvia ${rainPct}%`,
        `${dayName(dayIdx, 'en')}${iconEn(icon)}, high ${Math.round(today.temperatureMax)}°, low ${Math.round(today.temperatureMin)}°, rain ${rainPct}%`
      );
    }
    // 雨/风事件问答
    const rainEv = events.filter(e => e.type === 'rain' && sameDay(e.startTime, dayIdx, data));
    const windEv = events.filter(e => e.type === 'wind' && sameDay(e.startTime, dayIdx, data));
    if (intent.type === 'rain_start') {
      if (!rainEv.length) return r('当天没有降雨预报。', 'No se espera lluvia ese día.', 'No rain expected that day.');
      const e = rainEv[0];
      return r(`预计${fmtClock(e.startTime)}开始下雨，${fmtClock(e.peakTime)}左右最强。`,
        `Lluvia desde ${fmtClock(e.startTime)}, más fuerte ${fmtClock(e.peakTime)}.`,
        `Rain from ${fmtClock(e.startTime)}, heaviest ${fmtClock(e.peakTime)}.`);
    }
    if (intent.type === 'rain_duration') {
      if (!rainEv.length) return r('当天没有降雨预报。', 'No lluvia ese día.', 'No rain that day.');
      const hrs = Math.max(1, Math.round(rainEv[0].durationMinutes / 60));
      return r(`预计持续约 ${hrs} 小时（${fmtClock(rainEv[0].startTime)} 到 ${fmtClock(rainEv[0].endTime)}）。`,
        `Durará unas ${hrs} horas (${fmtClock(rainEv[0].startTime)}–${fmtClock(rainEv[0].endTime)}).`,
        `Lasting ~${hrs} hours (${fmtClock(rainEv[0].startTime)}–${fmtClock(rainEv[0].endTime)}).`);
    }
    if (intent.type === 'rain_end') {
      if (!rainEv.length) return r('当天没有降雨预报。', 'Sin lluvia ese día.', 'No rain that day.');
      return r(`预计${fmtClock(rainEv[0].endTime)}左右雨停。`,
        `La lluvia terminará sobre ${fmtClock(rainEv[0].endTime)}.`,
        `Rain should end around ${fmtClock(rainEv[0].endTime)}.`);
    }
    if (intent.type === 'wind_gust') {
      if (!windEv.length) return r('当天没有大风预报。', 'No se espera viento fuerte.', 'No strong wind expected.');
      return r(`最大持续风 ${windEv[0].metrics.maxWindSpeed} 公里每小时，最大阵风约 ${windEv[0].metrics.maxWindGust} 公里每小时。`,
        `Viento sostenido ${windEv[0].metrics.maxWindSpeed} km/h, ráfagas hasta ${windEv[0].metrics.maxWindGust} km/h.`,
        `Sustained ${windEv[0].metrics.maxWindSpeed} km/h, gusts up to ${windEv[0].metrics.maxWindGust} km/h.`);
    }
    if (intent.type === 'wind_peak' || intent.type === 'wind_today') {
      if (!windEv.length) return r('当天没有大风预报。', 'No viento fuerte.', 'No strong wind.');
      return r(`预计${fmtClock(windEv[0].startTime)}风力增强，${fmtClock(windEv[0].peakTime)}左右最强。`,
        `Viento desde ${fmtClock(windEv[0].startTime)}, máximo ${fmtClock(windEv[0].peakTime)}.`,
        `Wind from ${fmtClock(windEv[0].startTime)}, peak ${fmtClock(windEv[0].peakTime)}.`);
    }
    if (intent.type === 'rain_today') {
      const ev = events.filter(e => e.type === 'rain');
      if (!ev.length) return r('今天没有降雨预报。', 'Hoy sin lluvia.', 'No rain today.');
      return r(`预计${fmtClock(ev[0].startTime)}开始下雨，持续约 ${Math.max(1, Math.round(ev[0].durationMinutes / 60))} 小时。`,
        `Lluvia desde ${fmtClock(ev[0].startTime)}, ~${Math.max(1, Math.round(ev[0].durationMinutes / 60))}h.`,
        `Rain from ${fmtClock(ev[0].startTime)}, ~${Math.max(1, Math.round(ev[0].durationMinutes / 60))}h.`);
    }
    return null;
  }

  // ---- 辅助：日期/时区（§41：按 WeatherData.timezone 语义） ----
  function dayIndex(day, data, lang) {
    if (day == null || day === 'today') return 0;
    const daily = data.daily || [];
    if (day === 'tomorrow') return Math.min(1, daily.length - 1);
    if (day === 'aftertomorrow') return Math.min(2, daily.length - 1);
    if (typeof day === 'number') return day;
    return 0;
  }
  function sameDay(iso, dayIdx, data) {
    const d = (data.daily || [])[dayIdx];
    return d && String(iso).startsWith(String(d.date).slice(0, 10));
  }
  function fmtClock(iso) { const s = String(iso || ''); return s.length >= 16 ? s.slice(11, 16) : s; }
  function dayName(idx, lang) {
    const names = lang === 'es' ? ['Hoy', 'Mañana', 'Pasado mañana', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
      : lang === 'en' ? ['Today', 'Tomorrow', 'Day after', 'Wed', 'Thu', 'Fri', 'Sat']
      : ['今天', '明天', '后天', '周三', '周四', '周五', '周六'];
    return names[Math.min(idx, names.length - 1)] || '';
  }
  function iconZh(i) { return { clear: '☀️', partly_cloudy: '⛅', cloudy: '☁️', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '🌨️', thunderstorm: '⛈️' }[i] || '⛅'; }
  function iconEs(i) { return iconZh(i); }
  function iconEn(i) { return iconZh(i); }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.WeatherService = {
    refresh, current, answer, scheduleAutoRefresh, stopAutoRefresh,
    setProvider: (n) => { _providerName = n; },
    getVersion: () => _forecastVersion,
  };
})(typeof window !== 'undefined' ? window : globalThis);
