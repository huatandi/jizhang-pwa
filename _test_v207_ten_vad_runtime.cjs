const fs=require('fs'),vm=require('vm');
let n=0;const ok=(x,m)=>{if(!x)throw Error(m);n++;};

function makeCtx(){
  const ctx={console,globalThis:null,TextDecoder,Float32Array,Int16Array,Uint8Array,DataView,ArrayBuffer,
    performance:{now:()=>10},navigator:{},location:{href:'https://example.com/app/index.html'}};
  ctx.globalThis=ctx;vm.createContext(ctx);return ctx;
}

// 1) Official ABI wrapper lifecycle with a fake Emscripten memory/module.
const ctx=makeCtx();
ctx.TenVadRuntimeInstaller={isInstalled:async()=>false};
vm.runInContext(fs.readFileSync('js/asr/ten-vad-wasm-provider.js','utf8'),ctx,{filename:'provider'});
const mem=new ArrayBuffer(65536);let heap=1024,handle=0,created=0,processed=0,destroyed=0;
const mod={
  HEAPU8:new Uint8Array(mem),HEAP16:new Int16Array(mem),
  _malloc:(sz)=>{const p=heap;heap+=sz;return p;},_free:()=>{},
  _ten_vad_create:(ptr,hop,th)=>{new DataView(mem).setInt32(ptr,4321,true);handle=4321;created++;return (hop===256&&th===0.5)?0:9;},
  _ten_vad_process:(h,audioPtr,hop,probPtr,flagPtr)=>{
    if(h!==handle||hop!==256)return 8;
    const first=new Int16Array(mem,audioPtr,hop)[0];
    new DataView(mem).setFloat32(probPtr,first!==0?0.9:0.1,true);
    new DataView(mem).setInt32(flagPtr,first!==0?1:0,true);processed++;return 0;
  },
  _ten_vad_destroy:(ptr)=>{if(new DataView(mem).getInt32(ptr,true)===handle)destroyed++;return 0;},
  _ten_vad_get_version:()=>0
};
const S=ctx.TenVadWasmSession,s=new S(mod,{hopSize:256,threshold:.5});
ok(created===1,'created');
const firstHalf=new Float32Array(128);firstHalf.fill(.4);
ok(s.probability(firstHalf)===null,'buffers partial frame');
const speech=new Float32Array(128);speech.fill(.4);
ok(s.probability(speech)>.8&&s.lastFlag===1,'processes combined 256 frame');
ok(processed===1,'one frame');
s.dispose();ok(destroyed===1,'destroy lifecycle');

// 2) Adaptive VAD + neural probability integration.
vm.runInContext(fs.readFileSync('js/asr/vad.js','utf8'),ctx,{filename:'vad'});
const V=ctx.AsrKit.vad.VadEngine;
const v=new V({minSpeechMs:0,silenceDurationMs:40,postRollMs:0,preRollMs:0});
v.setNeuralProbabilityFn(()=>.9);
let started=0;v.onSpeechStart=()=>started++;
v.push(new Float32Array(640)); // zero RMS but neural says speech
ok(started===1&&v.state==='speech','neural can start speech');
v.setNeuralProbabilityFn(()=>.1);
v.push(new Float32Array(640));
ok(v.state==='silence','neural+adaptive silence can end utterance');

// 3) Installer source is pinned and JS signature validation protects unexpected glue.
const code=fs.readFileSync('js/asr/ten-vad-runtime-installer.js','utf8');
ok(code.includes("PIN='b50f2a2'")&&code.includes('1ec0b9640683987e15a4e54e4ce5642b2447c6e5d82b1be889b5099c75434fc3'),'pinned official runtime+hash');
ok(code.includes('_ten_vad_process')&&code.includes('TEN_VAD_WASM_HASH_MISMATCH'),'installer integrity gates');

console.log('V207 TEN-VAD runtime:',n+'/9 PASS');
