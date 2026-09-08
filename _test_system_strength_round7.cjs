'use strict';
const fs=require('fs'),vm=require('vm');let n=0;function ok(x,m){if(!x)throw new Error(m);n++}
const guardianSrc=fs.readFileSync('js/core/work-session-guardian.js','utf8');
const startup=fs.readFileSync('js/core/startup-recovery.js','utf8');
const diag=fs.readFileSync('js/core/system-diagnostics.js','utf8');
const safe=fs.readFileSync('js/core/safe-update-manager.js','utf8');
const ledger=fs.readFileSync('js/ledger-crud.js','utf8');
const app=fs.readFileSync('js/app.js','utf8');
const idx=fs.readFileSync('index.html','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const center=fs.readFileSync('js/intelligence/intelligence-center.js','utf8');
ok(idx.includes('js/core/work-session-guardian.js'),'guardian loaded');
ok(idx.indexOf('js/core/work-session-guardian.js')<idx.indexOf('js/core/startup-recovery.js'),'guardian loads before recovery');
ok(sw.includes("'./js/core/work-session-guardian.js'"),'guardian app shell');
ok(startup.includes('RESUME_UNFINISHED_WORK')&&startup.includes('automaticRestore:false'),'recovery is explicit/non-destructive');
ok(diag.includes('unfinishedWork')&&diag.includes('VERSION:3'),'diagnostics exposes drafts');
ok(safe.includes('WorkSessionGuardian')&&safe.includes('hasDirty'),'safe update respects dirty work');
ok(app.includes('g.beforeClose')&&app.includes('!g.beforeClose(id)'),'modal close guarded');
ok((ledger.match(/WorkSessionGuardian/g)||[]).length>=9,'ledger open/edit/save hooks wired');
ok(center.includes('resumeUnfinishedWork')&&center.includes('恢复继续填写'),'diagnostics resume UI');
const ocrBench=fs.readFileSync('tests/ocr/benchmark.cjs','utf8'),voiceBench=fs.readFileSync('tests/voice/benchmark.cjs','utf8'),reg=fs.readFileSync('tests/regression-gate.cjs','utf8');
ok(ocrBench.includes('OCR RELEASE GATE')&&ocrBench.includes('criticalErrors.length === 0'),'OCR real-result release gate blocks financial errors');
ok(voiceBench.includes('VOICE RELEASE GATE')&&voiceBench.includes('falseCommits.length === 0'),'Voice real-result release gate blocks false commits');
ok(reg.includes("ocrScript, ['--gate']")&&reg.includes("voiceScript, ['--gate']"),'regression gate invokes strict real-result gates');

// Runtime behavior with a minimal local DOM/localStorage.
const memory=new Map();
function mkEl(id,value=''){return {id,value,type:'text',checked:false,listeners:{},addEventListener(t,fn){this.listeners[t]=fn},dispatchEvent(){}}}
const els={
 incomeModal:mkEl('incomeModal'),iDate:mkEl('iDate','2026-09-07'),iProject:mkEl('iProject',''),iAccount:mkEl('iAccount',''),iAmount:mkEl('iAmount',''),iDiscount:mkEl('iDiscount',''),iCardPending:mkEl('iCardPending',''),iHandler:mkEl('iHandler',''),iRemark:mkEl('iRemark',''),iCurrency:mkEl('iCurrency','MXN'),iSemanticType:mkEl('iSemanticType','income'),iLinkedExpense:mkEl('iLinkedExpense',''),
 expenseModal:mkEl('expenseModal'),eDate:mkEl('eDate','2026-09-07'),eCategory:mkEl('eCategory',''),eAmount:mkEl('eAmount',''),eAccount:mkEl('eAccount',''),ePayee:mkEl('ePayee',''),eHandler:mkEl('eHandler',''),eRemark:mkEl('eRemark',''),eCurrency:mkEl('eCurrency','MXN')
};
const sandbox={
 localStorage:{getItem:k=>memory.has(k)?memory.get(k):null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
 document:{getElementById:id=>els[id]||null},Event:function(){},AppCore:{},confirm:()=>true,setTimeout,clearTimeout,globalThis:null
};sandbox.globalThis=sandbox;vm.createContext(sandbox);vm.runInContext(guardianSrc,sandbox);
const G=sandbox.AppCore.WorkSessionGuardian;
ok(G.VERSION===1,'guardian runtime loaded');
G.start('incomeModal','new');els.iAmount.value='125.50';els.iRemark.value='proveedor';G.persist('incomeModal');
ok(G.summary().count===1&&G.getDraft('incomeModal','new').values.iAmount==='125.50','new income draft persisted');
// Separate edit context must not overwrite the new-record draft.
els.iAmount.value='200';G.start('incomeModal','edit:9');els.iAmount.value='210';G.persist('incomeModal');
ok(G.summary().count===2&&G.getDraft('incomeModal','new')&&G.getDraft('incomeModal','edit:9'),'contexts isolated');
G.afterSave('incomeModal');
ok(G.summary().count===1&&!G.getDraft('incomeModal','edit:9')&&G.getDraft('incomeModal','new'),'save clears only active context');
// Restore requires explicit confirmation and repopulates prior values.
els.iAmount.value='';els.iRemark.value='';const r=G.start('incomeModal','new');
ok(r.restored===true&&els.iAmount.value==='125.50'&&els.iRemark.value==='proveedor','explicit restore works');
// Closing dirty draft with no confirmation capability must fail closed.
sandbox.confirm=undefined;els.iAmount.value='126';G.persist('incomeModal');
ok(G.beforeClose('incomeModal')===false&&G.getDraft('incomeModal','new'),'no-confirm cannot silently discard');
// Draft summary does not expose values to diagnostics.
const summary=G.summary();ok(!('values' in summary.items[0]),'summary redacts draft contents');
console.log('System Strength Round7:',n+'/19 PASS');
