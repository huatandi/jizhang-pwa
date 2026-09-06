'use strict';
/**
 * OcrKit · region-retry —— OCR 区域重试（V4 §49 / V4.5 P1）
 *
 * 当整图识别某字段（金额/日期/商户）置信度低时，不重跑整张图：
 *   1. 定位字段区域：在 lines/words 中找"标签词"（TOTAL/Subtotal/Fecha/...）所在行 bbox
 *   2. 裁剪 + 放大（×2）+ 增强（高对比/锐化）
 *   3. 仅对区域重新识别（Paddle 优先，Tesseract 兜底）
 *   4. 用字段专用正则（数字/日期）从区域文本提取值
 *
 * 依赖：OcrKit.preprocess（裁剪/放大/增强）+ OcrManager（引擎）。
 * 与现有架构完全兼容：OcrManager.recognize 成功后，业务层对低置信字段调用本模块。
 */
(function (global) {
  // 字段 → 标签词（区域定位用）。支持中/西/英。
  // V5 §34：全字段化 —— amount/date/merchant/tax_id/folio/reference/account_last4
  const FIELD_LABELS = {
    amount: [/total/i, /importe\s*total/i, /gran\s*total/i, /subtotal/i, /monto/i, /importe/i, /金额/i, /总计/i, /amount/i],
    date: [/fecha/i, /date/i, /fechade/i, /日期/i, /emision/i],
    tax: [/iva/i, /impuesto/i, /tax/i, /税额/i],
    merchant: [/tienda/i, /store/i, /merchant/i, /商户/i, /店/i, /establecimiento/i],
    rfc: [/rfc/i, /cfdi/i, /folio\s*fiscal/i],
    tax_id: [/rfc/i, /tax\s*id/i, /ein/i, /税号/i, /统一社会信用代码/i],
    folio: [/folio/i, /参考号/i, /referencia/i, /reference/i],
    reference: [/referencia/i, /reference/i, /clave\s*de\s*rastreo/i, /跟踪号/i, /流水号/i],
    account_last4: [/terminaci[oó]n/i, /尾号/i, /last\s*4/i, /ending\s*in/i, /card\s*ending/i],
  };

  // 区域文本提取正则（字段专用，容忍 $/空格/千分位）
  const VALUE_RES = {
    amount: /(?:^|[^0-9])(\d{1,3}(?:[.,]\d{3})*(?:\.\d{2})?|\d+[.,]\d{2}|\d+)\s*(?:mxn|pesos?|usd|eur)?/i,
    // 日期：支持数字月（11/08/2026）与西语月名（11/Ago/2026）与 ISO（2026-08-11）
    date: /(\d{1,2}[\/\-.]\s*(?:[a-záéíóúñü]{3,9}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dic|ene)\s*[\/\-.]\s*\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
    tax: /(?:^|[^0-9])(\d{1,3}(?:[.,]\d{3})*(?:\.\d{2})?|\d+[.,]\d{2}|\d+)/i,
    merchant: /(?:tienda|store|merchant|establecimiento|商户|店)\s*[:：]?\s*([A-Za-zÁÉÍÓÚÑü0-9&.\- ]{2,30})/i,
    rfc: /([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i,
    tax_id: /([A-ZÑ&0-9]{6,20})/i,
    folio: /([A-Z0-9]{4,14})/i,
    reference: /([A-Z0-9\-]{6,18})/i,
    account_last4: /(\d{4})/i,
  };

  /** 找某字段的标签行 bbox（返回行对象；无则 null） */
  function findLabelLine(lines, field) {
    const labels = FIELD_LABELS[field] || [];
    if (!lines || !lines.length || !labels.length) return null;
    for (const line of lines) {
      const t = String(line.text || '');
      for (const re of labels) {
        if (re.test(t)) return line;
      }
    }
    return null;
  }

  /** 找某字段的标签词 bbox（词级，更精确；返回词对象） */
  function findLabelWord(words, field) {
    const labels = FIELD_LABELS[field] || [];
    if (!words || !words.length || !labels.length) return null;
    for (const w of words) {
      const t = String(w.text || '');
      for (const re of labels) {
        if (re.test(t)) return w;
      }
    }
    return null;
  }

  /** 从一行/一词的 bbox 扩展出裁剪区域（左右扩 15%，上下扩 40%，容纳值） */
  function expandBox(box, w, h, padX, padY) {
    const x0 = Math.max(0, box[0][0] - w * (padX || 0.15));
    const y0 = Math.max(0, box[0][1] - h * (padY || 0.4));
    const x1 = Math.min(w, box[2][0] + w * (padX || 0.5) + w * 0.3);
    const y1 = Math.min(h, box[2][1] + h * (padY || 0.6));
    return [x0, y0, Math.max(x0 + 1, x1), Math.max(y0 + 1, y1)];
  }

  /** 裁剪 canvas 区域（坐标已按 canvas 尺寸） */
  function cropCanvas(canvas, region) {
    const [x0, y0, x1, y1] = region;
    const cw = Math.max(1, Math.round(x1 - x0));
    const ch = Math.max(1, Math.round(y1 - y0));
    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(canvas, Math.round(x0), Math.round(y0), cw, ch, 0, 0, cw, ch);
    return out;
  }

  /** 放大区域（×scale，线性插值由 drawImage 完成） */
  function upscale(canvas, scale) {
    const out = document.createElement('canvas');
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return out;
  }


  function normalizeNumeric(raw) {
    let s=String(raw||'').trim().replace(/[^\d,.\-]/g,'');
    if(!s) return null;
    // 1,234.56 / 1 234.56 / 1234,56
    if(/^-?\d+,\d{2}$/.test(s) && !s.includes('.')) s=s.replace(',','.');
    else s=s.replace(/,/g,'');
    const n=Number(s);
    return Number.isFinite(n) ? String(Math.round(n*100)/100) : null;
  }

  function extractValue(field, rawText) {
    const raw=String(rawText||'').replace(/\s+/g,' ').trim();
    if(!raw) return null;
    if(field==='amount' || field==='tax'){
      const vals=[]; const re=/(?:[$¥€£￥₩]\s*)?(-?\d{1,3}(?:[ ,]\d{3})+(?:[.,]\d{2})|-?\d+[.,]\d{2}|-?\d+)/g; let m;
      while((m=re.exec(raw))){const v=normalizeNumeric(m[1]); if(v!=null) vals.push(v);}
      return vals.length ? vals[vals.length-1] : null; // 标签同行通常最后一个金额是值
    }
    if(field==='merchant'){
      // 标签式商户名优先；若无标签，保留最长的非金额文本作为候选，但不自动高置信采用。
      const re=VALUE_RES.merchant, m=raw.match(re); if(m&&m[1]) return m[1].trim();
      const parts=raw.split(/[|;:：]/).map(x=>x.trim()).filter(x=>/[A-Za-zÁÉÍÓÚÑÜ\u3400-\u9fff]/.test(x) && !/^\d/.test(x));
      if(parts.length) return parts.sort((a,b)=>b.length-a.length)[0].slice(0,60);
      return null;
    }
    const vre=VALUE_RES[field]; const m=vre&&raw.match(vre);
    return m && m[1] ? String(m[1]).trim() : null;
  }

  function candidateScore(field, value, conf, rawText, passIndex) {
    let s=Math.max(0,Math.min(1,Number(conf)||0));
    if(value==null||value==='') return 0;
    if(field==='amount'){
      const n=Number(value); if(!Number.isFinite(n)||n<=0) return 0;
      if(/\b(total|importe|monto)\b/i.test(rawText||'')) s+=0.06;
    } else if(field==='date'){
      if(/\d{4}|\d{1,2}[\/\-.]/.test(value)) s+=0.04;
    } else if(field==='rfc'||field==='tax_id'){
      if(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(value)) s+=0.10;
    } else if(field==='reference'||field==='folio'){
      if(String(value).length>=6) s+=0.03;
    }
    s-=Math.max(0,passIndex||0)*0.01; // 首个清晰解优先，避免过度增强制造伪字符
    return Math.max(0,Math.min(1,s));
  }

  /**
   * 区域重试：定位低置信字段区域 → 裁剪放大增强 → 重识别 → 提取值
   * @param {Object} result  OcrResult（含 lines/words/width/height）
   * @param {Object} manager OcrManager（已有引擎）
   * @param {string} field   amount|date|tax|merchant|rfc
   * @param {Object} opts    { scale, engine }
   * @returns {Promise<{value, confidence, region, rawText}|null>}
   */
  async function retryField(result, manager, field, opts) {
    const o = opts || {};
    const lines = result.lines || [];
    const words = result.words || [];
    const W = result.width, H = result.height;
    if (!W || !H || !o.sourceCanvas) return null;

    let anchor = null;
    const lw = findLabelWord(words, field);
    if (lw && lw.box) anchor = lw;
    else {
      const line = findLabelLine(lines, field);
      if (line && line.box) anchor = { box: line.box };
    }
    if (!anchor || !anchor.box || anchor.box.length < 4) return null;

    const box = anchor.box;
    const region = [
      Math.max(0, box[0][0] - W * 0.025),
      Math.max(0, box[0][1] - H * 0.035),
      Math.min(W, box[2][0] + W * (field === 'merchant' ? 0.58 : 0.48)),
      Math.min(H, box[2][1] + H * 0.07),
    ];
    if (region[2] - region[0] < 10 || region[3] - region[1] < 6) return null;

    const baseCrop = cropCanvas(o.sourceCanvas, region);
    // V194+: 真正 ROI 多策略救援。只对小区域跑，最多 3 pass，避免整图 multipass 发热。
    let passes = [
      { scale:o.scale || 2.2, enhance:'normal' },
      { scale:2.8, enhance:'high_contrast' },
    ];
    if (field === 'amount' || field === 'tax' || field === 'rfc' || field === 'reference' || field === 'folio') {
      passes.push({ scale:3.2, enhance:field === 'amount' ? 'thermal' : 'high_contrast' });
    }
    const planner = global.OcrKit && global.OcrKit.RegionRescuePlanner;
    if (planner && planner.plan) {
      try {
        const pp = planner.plan({ field, confidence:o.currentConfidence == null ? 0 : o.currentConfidence });
        if (pp && pp.retry && Array.isArray(pp.passes) && pp.passes.length) {
          passes = pp.passes.slice(0,3).map(x=>({scale:x.scale||2.5,enhance:x.enhance||'high_contrast'}));
        }
      } catch(e){}
    }

    const candidates=[];
    for (let i=0;i<passes.length;i++) {
      const pass=passes[i];
      let reg=upscale(baseCrop, pass.scale || 2.5);
      try {
        if (global.OcrKit && global.OcrKit.preprocess) {
          const gray=global.OcrKit.preprocess.toGrayscale(reg);
          reg=global.OcrKit.preprocess.enhance(gray, pass.enhance || 'high_contrast');
        }
      } catch(e){}

      let rr=null;
      try {
        rr=await manager.recognize(reg,{
          engine:o.engine||'auto', profile:'balanced',
          maxEdge:Math.max(700,Math.min(1300,reg.width)),
          enhanceMode:'none', deskew:false, glowReduce:false, autoRotate:false,
          longReceipt:false, dynamicMaxEdge:false, qrFirst:false
        });
      } catch(e) { continue; }

      const rawText=String(rr && (rr.text||rr.fullText)||'').replace(/\s+/g,' ').trim();
      const value=extractValue(field,rawText);
      if(value==null) continue;
      let conf=0.72;
      if(rr.words&&rr.words.length) conf=rr.words.reduce((s,w)=>s+(Number(w.confidence)||0),0)/rr.words.length;
      const score=candidateScore(field,value,conf,rawText,i);
      candidates.push({value:String(value),confidence:conf,score,region,rawText,engine:rr.engine,pass:i+1,enhance:pass.enhance,scale:pass.scale});
      // 高质量且字段格式强，提前停止，减少耗电。
      if(score>=0.92) break;
    }

    if(!candidates.length) return null;
    candidates.sort((a,b)=>b.score-a.score);
    const best=candidates[0], second=candidates[1];
    // 两个高分候选明显冲突时不强行选，交给上层 RETRY/约束。
    if(second && best.value!==second.value && best.score<0.88 && Math.abs(best.score-second.score)<0.06) {
      return { conflict:true, candidates:candidates.slice(0,3), region, reason:'ROI_REAL_AMBIGUITY' };
    }
    best.candidates=candidates.slice(0,3);
    return best;
  }

  /**
   * 便捷：给定完整 OcrResult + 原图 canvas + manager，对指定低置信字段重试
   * @param {Object} result OcrResult
   * @param {HTMLCanvasElement} sourceCanvas 预处理后原图（与 result 同尺寸）
   * @param {Object} manager OcrManager
   * @param {string} field
   * @returns {Promise<Object|null>}
   */
  function retry(result, sourceCanvas, manager, field, opts) {
    return retryField(result, manager, field, Object.assign({}, opts, { sourceCanvas }));
  }



  /**
   * V7：按模板学习到的相对 ROI 直接救援字段。
   * 已知模板无需再次在全文里猜 TOTAL 位置；只裁小区域，速度远快于整图重跑。
   */
  async function retryTemplateRegion(result, sourceCanvas, manager, field, anchor, opts) {
    const o=opts||{};
    if(!sourceCanvas||!anchor||!Array.isArray(anchor.roi)||anchor.roi.length!==4)return null;
    if(anchor.suspended)return null;
    const W=sourceCanvas.width,H=sourceCanvas.height;
    const r=anchor.roi;
    const padX=field==='amount'?0.10:0.06, padY=field==='amount'?0.035:0.05;
    const region=[
      Math.max(0,(r[0]-padX)*W), Math.max(0,(r[1]-padY)*H),
      Math.min(W,(r[2]+padX)*W), Math.min(H,(r[3]+padY)*H)
    ];
    if(region[2]-region[0]<8||region[3]-region[1]<6)return null;
    let reg=upscale(cropCanvas(sourceCanvas,region),o.scale||2.4);
    // 淡字票：局部增强，不污染原图；仅一个增强版本，避免 multipass 爆炸。
    if(o.enhance!==false){
      try{ if(global.OcrKit&&global.OcrKit.preprocess){
        reg=global.OcrKit.preprocess.enhance(global.OcrKit.preprocess.toGrayscale(reg),'high_contrast');
      }}catch(e){}
    }
    let rr=null;
    try{ rr=await manager.recognize(reg,{engine:o.engine||null,profile:'balanced',maxEdge:Math.max(700,Math.min(1200,reg.width)),enhanceMode:'none',deskew:false,glowReduce:false,autoRotate:false,longReceipt:false}); }catch(e){}
    if(!rr)return null;
    const rawText=String(rr.text||rr.fullText||'').replace(/\s+/g,' ').trim();
    let value=null;
    if(field==='amount'){
      const vals=[]; const re=/(?:[$¥€£￥₩]\s*)?(-?\d{1,3}(?:[ ,]\d{3})+(?:[.,]\d{2})|-?\d+[.,]\d{2}|-?\d+)/g; let m;
      while((m=re.exec(rawText))){let x=m[1]; if(/^-?\d+,\d{2}$/.test(x)&&!x.includes('.'))x=x.replace(',','.'); else x=x.replace(/[ ,]/g,''); const n=Number(x); if(Number.isFinite(n))vals.push(n);}
      if(vals.length)value=String(Math.round(vals[vals.length-1]*100)/100);
    }else{
      const vre=VALUE_RES[field]; const m=vre&&rawText.match(vre); if(m)value=m[1];
    }
    if(value==null)return null;
    let conf=0.82;
    if(rr.words&&rr.words.length)conf=rr.words.reduce((a,w)=>a+(Number(w.confidence)||0),0)/rr.words.length;
    return {value:String(value),confidence:conf,region,rawText,engine:rr.engine,template:true};
  }

  global.OcrKit = global.OcrKit || {};
  Object.assign(global.OcrKit, {
    regionRetry: { retryField, retry, retryTemplateRegion, findLabelLine, findLabelWord, cropCanvas, upscale, extractValue, normalizeNumeric, candidateScore, FIELD_LABELS, VALUE_RES },
  });
})(typeof window !== 'undefined' ? window : globalThis);
