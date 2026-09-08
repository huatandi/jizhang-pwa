const fs=require('fs'),assert=require('assert'),path=require('path');
const root=__dirname,idx=fs.readFileSync(path.join(root,'index.html'),'utf8'),pet=fs.readFileSync(path.join(root,'js/personalization/pet-engine.js'),'utf8'),css=fs.readFileSync(path.join(root,'css/style.css'),'utf8');
const names=['rat','ox','tiger','rabbit','dragon','snake','horse','goat','monkey','rooster','dog','pig'];
let n=0; function ok(x,m){assert(x,m);console.log('PASS',m);n++}
ok(/VERSION:[234]/.test(pet),'Pet Engine V2+');
const director=fs.readFileSync(path.join(root,'js/personalization/pet-director.js'),'utf8');
ok(/ledger:saved/.test(director)&&/reminder:due/.test(director)&&/recognition:start/.test(director),'业务事件由 Pet Director 订阅');
ok(/visibilitychange/.test(pet),'后台暂停/恢复');
ok(/prefers-reduced-motion/.test(css),'减少动画可访问性');
ok(/petBreathe/.test(css)&&/petHappy/.test(css)&&/petRemind/.test(css)&&/petWander/.test(css),'睡眠/开心/提醒/走动状态');
for(const x of names){ok(fs.existsSync(path.join(root,'assets/pets/zodiac',x+'.png')),x+' 透明资源存在');ok(idx.includes('assets/pets/zodiac/'+x+'.png'),x+' 选择器使用正式资源')}
console.log('V213 Pet Pack:',n+'/'+n,'PASS');
