(function(g){'use strict';
const KEY='sm_icon_pack',packs={
standard:{label:'标准',glyphs:{dashboard:'▦',income:'＋',expense:'−',monthly:'▥',query:'⌕',scan:'⌗',idphoto:'▣',quick:'⚡',reminder:'◷',settings:'⚙'}},
cartoon:{label:'卡通',glyphs:{dashboard:'🏠',income:'🍀',expense:'🍂',monthly:'🗓️',query:'🔎',scan:'📸',idphoto:'🪪',quick:'✨',reminder:'🔔',settings:'🧸'}},
chinese:{label:'中国风',glyphs:{dashboard:'舍',income:'入',expense:'出',monthly:'历',query:'寻',scan:'照',idphoto:'证',quick:'记',reminder:'铃',settings:'设'}},
tech:{label:'科技',glyphs:{dashboard:'⌂',income:'⊕',expense:'⊖',monthly:'◫',query:'⌖',scan:'◉',idphoto:'▤',quick:'ϟ',reminder:'◌',settings:'⚙'}},
future:{label:'未来',glyphs:{dashboard:'⬡',income:'△',expense:'▽',monthly:'▦',query:'◎',scan:'◈',idphoto:'◇',quick:'✦',reminder:'◍',settings:'✣'}},
punk:{label:'朋克',glyphs:{dashboard:'♜',income:'✚',expense:'✖',monthly:'▧',query:'⌁',scan:'◉',idphoto:'▣',quick:'⚡',reminder:'♬',settings:'⚙'}}};
function get(){try{let v=localStorage.getItem(KEY);return packs[v]?v:'standard'}catch(e){return'standard'}}
function apply(n){n=packs[n]?n:'standard';try{localStorage.setItem(KEY,n)}catch(e){}document.documentElement.dataset.iconPack=n;document.querySelectorAll('.nav-item[data-page]').forEach(b=>{let e=b.querySelector('.nav-icon'),k=b.dataset.page;if(e&&packs[n].glyphs[k])e.textContent=packs[n].glyphs[k]});document.querySelectorAll('[data-icon-pack-choice]').forEach(b=>b.classList.toggle('active',b.dataset.iconPackChoice===n));return n}
function bind(){document.querySelectorAll('[data-icon-pack-choice]').forEach(b=>b.onclick=()=>apply(b.dataset.iconPackChoice));apply(get())}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();g.SmIconPacks={packs,get,apply,list:()=>Object.keys(packs),VERSION:1};
})(window);