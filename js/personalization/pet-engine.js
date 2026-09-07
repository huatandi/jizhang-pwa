(function(g){'use strict';
const KEY='sm_pet_v2';
const animals=[['rat','鼠'],['ox','牛'],['tiger','虎'],['rabbit','兔'],['dragon','龙'],['snake','蛇'],['horse','马'],['goat','羊'],['monkey','猴'],['rooster','鸡'],['dog','狗'],['pig','猪']];
let state={enabled:true,pet:'dragon',activity:'normal'},timer=0,walkTimer=0;
function load(){try{Object.assign(state,JSON.parse(localStorage.getItem(KEY)||localStorage.getItem('sm_pet_v1')||'{}'))}catch(e){}return state}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
function info(){return animals.find(a=>a[0]===state.pet)||animals[4]}
function src(){return 'assets/pets/zodiac/'+info()[0]+'.png'}
function render(){
 let p=document.getElementById('smDesktopPet');
 if(!p){p=document.createElement('button');p.id='smDesktopPet';p.className='sm-pet sm-pet-v2';p.type='button';p.innerHTML='<img class="sm-pet-img" alt=""><span class="sm-pet-bubble"></span>';document.body.appendChild(p);p.onclick=()=>react('happy','你好呀！')}
 p.hidden=!state.enabled;p.dataset.pet=state.pet;p.dataset.activity=state.activity;p.dataset.state=p.dataset.state||'sleep';
 let im=p.querySelector('.sm-pet-img');im.src=src();im.alt=info()[1]+'生肖萌宠';p.title=info()[1]+' · 十二生肖伙伴';
 document.querySelectorAll('[data-pet-choice]').forEach(b=>{let active=b.dataset.petChoice===state.pet;b.classList.toggle('active',active);let pi=b.querySelector('img');if(pi)pi.src='assets/pets/zodiac/'+b.dataset.petChoice+'.png'});
 scheduleWander();
}
function react(kind,text){if(!state.enabled)return;let p=document.getElementById('smDesktopPet');if(!p)return;p.dataset.state=kind||'idle';let b=p.querySelector('.sm-pet-bubble');if(text){b.textContent=text;b.classList.add('show');setTimeout(()=>b.classList.remove('show'),2600)}clearTimeout(timer);timer=setTimeout(()=>{p.dataset.state='sleep';scheduleWander()},kind==='remind'?5200:3200)}
function scheduleWander(){clearTimeout(walkTimer);if(!state.enabled||document.hidden||state.activity==='quiet')return;let wait=state.activity==='active'?8000:18000;walkTimer=setTimeout(()=>{let p=document.getElementById('smDesktopPet');if(!p||document.hidden)return;p.dataset.state='walk';p.classList.toggle('pet-left',Math.random()>.5);setTimeout(()=>{p.dataset.state='sleep';scheduleWander()},3500)},wait+Math.random()*wait)}
function setPet(v){if(animals.some(a=>a[0]===v)){state.pet=v;save();render();react('happy','换好啦！')}}
function setEnabled(v){state.enabled=!!v;save();render()}
function setActivity(v){if(['quiet','normal','active'].includes(v)){state.activity=v;save();render()}}
function bind(){load();document.querySelectorAll('[data-pet-choice]').forEach(b=>b.onclick=()=>setPet(b.dataset.petChoice));let on=document.getElementById('petEnabled');if(on){on.checked=state.enabled;on.onchange=()=>setEnabled(on.checked)}let a=document.getElementById('petActivity');if(a){a.value=state.activity;a.onchange=()=>setActivity(a.value)}render();
 
 document.addEventListener('visibilitychange',()=>{let p=document.getElementById('smDesktopPet');if(document.hidden){clearTimeout(walkTimer);if(p)p.dataset.state='sleep'}else scheduleWander()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
g.SmPetEngine={animals,state,setPet,setEnabled,setActivity,react,VERSION:3};
})(window);