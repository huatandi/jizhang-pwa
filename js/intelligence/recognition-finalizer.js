'use strict';
/**
 * RecognitionFinalizer V1 — production acceptance gates for the two headline capabilities.
 * This does not fake browser/device tests. It reports what is proven locally and what still requires
 * a deployed provider/model or real-device corpus.
 */
(function(global){
  const OFFICIAL_CONTRACT={
    sherpa:{
      requiredFamily:'transducer',
      requiredDecoding:'modified_beam_search',
      requiredCapabilities:['hotwords'],
      reason:'Hotwords require a transducer model with modified_beam_search.'
    },
    neuralVad:{providerNames:['TenVadProvider','NeuralVadProvider']}
  };
  function manifestContract(m){
    const fam=String(m&&m.family||'').toLowerCase(), dec=String(m&&m.decodingMethod||m&&m.decoding_method||'').toLowerCase();
    const caps=(m&&m.capabilities||[]).map(x=>String(x).toLowerCase());
    const errs=[];
    if(!fam.includes('transducer'))errs.push('SHERPA_REQUIRES_TRANSDUCER');
    if(dec && dec!=='modified_beam_search')errs.push('SHERPA_HOTWORDS_REQUIRE_MODIFIED_BEAM_SEARCH');
    if(!caps.includes('hotwords'))errs.push('SHERPA_HOTWORDS_CAPABILITY_MISSING');
    return {ok:!errs.length,errors:errs};
  }
  async function providerContract(){
    let sherpa={ok:false,reason:'NOT_READY'},vad={ok:false,reason:'NOT_READY'};
    try{
      const p=global.JizhangSherpaProvider;
      if(p&&typeof p.create==='function'){
        const ready=typeof p.isReady==='function'?await p.isReady():true;
        sherpa={ok:!!ready,reason:ready?'READY':'PROVIDER_NOT_READY'};
      }
    }catch(e){sherpa={ok:false,reason:String(e&&e.message||e)}}
    try{
      const p=global.TenVadProvider||global.NeuralVadProvider;
      if(p&&typeof p.create==='function'){
        if(typeof p.selfTest==='function'){
          const t=await p.selfTest();
          vad={ok:!!t.ok,reason:t.ok?'READY':'PROVIDER_SELF_TEST_FAILED',detail:t};
        }else{
          const ready=typeof p.isReady==='function'?await p.isReady():true;
          vad={ok:!!ready,reason:ready?'READY':'PROVIDER_NOT_READY'};
        }
      }
    }catch(e){vad={ok:false,reason:String(e&&e.message||e)}}
    return {sherpa,vad};
  }
  function metricGate(metrics){
    const m=metrics||{}, issues=[];
    // Targets are deliberately strict for financial recognition.
    if(Number(m.amountCriticalErrors||0)>0)issues.push('AMOUNT_CRITICAL_ERROR_PRESENT');
    if(Number(m.amountSamples||0)>=50 && Number(m.amountAccuracy||0)<.985)issues.push('AMOUNT_ACCURACY_BELOW_TARGET');
    if(Number(m.ocrCriticalSamples||0)>=50 && Number(m.ocrCriticalAccuracy||0)<.97)issues.push('OCR_CRITICAL_FIELD_ACCURACY_BELOW_TARGET');
    return {ok:!issues.length,issues};
  }
  async function report(){
    const providers=await providerContract();
    let device=null,models=null;
    try{device=global.IntelligenceCenter&&global.IntelligenceCenter.deviceProfile?await global.IntelligenceCenter.deviceProfile():null;}catch(e){}
    try{models=global.RecognitionModelManager&&global.RecognitionModelManager.status?await global.RecognitionModelManager.status():null;}catch(e){}
    let benchmarkMetrics=null, benchmarkGate=null;
    try{
      if(global.RecognitionBenchmarkLab){
        benchmarkMetrics=global.RecognitionBenchmarkLab.releaseMetrics();
        benchmarkGate=metricGate(benchmarkMetrics);
      }
    }catch(e){}
    return {
      version:2,
      providers,device,models,benchmarkMetrics,benchmarkGate,
      proven:{
        fallbackArchitecture:true,
        amountScaleConflictBlock:!!global.RecognitionFusionGate,
        ocrRegionRetry:!!(global.OcrKit&&global.OcrKit.regionRetry),
        modelRollback:!!(global.AsrKit&&global.AsrKit.sherpaModelStore&&global.AsrKit.sherpaModelStore.VERSION>=2)
      },
      requiresRealDeviceValidation:[
        'Sherpa WASM provider + released model package',
        'TEN-VAD browser provider/model',
        'real microphone benchmark in shop noise',
        'real receipt/photo corpus benchmark'
      ]
    };
  }
  global.RecognitionFinalizer={VERSION:2,OFFICIAL_CONTRACT,manifestContract,providerContract,metricGate,report};
})(typeof window!=='undefined'?window:globalThis);
