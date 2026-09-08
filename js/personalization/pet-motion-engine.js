(function(g){'use strict';
const BLOCK='input,textarea,select,button,a,[contenteditable="true"],.modal,.camera-view,.ocr-camera,#idphotoCameraView,.idp-live-panel,.voice-preview,.reminder-float-bar';
const PERSONALITY={rat:['stroll','run','look'],ox:['stroll','look'],tiger:['run','jump','stroll'],rabbit:['jump','run','stroll'],dragon:['jump','run','look'],snake:['stroll','look'],horse:['run','stroll','jump'],goat:['stroll','jump','look'],monkey:['run','jump','flip','look'],rooster:['stroll','run','jump'],dog:['run','jump','stroll'],pig:['stroll','look','jump']};
let timer=0,busy=false,last={x:null,y:null};
const pet=()=>document.getElementById('smDesktopPet');
function cfg(){return g.SmPetEngine&&g.SmPetEngine.state||{enabled:false,activity:'normal',pet:'dragon'}}
function vv(){const v=g.visualViewport;return {x:v&&v.offsetLeft||0,y:v&&v.offsetTop||0,w:v&&v.width||innerWidth,h:v&&v.height||innerHeight}}
function rects(){return [...document.querySelectorAll(BLOCK)].filter(e=>{const r=e.getBoundingClientRect();return r.width>24&&r.height>20&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth}).map(e=>e.getBoundingClientRect())}
function overlap(a,b,p=10){return !(a.right+p<b.left||a.left-p>b.right||a.bottom+p<b.top||a.top-p>b.bottom)}
function valid(x,y,s,blocks){const a={left:x,top:y,right:x+s,bottom:y+s};return !blocks.some(b=>overlap(a,b,12))}
function target(){const p=pet();if(!p)return null;const v=vv(),s=p.getBoundingClientRect().width||94,blocks=rects(),margin=10,bottom=76;for(let i=0;i<28;i++){const x=v.x+margin+Math.random()*Math.max(1,v.w-s-margin*2),y=v.y+margin+Math.random()*Math.max(1,v.h-s-bottom-margin);if(valid(x,y,s,blocks))return{x,y}}return null}
function pick(){const c=cfg(),pool=(PERSONALITY[c.pet]||['stroll','look']).slice();if(c.activity==='quiet')return'look';if(c.activity==='crazy')pool.push('run','jump','flip');else if(c.activity==='active')pool.push('run','jump');return pool[Math.floor(Math.random()*pool.length)]}
function duration(kind,dist){if(kind==='run')return Math.max(520,Math.min(1500,dist*2.1));if(kind==='stroll')return Math.max(1200,Math.min(3200,dist*5));return 850}
function perform(kind){const p=pet(),c=cfg();if(!p||!c.enabled||document.hidden||busy)return schedule();if(matchMedia('(prefers-reduced-motion: reduce)').matches)return schedule(30000);if(document.querySelector('.modal.open,.modal.show,.pet-life-diary.open'))return schedule(12000);if(['sleep','bath','wash','brush','eat','coffee','tea','work','read','write','phone','tv'].includes(p.dataset.state||''))return schedule(16000);
 const t=target();if(!t)return schedule(10000);const r=p.getBoundingClientRect(),dist=Math.hypot(t.x-r.left,t.y-r.top),moving=['run','stroll'].includes(kind);busy=true;p.dataset.motion=kind;p.classList.toggle('pet-facing-left',t.x<r.left);p.classList.toggle('pet-facing-right',t.x>=r.left);
 if(moving){const ms=duration(kind,dist);p.style.transitionDuration=ms+'ms';g.SmPetEngine.moveTo(t.x,t.y,{transient:true});setTimeout(()=>finish(),ms+120)}else setTimeout(()=>finish(),duration(kind,dist));
}
function finish(){const p=pet();if(p){delete p.dataset.motion;p.style.transitionDuration='';p.classList.remove('pet-facing-left','pet-facing-right')}busy=false;schedule()}
function schedule(force){clearTimeout(timer);const c=cfg();if(!c.enabled||document.hidden)return;let base=c.activity==='crazy'?7000:c.activity==='active'?11000:c.activity==='quiet'?30000:18000;timer=setTimeout(()=>perform(pick()),force||base+Math.random()*base*.8)}
function avoidAll(){const p=pet();if(!p||p.hidden)return;const r=p.getBoundingClientRect(),hit=rects().find(b=>overlap(r,b,8));if(hit&&g.SmPetEngine)g.SmPetEngine.avoidRect(hit,{reason:'ui-safe-zone'})}
function bind(){document.addEventListener('visibilitychange',()=>document.hidden?clearTimeout(timer):schedule(1500));addEventListener('resize',()=>{avoidAll();schedule(2000)});document.addEventListener('focusin',()=>setTimeout(avoidAll,20),true);document.addEventListener('click',e=>{if(e.target&&e.target.closest&&e.target.closest(BLOCK))setTimeout(avoidAll,20)},true);schedule(2200)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
g.SmPetMotionEngine={schedule,perform,avoidAll,VERSION:1};
})(window);
