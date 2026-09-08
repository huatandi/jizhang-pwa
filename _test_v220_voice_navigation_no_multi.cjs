'use strict';
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const plannerSrc=fs.readFileSync('js/voice/action-planner.js','utf8');
const sandbox={globalThis:{}}; vm.createContext(sandbox); vm.runInContext(plannerSrc,sandbox);
const P=sandbox.globalThis.VoiceActionPlanner;
assert(P && P.VERSION>=2);
for (const [s,page] of [['切换到收入页面','income'],['进入支出页面','expense'],['打开收入记账','income'],['前往支出界面','expense']]) {
  const p=P.plan(s,{}); assert.equal(p.actions.length,1,s); assert.equal(p.actions[0].type,'NAVIGATE_PAGE',s); assert.equal(p.actions[0].value,page,s);
}
for (const [s,t] of [['收入','income'],['支出','expense'],['选择收入','income']]) {
  const p=P.plan(s,{}); assert.equal(p.actions[0].type,'SET_ENTRY_TYPE',s); assert.equal(p.actions[0].value,t,s);
}
const q=fs.readFileSync('js/voice/quick-voice.js','utf8');
assert(!q.includes('VoiceParser.splitEntries(buffer, kind)'), 'quick voice must not auto split into multiple entries');
assert(!q.includes('识别到 ${voiceMultiEntries.length} 笔'), 'multi recognition prompt must be removed');
assert(!q.includes('保存全部'), 'multi save prompt must be removed');
assert(q.includes("action.type === 'NAVIGATE_PAGE'"));
assert(q.includes("gotoPage(action.value)"));
console.log('V220 voice navigation/no-multi gate: 12/12 PASS');
