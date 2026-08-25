'use strict';
/**
 * WeatherVoiceIntent —— 语音天气意图（§33，第一版基础）
 *
 * 从用户自然语言解析天气查询意图（中/西/英），返回结构化意图：
 *   { type: 'now'|'day'|'rain_start'|'rain_duration'|'rain_end'|'wind_peak'|'wind_gust',
 *     day: 'today'|'tomorrow'|'weekday'|N, }
 *
 * 只负责"理解"，不请求 Provider、不编造数据（§43）——数据由 WeatherService 提供。
 * 第一版覆盖验收场景 E 的基础查询；复杂条件提醒（§34）留后续版本。
 */
(function (global) {
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const DAY_ZH = { '今天': 'today', '今日': 'today', '明天': 'tomorrow', '明日': 'tomorrow', '后天': 'aftertomorrow', '大后天': 'afteraftertomorrow' };
  const DAY_ES = { 'hoy': 'today', 'mañana': 'tomorrow', 'pasado mañana': 'aftertomorrow' };
  const DAY_EN = { 'today': 'today', 'tomorrow': 'tomorrow', 'day after tomorrow': 'aftertomorrow' };
  const WD_ZH = { '周日': 0, '星期天': 0, '星期天': 0, '周一': 1, '星期一': 1, '周二': 2, '星期二': 2, '周三': 3, '星期三': 3, '周四': 4, '星期四': 4, '周五': 5, '星期五': 5, '周六': 6, '星期六': 6, '星期日': 0 };
  const WD_ES = { 'domingo': 0, 'lunes': 1, 'martes': 2, 'miércoles': 3, 'jueves': 4, 'viernes': 5, 'sábado': 6, 'domingo': 0 };
  const WD_EN = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };

  function langOf(text) {
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
    if (/(lluv|lluev|llov|viento|tiempo|mañana|hoy|llover|lluvia)/i.test(text)) return 'es';
    return 'en';
  }

  function dayOf(text, lang) {
    const t = String(text || '').toLowerCase();
    const map = lang === 'zh' ? DAY_ZH : lang === 'es' ? DAY_ES : DAY_EN;
    for (const k of Object.keys(map)) if (t.includes(k)) return map[k];
    // 星期几
    const wdMap = lang === 'zh' ? WD_ZH : lang === 'es' ? WD_ES : WD_EN;
    for (const k of Object.keys(wdMap)) if (t.includes(k)) return wdMap[k];
    return null;
  }

  /** 解析主要意图；未知返回 { type: null } */
  function parse(text, opts) {
    const t = String(text || '').trim();
    if (!t) return { type: null };
    const lang = opts && opts.lang ? opts.lang : langOf(t);
    const day = dayOf(t, lang);
    const hasRain = /(雨|lluv|lluev|llov|rain)/i.test(t);
    const hasWind = /(风|viento|wind)/i.test(t);
    const hasWeather = /(天气|天気|tiempo|weather|clima)/i.test(t);
    const isNow = /(现在|目前|现在天气|hoy|now|ahora)/i.test(t) && !day;

    let type = null;
    // 注意顺序：rain_end 先于 rain_start（"几点停雨"同时含"几点"+"停"）
    if (hasRain && /(停|结束|termina|termine|stop|end|para)/i.test(t)) type = 'rain_end';
    else if (hasRain && /(几点|什么时候|何时|cuando|when|hora|a qué hora)/i.test(t)) type = 'rain_start';
    else if (hasRain && /(多久|多长时间|cuanto|how long)/i.test(t)) type = 'rain_duration';
    else if (hasWind && /(最大阵风|阵风多少|rafaga|gust)/i.test(t)) type = 'wind_gust';
    else if (hasWind && /(几点|什么时候|cuando|when|hora)/i.test(t)) type = 'wind_peak';
    else if (hasWind) type = 'wind_today';
    else if (hasRain) type = 'rain_today';
    else if (hasWeather || isNow) type = 'day';

    return { type, day: day || (isNow ? 'today' : (hasWeather && !day ? 'today' : day)), lang };
  }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.WeatherVoiceIntent = { parse, langOf, dayOf };
})(typeof window !== 'undefined' ? window : globalThis);
