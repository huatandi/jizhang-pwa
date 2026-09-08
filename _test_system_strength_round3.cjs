const fs=require('fs'),vm=require('vm');let pass=0,fail=0;function ok(n,v){if(v){console.log('PASS '+n);pass++}else{console.error('FAIL '+n);fail++}}
const html=fs.readFileSync('index.html','utf8'),boot=fs.readFileSync('js/boot.js','utf8'),intel=fs.readFileSync('js/intelligence/intelligence-center.js','utf8'),diag=fs.readFileSync('js/core/system-diagnostics.js','utf8');
ok('SystemDiagnostics loaded before app boot',html.includes('js/core/system-diagnostics.js'));
ok('boot records startup state',boot.includes('SystemDiagnostics.beginBoot()'));
ok('app load marks boot ready',boot.includes('SystemDiagnostics.markReady()'));
ok('normal pagehide marks closed',boot.includes('SystemDiagnostics.markClosed()'));
ok('diagnostics does not call getUserMedia',!diag.includes('getUserMedia('));
ok('permissions are query-only',diag.includes("permissions.query"));
ok('storage usage/quota/persistence audited',diag.includes('storage.estimate')&&diag.includes('storage.persisted'));
ok('service worker registration/control audited',diag.includes('getRegistration')&&diag.includes('serviceWorker.controller'));
ok('camera and microphone inventory audited',diag.includes("audioinput")&&diag.includes("videoinput"));
ok('database health participates in snapshot',diag.includes('database:dbs'));
ok('previous abnormal boot is surfaced',diag.includes('previousAbnormal'));
ok('Intelligence Center renders system health',intel.includes('系统运行自检')&&intel.includes('systemDiag'));
ok('self-test explains it will not request permissions',intel.includes('权限状态只读取'));
ok('settings exposes system self-test entry',html.includes('系统自检 / 识别能力'));
// boot marker state machine
const store=new Map();const ctx={window:null,globalThis:null,navigator:{onLine:true},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},Notification:{permission:'default'}};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(diag,ctx);let a=ctx.AppCore.SystemDiagnostics.beginBoot();ok('first boot is not falsely abnormal',a.previousAbnormal===false);let b=ctx.AppCore.SystemDiagnostics.beginBoot();ok('unfinished boot is detected on next boot',b.previousAbnormal===true);ctx.AppCore.SystemDiagnostics.markReady();ok('ready state persisted',ctx.AppCore.SystemDiagnostics.readBoot().state==='ready');ctx.AppCore.SystemDiagnostics.markClosed();ok('closed state persisted',ctx.AppCore.SystemDiagnostics.readBoot().state==='closed');
console.log(`System Strength Round3: ${pass}/${pass+fail} PASS`);process.exit(fail?1:0);
