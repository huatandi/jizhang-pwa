'use strict';
const assert=require('assert');
global.window=global;
global.document={addEventListener(){},getElementById(){return null},querySelectorAll(){return []},querySelector(){return null}};
global.localStorage={getItem(){return null},setItem(){}};
Object.defineProperty(global,'navigator',{value:{language:'zh-CN'},configurable:true});
require('./js/voice/quick-voice.js');
const R=global.resolveContextualVoiceCommand, G=global.looksLikeQuickControlUtterance;
const cases=[
 ['选择现金','account','现金'],['选择橡筋','account','现金'],['账户详尽','account','现金'],['张虎详尽','account','现金'],
 ['赞胡先进','account','现金'],['张护陷阱','account','现金'],['详尽','account','现金'],
 ['切换到收入页面','navigate','income'],['进入支出页面','navigate','expense']
];
let pass=0;
for(const [raw,k,v] of cases){const r=R(raw);assert(r,raw);assert.equal(r.kind,k,raw);assert.equal(r.value||r.target,v,raw);pass++; console.log('✔',raw,'→',k,v)}
assert.equal(G('张虎橡筋'),true); pass++; console.log('✔ 控制类误识别禁止落入备注');
assert.equal(G('今天和客户吃饭讨论合同'),false); pass++; console.log('✔ 普通备注不被控制门禁吞掉');
const src=require('fs').readFileSync('./js/voice/quick-voice.js','utf8');
assert(src.includes("if (looksLikeQuickControlUtterance(finalText))")); pass++; console.log('✔ 未解析控制句 fail-closed');
assert(src.includes("if (typeof seg.click === 'function') seg.click()")); pass++; console.log('✔ 页面切换复用真实点击链');
console.log(`V217: ${pass}/${pass} PASS`);
