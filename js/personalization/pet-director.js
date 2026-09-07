(function(g){'use strict';
const KEY='sm_pet_quiet_until';let unsubs=[];
function quietUntil(){try{return Number(localStorage.getItem(KEY)||0)}catch(e){return 0}}
function isQuiet(){return Date.now()<quietUntil()}
function quiet(ms){try{localStorage.setItem(KEY,String(Date.now()+Math.max(0,Number(ms)||0)))}catch(e){};return quietUntil()}
function clearQuiet(){try{localStorage.removeItem(KEY)}catch(e){}}
function say(kind,text){if(isQuiet()||!g.SmPetEngine)return;g.SmPetEngine.react(kind,text)}
function bind(){
 if(!g.SmAppEvents)return;
 unsubs.push(g.SmAppEvents.on('ledger:saved',()=>say('happy','记好啦 ✓')));
 unsubs.push(g.SmAppEvents.on('reminder:due',()=>say('remind','有提醒啦！')));
 unsubs.push(g.SmAppEvents.on('recognition:start',e=>say('focus',(e.detail&&e.detail.channel)==='voice'?'我在听':'我来帮你看')));
 unsubs.push(g.SmAppEvents.on('recognition:end',()=>{ if(g.SmPetEngine) g.SmPetEngine.react('idle',''); }));
 unsubs.push(g.SmAppEvents.on('action:center',e=>{let n=Number(e.detail&&e.detail.count)||0;if(n>0)say('focus','有 '+n+' 件待处理事项')}));
 unsubs.push(g.SmAppEvents.on('system:offline',()=>say('focus','现在离线，本地功能继续可用')));
 unsubs.push(g.SmAppEvents.on('system:online',()=>say('happy','网络已恢复')));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
g.SmPetDirector={quiet,clearQuiet,isQuiet,VERSION:2};
})(window);