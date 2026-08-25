'use strict';
/**
 * WeatherCache —— 天气缓存（§30/§31）
 *
 * 分层 TTL：当前天气短、小时预报中、未来日预报长。
 * 离线时显示最后一次数据并标注更新时间；禁止把缓存伪装成实时。
 * 存储：localStorage（纯文本 JSON，轻量；不进 IndexedDB 避免与账本争用）。
 */
(function (global) {
  const LS_KEY = 'sm_weather_cache';
  let mem = null;

  function load() {
    if (mem) return mem;
    try {
      const raw = global.localStorage && global.localStorage.getItem(LS_KEY);
      mem = raw ? JSON.parse(raw) : {};
    } catch (e) { mem = {}; }
    return mem;
  }
  function save() {
    try { global.localStorage && global.localStorage.setItem(LS_KEY, JSON.stringify(mem)); } catch (e) { /* ignore */ }
  }
  function clear() {
    mem = {};
    save();
  }

  /** 按 key 读缓存；expireMs 过期返回 null（TTL 分层，§31） */
  function get(key, expireMs) {
    const c = load()[key];
    if (!c || !c.savedAt) return null;
    if (expireMs && (Date.now() - c.savedAt) > expireMs) return null;
    return c.data;
  }
  function put(key, data) {
    const c = load();
    c[key] = { savedAt: Date.now(), data };
    mem = c;
    save();
  }

  /** 完整读（含时间戳，UI 显示"上次更新"） */
  function readWithMeta(key) {
    const c = load()[key];
    return c ? { savedAt: c.savedAt, data: c.data } : null;
  }

  // 便捷：整份 WeatherData 缓存
  function getWeather(ttl) {
    const meta = readWithMeta('weather');
    if (!meta) return null;
    if (ttl && (Date.now() - meta.savedAt) > ttl) return null;
    return meta.data;
  }
  function putWeather(data) {
    put('weather', data);
  }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.WeatherCache = { get, put, readWithMeta, getWeather, putWeather, clear, LS_KEY };
})(typeof window !== 'undefined' ? window : globalThis);
