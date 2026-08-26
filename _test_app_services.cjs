'use strict';
/**
 * _test_app_services.cjs —— AppServices + Core Contracts 测试（V3.0 §十八/§二十九）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? ' → ' + detail : '')); }
}

function makeSandbox() {
  const s = { window: {}, console };
  s.window = s;
  const store = {};
  s.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  // 模拟既有全局（供 autoRegister 注册）
  s.VoiceSR = { listen: () => {} };
  s.FxTool = { refresh: () => {} };
  vm.createContext(s);
  const CORE = path.join(__dirname, 'js', 'core');
  for (const f of ['error-codes.js', 'feature-flags.js', 'capability.js', 'diagnostics.js', 'runtime-asset-manager.js', 'model-source-router.js', 'app-services.js']) {
    vm.runInContext(fs.readFileSync(path.join(CORE, f), 'utf8'), s);
  }
  // db 模块（migrations/health-check 挂 AppCore）
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'db', 'migrations.js'), 'utf8'), s);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', 'db', 'health-check.js'), 'utf8'), s);
  return s;
}

function main() {
  const s = makeSandbox();
  const AS = s.AppCore.AppServices;

  console.log('\n[1] AppServices 注册表');
  AS.register('test', { x: 1 });
  assert('register+get', AS.get('test').x === 1);
  assert('has 存在', AS.has('test') === true);
  assert('has 不存在', AS.has('nope') === false);
  assert('keys 含 test', AS.keys().includes('test'));

  console.log('\n[2] autoRegister 兼容既有全局');
  AS.autoRegister();
  assert('注册 voice', AS.has('voice') === true);
  assert('注册 fx', AS.has('fx') === true);
  assert('注册 errorCodes', AS.has('errorCodes') === true);
  assert('注册 dbMigration', AS.has('dbMigration') === true);

  console.log('\n[3] Core Contracts 校验');
  const ok = AS.validateContract('ocr', 'OcrResult', { text: 'x', fields: [], confidence: 0.9, engine: 'paddle', durationMs: 10, trace: [] });
  assert('OCR 契约完整通过', ok.ok === true, JSON.stringify(ok));
  const bad = AS.validateContract('ocr', 'OcrResult', { text: 'x' });
  assert('OCR 契约缺字段检测', bad.ok === false && bad.missing.includes('confidence'));
  const vOk = AS.validateContract('voice', 'VoiceIntent', { type: 'day', day: 'today', lang: 'zh' });
  assert('Voice 契约通过', vOk.ok === true);
  const wOk = AS.validateContract('weather', 'WeatherEvent', { id: 'r1', type: 'rain', startTime: '', peakTime: '', endTime: '', severity: '', metrics: {} });
  assert('Weather 契约通过', wOk.ok === true);
  const unknown = AS.validateContract('ocr', 'Nope', {});
  assert('未知契约 known=false', unknown.known === false);
  assert('CONTRACTS 含三域', !!AS.CONTRACTS.ocr && !!AS.CONTRACTS.voice && !!AS.CONTRACTS.weather);

  console.log('\n=== AppServices 测试完成:' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail ? 1 : 0);
}

main();
