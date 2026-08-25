'use strict';
/**
 * Document Intelligence V7
 *
 * 目标：OCR 只负责“看见候选”，本模块负责“理解并裁决”。
 * - 文档分类（通用核心，不绑定墨西哥）
 * - 金额候选池 + 标签角色 + 数学闭环 + 模板锚点
 * - 商户候选 + 表头/月份/状态词负面过滤 + 模板商户记忆
 * - 日期候选（数字日期 + 西/英月名）
 * - 纠错归因：OCR 没看见 vs 已看见但 Resolver 选错
 *
 * 重要原则：
 * 1) 不用数学“凭空创造”金额；数学只给票面候选加权。
 * 2) 模板学习“位置/标签/关系”，不记住上一张票的金额死值。
 * 3) 地区词典是插件式证据；Core 的输出契约与地区无关。
 */
(function (global) {
  const MONTHS = {
    ene:1, enero:1, jan:1, january:1,
    feb:2, febrero:2, february:2,
    mar:3, marzo:3, march:3,
    abr:4, abril:4, apr:4, april:4,
    may:5, mayo:5,
    jun:6, junio:6, june:6,
    jul:7, julio:7, july:7,
    ago:8, agosto:8, aug:8, august:8,
    sep:9, sept:9, septiembre:9, september:9,
    oct:10, octubre:10, october:10,
    nov:11, noviembre:11, november:11,
    dic:12, diciembre:12, dec:12, december:12,
  };

  const MERCHANT_BLOCK = new Set([
    'total','subtotal','iva','ieps','impuesto','tax','cantidad','cant','qty','precio','importe','monto',
    'descripcion','description','producto','product','fecha','hora','date','time','folio','referencia','reference',
    'pagado','pago','payment','cambio','vuelto','efectivo','cash','cliente','customer','rfc','cfdi','uuid',
    'agosto','enero','febrero','marzo','abril','mayo','junio','julio','septiembre','octubre','noviembre','diciembre',
    'january','february','march','april','june','july','august','september','october','november','december',
    'por','esr','cant.','fecha/hora','fechayhora','cajero','caja','ticket','factura','recibo','original','copia'
  ]);

  const TOTAL_LABELS = [
    { re:/\btotal\s+a\s+pagar\b/i, role:'total_due', bonus:1.05 },
    { re:/\btotal\s+a\s+cobrar\b/i, role:'total_due', bonus:1.05 },
    { re:/\bimporte\s+cobrado\b/i, role:'total_paid', bonus:1.00 },
    { re:/\bvalor\s+(?:de\s+)?pago\b/i, role:'total_paid', bonus:0.92 },
    { re:/\bgran\s+total\b/i, role:'total', bonus:0.98 },
    { re:/\btotal\b/i, role:'total', bonus:0.90 },
    { re:/\bamount\s+due\b/i, role:'total_due', bonus:1.05 },
    { re:/\btotal\s+due\b/i, role:'total_due', bonus:1.05 },
    { re:/合计|总计|应付金额|应付合计/i, role:'total_due', bonus:1.05 },
    { re:/\bimporte\b/i, role:'importe', bonus:0.55 },
    { re:/\bmonto\b/i, role:'importe', bonus:0.55 },
    { re:/\bpago\b/i, role:'payment', bonus:0.42 },
  ];
  const SUBTOTAL_RE = /\bsub\s*total\b|\bsubtotal\b|小计/i;
  const TAX_RE = /\biva\b|\bimpuesto\b|\btax\b|税额/i;
  const DISCOUNT_RE = /\bdescuento\b|\bdiscount\b|折扣/i;
  const CASH_RE = /\befectivo\b|\bentregado\b|\brecibido\b|\bcash\b|\btendered\b|现金|实付/i;
  const CHANGE_RE = /\bcambio\b|\bvuelto\b|\bchange\b|找零/i;
  const ITEM_NEG_RE = /\bcant(?:idad)?\b|\bqty\b|\bquantity\b|\bprecio\b|\bunit(?:ario)?\b|\bkg\b|\blitros?\b|\bpeso\b/i;

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function normKey(s) { return norm(s).toLowerCase().replace(/[^a-z0-9áéíóúñü&]+/gi, ''); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function parseMoney(s) {
    if (s == null) return null;
    let x = String(s).trim().replace(/[\s$¥€£￥₩]/g, '');
    if (!x) return null;
    // 1,505.30 / 1 505.30 / 1505,30（仅一个逗号且逗号后2位时视为小数）
    if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(x)) x = x.replace(/,/g, '');
    else if (/^-?\d+,\d{2}$/.test(x) && !x.includes('.')) x = x.replace(',', '.');
    else x = x.replace(/,/g, '');
    const n = Number(x.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  function moneyKey(n) { return Number.isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : ''; }

  function lineBox(line) {
    if (!line) return null;
    const b = line.bbox || line.box;
    if (!b) return null;
    if (Array.isArray(b) && b.length === 4 && typeof b[0] === 'number') return b;
    if (Array.isArray(b) && b.length >= 4 && Array.isArray(b[0])) {
      const xs = b.map(p=>Number(p[0])||0), ys = b.map(p=>Number(p[1])||0);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    return null;
  }
  function relBox(box, W, H) {
    if (!box || !W || !H) return null;
    return [box[0]/W, box[1]/H, box[2]/W, box[3]/H].map(v=>Math.round(v*10000)/10000);
  }
  function centerInRel(box, roi, W, H) {
    if (!box || !roi || !W || !H) return false;
    const cx = ((box[0]+box[2])/2)/W, cy=((box[1]+box[3])/2)/H;
    return cx >= roi[0] && cx <= roi[2] && cy >= roi[1] && cy <= roi[3];
  }

  function linesOf(result) {
    if (result && Array.isArray(result.lines) && result.lines.length) return result.lines.map((l,i)=>({ ...l, _i:i, text:norm(l.text) }));
    const text = norm(result && (result.fullText || result.text));
    return text ? text.split(/\n+/).map((t,i)=>({ text:norm(t), _i:i })) : [];
  }

  function amountsIn(text, allowInteger) {
    const out=[];
    const re = /(?:[$¥€£￥₩]\s*)?(-?\d{1,3}(?:[ ,]\d{3})+(?:[.,]\d{2})|-?\d+[.,]\d{2}|-?\d+)/g;
    let m;
    while ((m=re.exec(String(text||'')))) {
      const raw=m[1];
      if (!allowInteger && !/[.,]\d{2}$/.test(raw)) continue;
      const value=parseMoney(raw);
      if (value == null) continue;
      out.push({ raw, value, index:m.index });
    }
    return out;
  }

  function detectAmountRole(text) {
    const t=norm(text);
    if (SUBTOTAL_RE.test(t)) return { role:'subtotal', bonus:-0.55 };
    if (TAX_RE.test(t)) return { role:'tax', bonus:-0.65 };
    if (DISCOUNT_RE.test(t)) return { role:'discount', bonus:-0.55 };
    if (CHANGE_RE.test(t)) return { role:'change', bonus:-0.90 };
    if (CASH_RE.test(t)) return { role:'cash', bonus:-0.65 };
    for (const x of TOTAL_LABELS) if (x.re.test(t)) return x;
    if (ITEM_NEG_RE.test(t)) return { role:'item', bonus:-0.50 };
    return { role:'unknown', bonus:0 };
  }

  function findRoleAmount(lines, re) {
    for (const line of lines) {
      if (!re.test(line.text)) continue;
      const vals=amountsIn(line.text, true);
      if (vals.length) return vals[vals.length-1].value;
    }
    return null;
  }

  function classify(result, fallbackType) {
    const t = norm(result && (result.fullText || result.text)).toLowerCase();
    const scores = {
      fuel_receipt:0, utility_bill:0, cfdi_invoice:0, payment_receipt:0,
      bank_transfer:0, wholesale_invoice:0, retail_receipt:0, generic_document:0.1,
    };
    const hit=(type,re,w)=>{ if(re.test(t)) scores[type]+=w; };
    hit('fuel_receipt', /litros?|gasolina|diesel|permiso\s*c\.?r\.?e|estaci[oó]n\s+de\s+servicio/, 3);
    hit('utility_bill', /cfe|cespm|servicio\s+de\s+agua|total\s+a\s+pagar|l[ií]mite\s+de\s+pago|periodo\s+facturado/, 3);
    hit('cfdi_invoice', /cfdi|uuid|folio\s+fiscal|emisor|receptor|rfc/, 2.5);
    hit('payment_receipt', /pagos?\s+digitales|referencia|pago\s+realizado|pagado|servicio/, 1.7);
    hit('bank_transfer', /spei|clave\s+de\s+rastreo|ordenante|beneficiario|clabe|transferencia/, 3);
    hit('wholesale_invoice', /precio\s+unitario|cantidad\s+unidad|mayorista|pre\s*factura/, 2);
    hit('retail_receipt', /efectivo|cambio|cajero|ticket|total\s+de\s+art[ií]culos|articulos/, 2);
    if (fallbackType) {
      const map={ receipt:'retail_receipt', invoice:'cfdi_invoice', bank_transfer:'bank_transfer' };
      scores[map[fallbackType]||fallbackType]=(scores[map[fallbackType]||fallbackType]||0)+0.6;
    }
    let best='generic_document', max=-1;
    for (const [k,v] of Object.entries(scores)) if(v>max){max=v;best=k;}
    return { type:best, score:max, scores };
  }

  function resolveAmount(result, baseFields, opts) {
    const o=opts||{};
    const lines=linesOf(result);
    const W=Number(result&&result.width)||0, H=Number(result&&result.height)||0;
    const template=o.templateMatch&&o.templateMatch.template;
    const tplAnchor=template&&template.fieldAnchors&&(template.fieldAnchors.TOTAL_AMOUNT||template.fieldAnchors.amount);
    const byVal=new Map();
    function add(value, info) {
      const n=typeof value==='number'?value:parseMoney(value);
      if(n==null || n<0) return;
      const key=moneyKey(n), prev=byVal.get(key);
      const c=Object.assign({ value:n, key, score:0.20, reasons:[], roles:new Set(), occurrences:0, bbox:null, lineText:null }, info||{});
      c.roles = c.roles instanceof Set ? c.roles : new Set(c.roles||[]);
      if(prev){
        prev.score=Math.max(prev.score,c.score)+0.08;
        prev.occurrences++;
        (c.reasons||[]).forEach(r=>{if(!prev.reasons.includes(r))prev.reasons.push(r)});
        c.roles.forEach(r=>prev.roles.add(r));
        if(!prev.bbox&&c.bbox)prev.bbox=c.bbox;
      } else { c.occurrences=1; byVal.set(key,c); }
    }

    lines.forEach((line,i)=>{
      const role=detectAmountRole(line.text);
      const strong=role.role!=='unknown'&&role.role!=='item';
      const vals=amountsIn(line.text, strong);
      if(!vals.length)return;
      vals.forEach((v,vi)=>{
        // 强标签行通常取最后一个金额；一行多个数字时前面的可能票号/数量
        let score=0.30 + role.bonus;
        if(strong && vi===vals.length-1) score+=0.18;
        if(role.role==='unknown') score+=0.03;
        const box=lineBox(line);
        const reasons=[`line:${role.role}`];
        if(tplAnchor){
          const a=normKey(tplAnchor.anchor||'');
          if(a && normKey(line.text).includes(a)){score+=0.38;reasons.push('template-anchor');}
          if(tplAnchor.roi && centerInRel(box,tplAnchor.roi,W,H)){score+=0.32;reasons.push('template-roi');}
        }
        add(v.value,{ score, reasons, roles:new Set([role.role]), bbox:box, lineText:line.text, lineIndex:i });
      });
    });

    if(baseFields&&baseFields.amount!=null){
      add(baseFields.amount,{ score:0.32+clamp(Number(baseFields.amountConfidence)||0,0,1)*0.25, reasons:['legacy-extractor'], roles:new Set(['legacy']) });
    }

    const subtotal=findRoleAmount(lines,SUBTOTAL_RE);
    const tax=findRoleAmount(lines,TAX_RE);
    const discount=findRoleAmount(lines,DISCOUNT_RE);
    const cash=findRoleAmount(lines,CASH_RE);
    const change=findRoleAmount(lines,CHANGE_RE);
    const expectedFinancial = subtotal!=null ? subtotal + (tax||0) - (discount||0) : null;
    const expectedCash = (cash!=null&&change!=null) ? cash-change : null;
    const tol=0.03;
    const hasExplicitDue = [...byVal.values()].some(c=>c.roles.has('total_due'));
    for(const c of byVal.values()){
      if(expectedFinancial!=null && Math.abs(c.value-expectedFinancial)<=tol){ c.score+=0.52;c.reasons.push('math:subtotal+tax-discount'); }
      if(expectedCash!=null && Math.abs(c.value-expectedCash)<=tol){ c.score+=0.52;c.reasons.push('math:cash-change'); }
      if(c.occurrences>=2){c.score+=Math.min(0.24,0.08*(c.occurrences-1));c.reasons.push('repeated-value');}
      // “TOTAL A PAGAR / TOTAL A COBRAR / AMOUNT DUE”是用户实际要支付的业务字段，
      // 在账单中可与会计计算总额存在舍入差（如 CFE 56 vs 56.12），应优先于普通 TOTAL。
      if(c.roles.has('total_due')) { c.score+=0.62; c.reasons.push('business:explicit-due'); }
      else if(c.roles.has('total')||c.roles.has('total_paid')) { c.score+=0.12; if(hasExplicitDue)c.score-=0.10; }
      if(c.roles.has('subtotal')||c.roles.has('tax')||c.roles.has('change')||c.roles.has('cash')||c.roles.has('item')) c.score-=0.18;
    }
    const list=[...byVal.values()].map(c=>({...c,roles:[...c.roles],score:Math.round(c.score*1000)/1000})).sort((a,b)=>b.score-a.score);
    const best=list[0]||null, second=list[1]||null;
    let confidence=best?clamp(0.50+(best.score*0.23)+(best.reasons.some(r=>r.startsWith('math:'))?0.16:0),0,0.99):0;
    if(best&&second&&best.score-second.score<0.12) confidence=Math.min(confidence,0.72);
    const strong = !!best && (confidence>=0.80 || best.reasons.some(r=>r.startsWith('math:')) || best.roles.includes('total_due'));
    return {
      value:best?String(Math.round(best.value*100)/100):null,
      confidence, source: best ? 'document-intelligence-v7' : null,
      candidates:list.slice(0,12), strong,
      needsRoi: !best || confidence<0.72,
      math:{subtotal,tax,discount,cash,change,expectedFinancial,expectedCash},
      reason:best?best.reasons.join('; '):'no-candidate'
    };
  }

  function merchantBlocked(text) {
    const k=normKey(text);
    if(!k||k.length<3) return true;
    if(/^\d+$/.test(k)) return true;
    if(MERCHANT_BLOCK.has(k)) return true;
    if([...MERCHANT_BLOCK].some(w=>k===normKey(w))) return true;
    if(/^(fecha|hora|total|subtotal|iva|ieps|impuesto|tax|importe|monto|cant|cantidad|pagado|pago|rfc|folio|agosto|por|esr)/i.test(k)) return true;
    if(/^\d{1,2}[\/-]\d{1,2}/.test(text)) return true;
    return false;
  }

  function cleanMerchantLine(text) {
    let t=norm(text).replace(/^[^A-Za-zÁÉÍÓÚÑÜáéíóúñü&]+/,'').replace(/\s{2,}/g,' ');
    t=t.replace(/\b(?:RFC|FECHA|DATE|FOLIO|TOTAL)\b.*$/i,'').trim();
    return t;
  }

  function resolveMerchant(result, baseFields, opts) {
    const o=opts||{}; const lines=linesOf(result); const H=Number(result&&result.height)||0;
    const arr=[];
    function add(value,score,reasons,bbox){
      value=cleanMerchantLine(value); if(merchantBlocked(value))return;
      if(value.length>70)value=value.slice(0,70).trim();
      arr.push({value,score,reasons:reasons||[],bbox:bbox||null});
    }
    const tm=o.templateMatch;
    if(tm&&tm.template&&tm.template.merchantName&&tm.score>=0.50) add(tm.template.merchantName,1.25+tm.score*0.25,['template-merchant'],null);
    if(baseFields&&baseFields.merchant&&!merchantBlocked(baseFields.merchant)) add(baseFields.merchant,0.60,['legacy-extractor'],null);
    if(baseFields&&baseFields.company&&!merchantBlocked(baseFields.company)) add(baseFields.company,0.58,['legacy-company'],null);

    lines.forEach((line,i)=>{
      const t=cleanMerchantLine(line.text); if(merchantBlocked(t))return;
      const box=lineBox(line); const y=box&&H?((box[1]+box[3])/2)/H:(i/Math.max(1,lines.length));
      let score=0.30;
      if(y<0.22)score+=0.42; else if(y<0.38)score+=0.20;
      const letters=(t.match(/[A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g)||[]).length;
      if(letters>=5)score+=0.12;
      if(/\b(?:S\.?A\.?\s+DE\s+C\.?V\.?|SAPI|SA\s+DE\s+CV|STORE|MARKET|ESTACION|COMERCIAL|COMERCIO|UNIVERSIDAD|CAMPUS|PETROMAX|OXXO|CFE|CESPM)\b/i.test(t))score+=0.28;
      if(/\b(?:operadora|distribuidora|comercializadora|servicios|tienda)\b/i.test(t))score+=0.18;
      const nearby=(lines[i+1]&&lines[i+1].text)||'';
      if(/\bRFC\b/i.test(nearby)||/\bRFC\b/i.test(t))score+=0.22;
      if(t.length<=3 && !/^(CFE|OXXO)$/i.test(t))score-=0.45;
      add(t,score,['layout-header'],box);
    });
    // 合并同值
    const map=new Map();
    for(const c of arr){const k=normKey(c.value);const p=map.get(k);if(!p||c.score>p.score)map.set(k,c);}
    const list=[...map.values()].sort((a,b)=>b.score-a.score);
    const best=list[0]||null, second=list[1]||null;
    let conf=best?clamp(0.48+best.score*0.28,0,0.98):0;
    if(best&&second&&best.score-second.score<0.12)conf=Math.min(conf,0.72);
    return {value:best?best.value:null,confidence:conf,candidates:list.slice(0,10),reason:best?best.reasons.join('; '):'no-candidate'};
  }

  function parseDateCandidate(text) {
    let m=String(text||'').match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if(m){let d=+m[1],mo=+m[2],y=+m[3];if(mo>12&&d<=12){const x=d;d=mo;mo=x;}if(y<100)y+=2000;if(d>=1&&d<=31&&mo>=1&&mo<=12)return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
    m=String(text||'').match(/\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
    if(m)return `${m[1]}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`;
    m=String(text||'').toLowerCase().match(/\b(\d{1,2})[\/\-.\s]+([a-záéíóúñü]{3,10})[\/\-.\s]+(\d{2,4})\b/i);
    if(m&&MONTHS[m[2]]){let y=+m[3];if(y<100)y+=2000;return `${y}-${String(MONTHS[m[2]]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`;}
    return null;
  }
  function resolveDate(result,baseFields){
    const lines=linesOf(result), c=[];
    lines.forEach((l,i)=>{const v=parseDateCandidate(l.text);if(!v)return;let s=0.45;if(/fecha|date|emisi[oó]n|expedici[oó]n/i.test(l.text))s+=0.35;if(/vigencia|l[ií]mite|vence|vencimiento/i.test(l.text))s-=0.18;c.push({value:v,score:s,lineText:l.text,bbox:lineBox(l)});});
    if(baseFields&&baseFields.date)c.push({value:String(baseFields.date),score:0.55,reasons:['legacy-extractor']});
    c.sort((a,b)=>b.score-a.score); const b=c[0]||null;
    return {value:b?b.value:null,confidence:b?clamp(0.55+b.score*0.35,0,0.96):0,candidates:c.slice(0,8)};
  }

  function resolve(result, baseFields, opts) {
    const o=opts||{};
    const cls=classify(result,o.docType||(result&&result.documentType));
    const amount=resolveAmount(result,baseFields,o);
    const merchant=resolveMerchant(result,baseFields,o);
    const date=resolveDate(result,baseFields,o);
    return {documentClass:cls,amount,merchant,date,version:'7.0'};
  }

  function attributeCorrection(field, original, corrected, result, audit) {
    const raw=norm(result&&(result.fullText||result.text));
    const orig=norm(original), cor=norm(corrected);
    if(field==='amount'){
      const n=parseMoney(cor);
      if(n!=null){
        const key=moneyKey(n);
        const candidates=(audit&&audit.amount&&audit.amount.candidates)||[];
        if(candidates.some(c=>moneyKey(Number(c.value))===key)) return 'candidate_ranking_error';
        if(raw && raw.replace(/[,\s$]/g,'').includes(String(n).replace('.',''))) return 'candidate_ranking_error';
      }
      return 'ocr_or_segmentation_error';
    }
    if(field==='merchant'){
      if(cor && raw.toLowerCase().includes(cor.toLowerCase())) return 'candidate_ranking_error';
      return 'ocr_or_entity_error';
    }
    return orig!==cor?'resolver_or_ocr_error':'none';
  }

  global.OcrKit=global.OcrKit||{};
  global.OcrKit.documentIntelligenceV7={
    resolve, classify, resolveAmount, resolveMerchant, resolveDate, parseMoney,
    attributeCorrection, MERCHANT_BLOCK, TOTAL_LABELS, relBox, lineBox, version:'7.0'
  };
})(typeof window!=='undefined'?window:globalThis);
