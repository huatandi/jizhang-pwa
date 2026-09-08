'use strict';
const fs=require('fs'), vm=require('vm');
let pass=0, fail=0;
function ok(name, cond){ console.log((cond?'PASS ':'FAIL ')+name); cond?pass++:fail++; }

// Voice source-level architectural contract: Single Writer + dedupe + read-after-write.
const q=fs.readFileSync('js/voice/quick-voice.js','utf8');
ok('voice single writer exists', /function atomicVoiceWrite\(field, value\)/.test(q));
ok('voice action dedupe ledger exists', /__voiceActionLedger/.test(q) && /voiceActionSeen/.test(q));
ok('numeric transcript authoritative for 13500', /standalone money utterances/.test(q) && /Number\(body\.replace\(\/,\/g, ''\)\)/.test(q));
ok('read-after-write mismatch blocks success', /read-after-write-mismatch/.test(q) && /金额写入校验失败/.test(q));
ok('navigation verified against quickType + active class', /quickType === target && active/.test(q));
ok('account goes through atomic writer', /atomicVoiceWrite\('account', acc\)/.test(q));

// Load Mexico parser modules and verify a BANORTE-style SPEI visual row document.
global.window=global;
for(const f of ['js/mexico/money.js','js/mexico/field-normalizer.js','js/mexico/document-detector.js','js/mexico/spei-parser.js','js/mexico/cfdi-parser.js','js/mexico/oxxo-parser.js','js/mexico/parser.js']) {
  vm.runInThisContext(fs.readFileSync(f,'utf8'),{filename:f});
}
function box(x0,y0,x1,y1){return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];}
const rows=[
 ['Reporte de Transferencia a Nacionales SPEI',0],
 ['Cuenta/ CLABE Ordenante 1331321491',30],
 ['Nombre del Ordenante NWE MARCO FLY COMERCIO SA DE CV',60],
 ['RFC o CURP del Ordenante NMF250306N61',90],
 ['Moneda MXP',120],
 ['Nombre del Beneficiario CONTABLES Y ADUANAL',150],
 ['Cuenta/CLABE/Celular 036180500722064352',180],
 ['RFC Beneficiario SSF2312196B1',210],
 ['Banco Destino INBURSA',240],
 ['Importe a Transferir $20,000.00',270],
 ['IVA $0.00',300],
 ['Fecha Aplicación 07/08/2026',330],
 ['Referencia numérica 260807',360],
 ['Propósito de la Transferencia PAGA X MERCANCIAS',390],
 ['Clave de Rastreo 8846APR2202608075626420646',420],
 ['Confirmación OK. OPERACION EFECTUADA',450]
];
const lines=rows.map(([text,y])=>({text,confidence:96,box:box(0,y,900,y+20)}));
const words=lines.map(l=>({text:l.text,confidence:l.confidence,box:l.box}));
const result={fullText:rows.map(r=>r[0]).join('\n'),words,lines,engine:'test'};
const parsed=MexicoParser.parse(result);
ok('SPEI document classified', parsed.type==='SPEI');
ok('SPEI transfer amount = 20000', parsed.document.amount===20000);
ok('SPEI beneficiary extracted', parsed.document.beneficiary==='CONTABLES Y ADUANAL');
ok('SPEI destination bank extracted', parsed.document.bankBeneficiary==='INBURSA');
ok('SPEI beneficiary RFC extracted', parsed.document.beneficiaryRfc==='SSF2312196B1');
ok('SPEI tracking key extracted', parsed.document.trackingKey==='8846APR2202608075626420646');
ok('SPEI reference extracted', parsed.document.reference==='260807');
ok('SPEI account tail extracted', parsed.document.accountTail==='4352');
ok('SPEI purpose extracted', parsed.document.concept==='PAGA X MERCANCIAS');

console.log(`\nV215 gate: ${pass} pass, ${fail} fail`);
if(fail) process.exit(1);
