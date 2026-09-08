'use strict';
const fs=require('fs');
let pass=0,fail=0;
function ok(cond,msg){if(cond){pass++;console.log('✓ '+msg)}else{fail++;console.error('✗ '+msg)}}

// Critical field gate pure logic
require('./js/ocr/critical-field-gate.js');
const G=globalThis.OcrKit&&globalThis.OcrKit.CriticalFieldGate;
ok(!!G&&G.VERSION===1,'CriticalFieldGate V1 loaded');
let r=G.evaluate({amount:'60',fullText:'SUBTOTAL 51.72 IVA 8.28 TOTAL $60 EFECTIVO $70 CAMBIO $10'});
ok(r.status==='VERIFIED'&&!r.criticalConflict&&r.minConfidence>=0.95,'matching TOTAL + IVA + cash closure verifies amount');
r=G.evaluate({amount:'560',amountConfidence:.95,fullText:'SUBTOTAL 51.72 IVA 8.28 TOTAL 560 EFECTIVO 70 CAMBIO 10'});
ok(r.status==='CRITICAL_CONFLICT'&&r.criticalConflict&&r.maxConfidence===0.30,'two independent math closures block corrupted TOTAL 560');
r=G.evaluate({amount:'70',fullText:'TOTAL 60 EFECTIVO 70 CAMBIO 10'});
ok(r.status==='CRITICAL_CONFLICT'&&r.criticalConflict,'cash/total agreement blocks accidental EFECTIVO amount');
r=G.evaluate({amount:null,fullText:'SUBTOTAL 51.72 IVA 8.28 EFECTIVO 70 CAMBIO 10'});
ok(r.status==='UNRESOLVED'&&r.criticalConflict===false,'missing amount is not invented from math');
r=G.evaluate({amount:'60',fullText:'TOTAL 60'});
ok(r.status==='VERIFIED','explicit TOTAL label alone can verify the same current amount');
r=G.evaluate({amount:'65',amountConfidence:.9,fullText:'TOTAL 60'});
ok(r.status==='VERIFY'&&r.maxConfidence===0.58,'single conflicting TOTAL downgrades to explicit verification');

const sw=fs.readFileSync('sw.js','utf8');
ok(!/cache\.addAll\(APP_SHELL\)\)\.then\(\(\) => self\.skipWaiting\(\)\)/.test(sw),'SW install no longer auto skipWaiting');
ok(sw.includes("e.data.type === 'SKIP_WAITING'")&&sw.includes('self.skipWaiting()'),'SW only activates early after explicit SKIP_WAITING message');
ok(sw.includes("'./js/core/system-diagnostics.js'")&&sw.includes("'./js/core/safe-update-manager.js'"),'diagnostics and safe update manager are offline app-shell assets');
ok(sw.includes("'./js/ocr/critical-field-gate.js'"),'critical OCR gate is offline app-shell asset');

const upd=fs.readFileSync('js/core/safe-update-manager.js','utf8');
ok(upd.includes("recognition:start")&&upd.includes("recognition:end")&&upd.includes("ui:busy")&&upd.includes("ui:idle"),'safe update manager locks around recognition/UI busy work');
ok(upd.includes("input,textarea,select,[contenteditable=\"true\"]"),'safe update manager detects active field editing');
ok(upd.includes("if(!isSafe())")&&upd.includes("deferred:true"),'unsafe update is deferred rather than forced');
ok(upd.includes("if(applyRequested){applyRequested=false;location.reload();}"),'reload only follows an explicit safe apply request');

const boot=fs.readFileSync('js/boot.js','utf8');
ok(boot.includes('SafeUpdateManager')&&boot.includes("updater.register('sw.js')"),'boot registers SW through safe update manager');
const idx=fs.readFileSync('index.html','utf8');
ok(idx.includes('js/core/safe-update-manager.js')&&idx.includes('js/ocr/critical-field-gate.js'),'new safety modules are loaded by index');
const wb=fs.readFileSync('js/ai/ai-workbench.js','utf8');
ok(wb.includes('CriticalFieldGate.evaluate')&&wb.includes('__amountCriticalConflict'),'workbench applies critical amount gate and preserves conflict metadata');
ok(wb.includes("typeof window.confirm === 'function' ? window.confirm(promptText) : false"),'missing confirm API can no longer silently accept low-confidence amount');
const diag=fs.readFileSync('js/core/system-diagnostics.js','utf8');
ok(diag.includes('safeUpdate')&&diag.includes('发现新版本'),'system diagnostics surfaces staged update state');

console.log(`\nSystem Strength Round4: ${pass}/${pass+fail} PASS`);
process.exit(fail?1:0);
