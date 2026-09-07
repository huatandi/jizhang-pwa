(function(g){'use strict';
  const specs=new Map(),packs=new Map();
  const norm=s=>String(s||'').trim().toLowerCase();
  const key=s=>[s.region||'global',s.authority||'generic',s.documentType||'custom',s.applicationType||'default',s.version||'1'].map(norm).join('|');
  function validate(s){if(!s||typeof s!=='object')throw new TypeError('spec required');if(!s.documentType)throw new Error('documentType required');for(const k of ['widthMm','heightMm','dpi'])if(s[k]!=null&&!(+s[k]>0))throw new Error('invalid '+k);if(s.retouchPolicy&&!['normal','limited','none'].includes(s.retouchPolicy))throw new Error('invalid retouchPolicy');return true;}
  function register(s){validate(s);const v=Object.freeze({...s});specs.set(key(v),v);return v;}
  function list(filter={}){return [...specs.values()].filter(s=>Object.entries(filter).every(([k,v])=>v==null||v===''||norm(s[k])===norm(v)));}
  function find(q={}){return list(q)[0]||null;}
  function registerPack(pack){if(!pack||!Array.isArray(pack.specs))throw new Error('invalid spec pack');const id=String(pack.id||('pack-'+Date.now()));packs.set(id,{...pack});return pack.specs.map(register);}
  function exportPacks(){return [...packs.values()].map(p=>({...p}));}
  // Core contains only globally generic references. Country/authority rules must arrive as replaceable packs.
  register({region:'global',authority:'generic',documentType:'1-inch',applicationType:'print',version:'1',label:'1寸（常用参考）',widthMm:25,heightMm:35,dpi:300,verification:'reference',retouchPolicy:'normal',headHeightRatio:.46});
  register({region:'global',authority:'generic',documentType:'2-inch',applicationType:'print',version:'1',label:'2寸（常用参考）',widthMm:35,heightMm:49,dpi:300,verification:'reference',retouchPolicy:'normal',headHeightRatio:.46});
  register({region:'global',authority:'generic',documentType:'passport-reference',applicationType:'reference',version:'1',label:'护照（请选择国家/机构规格包）',verification:'needs-pack',retouchPolicy:'none'});
  register({region:'global',authority:'generic',documentType:'visa-reference',applicationType:'reference',version:'1',label:'签证（请选择国家/机构规格包）',verification:'needs-pack',retouchPolicy:'none'});
  register({region:'global',authority:'generic',documentType:'driving-reference',applicationType:'reference',version:'1',label:'驾驶证（请选择国家/地区规格包）',verification:'needs-pack',retouchPolicy:'limited'});
  register({region:'global',authority:'generic',documentType:'exam-reference',applicationType:'reference',version:'1',label:'考试/高考（请选择考试机构规格包）',verification:'needs-pack',retouchPolicy:'limited'});
  register({region:'global',authority:'generic',documentType:'custom',applicationType:'custom',version:'1',label:'自定义规格',verification:'custom',retouchPolicy:'normal'});
  g.IDPhotoSpecRegistry={register,registerPack,list,find,validate,key,exportPacks,VERSION:2};
})(window);
