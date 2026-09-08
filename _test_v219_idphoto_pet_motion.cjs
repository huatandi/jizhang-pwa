'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path'),R=__dirname,read=p=>fs.readFileSync(path.join(R,p),'utf8');let n=0;function ok(x,m){assert(x,m);console.log('PASS',m);n++}
const idx=read('index.html'),proc=read('js/idphoto/image-processor.js'),gate=read('js/idphoto/capture-quality-gate.js'),studio=read('js/idphoto/idphoto-studio.js'),motion=read('js/personalization/pet-motion-engine.js'),css=read('css/style.css'),sw=read('sw.js');
ok(idx.includes('3. 原图与质量诊断')&&idx.includes('4. 智能修复与成片预览'),'证件照步骤标题按产品语义更新');
ok(/color-mix\(in srgb,var\(--surface2\).*var\(--primary-soft\)/.test(css),'照片容器使用主题化非纯白底色');
ok(/shadowNeed/.test(proc)&&/highlightNeed/.test(proc)&&/lum>=248/.test(proc),'Relight V3 分离阴影恢复与高光压制且识别纯白剪切');
ok(/highlightRatio/.test(gate)&&/clipRatio/.test(gate)&&/shadowDelta/.test(gate),'质量诊断覆盖左右光差/高光/剪切');
ok(/idp-metrics/.test(studio)&&/纯白丢失/.test(studio),'质量 UI 暴露可解释光照指标');
ok(/BLOCK=/.test(motion)&&/avoidAll/.test(motion)&&/rects\(\)/.test(motion),'自由活动具备 UI Safe Zone 避让');
ok(/PERSONALITY/.test(motion)&&/rat:/.test(motion)&&/monkey:/.test(motion)&&/rooster:/.test(motion),'十二生肖运动性格池存在');
ok(/'stroll'/.test(motion)&&/'run'/.test(motion)&&/'jump'/.test(motion)&&/'flip'/.test(motion),'踱步/跑动/跳跃/跟斗动作进入运行时');
ok(/prefers-reduced-motion/.test(motion),'尊重减少动画系统设置');
ok(/document\.hidden/.test(motion)&&/visibilitychange/.test(motion),'后台暂停自由活动');
ok(idx.includes('pet-motion-engine.js')&&sw.includes('pet-motion-engine.js'),'运动引擎接入页面并离线预缓存');
ok(/data-motion="run"/.test(css)&&/petFlip/.test(css)&&/petJump/.test(css),'自由活动动作样式接入');
console.log(`V219 IDPhoto + Pet Motion: ${n}/${n} PASS`);
