'use strict';
/**
 * _test_runtime_assets.cjs —— RuntimeAssetManager + ModelSourceRouter 测试（V3.0 §十二/§十三）
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
  const s = { window: {}, console, setTimeout, clearTimeout, requestIdleCallback: undefined };
  s.window = s;
  const store = {};
  s.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  vm.createContext(s);
  const CORE = path.join(__dirname, 'js', 'core');
  for (const f of ['error-codes.js', 'feature-flags.js', 'capability.js', 'diagnostics.js', 'runtime-asset-manager.js', 'model-source-router.js']) {
    vm.runInContext(fs.readFileSync(path.join(CORE, f), 'utf8'), s);
  }
  return s;
}

function main() {
  const s = makeSandbox();
  const RA = s.AppCore.RuntimeAssets;
  const MR = s.AppCore.ModelRouter;

  console.log('\n[1] RuntimeAssetManager 状态机');
  RA.register('test-engine', { load: async () => ({ ok: 1 }) });
  assert('初始 UNLOADED', RA.getStatus('test-engine') === RA.STATE.UNLOADED);
  (async () => {
    const inst = await RA.loadRuntime('test-engine');
    assert('加载后 READY', RA.getStatus('test-engine') === RA.STATE.READY);
    assert('实例返回', inst && inst.ok === 1);
    const inst2 = await RA.loadRuntime('test-engine');
    assert('重复加载返回缓存实例', inst2 && inst2.ok === 1);

    // 失败引擎
    RA.register('fail-engine', { load: async () => { throw new Error('boom'); } });
    const f = await RA.loadRuntime('fail-engine');
    assert('失败引擎返回 null', f === null);
    assert('失败状态 FAILED', RA.getStatus('fail-engine') === RA.STATE.FAILED);

    // clearCache
    RA.clearCache('test-engine');
    assert('clearCache 后 UNLOADED', RA.getStatus('test-engine') === RA.STATE.UNLOADED);

    // statusReport
    const rep = RA.statusReport();
    assert('statusReport 含引擎', typeof rep['test-engine'] === 'string');

    // abort
    RA.register('abort-engine', { load: async () => { await new Promise(r => setTimeout(r, 50)); return 1; } });
    RA.abort('abort-engine');
    assert('abort 后状态 UNLOADED', RA.getStatus('abort-engine') === RA.STATE.UNLOADED);

    console.log('\n[2] ModelSourceRouter');
    const cands = MR.resolveCandidates('Xenova/whisper-tiny', 'onnx/model_quantized.onnx');
    assert('候选含 huggingface', cands.some(c => c.source === 'huggingface'));
    assert('候选含 jsdelivr', cands.some(c => c.source === 'jsdelivr'));
    assert('候选含 local', cands.some(c => c.source === 'local'));
    assert('huggingface URL 正确', cands.find(c => c.source === 'huggingface').url === 'https://huggingface.co/Xenova/whisper-tiny/resolve/main/onnx/model_quantized.onnx');

    // 失败负缓存：标记 huggingface 失败 → 候选不再含它
    MR.markFailure('Xenova/whisper-tiny', 'huggingface');
    const cands2 = MR.resolveCandidates('Xenova/whisper-tiny', 'onnx/model_quantized.onnx');
    assert('负缓存后排除 huggingface', !cands2.some(c => c.source === 'huggingface'));
    assert('仍含 jsdelivr', cands2.some(c => c.source === 'jsdelivr'));
    MR.markSuccess('Xenova/whisper-tiny', 'huggingface');
    const cands3 = MR.resolveCandidates('Xenova/whisper-tiny', 'onnx/model_quantized.onnx');
    assert('成功后恢复 huggingface', cands3.some(c => c.source === 'huggingface'));

    MR.resetSession();
    assert('resetSession 清空健康状态', MR.isHealthy('Xenova/whisper-tiny', 'huggingface') === true);

    console.log('\n=== Runtime Asset Manager 测试完成:' + pass + ' 通过 / ' + fail + ' 失败 ===');
    process.exit(fail ? 1 : 0);
  })().catch(e => { console.error(e); process.exit(1); });
}

main();
