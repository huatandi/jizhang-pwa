'use strict';
const fs=require('fs');
const p='js/voice/quick-voice.js';
const s=fs.readFileSync(p,'utf8');
const checks=[
 ['final utterance commit lane exists',/function executeFinalVoiceCommand\(finalText\)/.test(s)],
 ['amount command parses value tail only',/const am = raw\.match\([\s\S]*金额[\s\S]*const parser =/.test(s)],
 ['amount atomic write confirms field',/atomicVoiceWrite\('amount', n\);[\s\S]*voiceFieldConfirmed\.amount = true/.test(s)],
 ['amount clears pending and failure state',/voiceAmountPending = null;[\s\S]*voiceFieldFailCount\.amount = 0/.test(s)],
 ['native input change events dispatched by single writer',/dispatchVoiceControlEvents\(el\)/.test(s)],
 ['switch suppresses stale draft reparse',/skipVoiceReparse/.test(s) && /!\(opts && opts\.skipVoiceReparse\)/.test(s)],
 ['explicit command consumed before draft',/if \(executeFinalVoiceCommand\(finalText\)\) return true;/.test(s)],
 ['account command atomic commit exists',/atomicVoiceWrite\('account', acc\);[\s\S]*voiceFieldConfirmed\.account = true/.test(s)]
];
let bad=0; for(const [n,ok] of checks){console.log((ok?'PASS ':'FAIL ')+n);if(!ok)bad++;} if(bad) process.exit(1);
