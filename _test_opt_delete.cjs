'use strict';
/**
 * 常用选项 中文值 删除链路验证（V5）：
 * 复刻 renderOptTags 模板与后端 DELETE filter，确认中文值（一号门店）能正确渲染 × 且删除不因 escJs 截断乱码。
 */
let pass = 0, fail = 0;
function assert(name, cond, detail) { if (cond) { pass++; console.log('  ' + name); } else { fail++; console.log('  X ' + name + (detail ? '  -> ' + detail : '')); } }

const list = ['一', '二', '三', '四', '五', '其他', '一号门店'];
// 前端 escJs / deJs（app.js 567/579 —— 修复版 \uHHHH）
const escJs = (s) => { let o = ''; const str = String(s == null ? '' : s); for (let i = 0; i < str.length; i++) o += '\\u' + str.charCodeAt(i).toString(16).padStart(4, '0'); return o; };
const deJs = (s) => (typeof s !== 'string' || (!s.includes('\\u') && !s.includes('\\x'))) ? s : s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

function main() {
  console.log('\n[1] 渲染：每个条目带 ×');
  const html = list.map(v => `<span class="opt-tag">${v} <button class="opt-del" onclick="removeOptionItem('${escJs(v)}')" title="删除">×</button></span>`).join('');
  const crossCount = (html.match(/×/g) || []).length;
  assert('渲染 × 数量 = 条目数(' + list.length + ')', crossCount === list.length, crossCount);

  console.log('\n[2] onclick 经 JS 解析后（\\uHHHH -> 实字符）还原正确');
  const parse = (esc) => esc.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const clicked = parse(escJs('一号门店'));
  assert('还原为 一号门店', deJs(clicked) === '一号门店', JSON.stringify(clicked));

  console.log('\n[3] 后端 DELETE filter（对每个中文条目都正确）');
  const removed = list.filter(x => x !== deJs(parse(escJs('一号门店'))));
  assert('删除后不含 一号门店', !removed.includes('一号门店'));
  assert('其余 6 条目保留', removed.length === 6, removed.length);

  console.log('\n[4] 特殊字符（空格/括号/引号/emoji）安全');
  const tricky = 'A 店 (总部) "x" 🚀';
  const t = deJs(parse(escJs(tricky)));
  assert('特殊字符值解析正确', t === tricky, JSON.stringify(t));

  console.log('\n=== 选项删除链路验证: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
  if (fail) process.exit(1);
}
main();
