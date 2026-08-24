'use strict';
const fs = require('fs');
function probe(file, label) {
  const s = fs.readFileSync(file, 'utf8');
  console.log('===== ' + label + ' (' + file + ') =====');
  const ver = s.match(/[\"']?(?:transformers|onnxruntime[-\w]*)[\"']?\s*[=:]\s*[\"']?([0-9]+\.[0-9]+\.[0-9]+)/i);
  if (ver) console.log('  version候选:', ver[1]);
  const ort = s.match(/onnxruntime[-\w@]*/gi);
  console.log('  onnxruntime引用:', (ort || []).slice(0, 5));
  const v = s.match(/[0-9]+\.[0-9]+\.[0-9]+/g);
  if (v) console.log('  出现的版本号:', v.slice(0, 8));
  const pkg = s.match(/(?:@huggingface\/transformers|@xenova\/transformers|onnxruntime-web)[^\"'\s]*/gi);
  console.log('  package名:', (pkg || []).slice(0, 4));
}
probe('vendor/transformers/transformers.min.js', 'transformers.js');
probe('vendor/paddleocr/index.mjs', 'paddle SDK');
// 也探测 vendor/onnx 的 ort.all.min.mjs 版本
try {
  const o = fs.readFileSync('vendor/onnx/ort.all.min.mjs', 'utf8');
  const v = o.match(/[0-9]+\.[0-9]+\.[0-9]+/g);
  console.log('===== vendor/onnx/ort.all.min.mjs =====');
  console.log('  出现的版本号:', v ? v.slice(0, 6) : 'none');
  console.log('  含 webgpu/jsep:', /jsep|webgpu/i.test(o));
} catch (e) { console.log('ort.all.min.mjs 读取失败:', e.message); }
