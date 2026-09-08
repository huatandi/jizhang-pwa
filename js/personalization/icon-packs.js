(function(g){'use strict';
const KEY='sm_icon_pack';
const packs={standard:{label:'标准'},cartoon:{label:'卡通'},chinese:{label:'中国风'},tech:{label:'科技'}};
const legacy={punk:'tech',future:'tech'};
function get(){try{let v=localStorage.getItem(KEY);v=legacy[v]||v;return packs[v]?v:'standard'}catch(e){return'standard'}}
function apply(n){n=legacy[n]||n;n=packs[n]?n:'standard';try{localStorage.setItem(KEY,n)}catch(e){}document.documentElement.dataset.iconPack=n;if(g.SmIconSystem&&g.SmIconSystem.renderPageIcons)g.SmIconSystem.renderPageIcons();document.querySelectorAll('[data-icon-pack-choice]').forEach(b=>b.classList.toggle('active',b.dataset.iconPackChoice===n));return n}
function bind(){document.querySelectorAll('[data-icon-pack-choice]').forEach(b=>b.onclick=()=>apply(b.dataset.iconPackChoice));apply(get())}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();g.SmIconPacks={packs,get,apply,list:()=>Object.keys(packs),VERSION:3};
})(window);
