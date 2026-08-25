'use strict';
/**
 * WeatherCard —— 天气 UI（§21-§27）
 *
 * 总览小卡（入口）：☀️ 38°C 今天晴 下午有大风 → 点击打开详情
 * 详情卡：当前天气 / 重点事件（雨·风 时间轴）/ 未来 7 天 / 逐小时（可折叠）
 *
 * 只展示，不计算事件（数据来自 WeatherService）；三语 i18n + 单位换算在显示层。
 */
(function (global) {
  const I18N = {
    zh: {
      title: '天气预备', updated: '上次更新', fetching: '天气加载中…',
      fail: '天气获取失败（可手动设置城市后重试）', feel: '体感', high: '最高', low: '最低',
      rain: '降雨', wind: '大风', start: '预计开始', peak: '最强', end: '预计结束',
      dur: '预计持续', hours: '小时', maxRate: '最大雨量', total: '累计雨量',
      maxWind: '最大持续风', maxGust: '最大阵风', today: '今天', tomorrow: '明天',
      rainProb: '降雨概率', clickDetail: '点击查看未来天气', hour: '逐小时', collapse: '收起',
      noEvents: '今日无降雨/大风', tapSetup: '设置城市后可看天气',
    },
    es: {
      title: 'Tiempo', updated: 'Actualizado', fetching: 'Cargando tiempo…',
      fail: 'Error al obtener el tiempo', feel: 'Sensación', high: 'Máx', low: 'Mín',
      rain: 'Lluvia', wind: 'Viento', start: 'Inicia', peak: 'Máximo', end: 'Termina',
      dur: 'Duración', hours: 'h', maxRate: 'Pico', total: 'Total',
      maxWind: 'Viento sostenido', maxGust: 'Ráfagas', today: 'Hoy', tomorrow: 'Mañana',
      rainProb: 'Prob. lluvia', clickDetail: 'Ver pronóstico', hour: 'Por hora', collapse: 'Cerrar',
      noEvents: 'Sin lluvia/viento hoy', tapSetup: 'Configura ciudad para el tiempo',
    },
    en: {
      title: 'Weather', updated: 'Updated', fetching: 'Loading weather…',
      fail: 'Weather unavailable', feel: 'Feels', high: 'High', low: 'Low',
      rain: 'Rain', wind: 'Wind', start: 'From', peak: 'Peak', end: 'Until',
      dur: 'Lasting', hours: 'h', maxRate: 'Peak rate', total: 'Total',
      maxWind: 'Sustained', maxGust: 'Gusts', today: 'Today', tomorrow: 'Tomorrow',
      rainProb: 'Rain chance', clickDetail: 'View forecast', hour: 'Hourly', collapse: 'Close',
      noEvents: 'No rain/wind today', tapSetup: 'Set city for weather',
    },
  };
  const ICON_EMOJI = { clear: '☀️', partly_cloudy: '⛅', cloudy: '☁️', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '🌨️', thunderstorm: '⛈️' };
  const SEV_ZH = { RAIN_TRACE: '毛毛雨', RAIN_LIGHT: '小雨', RAIN_MODERATE: '中雨', RAIN_HEAVY: '大雨', RAIN_VERY_HEAVY: '强降雨', WIND_NORMAL: '', WIND_BREEZY: '微风', WIND_STRONG: '大风', WIND_VERY_STRONG: '强风' };
  const SEV_ES = { RAIN_TRACE: 'llovizna', RAIN_LIGHT: 'lluvia débil', RAIN_MODERATE: 'lluvia', RAIN_HEAVY: 'lluvia fuerte', RAIN_VERY_HEAVY: 'lluvia intensa', WIND_NORMAL: '', WIND_BREEZY: 'brisa', WIND_STRONG: 'viento fuerte', WIND_VERY_STRONG: 'viento muy fuerte' };
  const SEV_EN = { RAIN_TRACE: 'drizzle', RAIN_LIGHT: 'light rain', RAIN_MODERATE: 'rain', RAIN_HEAVY: 'heavy rain', RAIN_VERY_HEAVY: 'downpour', WIND_NORMAL: '', WIND_BREEZY: 'breeze', WIND_STRONG: 'strong wind', WIND_VERY_STRONG: 'gale' };

  function lang() {
    try {
      const gc = global.AIKit && global.AIKit.globalConfig;
      if (gc && gc.detectLang) { const l = gc.detectLang(); if (l && l.indexOf('zh') === 0) return 'zh'; if (l && l.indexOf('es') === 0) return 'es'; }
    } catch (e) { /* ignore */ }
    try { const n = global.navigator && global.navigator.language || ''; if (n.indexOf('zh') === 0) return 'zh'; if (n.indexOf('es') === 0) return 'es'; } catch (e) {}
    return 'zh';
  }
  const L = () => I18N[lang()] || I18N.zh;

  // ---- 单位（§38：内部 SI，显示换算） ----
  function tempC(c) {
    const u = (global.WeatherKit.WeatherConfig && global.WeatherKit.WeatherConfig.getUnits()) || { temperature: 'c' };
    if (u.temperature === 'f') return Math.round(c * 9 / 5 + 32) + '°F';
    return Math.round(c) + '°C';
  }
  function speedKmh(v) {
    const u = (global.WeatherKit.WeatherConfig && global.WeatherKit.WeatherConfig.getUnits()) || { windSpeed: 'kmh' };
    if (u.windSpeed === 'mph') return Math.round(v * 0.621371) + ' mph';
    return Math.round(v) + ' km/h';
  }

  function iconOf(code) { return ICON_EMOJI[global.WeatherKit.codeToIcon(code)] || '⛅'; }
  function sevOf(sev) {
    const l = lang();
    const m = l === 'es' ? SEV_ES : l === 'en' ? SEV_EN : SEV_ZH;
    return m[sev] || '';
  }
  function clockOf(iso) { const s = String(iso || ''); return s.length >= 16 ? s.slice(11, 16) : s; }
  function fmtUpdated(iso) {
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ================= 总览小卡（§21） =================
  /**
   * @param {HTMLElement} host 容器元素
   * @param {Object} res { data, events, fromCache, error }
   */
  function renderMini(host, res) {
    if (!host) return;
    const l = L();
    const data = res && res.data;
    if (!data || !data.current) {
      host.innerHTML = `<div class="weather-mini weather-mini-empty" onclick="WeatherCard.openDetail()">
        <span>${l.fetching}</span></div>`;
      return;
    }
    const cur = data.current;
    const icon = iconOf(cur.weatherCode);
    const today = (data.daily || [])[0] || {};
    // 今日事件摘要
    const evs = (res.events || []).filter(e => String(e.startTime).startsWith(String(today.date || '').slice(0, 10)) || !today.date);
    const rainEv = evs.find(e => e.type === 'rain');
    const windEv = evs.find(e => e.type === 'wind');
    let evLine = '';
    if (rainEv) evLine += `<span class="weather-mini-ev">🌧 ${clockOf(rainEv.startTime)}起 ${sevOf(rainEv.severity)}</span>`;
    if (windEv) evLine += `<span class="weather-mini-ev">💨 ${clockOf(windEv.startTime)}起 阵风${Math.round(windEv.metrics.maxWindGust)}</span>`;
    if (!evLine) evLine = `<span class="weather-mini-ev">${l.noEvents}</span>`;
    const updated = res.fromCache ? ` · ${l.updated} ${fmtUpdated(data.updatedAt)}` : '';
    host.innerHTML = `<div class="weather-mini" onclick="WeatherCard.openDetail()" title="${l.clickDetail}">
      <div class="weather-mini-left"><span class="weather-mini-icon">${icon}</span>
        <div class="weather-mini-main"><span class="weather-mini-temp">${tempC(cur.temperature)}</span>
          <span class="weather-mini-sub">${l.feel} ${tempC(cur.apparentTemperature)}${today.temperatureMax != null ? ` · ${l.high} ${tempC(today.temperatureMax)} ${l.low} ${tempC(today.temperatureMin)}` : ''}</span></div>
      </div>
      <div class="weather-mini-right">${evLine}<span class="weather-mini-upd">${data.location}${updated}</span></div>
    </div>`;
  }

  // ================= 详情卡（§22-§27） =================
  function renderDetail(res) {
    const l = L();
    const data = res && res.data;
    if (!data || !data.current) {
      return `<div class="weather-detail-empty">${l.fail}</div>`;
    }
    const cur = data.current;
    const icon = iconOf(cur.weatherCode);
    const events = (res.events || []).filter(e => {
      // 只显示今天/未来事件
      return new Date(e.startTime) >= new Date(Date.now() - 3600 * 1000);
    });
    const rainEvs = events.filter(e => e.type === 'rain');
    const windEvs = events.filter(e => e.type === 'wind');

    // 事件卡片（§23）
    const evCards = [];
    for (const ev of rainEvs.slice(0, 2)) {
      const m = ev.metrics || {};
      evCards.push(`<div class="weather-ev weather-ev-rain">
        <div class="weather-ev-head">🌧 ${l.rain} <span class="weather-ev-sev">${sevOf(ev.severity)}</span></div>
        <div class="weather-ev-times"><span>${l.start} <b>${clockOf(ev.startTime)}</b></span><span>${l.peak} <b>${clockOf(ev.peakTime)}</b></span><span>${l.end} <b>${clockOf(ev.endTime)}</b></span></div>
        <div class="weather-ev-bar"><span class="weather-ev-peak" style="left:${peakPct(ev)}%">▲</span></div>
        <div class="weather-ev-meta">${l.dur} ${Math.round(ev.durationMinutes / 60)}${l.hours} · ${l.maxRate} ${m.peakRate} mm/h · ${l.total} ${m.precipitationSum} mm</div>
      </div>`);
    }
    for (const ev of windEvs.slice(0, 2)) {
      const m = ev.metrics || {};
      evCards.push(`<div class="weather-ev weather-ev-wind">
        <div class="weather-ev-head">💨 ${l.wind} <span class="weather-ev-sev">${sevOf(ev.severity)}</span></div>
        <div class="weather-ev-times"><span>${l.start} <b>${clockOf(ev.startTime)}</b></span><span>${l.peak} <b>${clockOf(ev.peakTime)}</b></span><span>${l.end} <b>${clockOf(ev.endTime)}</b></span></div>
        <div class="weather-ev-bar"><span class="weather-ev-peak" style="left:${peakPct(ev)}%">▲</span></div>
        <div class="weather-ev-meta">${l.dur} ${Math.round(ev.durationMinutes / 60)}${l.hours} · ${l.maxWind} ${speedKmh(m.maxWindSpeed)} · ${l.maxGust} ${speedKmh(m.maxWindGust)}</div>
      </div>`);
    }

    // 未来 7 天（§25）
    const days = (data.daily || []).map((d, i) => {
      const name = i === 0 ? l.today : i === 1 ? l.tomorrow : weekday(i, lang());
      const rainPct = d.precipitationProbabilityMax || 0;
      const windTag = (d.windGustMax || 0) >= 40 ? '<span class="weather-day-wind">💨</span>' : '';
      return `<div class="weather-day" onclick="WeatherCard.toggleDay(${i})">
        <div class="weather-day-name">${name}</div>
        <div class="weather-day-icon">${iconOf(d.weatherCode)}${windTag}</div>
        <div class="weather-day-temp"><span class="weather-day-max">${tempC(d.temperatureMax)}</span> / <span class="weather-day-min">${tempC(d.temperatureMin)}</span></div>
        ${rainPct ? `<div class="weather-day-rain">${l.rainProb} ${rainPct}%</div>` : '<div class="weather-day-rain">&nbsp;</div>'}
        <div class="weather-day-detail" id="weatherDay${i}"></div>
      </div>`;
    }).join('');

    // 逐小时（§27，折叠）
    const hourRows = (data.hourly || []).slice(0, 24).map((h) => {
      const prob = h.precipitationProbability || 0;
      return `<div class="weather-hour-row"><span class="weather-hour-t">${clockOf(h.time)}</span><span class="weather-hour-i">${iconOf(h.weatherCode)}</span><span class="weather-hour-temp">${tempC(h.temperature)}</span>${prob ? `<span class="weather-hour-rain">${prob}%</span>` : ''}${h.windGust >= 40 ? '<span class="weather-hour-wind">💨</span>' : ''}</div>`;
    }).join('');

    return `<div class="weather-detail-top">
        <div class="weather-detail-loc">📍 ${escapeHtml(data.location)} <span class="weather-detail-upd">${l.updated} ${fmtUpdated(data.updatedAt)}</span></div>
        <div class="weather-detail-cur">
          <span class="weather-detail-icon">${icon}</span>
          <span class="weather-detail-temp">${tempC(cur.temperature)}</span>
          <div class="weather-detail-side">
            <div>${l.feel} ${tempC(cur.apparentTemperature)}</div>
            <div>${l.high} ${tempC((data.daily[0] || {}).temperatureMax)} / ${l.low} ${tempC((data.daily[0] || {}).temperatureMin)}</div>
          </div>
        </div>
      </div>
      ${evCards.length ? `<div class="weather-events">${evCards.join('')}</div>` : `<div class="weather-events-empty">${l.noEvents}</div>`}
      <div class="weather-days">${days}</div>
      <div class="weather-hour-toggle" onclick="WeatherCard.toggleHourly()">${l.hour} ▾</div>
      <div class="weather-hourly" id="weatherHourly" style="display:none">${hourRows}</div>`;
  }

  function peakPct(ev) {
    const s = new Date(ev.startTime).getTime(), e = new Date(ev.endTime).getTime(), p = new Date(ev.peakTime).getTime();
    if (!isFinite(s) || !isFinite(e) || e === s) return 50;
    return Math.max(5, Math.min(95, Math.round((p - s) / (e - s) * 100)));
  }
  function weekday(i, l) {
    const names = l === 'es' ? ['Mié', 'Jue', 'Vie', 'Sáb', 'Dom', 'Lun', 'Mar']
      : l === 'en' ? ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'] : ['周三', '周四', '周五', '周六', '周日', '周一', '周二'];
    const d = new Date(Date.now() + i * 86400000);
    return names[(d.getDay() + 6) % 7] || '';
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ================= 对外 API =================
  const API = {
    renderMini, renderDetail,
    /** 打开详情 modal（懒渲染） */
    openDetail() {
      const modal = global.document && global.document.getElementById('weatherModal');
      if (!modal) return;
      const body = modal.querySelector('.weather-modal-body');
      const res = global.WeatherKit.WeatherService.current();
      if (body) body.innerHTML = renderDetail(res);
      global.openModal && global.openModal('weatherModal');
      // 前台打开 → 刷新（§32）
      global.WeatherKit.WeatherService.refresh({ force: false }).then((r2) => {
        if (body) body.innerHTML = renderDetail(r2);
      }).catch(() => {});
    },
    toggleDay(i) {
      const el = global.document && global.document.getElementById('weatherDay' + i);
      if (!el) return;
      const d = global.WeatherKit.WeatherService.current().data.daily[i];
      if (!d) return;
      const l = L();
      if (el.style.display === 'block') { el.style.display = 'none'; el.innerHTML = ''; return; }
      // 该日事件
      const evs = global.WeatherKit.WeatherService.current().events.filter(e => String(e.startTime).startsWith(String(d.date).slice(0, 10)));
      const rows = evs.map((e) => {
        const m = e.metrics || {};
        return e.type === 'rain'
          ? `<div class="weather-day-ev">🌧 ${clockOf(e.startTime)}–${clockOf(e.endTime)} · ${l.peak} ${clockOf(e.peakTime)} · ${m.peakRate} mm/h · ${l.total} ${m.precipitationSum}mm</div>`
          : `<div class="weather-day-ev">💨 ${clockOf(e.startTime)}–${clockOf(e.endTime)} · ${l.maxWind} ${speedKmh(m.maxWindSpeed)} · ${l.maxGust} ${speedKmh(m.maxWindGust)}</div>`;
      }).join('') || `<div class="weather-day-ev">${l.noEvents}</div>`;
      el.style.display = 'block';
      el.innerHTML = rows;
    },
    toggleHourly() {
      const el = global.document && global.document.getElementById('weatherHourly');
      if (!el) return;
      const show = el.style.display !== 'block';
      el.style.display = show ? 'block' : 'none';
    },
  };
  // ================= 设置页接线（WeatherSettings） =================
  function readCfg() {
    const C = global.WeatherKit.WeatherConfig;
    const o = {};
    try { o.location = C && C.get('location'); } catch (e) {}
    const rem = C ? C.getReminder() : {};
    const units = C ? C.getUnits() : {};
    return { location: o.location || '', rem, units };
  }
  function saveCfg(next) {
    const C = global.WeatherKit.WeatherConfig;
    if (!C) return;
    if (next.location !== undefined) C.set('location', next.location);
    if (next.rem) C.set('reminder', next.rem);
    if (next.units) C.set('units', next.units);
  }

  const SettingsAPI = {
    /** 设置页回填 */
    fill() {
      const doc = global.document;
      if (!doc) return;
      const { location, rem, units } = readCfg();
      const cityEl = doc.getElementById('weatherCity');
      if (cityEl) cityEl.value = typeof location === 'string' ? location : (location && location.name) || '';
      const rainOn = doc.getElementById('weatherRainOn');
      if (rainOn) rainOn.checked = rem.rainEnabled !== false;
      const windOn = doc.getElementById('weatherWindOn');
      if (windOn) windOn.checked = rem.windEnabled !== false;
      const ra = doc.getElementById('weatherRainAdvance');
      if (ra) ra.value = String(rem.rainAdvanceMin != null ? rem.rainAdvanceMin : 30);
      const wa = doc.getElementById('weatherWindAdvance');
      if (wa) wa.value = String(rem.windAdvanceMin != null ? rem.windAdvanceMin : 60);
      const ut = doc.getElementById('weatherUnitTemp');
      if (ut) ut.value = (units.temperature || 'c');
      const uw = doc.getElementById('weatherUnitWind');
      if (uw) uw.value = (units.windSpeed || 'kmh');
    },
    /** 保存城市 + 提醒/单位设置 */
    saveAll() {
      const doc = global.document;
      if (!doc) return;
      const cityEl = doc.getElementById('weatherCity');
      const city = cityEl ? cityEl.value.trim() : '';
      const rem = {
        rainEnabled: !!(doc.getElementById('weatherRainOn') && doc.getElementById('weatherRainOn').checked),
        windEnabled: !!(doc.getElementById('weatherWindOn') && doc.getElementById('weatherWindOn').checked),
        rainAdvanceMin: Number((doc.getElementById('weatherRainAdvance') || {}).value) || 30,
        windAdvanceMin: Number((doc.getElementById('weatherWindAdvance') || {}).value) || 60,
      };
      const units = {
        temperature: (doc.getElementById('weatherUnitTemp') || {}).value || 'c',
        windSpeed: (doc.getElementById('weatherUnitWind') || {}).value || 'kmh',
      };
      saveCfg({ location: city, rem, units });
      // 保存后立即刷新
      global.WeatherKit.WeatherService.refresh({ force: true }).then((res) => {
        const host = doc.getElementById('weatherMiniHost');
        if (host) API.renderMini(host, res);
        global.showToast && global.showToast(city ? '✅ 天气城市已保存' : '天气设置已保存');
      }).catch(() => { global.showToast && global.showToast('天气保存失败，请检查城市名', 'error'); });
    },
    saveCity() { this.saveAll(); },
    /** GPS 定位（拒绝则提示手动城市，§28） */
    useGPS() {
      const g = global.navigator && global.navigator.geolocation;
      if (!g) { global.showToast && global.showToast('当前浏览器不支持定位，请手动输入城市', 'error'); return; }
      global.showToast && global.showToast('正在定位…');
      g.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude, lon = pos.coords.longitude;
          saveCfg({ location: { name: '📍 当前位置', latitude: lat, longitude: lon } });
          global.WeatherKit.WeatherService.refresh({ force: true }).then((res) => {
            const doc = global.document;
            const cityEl = doc && doc.getElementById('weatherCity');
            if (cityEl) cityEl.value = (res.data && res.data.location) || '📍 当前位置';
            const host = doc && doc.getElementById('weatherMiniHost');
            if (host) API.renderMini(host, res);
            global.showToast && global.showToast('✅ 已定位并获取天气');
          }).catch(() => { global.showToast && global.showToast('定位成功但天气获取失败', 'error'); });
        },
        () => { global.showToast && global.showToast('定位未授权，请手动输入城市', 'error'); },
        { timeout: 10000, maximumAge: 600000 }
      );
    },
  };
  global.WeatherKit.WeatherCard = Object.assign(API, { settings: SettingsAPI });
  // 全局 WeatherCard：内联 onclick（WeatherCard.openDetail/toggleDay/toggleHourly）走这里
  global.WeatherCard = Object.assign(global.WeatherCard || {}, API, { settings: SettingsAPI });
  global.WeatherSettings = SettingsAPI; // 内联 onclick 便捷入口
})(typeof window !== 'undefined' ? window : globalThis);
