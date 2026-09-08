'use strict';const fs=require('fs'),assert=require('assert'),path=require('path'),R=__dirname;const read=p=>fs.readFileSync(path.join(R,p),'utf8');let n=0;const ok=(x,m)=>{assert(x,m);console.log('PASS',m);n++};const h=read('index.html'),c=read('css/style.css'),i=read('js/personalization/icon-packs.js'),sw=read('sw.js');
ok(!h.includes('萌宠中心 · 视觉升级预览')&&!h.includes('zodiac-studio-preview.png'),'萌宠视觉升级预览内容和图片引用已删除');
ok(!fs.existsSync(path.join(R,'assets/pets/zodiac-studio-preview.png')),'萌宠预览图片文件已删除');
ok((h.match(/data-icon-pack-choice=/g)||[]).length===4,'图标风格收敛为四套');
for(const x of ['standard','cartoon','chinese','tech'])ok(h.includes(`data-icon-pack-choice="${x}"`),`${x} 图标风格可选`);
ok(!h.includes('data-icon-pack-choice="punk"')&&!h.includes('data-icon-pack-choice="future"'),'简陋朋克/未来入口移除');
ok(/VERSION:[23]/.test(i)&&/legacy=\{punk:'tech',future:'tech'\}/.test(i),'旧图标偏好兼容迁移');
ok(/icon-pack-chip\.cartoon/.test(c)&&/icon-pack-chip\.chinese/.test(c)&&/icon-pack-chip\.tech/.test(c),'四套图标选择器具有彩色渲染');
for(const t of ['light','spring-summer']){const at=c.lastIndexOf(`:root[data-theme="${t}"]{`);const b=c.slice(at,c.indexOf('}',at));ok(b.includes('--kpi-income-bg')&&b.includes('--kpi-networth-bg'),`${t} KPI 有独立浅色语义背景`)}
ok(/Softer action controls/.test(c)&&/--primary:#4f8f9d/.test(c),'浅色功能键改为柔和青灰主色');
ok(!sw.includes('zodiac-studio-preview.png'),'SW 不再缓存已删除预览');
console.log(`Visual Harmony Round3: ${n}/${n} PASS`);