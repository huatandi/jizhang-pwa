'use strict';
/**
 * IntelligenceCenter V209 integrated foundation.
 * Local-only diagnostics, self-test, recognition telemetry and learning-rule visibility.
 * No cloud dependency; never writes ledger records.
 */
(function(global){
  const KEY='jz_recognition_telemetry_v1';
  function ls(){try{return global.localStorage||null;}catch(e){return null;}}
  function load(){try{return JSON.parse(ls()&&ls().getItem(KEY)||'[]')||[];}catch(e){return [];}}
  function save(x){try{ls()&&ls().setItem(KEY,JSON.stringify((x||[]).slice(-500)));}catch(e){}}
  function record(evt){
    const a=load(); const e=Object.assign({at:new Date().toISOString()},evt||{});
    a.push(e); save(a); return e;
  }
  function pct(n,d){return d?Math.round(n*1000/d)/10:0;}
  function summarize(kind){
    const a=load().filter(x=>!kind||x.kind===kind), ok=a.filter(x=>x.ok!==false);
    const amount=a.filter(x=>x.field==='amount'), amountOk=amount.filter(x=>x.ok!==false);
    const ms=a.map(x=>Number(x.ms)||0).filter(Boolean);
    return {n:a.length,successRate:pct(ok.length,a.length),amountN:amount.length,
      amountRate:pct(amountOk.length,amount.length),avgMs:ms.length?Math.round(ms.reduce((s,x)=>s+x,0)/ms.length):0};
  }
  async function storageEstimate(){
    try{if(navigator.storage&&navigator.storage.estimate){const x=await navigator.storage.estimate();return {usage:x.usage||0,quota:x.quota||0};}}catch(e){}
    return {usage:0,quota:0};
  }
  async function deviceProfile(){
    const rt=global.AsrKit&&global.AsrKit.runtime;
    const base=rt&&rt.detect?rt.detect():{};
    const st=await storageEstimate();
    return Object.assign({},base,{
      deviceMemory:navigator.deviceMemory||null,hardwareConcurrency:navigator.hardwareConcurrency||null,
      webgpu:!!navigator.gpu,worker:typeof Worker!=='undefined',indexedDB:typeof indexedDB!=='undefined',
      storageUsage:st.usage,storageQuota:st.quota
    });
  }
  async function modelHealth(){
    let sherpa={ready:false,status:'NOT_INSTALLED'};
    try{
      const eng=global.AsrKit&&global.AsrKit.SherpaEngine;
      if(eng){const x=new eng(); sherpa.ready=await x.isAvailable(); sherpa.status=sherpa.ready?'READY':'NOT_READY';}
    }catch(e){sherpa.status='ERROR';}
    const ocrRank=global.OcrKit&&global.OcrKit.ModelBenchmarkStore&&global.OcrKit.ModelBenchmarkStore.rankings?
      global.OcrKit.ModelBenchmarkStore.rankings():[];
    return {sherpa,ocrRank:ocrRank.slice(0,5)};
  }
  function ocrRuntimeStatus(){
    try{
      const get=global.OcrKit&&global.OcrKit.getManager;
      if(!get)return {ready:false,status:'MANAGER_NOT_LOADED',engines:[]};
      const mgr=get();
      const engines=Object.keys((mgr&&mgr.engines)||{});
      const paddle=(mgr&&mgr.engines&&mgr.engines.paddle&&mgr.engines.paddle.engine)||null;
      return {ready:!!mgr,status:(paddle&&paddle._initFailed)?'PADDLE_FAILED':'READY',engines};
    }catch(e){return {ready:false,status:'ERROR:'+String(e&&e.message||e),engines:[]};}
  }
  async function selfTest(){
    const checks=[];
    const push=(name,ok,detail)=>checks.push({name,ok:!!ok,detail:detail||''});
    try{
      const p=await deviceProfile();
      push('Local Storage',!!ls(),'telemetry/settings');
      push('IndexedDB',p.indexedDB,'learning/model metadata');
      push('Web Worker',p.worker,'OCR/ASR isolation');
      push('WASM',typeof WebAssembly!=='undefined','local inference');
      push('Audio API',!!(global.AudioContext||global.webkitAudioContext),'voice capture');
      push('OCR Manager',!!(global.OcrKit&&global.OcrKit.getManager),'recognition router');
      push('ASR Arbitrator',!!(global.AsrKit&&global.AsrKit.resultArbitrator),'multi-engine safety');
      push('Context Bias',!!(global.AsrKit&&global.AsrKit.contextBias),'money/hotword protection');
      const mh=await modelHealth();
      push('Sherpa optional model',mh.sherpa.ready,mh.sherpa.status);
    }catch(e){push('Self test',false,String(e&&e.message||e));}
    return checks;
  }
  async function learnedRules(){
    try{return global.OcrMemoryStore&&global.OcrMemoryStore.all?await global.OcrMemoryStore.all('ocr_learned_rules'):[];}catch(e){return [];}
  }
  async function voiceMemories(){
    try{
      if(!global.PersonalVoiceMemory||!global.PersonalVoiceMemory.list)return [];
      const rows=await global.PersonalVoiceMemory.list();
      return rows.filter(x=>['medium','strong'].includes((global.PersonalVoiceMemory.statusOf&&global.PersonalVoiceMemory.statusOf(x))||x.status||''));
    }catch(e){return [];}
  }
  async function removeVoiceMemory(id){
    try{return !!(global.PersonalVoiceMemory&&global.PersonalVoiceMemory.remove&&await global.PersonalVoiceMemory.remove(id));}catch(e){return false;}
  }
  async function removeRule(key){
    if(!global.OcrMemoryStore||!global.OcrMemoryStore.remove)return false;
    const raw=String(key||'').replace(/^ocr_learned_rules::/,'');
    return global.OcrMemoryStore.remove('ocr_learned_rules',raw);
  }
  function fmtBytes(n){n=Number(n)||0;if(!n)return '—';const u=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}return (n>=10||i===0?Math.round(n):n.toFixed(1))+' '+u[i];}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function render(){
    const box=document.getElementById('intelligenceCenterBody'); if(!box)return;
    box.innerHTML='<div class="empty">正在本机自检…</div>';
    const mm=global.RecognitionModelManager;
    const jobs=[
      deviceProfile(),modelHealth(),selfTest(),learnedRules(),voiceMemories(),
      mm&&mm.status?mm.status():Promise.resolve(null),
      mm&&mm.runtimeReadiness?mm.runtimeReadiness():Promise.resolve({sherpaProvider:false,neuralVad:false}),
      global.RecognitionFinalizer&&global.RecognitionFinalizer.report?global.RecognitionFinalizer.report():Promise.resolve(null),
      global.AppCore&&global.AppCore.SystemDiagnostics?global.AppCore.SystemDiagnostics.snapshot():Promise.resolve(null)
    ];
    const [p,h,checks,rules,voiceRules,modelStatus,runtimeReady,finalReport,systemDiag]=await Promise.all(jobs);
    const asr=summarize('asr'),ocr=summarize('ocr');
    const sysState=systemDiag&&global.AppCore&&global.AppCore.SystemDiagnostics?global.AppCore.SystemDiagnostics.statusOf(systemDiag):null;
    const sysHtml=systemDiag?`<div class="intel-card" style="margin-top:8px"><b>🩺 系统运行自检</b>
      <p>总体：${sysState&&sysState.ok?'🟢 正常':'🟡 需要留意'}　网络：${systemDiag.online?'🟢 在线':'⚪ 离线'}　安全上下文：${systemDiag.secureContext?'🟢':'🟡'}</p>
      <p>数据库：${systemDiag.database&&systemDiag.database.ready?'🟢 READY':'🟡 '+esc(systemDiag.database&&systemDiag.database.status||'未知')}　离线缓存：${systemDiag.serviceWorker&&systemDiag.serviceWorker.registered?'🟢 已注册':'🟡 未注册'}　页面受控：${systemDiag.serviceWorker&&systemDiag.serviceWorker.controlled?'🟢':'⚪'}</p>
      <p>安全更新：${systemDiag.safeUpdate&&systemDiag.safeUpdate.waiting?(systemDiag.safeUpdate.safe?'🟡 新版本待安装':'🟡 已延后（当前有操作）'):'🟢 当前版本稳定'}${systemDiag.safeUpdate&&systemDiag.safeUpdate.waiting?'　<button class="btn-mini" onclick="IntelligenceCenter.applySafeUpdate()">安全更新</button>':''}</p>
      <p>未完成工作：${systemDiag.unfinishedWork&&systemDiag.unfinishedWork.count?'🟡 '+systemDiag.unfinishedWork.count+' 个本机草稿　<button class="btn-mini" onclick="IntelligenceCenter.resumeUnfinishedWork()">恢复继续填写</button>':'🟢 无待恢复草稿'}</p>
      <p>存储：${fmtBytes(systemDiag.storage&&systemDiag.storage.usage)} / ${fmtBytes(systemDiag.storage&&systemDiag.storage.quota)}　持久存储：${systemDiag.storage&&systemDiag.storage.persisted===true?'🟢 已授予':systemDiag.storage&&systemDiag.storage.persisted===false?'🟡 未授予':'⚪ 未知'}</p>
      <p>麦克风：${esc(systemDiag.media&&systemDiag.media.microphonePermission||'unknown')} (${systemDiag.media&&systemDiag.media.microphones||0})　相机：${esc(systemDiag.media&&systemDiag.media.cameraPermission||'unknown')} (${systemDiag.media&&systemDiag.media.cameras||0})　FaceDetector：${systemDiag.faceDetector?'🟢':'⚪ 浏览器未提供'}</p>
      <p>WASM：${systemDiag.capabilities&&systemDiag.capabilities.wasm?'🟢':'🟡'}　WebGPU：${systemDiag.capabilities&&systemDiag.capabilities.webgpu?'🟢':'⚪'}　Worker：${systemDiag.capabilities&&systemDiag.capabilities.worker!==false?'🟢':'⚪'}　通知：${esc(systemDiag.notificationPermission||'unsupported')}</p>
      ${sysState&&sysState.warnings.length?`<div class="recur-hint">${sysState.warnings.map(x=>'• '+esc(x)).join('<br>')}</div>`:'<div class="recur-hint">当前没有发现需要立即处理的运行环境异常。</div>'}
      <p class="recur-hint">权限状态只读取，不会在自检时主动弹出麦克风、相机或定位授权。</p></div>`:'';
    const checkHtml=checks.map(x=>`<div class="intel-row"><span>${x.ok?'🟢':'🟡'} ${esc(x.name)}</span><small>${esc(x.detail||'')}</small></div>`).join('');
    const ruleHtml=rules.length?rules.slice(0,30).map(r=>`<div class="intel-row"><span>🧠 ${esc(r.from||r.source||r.pattern||r.key||'学习规则')}</span><button class="btn-mini" onclick="IntelligenceCenter.deleteRule('${String(r.key||'').replace(/'/g,"\\'")}')">删除</button></div>`).join(''):'<div class="empty">暂无已晋级 OCR 学习规则</div>';
    const voiceRuleHtml=voiceRules.length?voiceRules.slice(0,30).map(r=>`<div class="intel-row"><span>🎙️ ${esc(r.phrase||'')} → ${esc(r.target||'')} <small>${esc(r.status||'')}</small></span><button class="btn-mini" onclick="IntelligenceCenter.deleteVoiceRule('${String(r.id||'').replace(/'/g,"\\'")}')">删除</button></div>`).join(''):'<div class="empty">暂无已晋级语音学习规则</div>';

    let modelHtml='<div class="empty">模型管理器未加载</div>';
    if(modelStatus){
      const sherpaEntries=Object.entries(modelStatus.sherpa||{});
      const installed=sherpaEntries.length?sherpaEntries[0][1]:null;
      const advice=modelStatus.advice||{};
      const manifest=modelStatus.manifest||'';
      const tenVad=modelStatus.tenVad||{installed:false,ready:false};
      const paddlePkg=modelStatus.paddleOcr||{installed:false};
      const ocrManifest=modelStatus.ocrManifest||'';
      modelHtml=`
        <div class="intel-card" style="margin-top:8px">
          <b>📦 本地增强模型</b>
          <p>设备档位：<b>${esc(advice.tier||'balanced')}</b>　${esc(advice.reason||'')}</p>
          <p>持久存储：${modelStatus.persistent===true?'🟢 已授予':modelStatus.persistent===false?'🟡 未授予':'⚪ 未知'}　可用空间：${fmtBytes(advice.free)}</p>
          <div style="padding:10px 0;border-top:1px solid var(--border,#ddd);border-bottom:1px solid var(--border,#ddd);margin:8px 0">
            <b>👂 TEN‑VAD 神经语音活动检测</b>
            <p>运行文件：${tenVad.installed?'🟢 已安装':'⚪ 尚未安装'}　运行 Provider：${runtimeReady.neuralVad?'🟢 READY':'⚪ Adaptive VAD 回退'}</p>
            <p class="recur-hint">官方 WebAssembly，约 300 KB；16 kHz / 256 samples。安装失败不会影响现有语音识别。</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn-primary" onclick="IntelligenceCenter.installTenVad()">安装 TEN‑VAD</button>
              <button class="btn-secondary" onclick="IntelligenceCenter.checkTenVad()">检查 TEN‑VAD</button>
              <button class="btn-danger" onclick="IntelligenceCenter.removeTenVad()">删除 TEN‑VAD</button>
            </div>
          </div>
          <div style="padding:10px 0;border-bottom:1px solid var(--border,#ddd);margin:8px 0">
            <b>👁️ OCR 本地识别</b>
            <p>OCR 管理器：${ocrRuntimeStatus().ready?'🟢 READY':'🟡 '+esc(ocrRuntimeStatus().status)}　引擎：${esc(ocrRuntimeStatus().engines.join(' / ')||'未加载')}</p>
            <p>完整性模型包：${paddlePkg.installed?'🟢 已安装 '+esc(paddlePkg.activeId||''):'⚪ 尚未安装'}　${ocrManifest?'发布清单已配置':'发布清单未配置'}</p>
            <p class="recur-hint">普通预加载仍可能使用上游模型源；只有同源 manifest + size/SHA‑256 校验通过的模型包，才计入“完整离线模型”状态。</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn-primary" onclick="IntelligenceCenter.preloadOcrModels()">安装 / 预加载 OCR</button>
              <button class="btn-secondary" onclick="IntelligenceCenter.checkOcr()">检查 OCR</button>
              ${ocrManifest?`<input id="ocrManifestInput" type="hidden" value="${esc(ocrManifest)}"><button class="btn-secondary" onclick="IntelligenceCenter.inspectOcrPackage()">检查离线模型包</button><button class="btn-primary" onclick="IntelligenceCenter.installOcrPackage()">安装离线模型包</button><button class="btn-danger" onclick="IntelligenceCenter.removeOcrPackage()">删除离线模型包</button>`:`<details><summary>开发者 OCR 模型部署</summary><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><input id="ocrManifestInput" style="min-width:280px;flex:1" placeholder="同源 OCR manifest.json 地址"><button class="btn-secondary" onclick="IntelligenceCenter.inspectOcrPackage()">检查</button><button class="btn-primary" onclick="IntelligenceCenter.installOcrPackage()">测试安装</button></div></details>`}
            </div>
          </div>
          <p>Sherpa 模型文件：${installed?'🟢 已缓存 '+fmtBytes(installed.bytes):'⚪ 尚未安装'}</p>
          <p>Sherpa 运行 Provider：${runtimeReady.sherpaProvider?'🟢 READY':'⚪ 未接入/未就绪'}　Neural VAD：${runtimeReady.neuralVad?'🟢 READY':'⚪ Adaptive VAD 回退'}</p>
          ${manifest ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input id="sherpaManifestInput" type="hidden" value="${esc(manifest)}">
            <button class="btn-secondary" onclick="IntelligenceCenter.inspectSherpaModel()">检查中文增强模型</button>
            <button class="btn-primary" onclick="IntelligenceCenter.installSherpaModel()">安装中文增强识别</button>
            <button class="btn-secondary" onclick="IntelligenceCenter.cancelModelInstall()">取消安装</button>
            <button class="btn-danger" onclick="IntelligenceCenter.removeSherpaModel()">删除增强模型</button>
          </div>` : `
          <div class="recur-hint">⚪ 中文增强模型尚未发布到当前部署。系统继续使用 Whisper / WebSpeech 回退，不影响现有语音功能。</div>
          <details style="margin-top:8px"><summary>开发者部署设置</summary>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              <input id="sherpaManifestInput" style="min-width:280px;flex:1" placeholder="同源 manifest.json 地址">
              <button class="btn-secondary" onclick="IntelligenceCenter.inspectSherpaModel()">检查</button>
              <button class="btn-primary" onclick="IntelligenceCenter.installSherpaModel()">测试安装</button>
            </div>
          </details>`}
          <div id="modelInstallProgress" class="recur-hint" style="margin-top:8px">不会静默下载；只有用户明确点击安装后才开始。</div>
        </div>`;
    }

    const finalHtml=finalReport?`
      <div class="intel-card" style="margin-top:8px">
        <b>🏁 识别生产状态</b>
        <p>金额数量级拦截：${finalReport.proven&&finalReport.proven.amountScaleConflictBlock?'🟢':'🟡'}　
        OCR 局部救援：${finalReport.proven&&finalReport.proven.ocrRegionRetry?'🟢':'🟡'}　
        模型回滚：${finalReport.proven&&finalReport.proven.modelRollback?'🟢':'🟡'}</p>
        <p>Sherpa Provider：${finalReport.providers&&finalReport.providers.sherpa.ok?'🟢 READY':'⚪ '+esc(finalReport.providers&&finalReport.providers.sherpa.reason||'NOT_READY')}　
        Neural VAD：${finalReport.providers&&finalReport.providers.vad.ok?'🟢 READY':'⚪ '+esc(finalReport.providers&&finalReport.providers.vad.reason||'NOT_READY')}</p>
        <p>真实样本：金额 ${finalReport.benchmarkMetrics?finalReport.benchmarkMetrics.amountSamples:0} 条；
        OCR关键字段 ${finalReport.benchmarkMetrics?finalReport.benchmarkMetrics.ocrCriticalSamples:0} 条；
        严重金额错误 ${finalReport.benchmarkMetrics?finalReport.benchmarkMetrics.amountCriticalErrors:0} 条。</p>
        <p>真实样本门禁：${finalReport.benchmarkGate?(finalReport.benchmarkGate.ok?'🟢 当前通过':'🟡 尚未通过'):'⚪ 尚无数据'}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-secondary" onclick="IntelligenceCenter.exportBenchmark()">导出真实识别基准</button>
          <button class="btn-secondary" onclick="IntelligenceCenter.resetBenchmark()">清空基准数据</button>
        </div>
        <p class="recur-hint">正式阶段完成必须经过真实手机麦克风与真实票据样本验收；静态/单元测试不能冒充真机准确率。</p>
      </div>`:'';

    box.innerHTML=sysHtml+`
      <div class="intel-grid">
       <div class="intel-card"><b>💻 设备能力</b><p>内存：${p.deviceMemory||'未知'} GB　CPU线程：${p.hardwareConcurrency||'未知'}</p><p>WebGPU：${p.webgpu?'✓':'—'}　Worker：${p.worker?'✓':'—'}　WASM：${typeof WebAssembly!=='undefined'?'✓':'—'}</p><p>存储：${fmtBytes(p.storageUsage)} / ${fmtBytes(p.storageQuota)}</p></div>
       <div class="intel-card"><b>🎙️ 语音识别</b><p>Sherpa：${h.sherpa.ready?'🟢 READY':'⚪ '+esc(h.sherpa.status)}</p><p>最近样本：${asr.n}　成功率：${asr.successRate}%　金额：${asr.amountRate}%</p><p>平均耗时：${asr.avgMs||'—'} ms</p></div>
       <div class="intel-card"><b>👁️ OCR</b><p>最近样本：${ocr.n}　成功率：${ocr.successRate}%　金额：${ocr.amountRate}%</p><p>平均耗时：${ocr.avgMs||'—'} ms</p><p>Benchmark：${h.ocrRank.length?esc(h.ocrRank[0].key):'尚无足够样本'}</p></div>
      </div>
      <h4>🏁 阶段验收状态</h4>${finalHtml}
      <h4>🚀 模型安装与设备适配</h4>${modelHtml}
      <h4>🩺 一键自检</h4>${checkHtml}
      <h4>🧠 OCR 学习规则</h4>${ruleHtml}
      <h4>🎙️ 语音学习规则</h4>${voiceRuleHtml}`;
  }


  function resumeUnfinishedWork(){
    const g=global.AppCore&&global.AppCore.WorkSessionGuardian;
    if(!g||!g.resumeFirst){if(typeof global.showToast==='function')global.showToast('草稿恢复管理器未加载','error');return;}
    const r=g.resumeFirst();
    if(!r||!r.ok){if(typeof global.showToast==='function')global.showToast('当前没有可恢复的记账草稿。');}
  }

  async function applySafeUpdate(){
    const u=global.AppCore&&global.AppCore.SafeUpdateManager;
    if(!u||!u.apply){if(typeof global.showToast==='function')global.showToast('安全更新管理器未加载','error');return;}
    try{
      const r=await u.apply();
      if(r&&r.deferred){if(typeof global.showToast==='function')global.showToast('正在编辑或识别，新版本已延后，不会强制刷新。');return;}
      if(r&&r.ok){if(typeof global.showToast==='function')global.showToast('正在安全切换到新版本…');return;}
      if(typeof global.showToast==='function')global.showToast('当前没有待安装的新版本。');
    }catch(e){if(typeof global.showToast==='function')global.showToast('安全更新失败：'+String(e&&e.message||e),'error');}
  }

  function progress(msg){
    const el=document.getElementById('modelInstallProgress'); if(el)el.textContent=String(msg||'');
  }
  function manifestInput(){
    const el=document.getElementById('sherpaManifestInput'); return el?String(el.value||'').trim():'';
  }
  async function installTenVad(){
    const mm=global.RecognitionModelManager;
    if(!mm||!mm.installTenVad){progress('TEN‑VAD 安装器未加载。');return;}
    progress('正在下载并校验官方 TEN‑VAD WebAssembly…');
    try{
      const r=await mm.installTenVad(x=>{
        const pct=x&&x.percent!=null?(' '+x.percent+'%'):'';
        progress(`TEN‑VAD：${x.phase||'处理中'} ${x.asset||''}${pct}`);
      });
      progress('TEN‑VAD 安装完成；下一次启动语音时会自动使用，异常时自动回退 Adaptive VAD。');
      await render();
    }catch(e){
      progress((e&&e.name==='AbortError')?'TEN‑VAD 安装已取消。':'TEN‑VAD 安装失败，已保留 Adaptive VAD：'+String(e&&e.message||e));
    }
  }
  async function checkTenVad(){
    const mm=global.RecognitionModelManager;
    if(!mm||!mm.tenVadHealth){progress('TEN‑VAD 健康检查不可用。');return;}
    progress('正在校验 TEN‑VAD 本地文件…');
    const s=await mm.tenVadHealth();
    if(s.ready){
      const r=s.runtime||{};
      progress(`TEN‑VAD READY：SHA‑256 通过；WASM ABI 实测通过；版本 ${r.version||'unknown'}；单帧自检 ${r.elapsedMs!=null?r.elapsedMs+' ms':'完成'}。`);
    }else{
      progress('TEN‑VAD 未通过完整健康检查：'+String((s.runtime&&s.runtime.error)||s.error||'未安装/哈希或WASM运行失败'));
    }
  }
  async function removeTenVad(){
    const mm=global.RecognitionModelManager;
    if(mm&&mm.removeTenVad)await mm.removeTenVad();
    progress('TEN‑VAD 已删除；语音继续使用 Adaptive VAD。');
    await render();
  }

  async function checkOcr(){
    const st=ocrRuntimeStatus();
    if(st.ready) progress('OCR READY：管理器已加载；可用引擎 '+(st.engines.join(' / ')||'已注册')+'。如需验证真实准确率，请用真实票据识别。');
    else progress('OCR 检查未通过：'+st.status+'。可点击“安装 / 预加载 OCR”重试初始化。');
    return st;
  }
  async function preloadOcrModels(){
    if(!global.AIKit||!global.AIKit.preloadOcr){progress('OCR 预加载入口未加载。');return false;}
    progress('正在安装 / 预加载 OCR 本地模型…首次可能需要一些时间。');
    try{
      const ok=await global.AIKit.preloadOcr();
      const st=ocrRuntimeStatus();
      progress(ok===false?'OCR 预加载未完成，识别时将继续自动重试/回退。':('OCR 预加载完成；状态 '+st.status+'。'));
      await render(); return ok!==false;
    }catch(e){progress('OCR 预加载失败：'+String(e&&e.message||e)+'；现有回退链保持可用。');return false;}
  }

  function ocrManifestInput(){const el=document.getElementById('ocrManifestInput');return el?String(el.value||'').trim():'';}
  async function inspectOcrPackage(){const mm=global.RecognitionModelManager,url=ocrManifestInput();if(!mm||!url){progress('请先填写同源 OCR manifest.json 地址。');return;}progress('正在检查 OCR 模型清单、哈希契约与本机空间…');try{const x=await mm.inspectOcr(url);mm.setManifest('paddle_ocr',url);progress(`OCR 模型包：${x.manifest.id}；大小：${fmtBytes(x.preflight.total)}；空间检查：${x.preflight.ok?'通过':'不足'}。`);}catch(e){progress('OCR 模型包检查失败：'+String(e&&e.message||e));}}
  async function installOcrPackage(){const mm=global.RecognitionModelManager,url=ocrManifestInput();if(!mm||!url){progress('请先配置同源 OCR manifest.json。');return;}progress('正在分阶段下载并校验 OCR 模型包…');try{const r=await mm.installOcr(url,x=>progress(`OCR 模型：${x.phase||'处理中'} ${x.done||0}/${x.count||2}　${fmtBytes(x.bytes||0)}`));progress(`OCR 离线模型包安装完成：${fmtBytes(r.bytes)}；已通过安装后完整性检查。`);await render();}catch(e){progress((e&&e.name==='AbortError')?'OCR 模型安装已取消。':'OCR 模型安装失败，已回滚本轮变更：'+String(e&&e.message||e));}}
  async function removeOcrPackage(){const mm=global.RecognitionModelManager;if(!mm)return;try{await mm.removeOcr();progress('OCR 离线模型包已删除；现有 Tesseract/Paddle 回退链保持可用。');await render();}catch(e){progress('OCR 模型删除失败：'+String(e&&e.message||e));}}
  async function inspectSherpaModel(){
    const mm=global.RecognitionModelManager, url=manifestInput();
    if(!mm||!url){progress('请先填写同源 manifest.json 地址。');return;}
    progress('正在检查模型清单与本机空间…');
    try{
      const x=await mm.inspectSherpa(url);
      mm.setManifest('sherpa_zh',url);
      progress(`模型：${x.manifest.id}；大小：${fmtBytes(x.preflight.total)}；空间检查：${x.preflight.ok?'通过':'不足'}。`);
    }catch(e){progress('检查失败：'+String(e&&e.message||e));}
  }
  async function installSherpaModel(){
    const mm=global.RecognitionModelManager, url=manifestInput();
    if(!mm||!url){progress('请先配置发布后的同源 manifest.json。');return;}
    progress('准备下载…');
    try{
      const r=await mm.installSherpa(url,x=>{
        progress(`正在安装 ${x.done}/${x.count}　${x.percent==null?'':x.percent+'%'}　${fmtBytes(x.downloaded)} / ${fmtBytes(x.total)}`);
      });
      progress(`安装完成：${fmtBytes(r.bytes)}；${r.persistent?'已获得持久存储':'浏览器未授予持久存储，仍可使用但可能被系统清理'}。正在刷新状态…`);
      await render();
    }catch(e){
      const msg=e&&e.name==='AbortError'?'已取消安装。':('安装失败并已清理本轮缓存：'+String(e&&e.message||e));
      progress(msg);
    }
  }
  function cancelModelInstall(){
    const mm=global.RecognitionModelManager;
    if(mm&&mm.cancelInstall&&mm.cancelInstall()) progress('正在取消下载…');
    else progress('当前没有正在进行的模型下载。');
  }
  async function removeSherpaModel(){
    const mm=global.RecognitionModelManager; if(!mm)return;
    progress('正在删除本地 Sherpa 模型…');
    try{await mm.removeSherpa();progress('模型已删除；系统继续使用 Whisper / 现有回退引擎。');await render();}
    catch(e){progress('删除失败：'+String(e&&e.message||e));}
  }
  function exportBenchmark(){
    try{
      const lab=global.RecognitionBenchmarkLab;if(!lab)return;
      const blob=new Blob([lab.exportJson()],{type:'application/json'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='recognition-benchmark.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    }catch(e){progress('基准导出失败：'+String(e&&e.message||e));}
  }
  async function resetBenchmark(){
    try{if(global.RecognitionBenchmarkLab)global.RecognitionBenchmarkLab.clear();await render();}catch(e){}
  }
  async function deleteRule(key){if(await removeRule(key))await render();}
  async function deleteVoiceRule(id){if(await removeVoiceMemory(id))await render();}
  global.IntelligenceCenter={VERSION:6,record,summarize,deviceProfile,modelHealth,ocrRuntimeStatus,selfTest,learnedRules,voiceMemories,removeRule,removeVoiceMemory,
    render,deleteRule,deleteVoiceRule,installTenVad,checkTenVad,removeTenVad,checkOcr,preloadOcrModels,inspectOcrPackage,installOcrPackage,removeOcrPackage,inspectSherpaModel,installSherpaModel,cancelModelInstall,removeSherpaModel,exportBenchmark,resetBenchmark,applySafeUpdate,resumeUnfinishedWork};

})(typeof window!=='undefined'?window:globalThis);
