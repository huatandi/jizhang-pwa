const fs=require('fs'),vm=require('vm');
let pass=0,fail=0;function ok(c,m){if(c){console.log('PASS',m);pass++}else{console.error('FAIL',m);fail++}}
const ctx={window:{},globalThis:{},console};ctx.window=ctx;ctx.globalThis=ctx;
// Minimal deterministic ReminderParser stub for boundary tests.
ctx.ReminderParser={
  parse(s){s=String(s||''); let dt=''; if(/明天/.test(s))dt='2099-01-02T15:00'; else if(/后天/.test(s))dt='2099-01-03T10:00'; return {datetime:dt};},
  parseAdvance(s){return /一小时|1小时/.test(String(s))?60:0;}
};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/voice/reminder-dialogue-engine.js','utf8'),ctx);
const E=ctx.ReminderDialogueEngine;
E.reset();let p=E.plan('事项 移民局 提醒时间 明天下午三点 地点 移民局 提醒方式 响铃');
const M=Object.fromEntries(p.actions.map(a=>[a.slot,a.value]));
ok(M.content==='移民局','single utterance content stops before 提醒时间');
ok(M.time==='2099-01-02T15:00','single utterance routes time');
ok(M.location==='移民局','single utterance routes location');
ok(M.method==='ring','single utterance routes reminder method');
ok(!/提醒时间|地点|提醒方式/.test(M.content||''),'field labels never leak into content');
E.reset();p=E.plan('事项 移民局 提醒');let m=Object.fromEntries(p.actions.map(a=>[a.slot,a.value]));
ok(m.content==='移民局','trailing partial 提醒 is held, not written to title');
p=E.plan('时间 明天');m=Object.fromEntries(p.actions.map(a=>[a.slot,a.value]));
ok(m.time==='2099-01-02T15:00','split ASR boundary 提醒 + 时间 is recovered');
E.reset();p=E.plan('地点 移民局 提醒办事 响铃');m=Object.fromEntries(p.actions.map(a=>[a.slot,a.value]));
ok(m.location==='移民局','ASR 提醒办事 does not contaminate location');
ok(m.method==='ring','ASR 提醒办事 is context-repaired to 提醒方式 when followed by 响铃');
const q=fs.readFileSync('js/voice/quick-voice.js','utf8');
ok(!q.includes('applyVoiceText(voiceBuffer); // Shadow Parser'), 'quick voice no longer replays full draft during CONTENT');
ok(q.includes("applyVoiceText(String(r.final || '').trim());"),'quick fallback parses current final only');
const rem=fs.readFileSync('js/voice/reminders.js','utf8');
ok(rem.includes('提醒语义引擎未就绪，已停止写入以避免串字段'),'reminder fails closed if dialogue engine unavailable');
ok(rem.includes('V223 pre-write guard'),'reminder contamination guard runs before DOM write');
console.log(`RESULT ${pass} PASS / ${fail} FAIL`);process.exit(fail?1:0);
