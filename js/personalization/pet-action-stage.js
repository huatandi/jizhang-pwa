(function(g){'use strict';
/** Pet Action Stage V2: literal daily-life props + micro animation, independent of business state. */
const LITERAL=new Set(['brush','wash','coffee','tea','sleep','eat','read','write','work','phone','bath','water']);
const svg=(body)=>`<svg viewBox="0 0 120 120" role="presentation" focusable="false">${body}</svg>`;
const ASSETS={
 brush:svg('<g class="pa-hand"><rect x="64" y="61" width="34" height="7" rx="3.5" transform="rotate(-18 64 61)" class="pa-tool"/><rect x="91" y="51" width="13" height="11" rx="3" transform="rotate(-18 91 51)" class="pa-bristle"/></g><g class="pa-foam"><circle cx="72" cy="57" r="4"/><circle cx="79" cy="54" r="3"/><circle cx="84" cy="59" r="2.5"/></g>'),
 wash:svg('<g class="pa-towel"><path d="M72 51c14 0 24 5 26 14l-9 21-31-9 4-20c2-4 5-6 10-6z"/><path d="M63 61c10 5 19 7 30 8" class="pa-line"/></g><g class="pa-drops"><path d="M83 46c4 6 5 8 0 11-5-3-4-6 0-11z"/><path d="M94 49c3 5 4 7 0 9-4-2-3-5 0-9z"/></g>'),
 coffee:svg('<g class="pa-cup"><path d="M72 66h25v20c0 8-6 12-13 12s-12-4-12-12z"/><path d="M97 71h6c8 0 8 13 0 13h-6" class="pa-line"/></g><g class="pa-steam"><path d="M78 62c-5-7 7-8 2-15"/><path d="M88 62c-5-7 7-8 2-15"/></g>'),
 tea:svg('<g class="pa-cup"><path d="M72 68h27v17c0 8-7 12-14 12s-13-4-13-12z"/><path d="M99 72h5c8 0 8 12 0 12h-5" class="pa-line"/></g><g class="pa-steam"><path d="M80 63c-4-6 6-8 2-14"/><path d="M90 63c-4-6 6-8 2-14"/></g>'),
 sleep:svg('<g class="pa-bed"><ellipse cx="60" cy="94" rx="45" ry="14"/><rect x="18" y="79" width="84" height="17" rx="8"/><ellipse cx="78" cy="79" rx="18" ry="8" class="pa-pillow"/></g><g class="pa-z"><path d="M90 44h15L92 57h15"/><path d="M80 34h11l-9 10h11"/></g>'),
 eat:svg('<g class="pa-bowl"><path d="M69 76h35c-3 15-10 21-18 21s-14-6-17-21z"/><path d="M68 75h37" class="pa-line"/></g><g class="pa-spoon"><path d="M67 71l-11-19"/><ellipse cx="54" cy="49" rx="4" ry="7"/></g>'),
 read:svg('<g class="pa-book"><path d="M55 70c11-6 21-5 30 1v25c-10-5-20-5-30 1z"/><path d="M85 71c9-6 18-5 27 0v25c-9-5-18-5-27 1z"/><path d="M85 72v25" class="pa-line"/></g>'),
 write:svg('<g class="pa-paper"><rect x="62" y="69" width="42" height="28" rx="4"/><path d="M69 78h25M69 85h20M69 92h16" class="pa-line"/></g><g class="pa-pencil"><rect x="54" y="63" width="40" height="6" rx="3" transform="rotate(36 54 63)"/></g>'),
 work:svg('<g class="pa-laptop"><rect x="60" y="59" width="45" height="28" rx="4"/><path d="M54 90h58l-6 8H60z"/><rect x="66" y="65" width="33" height="16" rx="2" class="pa-screen"/></g>'),
 phone:svg('<g class="pa-phone"><rect x="78" y="56" width="22" height="39" rx="5"/><rect x="82" y="61" width="14" height="26" rx="2" class="pa-screen"/><circle cx="89" cy="91" r="2"/></g>'),
 bath:svg('<g class="pa-bath"><path d="M47 77h62v12c0 7-6 12-13 12H60c-7 0-13-5-13-12z"/><circle cx="57" cy="72" r="7"/><circle cx="70" cy="68" r="5"/><circle cx="83" cy="72" r="8"/><circle cx="98" cy="68" r="5"/></g>'),
 water:svg('<g class="pa-glass"><path d="M76 64h24l-4 31H80z"/><path d="M79 76h18" class="pa-waterline"/></g>')
};
function render(p){if(!p)return;const st=p.querySelector('.sm-pet-action-stage');if(!st)return;const a=p.dataset.state||'';if(!LITERAL.has(a)){st.innerHTML='';st.hidden=true;p.classList.remove('pet-literal-action');return}st.hidden=false;st.innerHTML=ASSETS[a]||'';p.classList.add('pet-literal-action');st.dataset.action=a;}
function bind(){const p=document.getElementById('smDesktopPet');if(!p)return setTimeout(bind,150);render(p);new MutationObserver(()=>render(p)).observe(p,{attributes:true,attributeFilter:['data-state','data-scene']});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
g.SmPetActionStage={render,VERSION:2,ACTIONS:[...LITERAL]};
})(window);
