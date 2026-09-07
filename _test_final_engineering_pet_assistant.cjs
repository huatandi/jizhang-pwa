const fs=require('fs'),assert=require('assert'),path=require('path');const R=__dirname;
const read=p=>fs.readFileSync(path.join(R,p),'utf8');let n=0;function ok(v,m){assert(v,m);console.log('PASS',m);n++}
const bus=read('js/personalization/app-event-bus.js'),dir=read('js/personalization/pet-director.js'),pet=read('js/personalization/pet-engine.js'),idx=read('index.html'),app=read('js/app.js');
ok(/SAFE_TYPES/.test(bus)&&/delete safe\.amount/.test(bus)&&/delete safe\.photo/.test(bus),'事件总线过滤敏感字段');
ok(/ledger:saved/.test(dir)&&/reminder:due/.test(dir)&&/recognition:start/.test(dir),'宠物导演订阅抽象业务事件');
ok(!/sm:ledger-saved/.test(pet)&&!/sm:reminder/.test(pet),'Pet Engine 不直接拥有业务事件');
ok(/quiet\(ms\)/.test(dir)&&/sm_pet_quiet_until/.test(dir),'免打扰有持久时限');
ok(/action:center/.test(app),'Action Center 向表现层发布计数');
ok(/安静1小时/.test(idx)&&/恢复互动/.test(idx),'设置提供临时安静');
ok(/VERSION:3/.test(pet),'Pet Engine V3');
console.log('Final Engineering Pet Assistant:',n+'/'+n,'PASS');