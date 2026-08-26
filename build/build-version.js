'use strict';
/**
 * build-version.js —— Build Manifest System（V3.0 §二）
 *
 * 职责：
 *   1. 白名单扫描被 index.html / boot.js 引用的本地资源（js/、css/，vendor 大文件除外）
 *   2. 计算每个资源内容 SHA256（前 8 位）
 *   3. 更新 index.html 中 <script src> / <link href> 的 ?v= 为内容哈希
 *   4. 更新 boot.js 动态加载的 app.js?v=
 *   5. 更新 sw.js CACHE_NAME = 'jizhang-pwa-' + buildId
 *   6. 生成 build/build-manifest.json
 *   7. 输出 Build Report
 *
 * 关键原则（V3.0）：
 *   - buildId = 关键资产哈希排序后计算总哈希 → 相同代码重复构建 buildId 不变（禁止 Date.now()）
 *   - 只做白名单替换，绝不全文件正则（避免误改业务 URL）
 *   - vendor 无版本引用（echarts/tesseract/sqljs）保持不动
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const BOOT = path.join(ROOT, 'js', 'boot.js');
const SW = path.join(ROOT, 'sw.js');
const MANIFEST = path.join(__dirname, 'build-manifest.json');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function shortHash(file) {
  const buf = fs.readFileSync(file);
  return sha256(buf).slice(0, 8);
}
function resolveAsset(rel) {
  // rel 形如 'js/app.js' / 'css/style.css'；去掉查询串
  const clean = String(rel).split('?')[0];
  const p = path.join(ROOT, clean);
  return { rel: clean.replace(/\\/g, '/'), abs: p };
}

// ---------- 1. 扫描 index.html 引用的本地资源（白名单） ----------
function scanIndex() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const assets = new Map(); // rel → hash
  const re = /(?:src|href)="((?:js|css)\/[^"#]+\.(?:js|css))(?:\?v=[\dA-Za-z]+)?"/g;
  let m;
  while ((m = re.exec(html))) {
    const { rel, abs } = resolveAsset(m[1]);
    if (!fs.existsSync(abs)) {
      console.error('[build] 引用的资源不存在: ' + rel);
      process.exit(1);
    }
    if (!assets.has(rel)) assets.set(rel, shortHash(abs));
  }
  return { html, assets };
}

// ---------- 2. 扫描 boot.js 动态引用 ----------
function scanBoot() {
  const js = fs.readFileSync(BOOT, 'utf8');
  const assets = new Map();
  const re = /['"]((?:js|css)\/[^'"]+\.(?:js|css))(?:\?v=[\dA-Za-z]+)?['"]/g;
  let m;
  while ((m = re.exec(js))) {
    const { rel, abs } = resolveAsset(m[1]);
    if (!fs.existsSync(abs)) {
      console.error('[build] boot.js 引用的资源不存在: ' + rel);
      process.exit(1);
    }
    if (!assets.has(rel)) assets.set(rel, shortHash(abs));
  }
  return { js, assets };
}

// ---------- 3. 写回带哈希的版本 ----------
function applyVersions(html, bootJs, assets) {
  // index.html：<script src="x?v=NN"> / <link href="x?v=NN"> → 替换版本（保留原引号）
  let h = html;
  h = h.replace(/((?:src|href)="((?:js|css)\/[^"#]+\.(?:js|css)))\?v=[\dA-Za-z]+(")/g, (all, pre, rel, quote) => {
    const hash = assets.get(rel.split('?')[0]);
    return hash ? `${pre}?v=${hash}${quote}` : all;
  });
  // boot.js：app.js?v=NN（boot 用单引号）
  let b = bootJs;
  b = b.replace(/(['"](?:js|css)\/[^'"]+\.(?:js|css))\?v=[\dA-Za-z]+['"]/g, (all, pre) => {
    const rel = pre.replace(/['"]/g, '').split('?')[0];
    const hash = assets.get(rel);
    return hash ? `${pre}?v=${hash}'` : all;
  });
  return { h, b };
}

// ---------- 4. buildId ----------
function computeBuildId(assets) {
  const lines = [...assets.entries()].map(([rel, hash]) => rel + ':' + hash).sort();
  return sha256(lines.join('|')).slice(0, 8);
}

// ---------- 5. 更新 sw.js CACHE_NAME ----------
function applySw(buildId) {
  let sw = fs.readFileSync(SW, 'utf8');
  sw = sw.replace(/CACHE_NAME = 'jizhang-pwa-[^']*';/, `CACHE_NAME = 'jizhang-pwa-${buildId}';`);
  fs.writeFileSync(SW, sw, 'utf8');
}

// ---------- main（两阶段幂等收敛） ----------
// 阶段 1：用当前内容 hash 替换 index.html/boot.js 的 ?v= → 写回
// 阶段 2：重新扫描（此时 ?v= 已是新 hash，boot.js/index.html 内容稳定）→ 得到最终一致的 assets 表
// 再算 buildId、写 sw.js CACHE_NAME、写 manifest。
// 说明：boot.js 自身被 index.html 引用且带 ?v=，写回后自身内容变化 → 必须重扫才能拿到"构建后"的最终 hash。
function main() {
  console.log('[build] 阶段1：扫描并替换版本引用…');
  const idx1 = scanIndex();
  const boot1 = scanBoot();
  const assets1 = new Map([...idx1.assets, ...boot1.assets]);
  const { h, b } = applyVersions(idx1.html, boot1.js, assets1);
  fs.writeFileSync(INDEX, h, 'utf8');
  fs.writeFileSync(BOOT, b, 'utf8');

  console.log('[build] 阶段2：收敛重扫（构建后内容）…');
  const idx2 = scanIndex();
  const boot2 = scanBoot();
  const assets = new Map([...idx2.assets, ...boot2.assets]);
  console.log('[build] 资源数: ' + assets.size);

  const buildId = computeBuildId(assets);
  applySw(buildId);

  // 幂等：相同 buildId 保留原 generatedAt（避免无谓 git diff 噪音；V3.0 §二 相同代码重复构建不制造变化）
  let generatedAt = new Date().toISOString();
  try {
    const prev = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    if (prev.buildId === buildId && prev.generatedAt) generatedAt = prev.generatedAt;
  } catch (e) { /* 首次构建或 manifest 损坏 → 用当前时间 */ }

  const manifest = {
    buildId,
    generatedAt,
    assets: Object.fromEntries([...assets.entries()].sort()),
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('[build] buildId: ' + buildId);
  console.log('[build] CACHE_NAME → jizhang-pwa-' + buildId);
  console.log('[build] manifest 已生成: build/build-manifest.json');
  // Report
  console.log('[build] ---- Build Report ----');
  for (const [rel, hash] of [...assets.entries()].sort()) {
    console.log('  ' + rel + '  →  ' + hash);
  }
  return buildId;
}

if (require.main === module) main();
module.exports = { main, computeBuildId, shortHash, sha256 };
