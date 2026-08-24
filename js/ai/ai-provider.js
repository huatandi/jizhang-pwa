'use strict';
/**
 * AIProvider —— AI 提供方抽象接口（V4.5 P2，架构预留）
 *
 * 原则（§25/§60/§77）：
 *   - API Key 绝不能放进 GitHub Pages 前端 → 真实 Provider 需经 AI Gateway（未来 Cloudflare Worker / Serverless）
 *   - 业务层只依赖本接口，未来接 Gemini/OpenAI/Qwen/DeepSeek 时无需改业务代码
 *   - 当前不连接真实 API：内置 localProvider（supported=false），系统保持完全本地
 *
 * 接口契约：
 *   {
 *     name: string,
 *     supported(): boolean,                          // 是否已配置可用
 *     understand(input, schema, context): Promise<AIResult|null>,
 *     classify(text, options): Promise<Object|null>,
 *     suggest(field, candidates, context): Promise<Object|null>
 *   }
 *
 * AIResult 统一 JSON（§22）：
 *   { fields:{}, confidence:{}, candidates:{}, reasoning_summary, learning_suggestion }
 *   禁止自由文本作为业务结果。
 */
(function (global) {
  // ---- Provider 注册表 ----
  const providers = {}; // name → provider

  function register(name, provider) {
    if (!name || !provider) return;
    providers[name] = provider;
  }
  function get(name) { return providers[name] || null; }
  function list() { return Object.keys(providers).map(n => providers[n]); }
  function available() { return list().filter(p => typeof p.supported === 'function' && p.supported()); }

  /**
   * 本地 Provider（内置兜底）：未接真实模型前 supported=false。
   * 未来接入本地轻量规则/模型时可在此实现 understand()。
   */
  const localProvider = {
    name: 'local',
    supported: () => false, // 无外部依赖；当前不提供 AI 能力（保持 Local-First）
    async understand() { return null; },
    async classify() { return null; },
    async suggest() { return null; },
  };
  register('local', localProvider);

  global.AIProvider = { register, get, list, available, localProvider };
})(typeof window !== 'undefined' ? window : globalThis);
