'use strict';
/**
 * OCR Critical-Field Benchmark 计算器 (V5 §81-87)
 *
 * 职责：把"人工标注期望值(manifest) + 浏览器实测结果(results/*.json)"汇总为
 * 关键字段 KPI 报告：
 *   - Amount / Date / Merchant / TaxId / Reference / Payment 各自 Exact Match 率
 *   - Critical Financial Error Rate（金额严重错误率：60 → 560 这类）
 *   - 每张票的明细行 + 汇总表
 *
 * 用法：
 *   node tests/ocr/benchmark.cjs                 # 读取 manifest + tests/ocr/results/*.json 出报告
 *   node tests/ocr/benchmark.cjs --demo          # 内置演示数据展示报告格式（无结果文件时用）
 *   node tests/ocr/benchmark.cjs --check-manifest# 仅校验 manifest 结构
 *
 * 结果文件格式（tests/ocr/results/<fixtureId>.json）：
 *   {
 *     "fixtureId": "mx-cfdi-sample-001",
 *     "engine": "paddle | tesseract | fusion",
 *     "backend": "webgpu | wasm | ...",
 *     "processingMs": 1234,
 *     "fields": { "amount": "656.38", "date": "2026-08-01", "merchant": "...", "taxId": "...", "reference": "...", "payment": "..." },
 *     "rawText": "OCR 全文",
 *     "preprocessProfile": "normal | thermal | ..."
 *   }
 *
 * 结果捕获：在浏览器工作台控制台执行 tests/ocr/README.md 中的片段，
 * 或由自动化(Playwright 等)调用 wbLocalOcrV2 后落盘。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MANIFEST_PATH = path.join(__dirname, 'fixtures', 'manifest.json');
const RESULTS_DIR = path.join(__dirname, 'results');

/* ================== KPI 纯函数（可单测） ================== */

