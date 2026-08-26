'use strict';
/**
 * _test_core.cjs —— AppCore 基础设施测试（V3.0 Phase0C）
 * 覆盖：ErrorCodes / FeatureFlags / Capability / Diagnostics
 * 零依赖：vm 沙箱加载 js/core/*.js，Node 环境模拟。
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
  s.navigator = { language: 'zh-CN', deviceMemory: 8, maxTouchPoints: 5, onLine: true };
  vm.createContext(s);
  const CORE = path.join(__dirname, 'js', 'core');
  for (const f of ['error-codes.js', 'feature-flags.js', 'capability.js', 'diagnostics.js']) {
    vm.runInContext(fs.readFileSync(path.join(CORE, f), 'utf8'), s);
  }
  return s;
}

function main() {
  const s = makeSandbox();
  const C = s.AppCore;

  console.log('\n[1] ErrorCodes');
  assert('CODES 含 OCR_INIT_FAILED', C.ErrorCodes.CODES.OCR_INIT_FAILED === 'OCR_INIT_FAILED');
  assert('message 中文', C.ErrorCodes.message('DB_MIGRATION_FAILED', 'zh') === '数据库升级失败，请勿继续写入');
  assert('message 英文', C.ErrorCodes.message('WEATHER_PROVIDER_FAILED', 'en') === 'Weather provider failed');
  assert('message 西语', C.ErrorCodes.message('ASR_NO_SPEECH', 'es') === 'No entendí, repite por favor');
  assert('error() 带 code', (() => { const e = C.ErrorCodes.error('OCR_LOW_CONFIDENCE', 'conf=0.3'); return e.code === 'OCR_LOW_CONFIDENCE' && /置信度/.test(e.message); })());
  assert('未知码回退 UNKNOWN', C.ErrorCodes.message('NOPE') === '未知错误');

  console.log('\n[2] FeatureFlags');
  assert('默认 ocrV7Intelligence=true', C.FeatureFlags.isEnabled('ocrV7Intelligence') === true);
  assert('默认 ocrWebGpu=false', C.FeatureFlags.isEnabled('ocrWebGpu') === false);
  assert('默认 cloudSync=false（隐私）', C.FeatureFlags.isEnabled('cloudSync') === false);
  C.FeatureFlags.setLocal('ocrWebGpu', true);
  assert('LOCAL_SETTING 覆盖后 true', C.FeatureFlags.isEnabled('ocrWebGpu') === true);
  C.FeatureFlags.override('ocrWebGpu', false);
  assert('RUNTIME_OVERRIDE 覆盖 false', C.FeatureFlags.isEnabled('ocrWebGpu') === false);
  C.FeatureFlags.resetAll();
  assert('reset 后回默认 false', C.FeatureFlags.isEnabled('ocrWebGpu') === false);
  C.FeatureFlags.kill('glmOcrRescue');
  assert('kill 后强制 false', C.FeatureFlags.isEnabled('glmOcrRescue') === false);
  C.FeatureFlags.resetAll();

  console.log('\n[3] Capability');
  (async () => {
    const p = await C.Capability.detect();
    assert('wasm=true（Node 支持）', p.wasm === true);
    assert('sab=true（Node 有 SharedArrayBuffer）', p.sab === true);
    assert('memoryGb=8（模拟）', p.memoryGb === 8);
    assert('touch=true（模拟）', p.touch === true);
    assert('webspeech 为 boolean', typeof p.webspeech === 'boolean');
    assert('getSync 返回 profile', !!C.Capability.getSync());

    console.log('\n[4] Diagnostics');
    const d = C.Diagnostics;
    d.clear();
    d.log({ module: 'ocr', operation: 'paddle', durationMs: 120, success: true });
    d.log({ module: 'ocr', operation: 'parse', durationMs: 35, success: true });
    d.log({ module: 'asr', operation: 'init', durationMs: 800, success: false, errorCode: 'ASR_MODEL_FETCH_FAILED' });
    assert('记录 3 条', d.list().length === 3);
    assert('summary 按模块分组', d.summary().byModule.ocr.total === 2 && d.summary().byModule.asr.fail === 1);
    // timer
    const stop = d.timer('weather', 'fetch');
    stop(true);
    assert('timer 增加 1 条', d.list().length === 4);
    // timed async
    (async () => {
      await d.timed('db', 'open', async () => 1);
      assert('timed 成功记录', d.list().some(e => e.module === 'db' && e.success));
      const json = d.exportJSON();
      assert('exportJSON 可解析', (() => { try { JSON.parse(json); return true; } catch (e) { return false; } })());
      assert('环形上限', d.MAX_ENTRIES === 200);
      d.clear();
      assert('clear 后为空', d.list().length === 0);
      console.log('\n=== AppCore 基础设施测试完成:' + pass + ' 通过 / ' + fail + ' 失败 ===');
      process.exit(fail ? 1 : 0);
    })().catch(e => { console.error(e); process.exit(1); });
  })().catch(e => { console.error(e); process.exit(1); });
}

main();
