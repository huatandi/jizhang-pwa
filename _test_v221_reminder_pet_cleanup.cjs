'use strict';
const fs=require('fs'),vm=require('vm');
function ok(c,m){if(!c)throw new Error(m);console.log('PASS',m)}
const ctx={console,globalThis:{},window:{},document:{},setTimeout,clearTimeout};ctx.window=ctx;ctx.globalThis=ctx;
ctx.ReminderParser={
 parseAdvance:(t)=>/一小时|1小时/.test(t)?60:/半小时|30/.test(t)?30:0,
 parse:(t)=>({datetime:/明天/.test(t)?'2026-09-09T'+(/三点|3点/.test(t)?'15:00':/十点|10点/.test(t)?'10:00':'09:00'):'',advance_minutes:/一小时|1小时/.test(t)?60:0})
};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/voice/reminder-dialogue-engine.js','utf8'),ctx);
const E=ctx.ReminderDialogueEngine;ok(E&&E.VERSION===2,'Reminder Dialogue Engine V2 loaded');
E.reset();let p=E.plan('事项 移民局');ok(p.actions.some(a=>a.slot==='content'&&a.value==='移民局'),'explicit item owns only item value');
p=E.plan('提醒时间 明天');ok(p.actions.some(a=>a.slot==='time'&&a.value==='2026-09-09T09:00'),'next slot label canonicalizes time without leaking into prior item');
p=E.plan('地点 移民局');ok(p.actions.some(a=>a.slot==='location'&&a.value==='移民局'),'location is independently owned');
E.reset();p=E.plan('明天下午三点在移民局提醒我办理住址变更，提前一小时，记得带居留卡');
ok(p.actions.some(a=>a.slot==='time'),'natural utterance routes time');ok(p.actions.some(a=>a.slot==='location'),'natural utterance routes location');ok(p.actions.some(a=>a.slot==='advance'),'natural utterance routes lead time');ok(p.actions.some(a=>a.slot==='note'),'natural utterance routes note');ok(p.actions.some(a=>a.slot==='content'),'natural utterance routes event content');
const q=fs.readFileSync('js/voice/quick-voice.js','utf8');ok(!/voiceMultiEntries|removeVoiceEntry|splitEntries/.test(q),'Quick Accounting multi-entry runtime removed');
const ve=fs.readFileSync('js/voice-engine.js','utf8'),vp=fs.readFileSync('js/voice/voice-parser.js','utf8'),app=fs.readFileSync('js/app.js','utf8');ok(!/splitEntries/.test(ve+vp+app),'legacy splitEntries implementation/export removed');
const pe=fs.readFileSync('js/personalization/pet-engine.js','utf8'),pa=fs.readFileSync('js/personalization/pet-action-stage.js','utf8'),pm=fs.readFileSync('js/personalization/pet-motion-engine.js','utf8');ok(pe.includes('sm-pet-action-stage'),'pet host includes action stage');ok(/brush|wash|coffee|sleep|eat|read|write|phone|bath/.test(pa),'literal daily-life action renderer present');ok(pm.includes("e.id!=='smDesktopPet'"),'pet safe-zone excludes itself');
