(function(g){'use strict';
/**
 * Reminder Dialogue Engine V2
 * Natural speech -> semantic spans -> reminder slots.
 * Hard rule: finalized utterances are immutable evidence; never replay the full session transcript.
 */
const SLOT_ORDER=['content','time','location','advance','method','repeat','note'];
const LABELS=[
  ['advance',/(?:提前提醒|提醒节点|提前|提早)/iy],
  ['method',/(?:提醒方式|提醒方法|方式)/iy],
  ['location',/(?:地点|位置|地方)/iy],
  ['content',/(?:事项|事情|内容|做什么|任务|主题)/iy],
  ['time',/(?:提醒时间|日期时间|日期|时间|什么时候)/iy],
  ['repeat',/(?:重复提醒|重复|周期)/iy],
  ['note',/(?:备注|附注|注意事项|记得)/iy]
];
const END_RE=/^(?:好|好的|好了|好啦|下一个|下一项|继续|这个好了|这项好了|ok|okay|next|listo|siguiente)$/i;
const SAVE_RE=/^(?:保存|确定|确认|完成|完毕|结束|搞定|可以了|就这样|save|submit|done|finish|guardar|listo)$/i;
const TIME_HINT=/(?:今天|明天|后天|大后天|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|下周|本周|下个月|本月|月底|月初|\d{1,2}\s*月\s*\d{1,2}\s*[日号]?|早上|上午|中午|下午|晚上|凌晨|\d{1,2}\s*[点时:：]|[一二两三四五六七八九十]{1,3}\s*点|tomorrow|today|next week|mañana|pasado mañana)/i;
const ADV_HINT=/(?:提前|提早|\d+\s*(?:分钟|小时|天)\s*(?:前|之前)|minutes? before|hours? before|minutos? antes|horas? antes)/i;
const REPEAT_HINT=/(?:每天|每日|每周|每星期|每月|每个月|daily|weekly|monthly|cada día|cada dia|cada semana|cada mes)/i;
const METHOD_HINT=/(?:语音播报|语音提醒|响铃|铃声|震动|振动|手动提醒|speak|voice|ring|vibrate|manual|voz|timbre|vibrar)/i;
const NOTE_HINT=/(?:记得|别忘了|不要忘记|备注|附注|带上|带着|需要带|remember|don't forget|nota|recuerda)/i;

let state={activeSlot:null,lastSlot:null,locked:{},seq:0,ledger:[]};
function clean(s){return String(s||'').replace(/[，,。.!！?？；;]+$/g,'').replace(/\s+/g,' ').trim()}
function reset(){state={activeSlot:null,lastSlot:null,locked:{},seq:0,ledger:[]};return snapshot()}
function snapshot(){return JSON.parse(JSON.stringify(state))}
function closeSlot(slot){if(slot)state.locked[slot]=true;if(state.activeSlot===slot)state.activeSlot=null}
function openSlot(slot){if(state.activeSlot&&state.activeSlot!==slot)closeSlot(state.activeSlot);state.activeSlot=slot;state.lastSlot=slot;state.locked[slot]=false}
function stripLead(v,slot){let s=clean(v).replace(/^[:：\s]+/,'');
  if(slot==='content')s=s.replace(/^(?:提醒我|请提醒我|我要|我想|去|要去)\s*/,'');
  if(slot==='location')s=s.replace(/^(?:在|到|去|前往|位于)\s*/,'');
  if(slot==='note')s=s.replace(/^(?:记得|别忘了|不要忘记|备注|附注)\s*/,'');
  return clean(s);
}
function labeledSpans(text){const src=String(text||'');const hits=[];
  for(let i=0;i<src.length;i++)for(const [slot,re] of LABELS){re.lastIndex=i;const m=re.exec(src);if(m&&m.index===i){hits.push({slot,start:i,end:i+m[0].length,label:m[0]});i=m.index+m[0].length-1;break}}
  if(!hits.length)return[];
  const out=[];for(let i=0;i<hits.length;i++){const h=hits[i],n=hits[i+1];const value=stripLead(src.slice(h.end,n?n.start:src.length),h.slot);out.push({slot:h.slot,value,explicit:true,label:h.label})}return out;
}
function parser(){return g.ReminderParser||null}
function canonicalize(a){
  const rp=parser(),v=clean(a&&a.value); if(!a||!v)return a;
  if(a.slot==='time'&&rp){const p=rp.parse(v);if(p&&p.datetime)return Object.assign({},a,{value:p.datetime});}
  if(a.slot==='advance'&&rp){const m=rp.parseAdvance(v);if(m)return Object.assign({},a,{value:String(m)});}
  if(a.slot==='repeat'){const low=v.toLowerCase();const x=/(?:每天|每日|daily|cada día|cada dia)/.test(low)?'daily':/(?:每周|每星期|weekly|cada semana)/.test(low)?'weekly':/(?:每月|每个月|monthly|cada mes)/.test(low)?'monthly':'';if(x)return Object.assign({},a,{value:x});}
  if(a.slot==='method'){const vals=[];if(/(?:语音播报|语音提醒|语音|speak|voice|voz)/i.test(v))vals.push('speak');if(/(?:响铃|铃声|ring|timbre)/i.test(v))vals.push('ring');if(/(?:震动|振动|vibrate|vibrar)/i.test(v))vals.push('vibrate');if(/(?:手动提醒|手动|manual)/i.test(v))vals.push('manual');if(vals.length)return Object.assign({},a,{value:vals.join(',')});}
  return a;
}
function inferNatural(text){let rest=clean(text),actions=[];const rp=parser();if(!rest)return actions;
  // advance / repeat / method / note are high-signal metadata spans.
  if(ADV_HINT.test(rest)&&rp){const m=rp.parseAdvance(rest);if(m)actions.push({slot:'advance',value:String(m),explicit:false})}
  if(REPEAT_HINT.test(rest)){const low=rest.toLowerCase();const v=/(?:每天|每日|daily|cada día|cada dia)/.test(low)?'daily':/(?:每周|每星期|weekly|cada semana)/.test(low)?'weekly':'monthly';actions.push({slot:'repeat',value:v,explicit:false})}
  if(METHOD_HINT.test(rest)){const vals=[];if(/(?:语音播报|语音提醒|speak|voice|voz)/i.test(rest))vals.push('speak');if(/(?:响铃|铃声|ring|timbre)/i.test(rest))vals.push('ring');if(/(?:震动|振动|vibrate|vibrar)/i.test(rest))vals.push('vibrate');if(/(?:手动提醒|manual)/i.test(rest))vals.push('manual');if(vals.length)actions.push({slot:'method',value:vals.join(','),explicit:false})}
  const noteMatch=rest.match(/(?:记得|别忘了|不要忘记|备注|附注|带上|带着|需要带)\s*([^，。,.!！?？]{1,60})/i);if(noteMatch)actions.push({slot:'note',value:clean(noteMatch[1]),explicit:false});
  if(TIME_HINT.test(rest)&&rp){const p=rp.parse(rest);if(p&&p.datetime)actions.push({slot:'time',value:p.datetime,explicit:false})}
  // Location only when grammar makes it a location span. Avoid stealing “去移民局” when that is the whole event.
  let loc='';const lm=rest.match(/(?:在|位于)\s*([^，。,.!！?？]{2,30}?)(?=\s*(?:提醒我|办理|办|开会|见|谈|拿|带|提前|记得|别忘|$))/);if(lm)loc=clean(lm[1]);
  if(loc)actions.push({slot:'location',value:loc,explicit:false});
  // Derive event content by removing strong metadata spans, but fail closed if nothing meaningful remains.
  let content=rest
    .replace(/(?:今天|明天|后天|大后天|本周|下周|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天])/g,' ')
    .replace(/(?:早上|上午|中午|下午|晚上|凌晨)?\s*[零一二两三四五六七八九十\d]{1,3}\s*(?:点|时)(?:\s*(?:半|\d{1,2}\s*分?))?/g,' ')
    .replace(/\d{1,2}:\d{2}/g,' ')
    .replace(/(?:提前|提早)\s*[零一二两三四五六七八九十百\d半]+\s*(?:个)?\s*(?:分钟|小时|天|日)(?:提醒)?/g,' ')
    .replace(/(?:每天|每日|每周|每星期|每月|每个月|daily|weekly|monthly|cada día|cada dia|cada semana|cada mes)/gi,' ')
    .replace(/(?:提醒方式|方式)?\s*(?:语音播报|语音提醒|语音|响铃|铃声|震动|振动|手动提醒)/g,' ')
    .replace(/(?:记得|别忘了|不要忘记|备注|附注|带上|带着|需要带)\s*[^，。,.!！?？]{1,60}/gi,' ')
    .replace(loc?new RegExp('(?:在|位于)\\s*'+loc.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'):/$^/,' ')
    .replace(/(?:请)?提醒我|设置提醒|添加提醒|新建提醒/g,' ')
    .replace(/[，。,.!！?？]+/g,' ').replace(/\s+/g,' ').trim();
  if(content.length>=2)actions.push({slot:'content',value:content,explicit:false});
  return actions;
}
function plan(text){const raw=clean(text);const id='rdu-'+(++state.seq);if(!raw)return{id,raw,actions:[],command:null};
  if(SAVE_RE.test(raw))return{id,raw,actions:[],command:'save'};
  if(END_RE.test(raw)){closeSlot(state.activeSlot);state.ledger.push({id,raw,command:'close'});return{id,raw,actions:[],command:'close'};}
  let actions=labeledSpans(raw);
  if(actions.length){
    const explicitSlots=new Set(actions.map(a=>a.slot));
    const inferred=inferNatural(raw).filter(a=>!explicitSlots.has(a.slot));
    actions=actions.map(canonicalize).concat(inferred);
    for(const a of actions.filter(a=>a.explicit)){openSlot(a.slot);if(a.value)closeSlot(a.slot)}
  } else {
    actions=inferNatural(raw);
    if(!actions.length&&state.activeSlot){actions=[{slot:state.activeSlot,value:stripLead(raw,state.activeSlot),explicit:false,continuation:true}]}
    if(actions.length===1){state.lastSlot=actions[0].slot;}
  }
  actions=actions.filter(a=>a.value!==''&&a.value!=null);
  state.ledger.push({id,raw,actions:actions.map(a=>({slot:a.slot,value:a.value}))});if(state.ledger.length>80)state.ledger.shift();
  return{id,raw,actions,command:null};
}
function inspectCrossSlot(values){const issues=[];const labels=/(?:提醒时间|提醒方式|地点|位置|备注|附注|事项|内容|提前提醒|重复提醒)/;
  for(const [slot,val] of Object.entries(values||{})){if(typeof val==='string'&&labels.test(val))issues.push({slot,code:'FIELD_LABEL_LEAK',value:val})}return issues;
}
g.ReminderDialogueEngine={plan,reset,snapshot,inspectCrossSlot,VERSION:2};
})(typeof window!=='undefined'?window:globalThis);
