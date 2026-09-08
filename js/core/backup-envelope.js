'use strict';
/**
 * BackupEnvelope V1
 * 自描述、可校验的飞常明细备份信封。只负责字节 <-> JSON 信封，不触碰业务数据库。
 * 兼容：
 *  - 正式 jizhang-backup-v2：checksum_scope=base64
 *  - 早期 V2 JSON：未声明 scope 时按 JSON.stringify(data) 校验
 */
(function (global) {
  const FORMAT = 'jizhang-backup-v2';
  const VERSION = '2.0';

  function bytesToBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      out += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + chunk)));
    }
    return global.btoa(out);
  }

  function base64ToBytes(text) {
    let bin;
    try { bin = global.atob(String(text || '')); }
    catch (e) { throw new Error('备份 payload 不是有效 Base64'); }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function sha256HexText(text) {
    const c = global.crypto;
    if (!c || !c.subtle || typeof c.subtle.digest !== 'function') {
      throw new Error('当前运行环境不支持 SHA-256，无法校验安全备份');
    }
    const digest = await c.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function create(bytes, metadata) {
    const data = bytesToBase64(bytes);
    const checksum = await sha256HexText(data);
    return {
      metadata: Object.assign({
        format: FORMAT,
        version: VERSION,
        checksum_algorithm: 'SHA-256',
        checksum_scope: 'base64',
        payload_encoding: 'base64-sqlite'
      }, metadata || {}),
      checksum,
      data
    };
  }

  async function decode(obj) {
    if (!obj || typeof obj !== 'object' || !obj.metadata || typeof obj.data !== 'string') {
      throw new Error('备份 JSON 结构无效');
    }
    const meta = obj.metadata || {};
    if (meta.format && meta.format !== FORMAT) throw new Error('不支持的备份格式: ' + meta.format);
    if (meta.payload_encoding && meta.payload_encoding !== 'base64-sqlite') {
      throw new Error('不支持的备份编码: ' + meta.payload_encoding);
    }
    const checksumText = meta.checksum_scope === 'base64' ? obj.data : JSON.stringify(obj.data);
    if (obj.checksum) {
      const actual = await sha256HexText(checksumText);
      if (actual !== obj.checksum) throw new Error('备份文件校验和不匹配（可能损坏）');
    }
    return { metadata: meta, bytes: base64ToBytes(obj.data) };
  }

  global.AppCore = global.AppCore || {};
  global.AppCore.BackupEnvelope = { FORMAT, VERSION, bytesToBase64, base64ToBytes, sha256HexText, create, decode };
})(typeof window !== 'undefined' ? window : globalThis);
