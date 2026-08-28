'use strict';
/**
 * tests/run-all.cjs —— 统一测试入口（V3.0 §四）
 *
 * 遍历执行仓库内全部可跑测试：
 *   1. 根目录 _test_*.cjs（27 个，零依赖 node 可跑）
 *   2. tests/ocr/benchmark.cjs（OCR 基准）
 *
 * 跳过：依赖外部服务/浏览器/Desktop 专有模块的测试（见 SKIP 名单，CI 无此环境）。
 *
 * 用法：
 *   npm test            # 全部
 *   SKIP=1 npm test     # 跳过环境类
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const skipEnv = process.env.SKIP === '1';

// 环境类/需浏览器/需 Desktop 专有模块（V3.0 §四：Browser Runtime 测试后续用 Playwright 覆盖）
const ENV_ONLY = [
  // 需本地服务器 / SQLite 沙箱 / Node 版本特殊
  'test_ai_confirm', 'test_mex_banks', 'test_module_load', 'test_ocr_e2e',
  'test_reupload', 'test_runtime', 'test_ticket_api', 'test_ticket_e2e',
  // 依赖 Desktop 专有栈 server/financial-ai + npm(jimp/tesseract.js)
  'test_ai_pipeline', 'test_fuel_parser', 'test_ocr_fix', 'test_multilang',
  'test_receipts', 'test_similar_receipts', 'test_tickets', 'test_ticket_e2e',
];

function collect() {
  const tests = [];
  // 根目录 _test_*.cjs
  for (const f of fs.readdirSync(ROOT)) {
    if (/^_test_.*\.cjs$/.test(f)) tests.push(path.join(ROOT, f));
  }
  // tests/ocr/benchmark.cjs（若存在）
  const bench = path.join(ROOT, 'tests', 'ocr', 'benchmark.cjs');
  if (fs.existsSync(bench)) tests.push(bench);
  return tests.sort();
}

function main() {
  const tests = collect();
  let pass = 0, fail = 0, skipped = 0;
  const failures = [];
  for (const t of tests) {
    const base = path.basename(t).replace(/\.(cjs|js)$/, '');
    if (skipEnv && ENV_ONLY.includes(base)) { skipped++; console.log('SKIP ' + path.relative(ROOT, t) + ' (环境类)'); continue; }
    const r = spawnSync(process.execPath, [t], { stdio: 'inherit', cwd: ROOT });
    if (r.status === 0) { pass++; console.log('PASS ' + path.relative(ROOT, t)); }
    else { fail++; failures.push(path.relative(ROOT, t)); }
  }
  console.log('\n=== 测试汇总: ' + pass + ' 通过, ' + fail + ' 失败, ' + skipped + ' 跳过 ===');
  if (failures.length) console.log('失败列表: ' + failures.join(', '));

  // Golden benchmark（有 results 出真值 KPI；无 results 用 --demo 验证计算器本身）
  const runBench = (label, script, args) => {
    console.log('\n══════ ' + label + ' ══════');
    const r = spawnSync(process.execPath, [script].concat(args || []), { stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) fail++;
  };
  if (fail === 0) {
    runBench('OCR Golden Benchmark', path.join(ROOT, 'tests', 'ocr', 'benchmark.cjs'), ['--demo']);
    runBench('Voice Golden Benchmark', path.join(ROOT, 'tests', 'voice', 'benchmark.cjs'), ['--demo']);
  } else {
    console.log('\n（单元测试有失败，跳过 benchmark）');
  }
  process.exit(fail ? 1 : 0);
}

main();
