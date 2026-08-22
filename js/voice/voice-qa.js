'use strict';
/**
 * VoiceQA —— 语音模块验收统计（5 层漏斗 + 场景模拟）
 *
 * 用户原话："不要因为语音识别成功就认为语音记账成功，应该分别统计"
 *
 *   ① ASR 成功率      （SpeechToText 是否给出文本）
 *   ② 文本正确率      （识别文本与期望是否一致/近似）
 *   ③ 解析成功率      （VoiceParser 是否解析出字段）
 *   ④ 字段正确率      （金额/日期/分类/账户 各字段是否正确）
 *   ⑤ 最终记账正确率  （字段齐全 → 可一键入账）
 *
 * 用法（浏览器控制台 / 自动化测试）：
 *   VoiceQA.reset();
 *   VoiceQA.case('zh-CN', '今天午餐花了250比索', { date:'today', amount:250, kind:'expense', category:'餐饮' });
 *   VoiceQA.case('es-MX', 'El almuerzo de hoy costó 250 pesos', { amount:250, kind:'expense' });
 *   VoiceQA.report();   // 输出 5 层漏斗统计
 *
 * 依赖：VoiceKit（voice-parser.js）+ MexicoParser.money（金额归一）+ 日期工具
 */
(function (global) {
  const stats = {
    total: 0,
    asrOk: 0,        // ① 有文本输入
    textOk: 0,       // ② 文本匹配
    parseOk: 0,      // ③ 解析出至少 1 字段
    fieldOk: 0,      // ④ 期望字段全部命中
    finalOk: 0,      // ⑤ 记账所需核心字段齐全（金额+分类+日期）
    fieldHits: {},   // 逐字段命中
    cases: [],
  };

  function _vk() { return global.VoiceKit || {}; }

  /** 归一化：文本转小写、去空格、去标点，便于文本比较 */
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[\s,，。.、:：;；"'“”!！?？\-_/\\]/g, '');
  }

  /** 文本相似度 0~1（用于② 文本正确率：子串/编辑距离近似） */
  function similarity(a, b) {
    const na = norm(a), nb = norm(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.includes(nb) || nb.includes(na)) return 0.8;
    // 简单编辑距离（Levenshtein）
    const m = na.length, n = nb.length;
    if (Math.max(m, n) > 40) return 0;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (na[i - 1] === nb[j - 1] ? 0 : 1));
      }
    }
    const dist = dp[m][n];
    return Math.max(0, 1 - dist / Math.max(m, n));
  }

  /** 日期断言：today / tomorrow / 具体 YYYY-MM-DD */
  function dateOk(actual, expect) {
    if (expect == null) return true;
    if (expect === 'today') expect = _iso(new Date());
    if (expect === 'tomorrow') expect = _iso(new Date(Date.now() + 86400000));
    if (expect === 'yesterday') expect = _iso(new Date(Date.now() - 86400000));
    return String(actual) === String(expect);
  }
  function _iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * 跑一个验收用例。
   * @param {string} lang  zh-CN | en-US | es-MX（仅用于展示，解析器本身跨语言）
   * @param {string} text  语音识别文本（可模拟 ASR 已出结果；传 {asrFail:true} 模拟 ASR 失败）
   * @param {Object} expect 期望字段 { amount, date, kind, category, account, remark }
   */
  function runCase(lang, text, expect) {
    const vk = _vk();
    const e = expect || {};
    const rec = { lang, text, expect: e, layers: {}, detail: null };
    stats.total++;

    // ① ASR 层
    if (text && typeof text === 'object' && text.asrFail) {
      rec.layers.asr = false;
      rec.detail = 'ASR 未返回文本';
      stats.cases.push(rec);
      return rec;
    }
    const asrText = String(text || '').trim();
    rec.layers.asr = asrText.length > 0;
    if (rec.layers.asr) stats.asrOk++;

    // ② 文本层（期望文本存在才判定）
    if (e.text) {
      const sim = similarity(asrText, e.text);
      rec.layers.text = sim >= 0.6;
      rec.textSim = Math.round(sim * 100);
      if (rec.layers.text) stats.textOk++;
    } else {
      rec.layers.text = null; // 未指定期望文本，跳过
    }

    // ③ 解析层
    const parsed = vk.parse ? vk.parse(asrText, e.kind || 'expense') : null;
    const hasField = parsed && (parsed.amount != null || parsed.date || parsed.category || parsed.account);
    rec.layers.parse = !!hasField;
    rec.parsed = parsed;
    if (rec.layers.parse) stats.parseOk++;
    if (!rec.layers.parse) { stats.cases.push(rec); return rec; }

    // ④ 字段层
    const checks = [];
    if (e.amount !== undefined) {
      const amtOk = parsed.amount != null && Math.abs(Number(parsed.amount) - Number(e.amount)) < 0.01;
      checks.push({ field: 'amount', ok: amtOk, got: parsed.amount, want: e.amount });
    }
    if (e.date !== undefined) {
      const dOk = dateOk(parsed.date, e.date);
      checks.push({ field: 'date', ok: dOk, got: parsed.date, want: e.date });
    }
    if (e.kind !== undefined) {
      const kOk = parsed.kind === e.kind;
      checks.push({ field: 'kind', ok: kOk, got: parsed.kind, want: e.kind });
    }
    if (e.category !== undefined) {
      const cOk = parsed.category === e.category;
      checks.push({ field: 'category', ok: cOk, got: parsed.category, want: e.category });
    }
    if (e.account !== undefined) {
      const aOk = parsed.account === e.account;
      checks.push({ field: 'account', ok: aOk, got: parsed.account, want: e.account });
    }
    rec.fieldChecks = checks;
    const fieldHits = checks.filter(c => c.ok).length;
    rec.layers.field = checks.length > 0 && fieldHits === checks.length;
    if (rec.layers.field) stats.fieldOk++;
    for (const c of checks) {
      stats.fieldHits[c.field] = stats.fieldHits[c.field] || { ok: 0, total: 0 };
      stats.fieldHits[c.field].total++;
      if (c.ok) stats.fieldHits[c.field].ok++;
    }

    // ⑤ 记账层：核心字段齐全（金额 + 分类 + 日期可推算）
    const finalReady = parsed.amount != null && (parsed.category != null);
    rec.layers.final = finalReady;
    if (finalReady) stats.finalOk++;

    stats.cases.push(rec);
    return rec;
  }

  /** 输出 5 层漏斗统计报告 */
  function report() {
    const pct = (n) => stats.total ? Math.round((n / stats.total) * 1000) / 10 : 0;
    const lines = [];
    lines.push('══════════ VoiceQA 语音模块验收 ══════════');
    lines.push(`用例总数          : ${stats.total}`);
    lines.push(`① ASR 成功率      : ${stats.asrOk}/${stats.total} = ${pct(stats.asrOk)}%`);
    lines.push(`② 文本正确率      : ${stats.textOk}/${stats.total} = ${pct(stats.textOk)}%`);
    lines.push(`③ 解析成功率      : ${stats.parseOk}/${stats.total} = ${pct(stats.parseOk)}%`);
    lines.push(`④ 字段正确率      : ${stats.fieldOk}/${stats.total} = ${pct(stats.fieldOk)}%`);
    lines.push(`⑤ 最终记账正确率  : ${stats.finalOk}/${stats.total} = ${pct(stats.finalOk)}%`);
    const fh = Object.entries(stats.fieldHits);
    if (fh.length) {
      lines.push('── 逐字段命中 ──');
      for (const [f, v] of fh) lines.push(`   ${f}: ${v.ok}/${v.total}`);
    }
    lines.push('── 用例明细 ──');
    for (const c of stats.cases) {
      lines.push(`  [${c.lang}] "${String(c.text || '').slice(0, 30)}"` +
        (c.textSim != null ? ` sim=${c.textSim}%` : '') +
        ` → ①${c.layers.asr ? '✓' : '✗'} ③${c.layers.parse ? '✓' : '✗'} ④${c.layers.field ? '✓' : '✗'} ⑤${c.layers.final ? '✓' : '✗'}` +
        (c.parsed ? ` 金额=${c.parsed.amount} 日期=${c.parsed.date || '-'} 分类=${c.parsed.category || '-'} 收支=${c.parsed.kind || '-'}` : '') +
        (c.detail ? `  (${c.detail})` : ''));
    }
    const s = lines.join('\n');
    console.log(s);
    if (global.showToast) { try { global.showToast('📊 语音验收完成，见控制台'); } catch (e) {} }
    return s;
  }

  /** 重置统计 */
  function reset() {
    stats.total = 0; stats.asrOk = 0; stats.textOk = 0; stats.parseOk = 0; stats.fieldOk = 0; stats.finalOk = 0;
    stats.fieldHits = {}; stats.cases = [];
  }

  /** 便捷：批量跑内置场景（中/英/西） */
  function runBuiltin() {
    reset();
    // 注意：分类名取决于用户真实配置（options.expense_categories）。
    // 浏览器环境常见配置为「伙食/房租/杂费/交通…」，此处用常见名，
    // 若用户自定义分类，④字段正确率会偏低（属期望值差异，非解析错误）。
    // —— 中文 ——
    runCase('zh-CN', '今天午餐花了250比索', { amount: 250, date: 'today', kind: 'expense', category: '伙食', text: '今天午餐花了250比索' });
    runCase('zh-CN', '明天交房租三千元', { amount: 3000, date: 'tomorrow', kind: 'expense', category: '房租', text: '明天交房租三千元' });
    runCase('zh-CN', '买牛奶和面包花了45块', { amount: 45, kind: 'expense', category: '伙食', text: '买牛奶和面包花了45块' });
    runCase('zh-CN', '收入工资八千五百元', { amount: 8500, kind: 'income', category: '工资', text: '收入工资八千五百元' });
    runCase('zh-CN', '打车去机场花了120元', { amount: 120, kind: 'expense', category: '交通', text: '打车去机场花了120元' });
    // —— 英文 ——
    runCase('en-US', 'I spent two hundred fifty pesos on lunch today', { amount: 250, date: 'today', kind: 'expense', category: '伙食', text: 'two hundred fifty pesos on lunch today' });
    runCase('en-US', 'Bought groceries for forty five dollars', { amount: 45, kind: 'expense', category: '伙食', text: 'bought groceries for forty five dollars' });
    // —— 西语 ——
    runCase('es-MX', 'El almuerzo de hoy costó doscientos cincuenta pesos', { amount: 250, date: 'today', kind: 'expense', category: '伙食', text: 'almuerzo doscientos cincuenta pesos' });
    runCase('es-MX', 'Pagué el alquiler de tres mil pesos', { amount: 3000, kind: 'expense', category: '房租', text: 'alquiler tres mil pesos' });
    runCase('es-MX', 'Compré leche y pan por cuarenta y cinco pesos', { amount: 45, kind: 'expense', category: '伙食', text: 'leche y pan cuarenta y cinco pesos' });
    // —— ASR 失败模拟 ——
    runCase('zh-CN', { asrFail: true }, {});
    return report();
  }

  global.VoiceQA = { runCase, report, reset, runBuiltin, stats, norm, similarity };
})(typeof window !== 'undefined' ? window : globalThis);
