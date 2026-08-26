'use strict';
/**
 * OCR V7 日期解析 golden 测试（P0-2 补齐）：
 * 覆盖 resolveDate / parseDateCandidate 的边界——西语月名、粘连(20AGO2026)、
 * FECHA/VENCE 加权、baseFields 兜底、无日期 → null。
 * result 形态：{ lines:[{text,...}] }（linesOf 支持）或 { fullText }。
 */
const path = require('path');
global.window = global;
global.OcrKit = global.OcrKit || {};
require(path.join(__dirname, 'js/intelligence/document-intelligence-v7.js'));
const D7 = global.OcrKit.documentIntelligenceV7;

let pass = 0, fail = 0;
function assert(name, cond, detail) { if (cond) { pass++; console.log('  ' + name); } else { fail++; console.log('  X ' + name + (detail ? '  -> ' + detail : '')); } }
const R = (lines) => ({ lines });

function main() {
  if (!D7 || typeof D7.resolveDate !== 'function') { console.log('ERROR: resolveDate not exported'); process.exit(1); }

  console.log('\n[1] 常见分隔日期');
  let r = D7.resolveDate(R([{ text: '12/08/2026' }]), {});
  assert('DD/MM/YYYY → 2026-08-12', r.value === '2026-08-12', JSON.stringify(r.value));
  r = D7.resolveDate(R([{ text: '2026-08-12' }]), {});
  assert('YYYY-MM-DD → 2026-08-12', r.value === '2026-08-12', JSON.stringify(r.value));
  r = D7.resolveDate(R([{ text: '15-09-2026' }]), {});
  assert('DD-MM-YYYY → 2026-09-15', r.value === '2026-09-15', JSON.stringify(r.value));

  console.log('\n[2] 西语月份');
  r = D7.resolveDate(R([{ text: '12 de agosto de 2026' }]), {});
  assert('12 de agosto de 2026 → 2026-08-12', r.value === '2026-08-12', JSON.stringify(r.value));
  r = D7.resolveDate(R([{ text: '15 de septiembre 2026' }]), {});
  assert('15 de septiembre 2026 → 2026-09-15', r.value === '2026-09-15', JSON.stringify(r.value));

  console.log('\n[3] OCR 粘连日期（V7.2）');
  r = D7.resolveDate(R([{ text: 'FECHA: 20AGO2026' }]), {});
  assert('20AGO2026(粘连) → 2026-08-20', r.value === '2026-08-20', JSON.stringify(r.value));
  r = D7.resolveDate(R([{ text: '20AGOSTO2026' }]), {});
  assert('20AGOSTO2026 → 2026-08-20', r.value === '2026-08-20', JSON.stringify(r.value));

  console.log('\n[4] 字段加权(FECHA 加成 / 多行取 FECHA)');
  r = D7.resolveDate(R([{ text: 'FECHA 15/09/2026' }, { text: 'SUBTOTAL 100' }]), {});
  assert('FECHA 行优于其他 → 2026-09-15', r.value === '2026-09-15', JSON.stringify(r.value));
  r = D7.resolveDate(R([{ text: 'TOTAL 121', bbox: [0,0,1,1] }, { text: 'FECHA 15/09/2026', bbox: [0,0,1,1] }]), {});
  assert('多行取 FECHA → 2026-09-15', r.value === '2026-09-15', JSON.stringify(r.value));

  console.log('\n[5] fullText 形态 + baseFields 兜底 + 无日期');
  r = D7.resolveDate({ fullText: 'SUBTOTAL 100\nTOTAL 121\nFECHA 15/09/2026' }, {});
  assert('fullText 分行取 FECHA → 2026-09-15', r.value === '2026-09-15', JSON.stringify(r.value));
  r = D7.resolveDate({ lines: [] }, { date: '2026-08-24' });
  assert('无行但 baseFields.date → 2026-08-24', r.value === '2026-08-24', JSON.stringify(r.value));
  r = D7.resolveDate({ lines: [{ text: 'SIN FECHA 001' }] }, {});
  assert('无日期候选 → value null', r.value === null, JSON.stringify(r.value));

  console.log('\n=== OCR V7 日期 golden: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  if (fail) process.exit(1);
}
main();
