'use strict';
/**
 * OCR WebGPU 实验路径基础开关测试（V5）：
 * 确认 paddleWebGpuExperimental 默认关闭（安全、可回退），setFlag/resetFlags 生效，
 * 且不影响既有 Feature Flags。_detectRuntime 的默认(未隔离)路径应仍是 WASM 单线程。
 */
const path = require('path');
global.window = global;

require(path.join(__dirname, 'js/asr/voice-runtime-profile.js'));
const RT = global.AsrKit.runtime;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ' + name); }
  else { fail++; console.log('  X ' + name + (detail ? '  -> ' + detail : '')); }
}

function main() {
  console.log('\n[1] 默认关闭');
  assert('paddleWebGpuExperimental 默认 false', RT.getFlags().paddleWebGpuExperimental === false, RT.getFlags().paddleWebGpuExperimental);
  assert('isEnabled 默认 false', RT.isEnabled('paddleWebGpuExperimental') === false);

  console.log('\n[2] setFlag / resetFlags');
  RT.setFlag('paddleWebGpuExperimental', true);
  assert('setFlag(true) 生效', RT.isEnabled('paddleWebGpuExperimental') === true);
  RT.resetFlags();
  assert('resetFlags 恢复默认 false', RT.isEnabled('paddleWebGpuExperimental') === false);

  console.log('\n[3] 不影响既有 flags');
  assert('selfTestEnabled 仍默认 true', RT.isEnabled('selfTestEnabled') === true);
  assert('whisperV2Pipeline 仍默认 true', RT.isEnabled('whisperV2Pipeline') === true);

  console.log('\n=== OCR WebGPU flag 测试完成: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  if (fail) process.exit(1);
}

main();
