'use strict';
/** Repository-owned browser JS syntax gate. Vendor assets are intentionally excluded. */
const fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=__dirname;
function walk(dir,out=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,out);else if(e.isFile()&&e.name.endsWith('.js'))out.push(p)}return out}
const files=walk(path.join(ROOT,'js')).concat([path.join(ROOT,'sw.js')]).sort();
const failures=[];
for(const f of files){const r=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status!==0)failures.push({file:path.relative(ROOT,f),error:(r.stderr||r.stdout||'syntax error').trim()})}
if(failures.length){console.error('JS Syntax Gate FAIL:',failures.length);for(const x of failures)console.error(' -',x.file,'\n   ',x.error.replace(/\n/g,'\n    '));process.exit(1)}
console.log('JS Syntax Gate:',files.length+'/'+files.length,'PASS');
