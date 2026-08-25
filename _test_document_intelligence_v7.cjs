const fs=require('fs'), vm=require('vm'), assert=require('assert');
global.window=global; global.OcrKit={};
vm.runInThisContext(fs.readFileSync('js/intelligence/document-intelligence-v7.js','utf8'),{filename:'document-intelligence-v7.js'});
const DI=global.OcrKit.documentIntelligenceV7;
function mk(lines){return {width:1000,height:2000,lines:lines.map((text,i)=>({text,box:[[50,100+i*80],[950,100+i*80],[950,150+i*80],[50,150+i*80]]})),fullText:lines.join('\n')};}
let pass=0;
function eq(name,got,want){assert.strictEqual(String(got),String(want),name+': '+got+' != '+want);console.log('✓',name,got);pass++;}

let r=DI.resolve(mk(['EL FLORIDO','PESO 0.51','Subtotal 647.51','IVA 8.87','Total 656.38','Efectivo 700.00','Cambio 43.62']),{amount:'0.51',merchant:'FECHAYHORA',amountConfidence:.45},{});
eq('El Florido amount',r.amount.value,'656.38');
eq('El Florido merchant',r.merchant.value,'EL FLORIDO');

r=DI.resolve(mk(['ESTACION DEL NORTE','RFC ABC010203AA1','SUBTOTAL 1347.64','IVA 104.66','TOTAL 1452.30','POR']),{amount:'2',merchant:'POR',amountConfidence:.4},{});
eq('Fuel total',r.amount.value,'1452.3');
eq('Fuel merchant',r.merchant.value,'ESTACION DEL NORTE');

r=DI.resolve(mk(['SEE JEE CHINA STORE','CANT DESCRIPCION PRECIO','Total a Cobrar 2712.50','Importe Cobrado 2712.50','Cobro efectivo 2712.50']),{amount:'83',merchant:'CANT',amountConfidence:.4},{});
eq('China Store total',r.amount.value,'2712.5');
eq('China Store merchant',r.merchant.value,'SEE JEE CHINA STORE');

r=DI.resolve(mk(['CFE','TOTAL A PAGAR 56','Subtotal 48.38','IVA 7.74','Total 56.12']),{amount:'56.12',merchant:'AGOSTO',amountConfidence:.9},{});
eq('CFE due beats accounting total',r.amount.value,'56');
eq('CFE merchant',r.merchant.value,'CFE');

r=DI.resolve(mk(['CAMPUS MF','PreFactura 114435','SUBTOTAL 2,250.00','IVA 0.00','TOTAL 2,250.00','CANT']),{amount:'920',merchant:'CANT',amountConfidence:.4},{});
eq('Campus total',r.amount.value,'2250');
eq('Campus merchant',r.merchant.value,'CAMPUS MF');

r=DI.resolve(mk(['PETROMAX','RFC PET040903DH1','FECHA 17/06/2026','TOTAL $1,505.30','ESR']),{amount:'1505.30',merchant:'ESR',amountConfidence:.9},{});
eq('Petromax merchant',r.merchant.value,'PETROMAX'); eq('Petromax date',r.date.value,'2026-06-17');

const audit=DI.resolve(mk(['TOTAL 1452.30']),{amount:'2'},{});
eq('Attribution sees correct candidate',DI.attributeCorrection('amount','2','1452.30',mk(['TOTAL 1452.30']),audit),'candidate_ranking_error');
console.log(`Document Intelligence V7: ${pass}/${pass} passed`);
