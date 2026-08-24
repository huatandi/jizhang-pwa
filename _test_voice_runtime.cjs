'use strict';
/**
 * Voice Runtime Foundation 测试(V5 Phase1 保险1/2/6/7/8)
 */
const path = require('path');
global.window = global;
try { Object.defineProperty(global, 'navigator', { value: { deviceMemory: 8, hardwareConcurrency: 8 }, configurable: true, writable: true }); } catch (e) {}

require(path.join(__dirname, 'js/asr/voice-runtime-profile.js'));
require(path.join(__dirname, 'js/asr/circuit-breaker.js'));
require(path.join(__dirname, 'js/asr/audio-focus.js'));
require(path.join(__dirname, 'js/asr/model-manager.js'));

const RT = global.AsrKit.runtime;
const CB = global.AsrKit.circuitBreaker;
const AF = global.AsrKit.audioFocus;
const MM = global.AsrKit.modelManager;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. Feature Flags(保险8)
  console.log('\n[1] Feature Flags + Kill Switch');
  assert('默认 whisperV2Pipeline=true', RT.getFlags().whisperV2Pipeline === true);
  assert('默认 adaptiveVadEnabled=false', RT.isEnabled('adaptiveVadEnabled') === false);
  RT.setFlag('adaptiveVadEnabled', true);
  assert('setFlag 生效(本地覆盖)', RT.isEnabled('adaptiveVadEnabled') === true);
  RT.resetFlags();
  assert('resetFlags 恢复默认', RT.isEnabled('adaptiveVadEnabled') === false);

  // 2. 能力探测(保险1)
  console.log('\n[2] VoiceRuntimeProfile 能力探测');
  const cap = await RT.detect();
  assert('wasm 可探测', typeof cap.wasm === 'boolean');
  assert('sab/isolated 布尔', typeof cap.sab === 'boolean' && typeof cap.isolated === 'boolean');
  assert('profile 缓存', RT.getProfileSync() === cap);
  assert('asrBackendPlan 给出 engine', !!RT.asrBackendPlan(cap).engine);

  // 3. 设备熔断(保险7)
  console.log('\n[3] DeviceCircuitBreaker');
  CB.reset();
  assert('初始未熔断', CB.isDisabled('whisper') === false);
  CB.markFailure('whisper', 't1'); CB.markFailure('whisper', 't2');
  assert('失败2次未熔断', CB.isDisabled('whisper') === false);
  CB.markFailure('whisper', 't3');
  assert('失败3次→熔断', CB.isDisabled('whisper') === true);
  assert('记录次数=3', CB.state('whisper').failures === 3);
  CB.markSuccess('whisper');
  assert('成功复位', CB.isDisabled('whisper') === false && CB.state('whisper').failures === 0);
  CB.reset();

  // 4. AudioFocus 状态机(保险6)
  console.log('\n[4] AudioFocus');
  AF.getIdle();
  assert('初始 IDLE', AF.getState() === AF.STATES.IDLE);
  AF.beginListening();
  assert('listen→LISTENING 未抑制', AF.getState() === 'LISTENING' && AF.isAsrSuppressed() === false);
  AF.beginSpeaking();
  assert('speak→SPEAKING 抑制', AF.getState() === 'SPEAKING' && AF.isAsrSuppressed() === true);
  let resumed = false;
  AF.setResumeDelay(20);
  AF.onChange((s) => { if (s === 'LISTENING') resumed = true; });
  AF.endSpeaking();
  assert('endSpeaking 后短暂抑制', AF.isAsrSuppressed() === true);
  await sleep(60);
  assert('延时后恢复 LISTENING', AF.getState() === 'LISTENING' && AF.isAsrSuppressed() === false && resumed === true);
  AF.beginProcessing();
  assert('processing 抑制', AF.isAsrSuppressed() === true);
  AF.getIdle();
  assert('idle 解除抑制', AF.isAsrSuppressed() === false);

  // 5. ModelHealth(保险2)
  console.log('\n[5] ModelHealth');
  const plan = MM.resolvePlan('low');
  assert('未安装→NOT_INSTALLED', (await MM.healthState(plan)) === 'NOT_INSTALLED');
  await MM.markHealth(plan, 'INCOMPATIBLE');
  assert('标记 INCOMPATIBLE', (await MM.healthState(plan)) === 'INCOMPATIBLE');
  await MM.markSelfTestPassed(plan, { ok: true });
  assert('Self-Test通过→READY', (await MM.healthState(plan)) === 'READY');

  console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('测试异常:', e); process.exit(1); });
