'use strict';
/**
 * build/verify-build.js —— Build Verify（V3.0 §二验收）
 *
 * 验证：
 *   1. index.html 中不存在旧数字版本残留（所有 ?v= 与 manifest 一致）
 *   2. manifest 中的 hash 与文件实际内容一致
 *   3. sw.js CACHE_NAME == 'jizhang-pwa-' + buildId
 *   4. sw.js APP_SHELL 预缓存引用的文件全部真实存在
 *   5. index.html 引用的本地资源全部存在（无 404）
 *
 * 任一失败 → 退出码 1（CI 拦截）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const BOOT = path.join(ROOT, 'js', 'boot.js');
const SW = path.join(ROOT, 'sw.js');
const MANIFEST = path.join(__dirname, 'build-manifest.json');

let errors = 0;
function fail(msg) { errors++; console.error('✗ ' + msg); }
function ok(msg) { console.log('✓ ' + msg); }

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function hashFile(p) { return sha256(fs.readFileSync(p)).slice(0, 8); }

function main() {
  // 0) manifest 存在
  if (!fs.existsSync(MANIFEST)) { fail('build-manifest.json 不存在——请先运行 npm run build'); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  ok('manifest 存在（buildId=' + manifest.buildId + '）');

  // 1) manifest hash 与文件实际内容一致
  for (const [rel, h] of Object.entries(manifest.assets || {})) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { fail('manifest 资源不存在: ' + rel); continue; }
    const cur = hashFile(abs);
    if (cur !== h) fail('manifest 哈希过期: ' + rel + '（manifest=' + h + ' 实际=' + cur + '，需重新 npm run build）');
  }
  ok('manifest 资源哈希全部一致');

  // 2) index.html 无旧数字版本残留 + 版本与 manifest 一致
  const html = fs.readFileSync(INDEX, 'utf8');
  const re = /(?:src|href)="((?:js|css)\/[^"#]+\.(?:js|css))\?v=([\dA-Za-z]+)"/g;
  let m, idxCount = 0;
  while ((m = re.exec(html))) {
    idxCount++;
    const rel = m[1];
    const v = m[2];
    const expect = manifest.assets[rel];
    if (!expect) { fail('index.html 引用了 manifest 之外的资源: ' + rel); continue; }
    if (v !== expect) fail('index.html 版本不一致: ' + rel + '（?v=' + v + ' 期望=' + expect + '）');
  }
  ok('index.html 版本检查通过（' + idxCount + ' 处）');

  // 3) boot.js 版本一致
  const boot = fs.readFileSync(BOOT, 'utf8');
  const bm = /['"]((?:js|css)\/[^'"]+\.(?:js|css))\?v=([\dA-Za-z]+)['"]/.exec(boot);
  if (!bm) fail('boot.js 未找到版本化引用');
  else {
    const expect = manifest.assets[bm[1]];
    if (bm[2] !== expect) fail('boot.js 版本不一致: ' + bm[1] + '（?v=' + bm[2] + ' 期望=' + expect + '）');
    else ok('boot.js 版本检查通过（' + bm[1] + ' ?v=' + bm[2] + '）');
  }

  // 4) sw.js CACHE_NAME == 'jizhang-pwa-' + buildId
  const sw = fs.readFileSync(SW, 'utf8');
  const cm = /CACHE_NAME = 'jizhang-pwa-([\dA-Za-z]+)'/.exec(sw);
  if (!cm) fail('sw.js 未找到 CACHE_NAME');
  else if (cm[1] !== manifest.buildId) fail('sw.js CACHE_NAME 与 buildId 不一致（CACHE=' + cm[1] + ' buildId=' + manifest.buildId + '）');
  else ok('sw.js CACHE_NAME = jizhang-pwa-' + cm[1] + ' ✓');

  // 5) sw.js APP_SHELL 引用文件全部存在
  let shellCount = 0;
  const shellRe = /'\.\/([^']+)'/g;
  while ((m = shellRe.exec(sw))) {
    shellCount++;
    const rel = m[1];
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) fail('APP_SHELL 资源不存在: ' + rel);
  }
  ok('APP_SHELL 预缓存检查通过（' + shellCount + ' 项）');

  // 6) index.html 引用的本地资源全部存在
  const allRe = /(?:src|href)="((?:js|css|vendor)\/[^"#]+\.(?:js|css|wasm|mjs|json|png|gz))"/g;
  let miss = 0;
  while ((m = allRe.exec(html))) {
    const abs = path.join(ROOT, m[1].split('?')[0]);
    if (!fs.existsSync(abs)) { fail('index.html 资源不存在: ' + m[1]); miss++; }
  }
  if (!miss) ok('index.html 资源存在性检查通过');

  // 7) 无旧语义版本残留（vNNN-final-intelligence 之类）
  if (/jizhang-pwa-v\d+[A-Za-z-]*/.test(sw) && !/jizhang-pwa-[\dA-Za-z]{8}'/.test(sw)) {
    fail('sw.js 仍含旧语义版本号（需重新 build）');
  } else ok('无旧语义版本残留');

  if (errors) { console.error('\n[verify] 失败 ' + errors + ' 项'); process.exit(1); }
  console.log('\n[verify] ✅ 全部通过');
}

main();
