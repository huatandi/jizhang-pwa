const fs=require('fs'), vm=require('vm');
global.window=global; global.navigator={language:'zh-CN'}; global.localStorage={getItem(){return null},setItem(){},removeItem(){}};
function load(f){ vm.runInThisContext(fs.readFileSync(f,'utf8'),{filename:f}); }
load('js/asr/asr-types.js'); load('js/asr/voice-runtime-profile.js'); load('js/asr/context-bias.js'); load('js/asr/sherpa-engine.js');
let fail=0,pass=0; function ok(n,v){ if(v){pass++;console.log('PASS',n)}else{fail++;console.error('FAIL',n)} }
const cb=global.AsrKit.contextBias;
ok('中文金额单位纠错', cb.normalizeTranscript('支出1完3千4拜5十5',{lang:'zh-CN'}).text.includes('1万3千4百5十5'));
ok('不凭空补单位', cb.normalizeTranscript('一三千',{lang:'zh-CN'}).text==='一三千');
ok('中文热词含万亿', cb.hotwords('zh-CN').includes('万') && cb.hotwords('zh-CN').includes('亿'));
ok('西语热词保留词边界', cb.normalizeTranscript('doscientos cincuenta',{lang:'es-MX'}).text==='doscientos cincuenta');
(async()=>{ok('Sherpa 未安装时不可用', await global.AsrKit.SherpaEngine.isReady()===false); console.log(`V188: ${pass} pass, ${fail} fail`); process.exit(fail?1:0)})()
