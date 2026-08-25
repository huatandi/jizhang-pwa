'use strict';
/**
 * WeatherProvider —— Provider 抽象（§3）
 *
 * 业务层（Service/EventEngine/UI）不得直接依赖具体天气服务原始 JSON。
 * 所有 Provider 实现此接口，统一返回内部 WeatherData Schema（§4）。
 *
 * 接口：
 *   fetchWeather(location, opts) → Promise<WeatherData>
 *   location 为 { name, latitude, longitude, timezone? } 或城市名字符串
 */
(function (global) {
  const WEATHER_PROVIDERS = {};   // name → provider 实例

  function register(name, provider) {
    WEATHER_PROVIDERS[name] = provider;
  }
  function get(name) {
    return WEATHER_PROVIDERS[name] || null;
  }
  function list() {
    return Object.keys(WEATHER_PROVIDERS);
  }

  /**
   * 基类：校验子类实现，统一错误封装（§40 异常处理：API 失败不影响主应用）
   */
  class WeatherProviderBase {
    constructor(name) {
      this.name = name || 'base';
    }
    async fetchWeather(location) {
      throw new Error('WeatherProvider.fetchWeather 未实现: ' + this.name);
    }
    /** 统一把 Provider 异常转成规范化错误（业务层据此降级） */
    static wrapError(e, action) {
      const err = new Error('天气服务 ' + action + ' 失败: ' + (e && e.message || e));
      err.weather = true;
      err.cause = e;
      return err;
    }
  }

  global.WeatherKit = global.WeatherKit || {};
  global.WeatherKit.WeatherProvider = { register, get, list, Base: WeatherProviderBase };
})(typeof window !== 'undefined' ? window : globalThis);
