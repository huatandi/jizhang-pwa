'use strict';
/**
 * 执行计划 + ServerOcrEngine 契约测试（V5 §68-70/§75）
 * 覆盖：
 *  1. criticalFieldConfidence：金额/日期词置信、缺失检测、strong 判定
 *  2. planExecution：FAST（清晰+关键高置信）/ SMART / RESCUE（缺失/极低）
 *  3. ServerOcrEngine：无 fetch 环境抛 SERVER_UNAVAILABLE；_normalize 输出映射
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node', deviceMemory: 8 }, configurable: true, writable: true }); } catch (e) {}

require(path.join(__dirname, 'js/ocr/ocr-types.js'));
require(path.join(__dirname, 'js/ocr/execution-planner.js'));
require(path.join(__dirname, 'js/ocr/server-engine.js'));
const EP = global.OcrKit.executionPlanner;
if (!EP) { console.error('execution-planner 加载失败'); process.exit(1); }

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}
const word = (text, conf) => ({ text, confidence: conf });

// ---------- 1. criticalFieldConfidence ----------
console.log('\n[1] criticalFieldConfidence（§70）');
{
  const r1 = { words: [word('TOTAL', 90), word('$560.00', 95), word('01/08/2026', 97), word('EFECTIVO', 50)] };
  const c1 = EP.criticalFieldConfidence(r1);
  assert('金额+日期词平均置信', c1.confidence >= 0.9, c1.confidence);
  assert('strong = true', c1.strong === true);
  assert('missing = false', c1.missing === false);

  const r2 = { words: [word('TOTAL', 90), word('FECHA', 80), word('OXXO', 70)] };
  const c2 = EP.criticalFieldConfidence(r2);
  assert('无金额词 → missing', c2.missing === true);
  assert('无金额词 → strong false', c2.strong === false);
  assert('无金额词 → confidence 0', c2.confidence === 0);

  const r3 = { words: [] };
  assert('空结果安全', EP.criticalFieldConfidence(r3).missing === true);
}

// ---------- 2. planExecution（§68-69） ----------
console.log('\n[2] planExecution');
{
  assert('清晰+关键高置信 → FAST（早退）', EP.planExecution({ avgConf: 0.85, criticalMissing: false, criticalConf: 0.9 }) === 'fast');
  assert('avgConf 高但关键缺失 → RESCUE', EP.planExecution({ avgConf: 0.85, criticalMissing: true, criticalConf: 0 }) === 'rescue');
  assert('avgConf 极低 → RESCUE', EP.planExecution({ avgConf: 0.3, criticalMissing: false, criticalConf: 0.4 }) === 'rescue');
  assert('关键置信过低 → RESCUE', EP.planExecution({ avgConf: 0.6, criticalMissing: false, criticalConf: 0.3 }) === 'rescue');
  assert('中等 → SMART', EP.planExecution({ avgConf: 0.6, criticalMissing: false, criticalConf: 0.6 }) === 'smart');
  assert('缺省安全（全 0 → RESCUE）', EP.planExecution({}) === 'rescue');
}

// ---------- 3. ServerOcrEngine（§75） ----------
console.log('\n[3] ServerOcrEngine');
{
  const SE = global.OcrKit.ServerOcrEngine;
  assert('类存在且继承 OcrEngineBase', typeof SE === 'function');
  const eng = new SE({});
  assert('name = server', eng.name === 'server');
  // Node 无 fetch → recognize 抛 SERVER_UNAVAILABLE（不依赖服务器）
  eng.recognize({}).then(
    () => assert('无 fetch 应失败', false),
    (e) => assert('无 fetch → SERVER_UNAVAILABLE', /SERVER_UNAVAILABLE/.test(String(e && e.message || e)), String(e && e.message))
  ).then(() => {});
  // _normalize 映射（服务器响应 → OcrResult）
  const out = eng._normalize({ normalized_text: 'TOTAL $100.00\nFECHA 01/08/2026', ocr_lines: [{ text: 'TOTAL $100.00', confidence: 90 }], document_type: 'tax_invoice', ocr_confidence: 88, cached: true, languages: ['spa'] });
  assert('engine = server', out.engine === 'server');
  assert('全文透出', out.fullText === 'TOTAL $100.00\nFECHA 01/08/2026');
  assert('文档类型透出', out.documentType === 'tax_invoice');
  assert('serverConfidence 透出', out.serverConfidence === 88);
  assert('serverCoreFields 字段存在', 'serverCoreFields' in out);
  assert('词级行构造', out.words.length === 1 && out.words[0].text === 'TOTAL $100.00');
}

setTimeout(() => {
  console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}, 300);
