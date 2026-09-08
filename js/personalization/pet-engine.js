(function(g){'use strict';
const KEY='sm_pet_v2';
const animals=[['rat','鼠'],['ox','牛'],['tiger','虎'],['rabbit','兔'],['dragon','龙'],['snake','蛇'],['horse','马'],['goat','羊'],['monkey','猴'],['rooster','鸡'],['dog','狗'],['pig','猪']];
let state={enabled:true,pet:'dragon',activity:'normal',x:null,y:null},timer=0,walkTimer=0,drag=null;
function load(){try{Object.assign(state,JSON.parse(localStorage.getItem(KEY)||localStorage.getItem('sm_pet_v1')||'{}'))}catch(e){}return state}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
function info(){return animals.find(a=>a[0]===state.pet)||animals[4]}
function src(){return 'assets/pets/zodiac/'+info()[0]+'.png'}
function pet(){return document.getElementById('smDesktopPet')}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function viewport(){const vv=g.visualViewport;return {w:Math.round(vv&&vv.width||g.innerWidth||360),h:Math.round(vv&&vv.height||g.innerHeight||640),ox:Math.round(vv&&vv.offsetLeft||0),oy:Math.round(vv&&vv.offsetTop||0)}}
function applyPosition(){const p=pet();if(!p)return;const v=viewport(),s=p.getBoundingClientRect().width||94;if(Number.isFinite(state.x)&&Number.isFinite(state.y)){state.x=clamp(state.x,v.ox+6,v.ox+v.w-s-6);state.y=clamp(state.y,v.oy+6,v.oy+v.h-s-72);p.style.left=state.x+'px';p.style.top=state.y+'px';p.style.right='auto';p.style.bottom='auto'}else{p.style.left='';p.style.top='';p.style.right='';p.style.bottom=''}}
function render(){
 let p=pet();
 if(!p){p=document.createElement('button');p.id='smDesktopPet';p.className='sm-pet sm-pet-v2';p.type='button';p.innerHTML='<span class="sm-pet-life-badge"></span><img class="sm-pet-img" alt=""><span class="sm-pet-bubble"></span>';document.body.appendChild(p);bindPointer(p);p.addEventListener('click',()=>{if(drag&&drag.moved)return;react('happy','我在这里呀！')})}
 p.hidden=!state.enabled;p.dataset.pet=state.pet;p.dataset.activity=state.activity;p.dataset.state=p.dataset.state||'idle';
 let im=p.querySelector('.sm-pet-img');im.src=src();im.alt=info()[1]+'生肖萌宠';p.title=info()[1]+' · 十二生肖伙伴';
 document.querySelectorAll('[data-pet-choice]').forEach(b=>{let active=b.dataset.petChoice===state.pet;b.classList.toggle('active',active);let pi=b.querySelector('img');if(pi)pi.src='assets/pets/zodiac/'+b.dataset.petChoice+'.png'});
 applyPosition();
}
function bubble(text,ms){const p=pet();if(!p||!text)return;const b=p.querySelector('.sm-pet-bubble');b.textContent=text;b.classList.add('show');setTimeout(()=>b.classList.remove('show'),ms||2600)}
function react(kind,text){if(!state.enabled)return;let p=pet();if(!p)return;p.dataset.state=kind||'idle';if(text)bubble(text);clearTimeout(timer);timer=setTimeout(()=>{if(!g.SmPetLifeOS){p.dataset.state='idle';scheduleWander()}},kind==='remind'?5200:3200)}
function setLifeScene(scene,activity,meta){if(!state.enabled)return;const p=pet();if(!p)return;p.dataset.scene=scene||'idle';p.dataset.state=activity||scene||'idle';const badge=p.querySelector('.sm-pet-life-badge');if(badge){const txt=meta&&meta.label||'';badge.textContent=txt;badge.hidden=!txt}if(meta&&meta.interruption&&meta.label)bubble(meta.label,1800)}
function moveTo(x,y,opts){const p=pet();if(!p)return;const v=viewport(),s=p.getBoundingClientRect().width||94;state.x=clamp(Math.round(x),v.ox+6,v.ox+v.w-s-6);state.y=clamp(Math.round(y),v.oy+6,v.oy+v.h-s-72);p.classList.add('pet-moving');applyPosition();if(!(opts&&opts.transient))save();setTimeout(()=>p.classList.remove('pet-moving'),700)}
function rectOverlap(a,b,pad){const q=pad||0;return !(a.right+q<b.left||a.left-q>b.right||a.bottom+q<b.top||a.top-q>b.bottom)}
function avoidRect(blocked,opts){const p=pet();if(!p||p.hidden)return false;const pr=p.getBoundingClientRect();if(!rectOverlap(pr,blocked,10))return false;const v=viewport(),s=pr.width||94,gap=14;const candidates=[
 [v.ox+v.w-s-gap,v.oy+gap],[v.ox+gap,v.oy+gap],[v.ox+gap,v.oy+v.h-s-82],[v.ox+v.w-s-gap,v.oy+v.h-s-82],
 [blocked.left-s-gap,blocked.top],[blocked.right+gap,blocked.top],[blocked.left,blocked.top-s-gap],[blocked.left,blocked.bottom+gap]
 ];
 const valid=candidates.map(c=>({x:clamp(c[0],v.ox+6,v.ox+v.w-s-6),y:clamp(c[1],v.oy+6,v.oy+v.h-s-72)})).filter(c=>!rectOverlap({left:c.x,top:c.y,right:c.x+s,bottom:c.y+s},blocked,8));
 if(!valid.length)return false;valid.sort((a,b)=>Math.hypot(a.x-pr.left,a.y-pr.top)-Math.hypot(b.x-pr.left,b.y-pr.top));moveTo(valid[0].x,valid[0].y,{transient:true});return true
}
function scheduleWander(){clearTimeout(walkTimer);if(g.SmPetLifeOS||!state.enabled||document.hidden||state.activity==='quiet')return;let wait=state.activity==='active'?8000:18000;walkTimer=setTimeout(()=>{let p=pet();if(!p||document.hidden)return;p.dataset.state='walk';p.classList.toggle('pet-left',Math.random()>.5);setTimeout(()=>{p.dataset.state='idle';scheduleWander()},3500)},wait+Math.random()*wait)}
function setPet(v){if(animals.some(a=>a[0]===v)){state.pet=v;save();render();react('happy','换好啦！')}}
function setEnabled(v){state.enabled=!!v;save();render()}
function setActivity(v){if(['quiet','normal','active','crazy'].includes(v)){state.activity=v;save();render()}}
function bindPointer(p){let hold=0;p.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;drag={id:e.pointerId,sx:e.clientX,sy:e.clientY,px:p.getBoundingClientRect().left,py:p.getBoundingClientRect().top,moved:false};p.setPointerCapture&&p.setPointerCapture(e.pointerId);clearTimeout(hold);hold=setTimeout(()=>{if(drag&&!drag.moved)bubble('长按菜单：回窝 · 安静 · 设置',3200)},650)});p.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;if(Math.hypot(dx,dy)>7)drag.moved=true;if(drag.moved)moveTo(drag.px+dx,drag.py+dy,{transient:true})});const up=e=>{clearTimeout(hold);if(!drag||drag.id!==e.pointerId)return;if(drag.moved)save();setTimeout(()=>drag=null,0)};p.addEventListener('pointerup',up);p.addEventListener('pointercancel',up)}
function bind(){load();document.querySelectorAll('[data-pet-choice]').forEach(b=>b.onclick=()=>setPet(b.dataset.petChoice));let on=document.getElementById('petEnabled');if(on){on.checked=state.enabled;on.onchange=()=>setEnabled(on.checked)}let a=document.getElementById('petActivity');if(a){a.value=state.activity;a.onchange=()=>setActivity(a.value)}render();document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(walkTimer);else scheduleWander()});g.addEventListener('resize',applyPosition);if(g.visualViewport)g.visualViewport.addEventListener('resize',applyPosition)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
g.SmPetEngine={animals,state,setPet,setEnabled,setActivity,react,setLifeScene,moveTo,avoidRect,VERSION:4};
})(window);
