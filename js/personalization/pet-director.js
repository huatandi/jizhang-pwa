(function(g){'use strict';
const KEY='sm_pet_quiet_until';let unsubs=[];
function quietUntil(){try{return Number(localStorage.getItem(KEY)||0)}catch(e){return 0}}
function isQuiet(){return Date.now()<quietUntil()}
function quiet(ms){try{localStorage.setItem(KEY,String(Date.now()+Math.max(0,Number(ms)||0)))}catch(e){};return quietUntil()}
function clearQuiet(){try{localStorage.removeItem(KEY)}catch(e){} }
function say(){/* V222 quiet companion */}
function startAssist(){/* V222 quiet companion */}
function endAssist(){/* V222 quiet companion */}
function bind(){/* V222: pet does not surface business/system prompts */}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
g.SmPetDirector={quiet,clearQuiet,isQuiet,VERSION:3};
})(window);
