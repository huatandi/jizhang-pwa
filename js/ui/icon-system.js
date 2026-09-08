(function(g){'use strict';
const VERSION=1;
const ICONS={
 dashboard:'<path d="M4 4h6v6H4zM14 4h6v10h-6zM4 14h6v6H4zM14 18h6v2h-6z"/>',
 income:'<path d="M12 3v18M7 8.2c0-2 1.8-3.2 5-3.2s5 1.2 5 3.3-1.7 3.1-5 3.7-5 1.7-5 3.9S8.9 19 12 19s5-1.2 5-3.2"/><path d="M19 5v5h-5"/>',
 expense:'<path d="M12 3v18M7 8.2c0-2 1.8-3.2 5-3.2s5 1.2 5 3.3-1.7 3.1-5 3.7-5 1.7-5 3.9S8.9 19 12 19s5-1.2 5-3.2"/><path d="M5 19v-5h5"/>',
 purchase:'<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
 monthly:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 18h3"/>',
 query:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
 scan:'<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4M7 12h10"/>',
 idphoto:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2.5"/><path d="M5.5 17c.8-2.2 2-3.3 3.5-3.3s2.7 1.1 3.5 3.3M15 9h3M15 13h3M15 17h2"/>',
 quick:'<path d="m13 2-8 12h7l-1 8 8-12h-7z"/>',
 reminder:'<circle cx="12" cy="13" r="7"/><path d="M12 9v4l3 2M5 4 2.5 6.5M19 4l2.5 2.5"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.08.08-2.76 2.76-.08-.08a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V21H10v-.12A1.8 1.8 0 0 0 8.9 19.3a1.8 1.8 0 0 0-2 .36l-.08.08-2.76-2.76.08-.08a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2.85 13H2.7V9.1h.15A1.8 1.8 0 0 0 4.5 8a1.8 1.8 0 0 0-.36-2l-.08-.08 2.76-2.76.08.08a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 10 1.95V1.8h3.9v.15A1.8 1.8 0 0 0 15 3.6a1.8 1.8 0 0 0 2-.36l.08-.08 2.76 2.76-.08.08a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.65 1.1h.15V13h-.15A1.8 1.8 0 0 0 19.4 15Z"/>',
 plus:'<path d="M12 5v14M5 12h14"/>'
};
function normalize(name){return ICONS[name]?name:(name==='income-ledger'?'income':name)}
function svg(name){name=normalize(name);const body=ICONS[name];if(!body)return null;return '<svg class="sm-ui-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">'+body+'</svg>'}
function render(el,name){if(!el)return false;const out=svg(name);if(!out)return false;el.innerHTML=out;el.dataset.smIcon=name;return true}
function pageKey(page){return page==='purchase'?'purchase':page}
function renderPageIcons(){document.querySelectorAll('.nav-item[data-page]').forEach(el=>{const target=el.querySelector('.nav-icon');if(target)render(target,pageKey(el.dataset.page))});document.querySelectorAll('.fn-card[data-page]').forEach(el=>{const target=el.querySelector('.fn-icon');if(target)render(target,pageKey(el.dataset.page))})}
function bind(){renderPageIcons()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
g.SmIconSystem={VERSION,ICONS,svg,render,renderPageIcons};
})(window);
