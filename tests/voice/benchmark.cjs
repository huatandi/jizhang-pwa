'use strict';
/**
 * Voice Critical-Field Benchmark 计算器（V7.0 §28）
 *
 * 职责：把"人工标注期望值(manifest) + 引擎/浏览器实测结果(results/*.json)"汇总为
 * 语音 KPI 报告：
 *   - Amount / Date / Entity / Intent 各自 Exact Match 率
 *   - False Commit Rate（关键安全指标：非提交意图被误判为提交）
 *   - 每句明细 + 汇总表
 *
 * 用法：
 *   node tests/voice/benchmark.cjs                 # 读取 manifest + tests/voice/results/*.json 出报告
 *   node tests/voice/benchmark.cjs --demo          # 内置演示数据展示报告格式（无结果文件时用）
 *   node tests/voice/benchmark.cjs --check-manifest# 仅校验 manifest 结构
 *
 * 结果文件格式（tests/voice/results/<fixtureId>.json）：
 *   {
 *     "fixtureId": "voice-zh-clean-001",
 *     "engine": "whisper | webspeech",
 *     "lang": "zh-CN",
 *     "processingMs": 1234,
 *     "fields": { "amount": "850", "currency": "MXN", "merchant": "Costco", "category": "材料", "date": null, "account": null, "intent": "CONTENT" },
 *     "rawTranscript": "语音文本"
 *   }
 *
 * 结果捕获：浏览器工作台/引擎调用后落盘（与 OCR 一致：结果文件 <fixtureId>.json 放入 results/）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(__dirname, 'fixtures', 'manifest.json');
const RESULTS_DIR = path.join(__dirname, 'results');

/* ================== KPI 纯函数（可单测） ================== */