/** 金额归一化：去币种/千分位/空格，保留数值语义（含欧式格式，与 mexico/money.js 行为一致） */
function normalizeAmount(s) {
  if (s == null) return null;
  let t = String(s).replace(/[$¥€£￥\s]/g, '').trim();
  if (!t) return null;
  // 欧式千分位点 + 逗号小数：1.234,56 / 1.234.567,89 → 1234.56 / 1234567.89
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else {
    // 美式/通用：去千分位逗号（1,234.56 → 1234.56）
    t = t.replace(/,/g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 金额精确匹配（归一化后相等） */
function amountExact(expected, actual) {
  const a = normalizeAmount(expected), b = normalizeAmount(actual);
  if (a == null || b == null) return false;
  return a === b;
}

/**
 * 金额严重错误（Critical Financial Error）：|实际-期望| >= max(10, 期望*10%)。
 * 60 → 560 属严重；656.38 → 656（找零级误差）不算严重（但仍非精确）。
 */
function isCriticalAmountError(expected, actual) {
  const a = normalizeAmount(expected), b = normalizeAmount(actual);
  if (a == null || b == null || a === b) return false;
  return Math.abs(b - a) >= Math.max(10, Math.abs(a) * 0.1);
}

/** 日期精确匹配：去分隔符后比较（容忍 2026-08-01 / 20260801） */
function dateExact(expected, actual) {
  if (expected == null || actual == null) return false;
  const n = (s) => String(s).replace(/[^\d]/g, '');
  const a = n(expected), b = n(actual);
  return a.length > 0 && a === b;
}

/** 文本精确匹配（忽略大小写与首尾空白） */
function textExact(expected, actual) {
  if (expected == null || actual == null) return false;
  return String(expected).trim().toLowerCase() === String(actual).trim().toLowerCase();
}

const FIELD_COMPARATORS = {
  amount: amountExact,
  date: dateExact,
  merchant: textExact,
  taxId: textExact,
  reference: textExact,
  payment: textExact,
};

/**
 * 单张票 KPI
 * @param {Object} expected manifest.expected
 * @param {Object} actual   result.fields
 * @returns {{ fixtureId, engine, processingMs, fields: {field:{expected, actual, match, skipped}}, exactCount, evaluatedCount, amountExact, amountCritical, allCriticalExact }}
 */
function evaluateFixture(fixture, result) {
  const expected = (fixture && fixture.expected) || {};
  const actual = (result && result.fields) || {};
  const fields = {};
  let exactCount = 0, evaluatedCount = 0;
  for (const [field, cmp] of Object.entries(FIELD_COMPARATORS)) {
    const exp = expected[field];
    if (exp == null) { fields[field] = { expected: null, actual: actual[field] != null ? actual[field] : null, match: null, skipped: true }; continue; }
    const act = actual[field] != null ? String(actual[field]) : null;
    const match = act != null && cmp(exp, act);
    evaluatedCount++;
    if (match) exactCount++;
    fields[field] = { expected: exp, actual: act, match, skipped: false };
  }
  const amount = fields.amount;
  const amountCritical = (amount && !amount.skipped && !amount.match)
    ? isCriticalAmountError(amount.expected, amount.actual) : false;
  return {
    fixtureId: (fixture && fixture.id) || (result && result.fixtureId) || '?',
    documentType: (fixture && fixture.documentType) || null,
    difficulty: (fixture && fixture.difficulty) || null,
    engine: (result && result.engine) || null,
    processingMs: (result && result.processingMs) || null,
    fields,
    exactCount, evaluatedCount,
    amountExact: amount && !amount.skipped ? !!amount.match : null,
    amountCritical,
    allCriticalExact: amount ? (amount.skipped || amount.match || !amountCritical) : null,
  };
}

/** 汇总报告字符串 */
function renderReport(fixtures, resultsByFixtureId) {
  const evals = [];
  for (const fx of fixtures || []) {
    const res = resultsByFixtureId[fx.id];
    if (!res) continue; // 无结果 → 不参与统计（报告尾部提示 pending）
    evals.push(evaluateFixture(fx, res));
  }
  const pending = (fixtures || []).filter(fx => !resultsByFixtureId[fx.id]).map(fx => fx.id);

  const lines = [];
  lines.push('══════════ OCR Critical-Field Benchmark ══════════');
  if (!evals.length) {
    lines.push('（无已捕获结果：请先在浏览器运行识别并写入 tests/ocr/results/<id>.json，或用 --demo 查看格式）');
    lines.push('未捕获结果的 fixture: ' + (pending.join(', ') || '无'));
    lines.push('══════════════════════════════════════════════════');
    return lines.join('\n');
  }

  // 逐字段汇总
  const fieldTotals = {};
  for (const f of Object.keys(FIELD_COMPARATORS)) {
    const hits = evals.filter(e => e.fields[f] && !e.fields[f].skipped && e.fields[f].match).length;
    const total = evals.filter(e => e.fields[f] && !e.fields[f].skipped).length;
    fieldTotals[f] = { hits, total };
  }
  const amountEval = evals.filter(e => e.amountExact != null);
  const amountHits = amountEval.filter(e => e.amountExact).length;
  const criticalErrors = evals.filter(e => e.amountCritical).length;

  lines.push('── 逐字段 Exact Match ──');
  for (const [f, { hits, total }] of Object.entries(fieldTotals)) {
    const pct = total ? Math.round(hits / total * 1000) / 10 : null;
    lines.push(`   ${f.padEnd(10)} ${hits}/${total}${pct != null ? '  (' + pct + '%)' : ''}`);
  }
  lines.push('── 金额指标（P0）──');
  lines.push(`   Amount Exact           ${amountHits}/${amountEval.length}`);
  lines.push(`   Critical Financial Err  ${criticalErrors} 次  ${amountEval.length ? Math.round(criticalErrors / amountEval.length * 100) : 0}%`);
  lines.push('── 明细 ──');
  for (const e of evals) {
    const amt = e.fields.amount;
    const amtTag = amt.skipped ? 'n/a' : (amt.match ? '✓' : (e.amountCritical ? '✗✗CRIT' : '✗'));
    lines.push(`   ${e.fixtureId.padEnd(24)} ${(e.documentType || '').padEnd(8)} amount=${amtTag} exact=${e.exactCount}/${e.evaluatedCount} engine=${e.engine || '?'} ${e.processingMs != null ? e.processingMs + 'ms' : ''}`);
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
    } catch (e) { console.warn('[benchmark] 忽略损坏结果文件:', f, e.message); }
  }
  return out;
}

/** 演示数据（--demo） */
function demoResults() {
  return {
    'mx-cfdi-sample-001': {
      fixtureId: 'mx-cfdi-sample-001', engine: 'fusion', backend: 'wasm', processingMs: 1840,
      fields: { amount: '656.38', date: '2026-08-01', merchant: null, taxId: 'XAXX010101000', reference: null, payment: 'EFECTIVO' },
      rawText: 'DEMO', preprocessProfile: 'normal',
    },
    'mx-retail-sample-002': {
      fixtureId: 'mx-retail-sample-002', engine: 'paddle', backend: 'webgpu', processingMs: 960,
      // 演示 $→5 金额严重错误：应为 60.00，识别成 560.00
      fields: { amount: '560.00', date: '2026-08-02', merchant: 'OXXO', taxId: null, reference: null, payment: null },
      rawText: 'DEMO', preprocessProfile: 'thermal',
    },
  };
}

/* ================== CLI ================== */
function main(argv) {
  const fixtures = loadManifest();
  if (argv.includes('--check-manifest')) {
    console.log('manifest fixtures: ' + fixtures.length);
    for (const f of fixtures) {
      const ok = f.id && f.file && f.expected;
      console.log(`   ${ok ? '✔' : '✘'} ${f.id || '?'}  ${f.documentType || ''}  file=${f.file || '?'}  expected=${ok ? Object.keys(f.expected).length + '字段' : '缺失'}`);
    }
    return;
  }
  const results = argv.includes('--demo') ? demoResults() : loadResults();
  console.log(renderReport(fixtures, results));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  normalizeAmount, amountExact, isCriticalAmountError, dateExact, textExact,
  evaluateFixture, renderReport, FIELD_COMPARATORS,
  loadManifest, loadResults, main,
};
