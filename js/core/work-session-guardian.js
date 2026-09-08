'use strict';
/**
 * WorkSessionGuardian V1 — local-only unfinished-ledger draft protection.
 * Scope: income / expense / purchase modals only.
 * Never writes ledger data, never auto-restores, never uploads draft content.
 */
(function(global){
  const KEY='jz_work_session_guardian_v1';
  const CONFIG={
    incomeModal:['iDate','iProject','iAccount','iAmount','iDiscount','iCardPending','iHandler','iRemark','iCurrency','iSemanticType','iLinkedExpense'],
    expenseModal:['eDate','eCategory','eAmount','eAccount','ePayee','eHandler','eRemark','eCurrency'],
    purchaseModal:['pDate','pSupplier','pSupplierNew','pTotal','pCurrency','pPayMethod','pPaid','pStatus','pRemark']
  };
  const active=new Map();
  const timers=new Map();
  const now=()=>new Date().toISOString();
  function storage(){try{return global.localStorage||null}catch(_){return null}}
  function loadAll(){try{return JSON.parse((storage()&&storage().getItem(KEY))||'{}')||{}}catch(_){return {}}}
  function saveAll(x){try{storage()&&storage().setItem(KEY,JSON.stringify(x||{}))}catch(_){}return x}
  function token(id,context){return String(id||'')+'::'+String(context||'new')}
  function getDraft(id,context){return loadAll()[token(id,context)]||null}
  function setDraft(id,context,draft){const all=loadAll();all[token(id,context)]=draft;saveAll(all);return draft}
  function removeDraft(id,context){const all=loadAll();delete all[token(id,context)];saveAll(all)}
  function fieldValue(el){if(!el)return '';if(el.type==='checkbox'||el.type==='radio')return !!el.checked;return el.value==null?'':String(el.value)}
  function setFieldValue(el,v){if(!el)return;if(el.type==='checkbox'||el.type==='radio'){el.checked=!!v;return}el.value=v==null?'':String(v);try{el.dispatchEvent(new Event('change',{bubbles:true}))}catch(_){}}
  function capture(id){const ids=CONFIG[id]||[];const values={};for(const fid of ids){const el=global.document&&global.document.getElementById(fid);if(el)values[fid]=fieldValue(el)}return values}
  function hasMeaningful(values){return Object.entries(values||{}).some(([k,v])=>{
    if(/Date$/.test(k))return false; // auto-filled dates alone do not create a recoverable draft
    return typeof v==='boolean'?v:String(v==null?'':v).trim()!=='';
  })}
  function sameValues(a,b){try{return JSON.stringify(a||{})===JSON.stringify(b||{})}catch(_){return false}}
  function resolvePending(id){
    const st=active.get(id);if(!st||!st.pendingUnrestored)return true;
    const old=getDraft(id,st.context);
    let replace=false;
    try{replace=typeof global.confirm==='function'&&global.confirm('上次未保存草稿仍被保留。继续输入将用当前内容替换旧草稿。确定开始新的内容吗？')}catch(_){replace=false}
    if(replace){removeDraft(id,st.context);st.pendingUnrestored=false;return true}
    if(old){restoreDraft(id,old);st.pendingUnrestored=false;return false}
    st.pendingUnrestored=false;return true;
  }
  function scheduleSave(id){
    clearTimeout(timers.get(id));
    const st=active.get(id);if(st&&st.pendingUnrestored&&!resolvePending(id))return;
    timers.set(id,setTimeout(()=>persist(id),220));
  }
  function persist(id){
    const st=active.get(id);if(!st)return null;
    const values=capture(id);const meaningful=hasMeaningful(values);const dirty=!sameValues(values,st.baseline)&&meaningful;
    st.dirty=dirty;st.values=values;
    if(!dirty){removeDraft(id,st.context);return null}
    return setDraft(id,st.context,{modalId:id,context:st.context,updatedAt:now(),dirty:true,values});
  }
  function attach(id){
    const root=global.document&&global.document.getElementById(id);if(!root||root.__workGuardianBound)return;
    root.__workGuardianBound=true;
    const fn=()=>scheduleSave(id);
    root.addEventListener('input',fn,true);root.addEventListener('change',fn,true);
  }
  function restoreDraft(id,draft){
    if(!draft||!draft.values)return false;
    for(const [fid,v] of Object.entries(draft.values)){setFieldValue(global.document&&global.document.getElementById(fid),v)}
    const st=active.get(id);if(st){st.dirty=true;st.restored=true;st.values=capture(id)}
    return true;
  }
  function start(id,context){
    if(!CONFIG[id])return {supported:false};
    attach(id);
    const ctx=String(context||'new');
    const baseline=capture(id);const st={context:ctx,baseline,dirty:false,restored:false};active.set(id,st);
    const draft=getDraft(id,ctx);
    if(draft&&draft.dirty){
      let allow=false;
      try{allow=typeof global.confirm==='function'&&global.confirm('检测到这项记录上次有未保存的内容。要恢复继续填写吗？')}catch(_){allow=false}
      if(allow){restoreDraft(id,draft);return {supported:true,restored:true,draft}}
      st.pendingUnrestored=true;
      return {supported:true,restored:false,pending:true,draft};
    }
    return {supported:true,restored:false,pending:false};
  }
  function beforeClose(id){
    if(!CONFIG[id])return true;
    const st=active.get(id);if(!st)return true;
    // If a previous draft exists but user chose not to restore it, do not destroy it when closing a blank/current form.
    if(st.pendingUnrestored&&!st.dirty){active.delete(id);return true}
    persist(id);const draft=getDraft(id,st.context);const dirty=!!(st.dirty||(draft&&draft.dirty));
    if(!dirty){active.delete(id);return true}
    let discard=false;
    try{discard=typeof global.confirm==='function'&&global.confirm('当前有尚未保存的内容。确定放弃这些内容吗？')}catch(_){discard=false}
    if(!discard)return false;
    clear(id,st.context);return true;
  }
  function clear(id,context){
    clearTimeout(timers.get(id));timers.delete(id);
    const st=active.get(id);const ctx=context!=null?String(context):(st&&st.context)||'new';
    removeDraft(id,ctx);if(st&&st.context===ctx)active.delete(id);return true
  }
  function afterSave(id){const st=active.get(id);return clear(id,st&&st.context)}
  function hasDirty(){const all=loadAll();return Object.values(all).some(x=>x&&x.dirty)||Array.from(active.values()).some(x=>x&&x.dirty)}
  function summary(){const all=loadAll();const items=Object.values(all).filter(x=>x&&x.dirty&&CONFIG[x.modalId]).map(x=>({modalId:x.modalId,context:x.context||'new',updatedAt:x.updatedAt||null})).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));return {count:items.length,items,hasDirty:items.length>0}}
  function resumeFirst(){
    const s=summary();if(!s.count)return {ok:false,reason:'NO_PENDING_DRAFT'};const x=s.items[0];const ctx=String(x.context||'new');
    try{
      if(x.modalId==='incomeModal'){if(ctx.startsWith('edit:')&&global.editIncome){global.editIncome(Number(ctx.slice(5)));return {ok:true}}if(global.openIncomeModal){global.openIncomeModal();return {ok:true}}}
      if(x.modalId==='expenseModal'){if(ctx.startsWith('edit:')&&global.editExpense){global.editExpense(Number(ctx.slice(5)));return {ok:true}}if(global.openExpenseModal){global.openExpenseModal();return {ok:true}}}
      if(x.modalId==='purchaseModal'){if(ctx.startsWith('edit:')&&global.editPurchase){global.editPurchase(Number(ctx.slice(5)));return {ok:true}}if(global.openPurchaseModal){global.openPurchaseModal();return {ok:true}}}
    }catch(e){return {ok:false,reason:String(e&&e.message||e)}}
    return {ok:false,reason:'OPEN_HANDLER_NOT_READY'};
  }
  global.AppCore=global.AppCore||{};
  global.AppCore.WorkSessionGuardian={VERSION:1,KEY,CONFIG,start,persist,beforeClose,clear,afterSave,hasDirty,summary,resumeFirst,getDraft};
})(typeof window!=='undefined'?window:globalThis);
