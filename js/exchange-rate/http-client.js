'use strict';
/**
 * http-client —— 汇率 API 请求封装
 *
 * 职责：timeout / retry（指数退避）/ abort / 状态码 / JSON 解析 / 网络错误统一。
 * 禁止无限等待、禁止无限 retry。
 */
(function (global) {
  const T = global.ExchangeRateTypes;

  /**
   * 请求 JSON，带超时与重试。
   * @param {string} url 完整 URL
   * @param {object} opts { timeoutMs, retries, headers }
   * @returns {Promise<any>} 解析后的 JSON
   * @throws {Error} code: 'timeout' | 'http' | 'network' | 'parse'
   */
  async function requestJson(url, opts = {}) {
    const timeoutMs = opts.timeoutMs || T.HTTP_TIMEOUT_MS;
    const maxRetries = opts.retries !== undefined ? opts.retries : T.MAX_RETRIES;
    const delays = T.RETRY_DELAYS;

    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const res = await fetch(url, {
          headers: Object.assign({ Accept: 'application/json' }, opts.headers || {}),
          signal: controller ? controller.signal : undefined,
        });
        if (!res.ok) {
          const err = new Error('HTTP ' + res.status);
          err.code = 'http';
          err.status = res.status;
          throw err;
        }
        let data;
        try {
          data = await res.json();
        } catch (e) {
          const err = new Error('JSON 解析失败');
          err.code = 'parse';
          throw err;
        }
        return data;
      } catch (e) {
        if (e && e.name === 'AbortError') {
          const err = new Error('请求超时');
          err.code = 'timeout';
          lastErr = err;
        } else if (e && (e.code === 'http' || e.code === 'parse')) {
          // HTTP/解析错误不重试（数据问题重试无意义）
          lastErr = e;
          if (attempt >= maxRetries) break;
          const delay = delays[Math.min(attempt, delays.length - 1)] || 1000;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        } else {
          const err = new Error('网络错误');
          err.code = 'network';
          lastErr = err;
        }
        // 网络/超时错误：退避重试
        if (attempt >= maxRetries) break;
        const delay = delays[Math.min(attempt, delays.length - 1)] || 1000;
        await new Promise((r) => setTimeout(r, delay));
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastErr || new Error('请求失败');
  }

  global.FxHttpClient = { requestJson };
})(typeof window !== 'undefined' ? window : globalThis);
