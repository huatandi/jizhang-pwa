(function(g){'use strict';
const TARGET=new EventTarget(),SAFE_TYPES=new Set(['ledger:saved','reminder:due','recognition:start','recognition:end','action:center','system:offline','system:online','ui:busy','ui:idle']);
function emit(type,detail){if(!SAFE_TYPES.has(type))return false;const safe=detail&&typeof detail==='object'?Object.assign({},detail):{};delete safe.amount;delete safe.account;delete safe.photo;delete safe.image;delete safe.rfc;delete safe.taxId;TARGET.dispatchEvent(new CustomEvent(type,{detail:safe}));return true}
function on(type,fn){TARGET.addEventListener(type,fn);return()=>TARGET.removeEventListener(type,fn)}
function bindConnectivity(){if(!g.addEventListener)return;g.addEventListener('offline',()=>emit('system:offline',{}));g.addEventListener('online',()=>emit('system:online',{}));}

bindConnectivity();
g.SmAppEvents={emit,on,types:Array.from(SAFE_TYPES),VERSION:2};
})(window);