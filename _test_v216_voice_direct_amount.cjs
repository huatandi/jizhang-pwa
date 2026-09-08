'use strict';
const fs=require('fs'),vm=require('vm');
let pass=0,fail=0; function ok(n,c){console.log((c?'PASS ':'FAIL ')+n);c?pass++:fail++;}
const q=fs.readFileSync('js/voice/quick-voice.js','utf8');
ok('direct amount parser exists', /function parseDirectAmountUtterance\(raw\)/.test(q));
ok('费用/花费/消费 are amount cues', /金额\|数额\|费用\|花费\|消费/.test(q));
ok('今儿 homophone is locally scoped to amount cue', /金额\|数额\|费用\|花费\|消费[^\n]*今儿/.test(q));
ok('standalone amount is accepted before draft arbitration', /standalone money utterances/.test(q) && /parseDirectAmountUtterance\(raw\)/.test(q));
ok('amount still uses atomic single writer', /atomicVoiceWrite\('amount', n\)/.test(q));
ok('recognition action feedback no longer calls popup toast', /function voiceActionFeedback[\s\S]*?voiceTip[\s\S]*?dataset.state/.test(q) && !/function voiceActionFeedback[\s\S]{0,700}?showToast\(/.test(q));
ok('quick recognition completion uses inline feedback', /voiceActionFeedback\(filled \? '✔ 已识别，请核对后保存'/.test(q));
global.window=global; vm.runInThisContext(fs.readFileSync('js/voice/voice-parser.js','utf8'),{filename:'voice-parser.js'});
ok('VoiceKit parses 13500 exactly', VoiceKit.parseAmount('13500')===13500);
ok('VoiceKit parses 一万 exactly', VoiceKit.parseAmount('一万')===10000);
ok('VoiceKit parses 九千多 as 9000', VoiceKit.parseAmount('九千多')===9000);
console.log(`\nV216 direct amount gate: ${pass} pass, ${fail} fail`); if(fail)process.exit(1);
