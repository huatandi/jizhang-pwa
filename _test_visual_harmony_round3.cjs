'use strict';
/**
 * Visual Harmony Round3 compatibility gate.
 *
 * This gate protects the surviving product contracts, not historical source
 * formatting/comments.  Every assertion reports its own evidence so a CI
 * failure is actionable on the first run.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('css/style.css');
const iconPacks = read('js/personalization/icon-packs.js');
const sw = read('sw.js');
let passed = 0;
let failed = 0;

function check(name, predicate, evidence) {
  let ok = false;
  let detail = '';
  try {
    ok = Boolean(predicate());
  } catch (err) {
    detail = `${err && err.name ? err.name : 'Error'}: ${err && err.message ? err.message : String(err)}`;
  }
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
    return;
  }
  failed++;
  if (!detail) {
    try { detail = typeof evidence === 'function' ? evidence() : (evidence || 'contract returned false'); }
    catch (err) { detail = `evidence unavailable: ${err.message}`; }
  }
  console.error(`FAIL ${name}`);
  console.error(`     evidence: ${detail}`);
}

function themeBlock(theme) {
  // Formatting-independent: accept whitespace/newlines between selector/braces.
  const escaped = theme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`:root\\s*\\[data-theme=["']${escaped}["']\\]\\s*\\{([\\s\\S]*?)\\}`, 'g'));
  return m ? m[m.length - 1] : '';
}

const choices = [...html.matchAll(/data-icon-pack-choice\s*=\s*["']([^"']+)["']/g)].map(m => m[1]);
const official = ['standard', 'cartoon', 'chinese', 'tech'];

check('萌宠视觉升级预览内容和图片引用已删除',
  () => !html.includes('萌宠中心 · 视觉升级预览') && !html.includes('zodiac-studio-preview.png'),
  () => `previewHeading=${html.includes('萌宠中心 · 视觉升级预览')}, previewRef=${html.includes('zodiac-studio-preview.png')}`);
check('萌宠预览图片文件已删除',
  () => !fs.existsSync(path.join(ROOT, 'assets/pets/zodiac-studio-preview.png')),
  () => `exists=${fs.existsSync(path.join(ROOT, 'assets/pets/zodiac-studio-preview.png'))}`);
check('图标风格收敛为四套',
  () => choices.length === 4 && official.every(x => choices.includes(x)),
  () => `choices=${JSON.stringify(choices)}`);
for (const pack of official) {
  check(`${pack} 图标风格可选`, () => choices.includes(pack), () => `choices=${JSON.stringify(choices)}`);
}
check('简陋朋克/未来入口移除',
  () => !choices.includes('punk') && !choices.includes('future'),
  () => `choices=${JSON.stringify(choices)}`);
check('旧图标偏好兼容迁移',
  () => /legacy\s*=\s*\{[^}]*punk\s*:\s*['"]tech['"][^}]*future\s*:\s*['"]tech['"][^}]*\}/s.test(iconPacks),
  'expected legacy migration punk→tech and future→tech');
check('四套图标选择器具有彩色渲染',
  () => official.slice(1).every(pack => new RegExp(`icon-pack-chip\\.${pack}\\b`).test(css)),
  () => official.slice(1).map(pack => `${pack}=${new RegExp(`icon-pack-chip\\.${pack}\\b`).test(css)}`).join(', '));
for (const theme of ['light', 'spring-summer']) {
  check(`${theme} KPI 有独立浅色语义背景`,
    () => { const b = themeBlock(theme); return b.includes('--kpi-income-bg') && b.includes('--kpi-networth-bg'); },
    () => `themeBlockFound=${Boolean(themeBlock(theme))}, income=${themeBlock(theme).includes('--kpi-income-bg')}, networth=${themeBlock(theme).includes('--kpi-networth-bg')}`);
}
check('浅色功能键使用柔和青灰主色语义',
  () => /--primary\s*:\s*#4f8f9d\b/i.test(css),
  'expected semantic primary #4f8f9d; historical comment text is intentionally not part of the contract');
check('SW 不再缓存已删除预览',
  () => !sw.includes('zodiac-studio-preview.png'),
  () => `swPreviewRef=${sw.includes('zodiac-studio-preview.png')}`);

console.log(`Visual Harmony Round3: ${passed}/${passed + failed} PASS${failed ? `, ${failed} FAIL` : ''}`);
if (failed) process.exit(1);
