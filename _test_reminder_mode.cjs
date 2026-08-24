'use strict';
/**
 * 语音选择"提醒方式"(语音播报/响铃/震动)测试（V5）：
 * tryRemindModeByVoice(text) —— 只要/关闭/开启 + 方式关键词 → 切换对应 checkbox。
 */
const path = require('path');
global.window = global;
const _ls = {};
global.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};
const els = {};
function fakeEl() {
  return {
    value: '', textContent: '', innerHTML: '', disabled: false, checked: true,
    style: {}, classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    focus() {}, setAttribute() {}, removeAttribute() {}, click() {}, blur() {},
    options: [],
  };
}
global.document = {
  getElementById: (id) => (els[id] || (els[id] = fakeEl())),
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
};
global.escapeHtml = (s) => String(s);
global.showToast = () => {};
global.speak = () => {};
global.renderReminders = () => {};
global.syncRepeatDayUI = () => {};

require(path.join(__dirname, 'js/voice/reminders.js'));
const mode = global.tryRemindModeByVoice;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

function setDefaults() {
  els['rModeSpeak'] = fakeEl(); els['rModeSpeak'].checked = true;
  els['rModeRing'] = fakeEl(); els['rModeRing'].checked = true;
  els['rModeVibrate'] = fakeEl(); els['rModeVibrate'].checked = true;
}
function read() { return { speak: els['rModeSpeak'].checked, ring: els['rModeRing'].checked, vibrate: els['rModeVibrate'].checked }; }

function main() {
  console.log('\n[1] 只要震动 → 只开震动');
  setDefaults();
  assert('命中', mode('只要震动') === true);
  let r = read();
  assert('speak 关', r.speak === false); assert('ring 关', r.ring === false); assert('vibrate 开', r.vibrate === true);

  console.log('\n[2] 关闭语音播报 → 只关语音播报');
  setDefaults();
  assert('命中', mode('关闭语音播报') === true);
  r = read();
  assert('speak 关', r.speak === false); assert('ring 仍开', r.ring === true); assert('vibrate 仍开', r.vibrate === true);

  console.log('\n[3] 开启响铃 → 开响铃(其余不动)');
  els['rModeRing'] = fakeEl(); els['rModeRing'].checked = false;
  els['rModeSpeak'] = fakeEl(); els['rModeSpeak'].checked = true;
  els['rModeVibrate'] = fakeEl(); els['rModeVibrate'].checked = true;
  assert('命中', mode('开启响铃') === true);
  r = read();
  assert('ring 开', r.ring === true); assert('speak 不动', r.speak === true);

  console.log('\n[4] 无方式关键词 → false(不吞普通语句)');
  setDefaults();
  assert('明天九点开会 → false', mode('明天九点 在办公室 开会') === false);

  console.log('\n[5] 模式关键词即使已设也消费(不落入内容)');
  setDefaults();
  assert('语音播报(已开) → 仍 true(被当命令)', mode('语音播报') === true);

  console.log('\n=== 语音提醒方式测试完成:' + pass + ' 通过 / ' + fail + ' 失败 ===');
  if (fail) process.exit(1);
}

main();
