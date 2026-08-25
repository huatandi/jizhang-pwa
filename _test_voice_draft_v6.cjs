const fs = require('fs');
function load(p){ global.window=global; global.globalThis=global; eval(fs.readFileSync(p,'utf8')); }
load('js/voice/voice-language-pack.js');
load('js/voice/voice-draft-session.js');
let pass=0, fail=0;
function ok(x,m){ if(x){console.log('✔',m);pass++}else{console.log('✘',m);fail++} }
const s=new VoiceDraftSession({lang:'zh-CN'});
let e=s.acceptUtterance('今天 Costco 买货 850 比索',{lang:'zh-CN',engine:'whisper'});
ok(e.type==='CONTENT' && s.getDraftText().includes('850'),'内容进入草稿');
e=s.acceptUtterance('删除上一句',{lang:'zh-CN'}); ok(e.action==='DELETE_LAST' && s.getDraftText()==='','删除上一句');
s.acceptUtterance('今天 Costco 买货 580 比索',{lang:'zh-CN'});
e=s.acceptUtterance('重说上一句',{lang:'zh-CN'}); ok(e.action==='REPLACE_LAST_ARMED','进入重说上一句');
e=s.acceptUtterance('今天 Costco 买货 650 比索',{lang:'zh-CN'}); ok(e.action==='REPLACED_LAST' && s.getDraftText().includes('650') && !s.getDraftText().includes('580'),'替换上一句');
e=s.acceptUtterance('机器修好了以后付了500',{lang:'zh-CN'}); ok(e.type==='CONTENT','句中“好了”不误提交');
e=s.acceptUtterance('好了',{lang:'zh-CN'}); ok(e.type==='COMMIT','独立“好了”提交');
const raw=s.getRawTranscript(); ok(raw.includes('580') && raw.includes('650'),'原始历史仍保留');
const es=new VoiceDraftSession({lang:'es-MX'}); es.acceptUtterance('pagué 500 pesos',{lang:'es-MX'}); ok(es.acceptUtterance('listo',{lang:'es-MX'}).type==='COMMIT','西语 listo 提交');
const en=new VoiceDraftSession({lang:'en-US'}); en.acceptUtterance('paid 500 dollars',{lang:'en-US'}); ok(en.acceptUtterance('done',{lang:'en-US'}).type==='COMMIT','英语 done 提交');
console.log(`RESULT ${pass} pass ${fail} fail`); process.exit(fail?1:0);
