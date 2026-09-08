'use strict';
/**
 * Regression Gate（V7.0 §30）—— 统一回归门禁
 *
 * 职责：任何 Voice / OCR / Parser / Memory / Entity / Region / Provider 修改后，必须跑本门禁：
 *   1. 执行仓库内全部可跑测试（复用 tests/run-all.cjs 的收集逻辑）；
 *   2. 校验 OCR / Voice Golden dataset manifest；存在真实 results 时才输出真实 KPI；绝不以 demo 结果作为发布门禁；
 *   3. 汇总 PASS / FAIL 与关键指标，输出报告。
 *
 * 用法：
 *   node tests/regression-gate.cjs            # 全量回归（测试 + benchmark）
 *   node tests/regression-gate.cjs --tests    # 仅跑单元测试
 *   node tests/regression-gate.cjs --bench    # 仅跑 Golden 数据门禁（manifest + 已捕获真实 results）
 *
 * 退出码：0 = 通过；1 = 有失败（供 CI / 手动门禁）。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/* ================== 测试收集（与 run-all.cjs 一致） ================== */
const NETWORK_ONLY = new Set(['_test_fx']);
const ENV_ONLY = [
  'test_ai_confirm', 'test_mex_banks', 'test_module_load', 'test_ocr_e2e',
  'test_reupload', 'test_runtime', 'test_ticket_api', 'test_ticket_e2e',
  'test_ai_pipeline', 'test_fuel_parser', 'test_ocr_fix', 'test_multilang',
  'test_receipts', 'test_similar_receipts', 'test_tickets', 'test_ticket_e2e',
];

function collectTests() {
  const tests = [];
  for (const f of fs.readdirSync(ROOT)) {
    if (/^_test_.*\.cjs$/.test(f)) tests.push(path.join(ROOT, f));
  }
  const bench = path.join(ROOT, 'tests', 'ocr', 'benchmark.cjs');
  if (fs.existsSync(bench)) tests.push(bench);
  return tests.sort();
}

function runTests() {
  const tests = collectTests();
  let pass = 0, fail = 0, skipped = 0;
  const failures = [];
  for (const t of tests) {
    const base = path.basename(t).replace(/\.(cjs|js)$/, '');
    if (NETWORK_ONLY.has(base)) { skipped++; console.log('SKIP ' + path.relative(ROOT, t) + ' (网络类)'); continue; }
    if (ENV_ONLY.includes(base)) { skipped++; console.log('SKIP ' + path.relative(ROOT, t) + ' (环境类)'); continue; }
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    if (r.status === 0) { pass++; console.log('PASS ' + path.relative(ROOT, t)); }
    else {
      fail++;
      failures.push(path.relative(ROOT, t));
      console.log('FAIL ' + path.relative(ROOT, t));
      if (r.stderr) console.log('  stderr: ' + r.stderr.split('\n').slice(-4).join('\n  '));
    }
  }
  console.log(`\n── 单元测试: ${pass} pass / ${fail} fail / ${skipped} skip ──`);
  if (failures.length) console.log('失败列表: ' + failures.join(', '));
  return { pass, fail, skipped };
}

function runBenchmark(label, script, args) {
  console.log('\n══════ ' + label + ' ══════');
  const r = spawnSync(process.execPath, [script].concat(args || []), { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  if (r.status === 0) { console.log(r.stdout); return true; }
  console.log('FAIL ' + label);
  if (r.stderr) console.log('  stderr: ' + r.stderr);
  return false;
}

/* ================== Main ================== */
function main(argv) {
  const onlyTests = argv.includes('--tests');
  const onlyBench = argv.includes('--bench');
  let ok = true;

  if (!onlyBench) {
    const tr = runTests();
    if (tr.fail > 0) ok = false;
  }
  if (!onlyTests) {
    const ocrScript = path.join(ROOT, 'tests', 'ocr', 'benchmark.cjs');
    const voiceScript = path.join(ROOT, 'tests', 'voice', 'benchmark.cjs');
    const ocrOk = runBenchmark('OCR Golden Dataset Manifest', ocrScript, ['--check-manifest']);
    const voiceOk = runBenchmark('Voice Golden Dataset Manifest', voiceScript, ['--check-manifest']);
    if (!ocrOk || !voiceOk) ok = false;
    const hasJson = (dir) => fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.endsWith('.json'));
    const ocrResults = path.join(ROOT, 'tests', 'ocr', 'results');
    const voiceResults = path.join(ROOT, 'tests', 'voice', 'results');
    if (hasJson(ocrResults)) ok = runBenchmark('OCR Golden Release Gate (captured real results)', ocrScript, ['--gate']) && ok;
    else console.log('\nINFO OCR: 未发现真实浏览器 results，跳过真实性 KPI；不会使用 demo 冒充。');
    if (hasJson(voiceResults)) ok = runBenchmark('Voice Golden Release Gate (captured real results)', voiceScript, ['--gate']) && ok;
    else console.log('INFO Voice: 未发现真实设备 results，跳过真实性 KPI；不会使用 demo 冒充。');
  }

  console.log('\n══════════════════════════════════════════');
  console.log(ok ? '✅ REGRESSION GATE: PASS' : '❌ REGRESSION GATE: FAIL');
  console.log('══════════════════════════════════════════');
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { collectTests, runTests, runBenchmark, main, ENV_ONLY };
