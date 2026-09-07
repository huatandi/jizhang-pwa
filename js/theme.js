'use strict';
(function(){
var KEY='sm_theme',SUPPORTED=['dark','light','autumn','spring-summer'];
var META={dark:{label:'深色',icon:'🌙',color:'#0b1120'},light:{label:'浅色',icon:'☀️',color:'#f8fafc'},autumn:{label:'秋色',icon:'🍂',color:'#f7f0e6'},'spring-summer':{label:'春夏',icon:'🌿',color:'#eefbf8'}};
function norm(v){v=String(v||'dark');return SUPPORTED.includes(v)?v:'dark'}function get(){try{return norm(localStorage.getItem(KEY)||'dark')}catch(e){return'dark'}}
function apply(t){t=norm(t);document.documentElement.setAttribute('data-theme',t);try{var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=META[t].color}catch(e){}refresh();try{dispatchEvent(new CustomEvent('sm:theme-changed',{detail:{theme:t}}))}catch(e){}}
function set(t){t=norm(t);try{localStorage.setItem(KEY,t)}catch(e){}apply(t);return t}function cycle(){var i=SUPPORTED.indexOf(get());return set(SUPPORTED[(i+1)%SUPPORTED.length])}
function refresh(){var t=get();document.querySelectorAll('[data-theme-choice]').forEach(b=>b.classList.toggle('active',b.dataset.themeChoice===t));var l=document.querySelector('#themeToggle .tt-label');if(l)l.textContent=META[t].icon+' '+META[t].label}
function bind(){var b=document.getElementById('themeToggle');if(b&&!b.dataset.v212){b.dataset.v212='1';b.onclick=cycle}document.querySelectorAll('[data-theme-choice]').forEach(x=>x.onclick=()=>set(x.dataset.themeChoice));refresh()}
apply(get());if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();window.SmTheme={get,set,apply,toggle:cycle,cycle,list:()=>SUPPORTED.slice(),meta:META,VERSION:212};
})();