/** 金额归一化：去币种/千分位/空格，保留数值语义 */
function normalizeAmount(s) {
  if (s == null) return null;
  let t = String(s).replace(/[$¥€£￥\s]/g, '').trim();
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else {
    t = t.replace(/,/g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function amountExact(expected, actual) {
  const a = normalizeAmount(expected), b = normalizeAmount(actual);
  if (a == null || b == null) return false;
  return a === b;
}

function dateExact(expected, actual) {
  if (expected == null || actual == null) return false;
  const n = (s) => String(s).replace(/[^\d]/g, '');
  const a = n(expected), b = n(actual);
  return a.length > 0 && a === b;
}

function textExact(expected, actual) {
  if (expected == null || actual == null) return false;
  return String(expected).trim().toLowerCase() === String(actual).trim().toLowerCase();
}

/** 实体匹配：精确 或 别名等价（大小写/首尾空白归一后相等） */
function entityExact(expected, actual) {
  if (expected == null || actual == null) return false;
  return String(expected).trim().toLowerCase() === String(actual).trim().toLowerCase();
}

/**
 * 单句 KPI
 * @param {Object} fixture manifest 条目
 * @param {Object} result  results/<id>.json
 * @returns {{ fixtureId, lang, difficulty, engine, processingMs, fields, exactCount, evaluatedCount,
 *             amountExact, dateExact, entityExact, intentExact, falseCommit }}
 */
function evaluateFixture(fixture, result) {
  const expected = (fixture && fixture.expected) || {};
  const actual = (result && result.fields) || {};
  const fields = {};
  let exactCount = 0, evaluatedCount = 0;

  // 字段比较器：intent 用 textExact，其余按类型
  const fieldMap = [
    ['amount', amountExact],
    ['date', dateExact],
    ['merchant', entityExact],
    ['account', entityExact],
    ['category', entityExact],
    ['currency', textExact],
    ['intent', textExact],
  ];
  for (const [field, cmp] of fieldMap) {
    const exp = expected[field];
    if (exp == null) { fields[field] = { expected: null, actual: actual[field] != null ? actual[field] : null, match: null, skipped: true }; continue; }
    const act = actual[field] != null ? String(actual[field]) : null;
    const match = act != null && cmp(exp, act);
    evaluatedCount++;
    if (match) exactCount++;
    fields[field] = { expected: exp, actual: act, match, skipped: false };
  }

  // 关键安全指标：期望是非提交意图，实际却被判为提交 → falseCommit
  const expIntent = expected.intent;
  const actIntent = actual.intent != null ? String(actual.intent) : null;
  const falseCommit = (expIntent != null && expIntent !== 'COMMIT' && actIntent === 'COMMIT');

  return {
    fixtureId: (fixture && fixture.id) || (result && result.fixtureId) || '?',
    lang: (fixture && fixture.lang) || (result && result.lang) || null,
    difficulty: (fixture && fixture.difficulty) || null,
    engine: (result && result.engine) || null,
    processingMs: (result && result.processingMs) || null,
    fields,
    exactCount, evaluatedCount,
    amountExact: fields.amount && !fields.amount.skipped ? !!fields.amount.match : null,
    dateExact: fields.date && !fields.date.skipped ? !!fields.date.match : null,
    entityExact: (fields.merchant && !fields.merchant.skipped) || (fields.account && !fields.account.skipped)
      ? ((fields.merchant && !fields.merchant.skipped && fields.merchant.match) || (fields.account && !fields.account.skipped && fields.account.match)) : null,
    intentExact: fields.intent && !fields.intent.skipped ? !!fields.intent.match : null,
    falseCommit,
  };
}

/** 汇总报告字符串 */
function renderReport(fixtures, resultsByFixtureId) {
  const evals = [];
  for (const fx of fixtures || []) {
    const res = resultsByFixtureId[fx.id];
    if (!res) continue;
    evals.push(evaluateFixture(fx, res));
  }
  const pending = (fixtures || []).filter(fx => !resultsByFixtureId[fx.id]).map(fx => fx.id);

  const lines = [];
  lines.push('══════════ Voice Critical-Field Benchmark ══════════');
  if (!evals.length) {
    lines.push('（无已捕获结果：请先在引擎/浏览器运行识别并写入 tests/voice/results/<id>.json，或用 --demo 查看格式）');
    lines.push('未捕获结果的 fixture: ' + (pending.join(', ') || '无'));
    lines.push('══════════════════════════════════════════════════');
    return lines.join('\n');
  }

  const fieldTotals = {};
  for (const f of ['amount', 'date', 'merchant', 'account', 'category', 'currency', 'intent']) {
    const hits = evals.filter(e => e.fields[f] && !e.fields[f].skipped && e.fields[f].match).length;
    const total = evals.filter(e => e.fields[f] && !e.fields[f].skipped).length;
    fieldTotals[f] = { hits, total };
  }
  const amtEval = evals.filter(e => e.amountExact != null);
  const amtHits = amtEval.filter(e => e.amountExact).length;
  const intentEval = evals.filter(e => e.intentExact != null);
  const intentHits = intentEval.filter(e => e.intentExact).length;
  const fcCount = evals.filter(e => e.falseCommit).length;

  lines.push('── 逐字段 Exact Match ──');
  for (const [f, { hits, total }] of Object.entries(fieldTotals)) {
    const pct = total ? Math.round(hits / total * 1000) / 10 : null;
    lines.push(`   ${f.padEnd(10)} ${hits}/${total}${pct != null ? '  (' + pct + '%)' : ''}`);
  }
  lines.push('── 关键指标 ──');
  lines.push(`   Amount Exact       ${amtHits}/${amtEval.length}`);
  lines.push(`   Intent Exact       ${intentHits}/${intentEval.length}`);
  lines.push(`   False Commit Rate  ${fcCount} 次  ${evals.length ? Math.round(fcCount / evals.length * 100) + '%' : '0%'}  (安全:只降不升)`);
  lines.push('── 明细 ──');
  for (const e of evals) {
    const amt = e.fields.amount;
    const amtTag = amt.skipped ? 'n/a' : (amt.match ? '✓' : '✗');
    const intTag = e.fields.intent.skipped ? 'n/a' : (e.fields.intent.match ? '✓' : '✗');
    const fcTag = e.falseCommit ? ' ⚠️FALSE_COMMIT' : '';
    lines.push(`   ${e.fixtureId.padEnd(24)} ${(e.lang || '').padEnd(6)} amount=${amtTag} intent=${intTag}${fcTag} exact=${e.exactCount}/${e.evaluatedCount} engine=${e.engine || '?'} ${e.processingMs != null ? e.processingMs + 'ms' : ''}`);
  }
  lines.push('── 未捕获结果 ──');
  lines.push('   ' + (pending.join(', ') || '无'));
  lines.push('══════════════════════════════════════════════════');
  return lines.join('\n');
}

/** 读取 manifest */
function loadManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const data = JSON.parse(raw);
  return data.fixtures || [];
}

/** 读取 results/ 下所有结果 */
function loadResults() {
  const out = {};
  if (!fs.existsSync(RESULTS_DIR)) return out;
  for (const f of fs.readdirSync(RESULTS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8'));
      const id = r.fixtureId || f.replace(/\.json$/, '');
      out[id] = r;
    } catch (e) { console.warn('[voice-benchmark] 忽略损坏结果文件:', f, e.message); }
  }
  return out;
}

/** 演示数据（--demo）：展示报告格式，含一次 falseCommit 演示 */
function demoResults() {
  return {
    'voice-zh-clean-001': {
      fixtureId: 'voice-zh-clean-001', engine: 'whisper', lang: 'zh-CN', processingMs: 320,
      fields: { amount: '850', currency: 'MXN', merchant: 'Costco', category: '材料', date: null, intent: 'CONTENT' },
      rawTranscript: '今天 Costco 买货 850 比索',
    },
    'voice-zh-amount-002': {
      fixtureId: 'voice-zh-amount-002', engine: 'whisper', lang: 'zh-CN', processingMs: 280,
      fields: { amount: '15000', currency: 'CNY', merchant: null, category: '材料', date: null, intent: 'CONTENT' },
      rawTranscript: '买了一万五千块的货',
    },
    'voice-zh-bank-003': {
      fixtureId: 'voice-zh-bank-003', engine: 'whisper', lang: 'zh-CN', processingMs: 300,
      fields: { amount: '500', account: 'Santander', merchant: null, category: null, date: null, intent: 'CONTENT' },
      rawTranscript: '从桑坦德账户转 500',
    },
    'voice-zh-command-004': {
      fixtureId: 'voice-zh-command-004', engine: 'whisper', lang: 'zh-CN', processingMs: 90,
      fields: { amount: null, date: null, intent: 'COMMIT' },
      rawTranscript: '好了',
    },
    'voice-zh-correction-005': {
      fixtureId: 'voice-zh-correction-005', engine: 'whisper', lang: 'zh-CN', processingMs: 100,
      fields: { amount: null, date: null, intent: 'REPLACE_LAST_ARMED' },
      rawTranscript: '重说上一句',
    },
    'voice-zh-changedmind-006': {
      fixtureId: 'voice-zh-changedmind-006', engine: 'whisper', lang: 'zh-CN', processingMs: 340,
      // 演示：误判为 COMMIT（应为 CONTENT）→ False Commit
      fields: { amount: '500', date: null, intent: 'COMMIT' },
      rawTranscript: '店里300 不对 店里500',
    },
    'voice-es-clean-007': {
      fixtureId: 'voice-es-clean-007', engine: 'whisper', lang: 'es-MX', processingMs: 260,
      fields: { amount: '500', currency: 'MXN', merchant: null, category: null, date: null, intent: 'CONTENT' },
      rawTranscript: 'pagué 500 pesos',
    },
    'voice-en-clean-008': {
      fixtureId: 'voice-en-clean-008', engine: 'whisper', lang: 'en-US', processingMs: 250,
      fields: { amount: '500', currency: 'USD', merchant: null, category: null, date: null, intent: 'CONTENT' },
      rawTranscript: 'paid 500 dollars',
    },
    'voice-es-command-009': {
      fixtureId: 'voice-es-command-009', engine: 'whisper', lang: 'es-MX', processingMs: 80,
      fields: { amount: null, date: null, intent: 'COMMIT' },
      rawTranscript: 'listo',
    },
    'voice-en-command-010': {
      fixtureId: 'voice-en-command-010', engine: 'whisper', lang: 'en-US', processingMs: 85,
      fields: { amount: null, date: null, intent: 'COMMIT' },
      rawTranscript: 'done',
    },
  };
}

/* ================== CLI ================== */
function main(argv) {
  const fixtures = loadManifest();
  if (argv.includes('--check-manifest')) {
    console.log('voice manifest fixtures: ' + fixtures.length);
    for (const f of fixtures) {
      const ok = f.id && f.utterance && f.expected;
      console.log(`   ${ok ? '✔' : '✘'} ${f.id || '?'}  ${f.lang || ''}  ${f.difficulty || ''}  expected=${ok ? Object.keys(f.expected).length + '字段' : '缺失'}`);
    }
    return;
  }
  const results = argv.includes('--demo') ? demoResults() : loadResults();
  console.log(renderReport(fixtures, results));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  normalizeAmount, amountExact, dateExact, textExact, entityExact,
  evaluateFixture, renderReport,
  loadManifest, loadResults, main,
};
