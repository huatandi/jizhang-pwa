'use strict';
/**
 * 语音"清空字段"命令测试（V5）：
 * tryClearReminderField(text) —— 检测 清空/删除 + 字段名，清空对应输入框。
 */
const path = require('path');
global.window = global;
const _ls = {};
global.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

// 通用 DOM 桩：getElementById 返回一个可写值/无操作方法的假元素
const els = {};
function fakeEl() {
  return {
    value: '', textContent: '', innerHTML: '', disabled: false,
    style: {}, classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    focus() {}, setAttribute() {}, removeAttribute() {}, click() {},
    options: [], blur() {},
  };
}
global.document = {
  getElementById: (id) => (els[id] || (els[id] = fakeEl())),
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
};
// 应用层公共函数桩（reminders.js 依赖 app.js 全局）
global.escapeHtml = (s) => String(s);
global.showToast = () => {};
global.speak = () => {};
global.renderReminders = () => {};
global.syncRepeatDayUI = () => {};

require(path.join(__dirname, 'js/voice/reminders.js'));
const tryClear = global.tryClearReminderField;

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}

function main() {
  // 重置字段值
  els['rContent'] = fakeEl(); els['rContent'].value = '开会';
  els['rLocation'] = fakeEl(); els['rLocation'].value = '办公室';
  els['rNote'] = fakeEl(); els['rNote'].value = '带文件';
  els['rAt'] = fakeEl(); els['rAt'].value = '2024-05-13T09:00';

  console.log('\n[1] 清空 地点');
  assert('清空 地点里的内容 文字 数据 → 命中', tryClear('清空 地点里的内容、文字、数据') === true);
  assert('rLocation 已清空', els['rLocation'].value === '', JSON.stringify(els['rLocation'].value));

  console.log('\n[2] 清空 事项');
  els['rContent'].value = '开会';
  assert('清空 事项 框内数据或内容 → 命中', tryClear('清空 事项 框内数据或内容') === true);
  assert('rContent 已清空', els['rContent'].value === '');

  console.log('\n[3] 别名/西语');
  els['rNote'].value = '带文件';
  assert('删除 备注 → 命中', tryClear('删除 备注') === true);
  assert('rNote 已清空', els['rNote'].value === '');
  els['rLocation'].value = '仓库';
  assert('borrar ubicación → 命中', tryClear('borrar ubicación') === true);
  assert('rLocation 已清空(西语)', els['rLocation'].value === '');

  console.log('\n[4] 时间字段');
  els['rAt'].value = '2024-05-13T09:00';
  assert('清空 时间 → 命中', tryClear('清空 时间') === true);
  assert('rAt 已清空', els['rAt'].value === '');

  console.log('\n[5] 防误清：无字段/无清空动词');
  assert('不含清空动词 → false', tryClear('明天九点 开会') === false);
  assert('只有清空无字段 → false', tryClear('清空') === false);
  assert('空 → false', tryClear('') === false);

  console.log('\n=== 语音清空字段测试完成:' + pass + ' 通过 / ' + fail + ' 失败 ===');
  if (fail) process.exit(1);
}

main();
