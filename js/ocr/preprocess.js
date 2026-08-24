'use strict';
/**
 * OcrKit · preprocess —— 图片预处理管线（Canvas 2D 实现，零依赖）
 *
 * 目标：手机原图（4000×3000、旋转、反光、低亮度）不能直接送 OCR。
 * 按设备档位（high/balanced/low）决定目标尺寸，按票据类型选择增强策略。
 *
 * 阶段一提供 Canvas 可完成的能力：
 *   smartResize / rotate / toGrayscale / enhance / binarize / pipeline
 * 透视矫正（OpenCV.js）留到阶段二按需引入。
 */
(function (global) {
  // 设备档位 → 最长边目标
  const PROFILES = {
    high:    2200,
    balanced: 1800,
    low:     1400,
  };

  /** 从任意图像源加载 HTMLImageElement */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      if (typeof src === 'string') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = src;
      } else if (src instanceof HTMLImageElement) {
        if (src.complete && src.naturalWidth > 0) resolve(src);
        else { src.onload = () => resolve(src); src.onerror = () => reject(new Error('图片加载失败')); }
      } else if (src instanceof HTMLCanvasElement) {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Canvas 转图片失败'));
        img.src = src.toDataURL('image/jpeg', 0.92);
      } else {
        reject(new Error('不支持的图像源'));
      }
    });
  }

  /**
   * 智能缩放：最长边 > 目标 → 等比缩小到目标边。
   * 返回 { canvas, width, height, scale }
   */
  function smartResize(img, maxEdge) {
    const limit = maxEdge || PROFILES.balanced;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    let scale = 1;
    if (Math.max(w, h) > limit) scale = limit / Math.max(w, h);
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, tw, th);
    return { canvas, width: tw, height: th, scale };
  }

  /** 旋转 90 的倍数 */
  function rotate(canvas, deg) {
    const d = ((Number(deg) % 360) + 360) % 360;
    if (d === 0) return canvas;
    const rad = (d * Math.PI) / 180;
    const w = canvas.width, h = canvas.height;
    const out = document.createElement('canvas');
    if (d === 90 || d === 270) { out.width = h; out.height = w; } else { out.width = w; out.height = h; }
    const ctx = out.getContext('2d');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(canvas, -w / 2, -h / 2);
    return out;
  }

  /**
   * 任意角度旋转（倾斜校正用；白底填充，避免黑边干扰 OCR）。
   */
  function rotateCanvas(canvas, deg) {
    const rad = (deg * Math.PI) / 180;
    const w = canvas.width, h = canvas.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rad);
    ctx.drawImage(canvas, -w / 2, -h / 2);
    return out;
  }

  /**
   * 投影法倾斜估计（Deskew）：
   * 对灰度图做水平投影，在 -8°~+8° 范围内搜索使"行投影峰谷方差最大"的角度。
   * 该角度即文字行最水平的旋转角（反向旋转即扶正）。纯 Canvas 实现，零依赖。
   * 复杂度：每角度一次投影扫描（降采样到 320px 宽，速度快）。
   */
  function estimateDeskew(canvas) {
    try {
      const W = 320; // 降采样宽度（速度）
      const scale = W / canvas.width;
      const H = Math.max(1, Math.round(canvas.height * scale));
      const c2 = document.createElement('canvas');
      c2.width = W; c2.height = H;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, W, H);
      const imgData = ctx.getImageData(0, 0, W, H);
      const d = imgData.data;
      const gray = new Uint8Array(W * H);
      for (let i = 0; i < d.length; i += 4) {
        gray[i / 4] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      }
      const inked = (x, y) => gray[y * W + x] < 150; // 深色像素（文字）
      let bestAngle = 0, bestVar = -1;
      for (let ang = -8; ang <= 8; ang += 0.5) {
        const rad = (ang * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const cx = W / 2, cy = H / 2;
        const rows = new Float32Array(H + 8);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (!inked(x, y)) continue;
            const dx = x - cx, dy = y - cy;
            // 投影到 Y 轴（考虑旋转）
            const py = dy * cos - dx * sin + cy;
            const idx = Math.round(py);
            if (idx >= 0 && idx < rows.length) rows[idx]++;
          }
        }
        // 方差 = 投影峰谷对比度（文字行对齐时峰值集中）
        let mean = 0;
        for (let i = 0; i < rows.length; i++) mean += rows[i];
        mean /= rows.length;
        let v = 0;
        for (let i = 0; i < rows.length; i++) v += (rows[i] - mean) * (rows[i] - mean);
        v /= rows.length;
        if (v > bestVar) { bestVar = v; bestAngle = ang; }
      }
      return bestVar > 0 ? bestAngle : 0;
    } catch (e) { return 0; }
  }

  /**
   * 反光抑制：检测超过高阈值的"亮斑"像素，局部压暗到纸面亮度。
   * 对手机拍摄的反光票据（热敏纸/塑封面）有效。
   */
  function reduceGlare(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    // 纸面典型亮度估计：取中位数亮度（反光只占少部分）
    const lum = new Uint8Array(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      lum[j] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }
    const sorted = [...lum].sort((a, b) => a - b);
    const paper = sorted[Math.floor(sorted.length * 0.6)] || 220;
    const glareLum = Math.max(230, paper + 40);
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (l > glareLum) {
        // 反光像素 → 压到纸面亮度（保留微弱色差）
        const k = paper / l;
        d[i] = Math.min(255, d[i] * k);
        d[i + 1] = Math.min(255, d[i + 1] * k);
        d[i + 2] = Math.min(255, d[i + 2] * k);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /** 灰度化（返回新 canvas） */
  function toGrayscale(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // 3x3 卷积（锐化核等）
  function convolve(canvas, kernel, divisor) {
    const ctx = canvas.getContext('2d');
    const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = ctx.createImageData(src);
    const w = canvas.width, h = canvas.height;
    const d = src.data, o = out.data;
    const k = 3;
    const off = Math.floor(k / 2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let ky = 0; ky < k; ky++) {
          for (let kx = 0; kx < k; kx++) {
            const py = Math.min(h - 1, Math.max(0, y + ky - off));
            const px = Math.min(w - 1, Math.max(0, x + kx - off));
            const idx = (py * w + px) * 4;
            const kv = kernel[ky * k + kx];
            r += d[idx] * kv; g += d[idx + 1] * kv; b += d[idx + 2] * kv;
          }
        }
        const idx = (y * w + x) * 4;
        o[idx] = Math.max(0, Math.min(255, r / divisor));
        o[idx + 1] = Math.max(0, Math.min(255, g / divisor));
        o[idx + 2] = Math.max(0, Math.min(255, b / divisor));
        o[idx + 3] = d[idx + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
    return canvas;
  }

  // Otsu 二值化（简化实现：灰度直方图自动阈值）
  function otsuThreshold(grayData) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < grayData.length; i += 4) hist[grayData[i]]++;
    const total = grayData.length / 4;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, maxVar = 0, threshold = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += i * hist[i];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) { maxVar = between; threshold = i; }
    }
    return threshold;
  }

  /** 二值化（先灰度再 Otsu） */
  function binarize(canvas) {
    toGrayscale(canvas);
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const t = otsuThreshold(imgData.data);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] >= t ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // 对比度/亮度调整（线性拉伸）
  function contrast(canvas, amount) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    const f = (255 * (amount || 1.4)) / 100;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        d[i + c] = Math.max(0, Math.min(255, (d[i + c] - 128) * f + 128));
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * 图像增强（按票据类型/场景选择策略，不强制同一处理）
   *   normal      → 轻微锐化
   *   high_contrast → 对比度增强 + 锐化
   *   thermal     → 热敏纸：灰度 + Otsu 二值化 + 锐化
   *   low_light   → 对比度拉伸 + 锐化
   */
  function enhance(canvas, mode) {
    const m = mode || 'normal';
    switch (m) {
      case 'thermal':
        return convolve(binarize(toGrayscale(canvas)), [0, -1, 0, -1, 5, -1, 0, -1, 0], 1);
      case 'high_contrast':
        return convolve(contrast(canvas, 1.5), [0, -1, 0, -1, 5, -1, 0, -1, 0], 1);
      case 'low_light':
        return convolve(contrast(canvas, 1.8), [0, -1, 0, -1, 5, -1, 0, -1, 0], 1);
      case 'none':
        return canvas;
      default:
        return convolve(canvas, [0, -1, 0, -1, 5, -1, 0, -1, 0], 1);
    }
  }

  /**
   * 透视矫正（V4 §19）：斜拍/俯拍票据 → 四点 → 单应变换 → 正面矩形。
   * points: 文档四角（顺时针 TL/TR/BR/BL，像素坐标）。缺省时尝试自动检测。
   * 返回 { canvas, points, used, perspectiveAngle }
   */
  function perspectiveCorrection(canvas, points) {
    let quad = points;
    let used = 'given';
    if (!quad || quad.length !== 4) {
      const auto = detectDocumentQuad(canvas);
      if (auto) { quad = auto; used = 'auto'; }
      else return { canvas, points: null, used: 'none', perspectiveAngle: 0 };
    }
    try {
      const out = warpQuad(canvas, quad);
      return { canvas: out, points: quad, used, perspectiveAngle: 1 };
    } catch (e) {
      console.warn('[ocr] 透视矫正失败，回退原图:', e);
      return { canvas, points: null, used: 'none', perspectiveAngle: 0 };
    }
  }

  /**
   * 自动检测文档四边形：降采样灰度 → 找"最大连通亮区"的边界角点。
   * 启发式：票据多为白底，背景偏暗。取 4 个极端角（最左/最右/最上/最下）的亮区点，
   * 再用"最大内接矩形角"近似。若检测不可靠返回 null（调用方回退 deskew）。
   */
  function detectDocumentQuad(canvas) {
    try {
      const W = 260; // 降采样（速度）
      const scale = W / canvas.width;
      const H = Math.max(1, Math.round(canvas.height * scale));
      const c2 = document.createElement('canvas');
      c2.width = W; c2.height = H;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, W, H);
      const imgData = ctx.getImageData(0, 0, W, H);
      const d = imgData.data;
      // 纸面亮度估计（中位数）
      const lum = [];
      for (let i = 0; i < d.length; i += 4) lum.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      const sorted = [...lum].sort((a, b) => a - b);
      const paper = sorted[Math.floor(sorted.length * 0.5)] || 200;
      const darkThreshold = paper * 0.55; // 背景应明显暗于纸面
      // 收集"亮区"（纸面）像素
      const bright = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const l = lum[y * W + x];
          if (l >= paper * 0.8) bright.push([x, y]);
        }
      }
      if (bright.length < W * H * 0.1) return null; // 亮区太少，不是"白纸照"场景
      // 四个极端角：离图像四角最远的亮像素（近似文档外接角）
      const corners = [];
      const isFar = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > (W + H) / 6;
      const TL = bright.reduce((best, p) => (p[0] + p[1] < best[0] + best[1] ? p : best), bright[0]);
      const TR = bright.reduce((best, p) => ((W - p[0]) + p[1] < (W - best[0]) + best[1] ? p : best), bright[0]);
      const BR = bright.reduce((best, p) => ((W - p[0]) + (H - p[1]) < (W - best[0]) + (H - best[1]) ? p : best), bright[0]);
      const BL = bright.reduce((best, p) => (p[0] + (H - p[1]) < best[0] + (H - best[1]) ? p : best), bright[0]);
      if (!isFar(TL, TR) || !isFar(TR, BR) || !isFar(BR, BL) || !isFar(BL, TL)) return null;
      // 映射回原图坐标（缩放）
      const inv = 1 / scale;
      const out = [TL, TR, BR, BL].map(p => [Math.round(p[0] * inv), Math.round(p[1] * inv)]);
      return out;
    } catch (e) { return null; }
  }

  /**
   * 四点单应变换（纯 Canvas 实现）：
   * 将四边形 quad（TL/TR/BR/BL）透视投影到目标矩形（文档长宽比按四边形估算）。
   * 使用 8 自由度单应矩阵 + 反向映射 + 双线性采样。
   */
  function warpQuad(canvas, quad) {
    const srcW = canvas.width, srcH = canvas.height;
    // 目标尺寸：取四边形对边长度平均，保持长宽比（上限 2000）
    const side = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const wTop = side(quad[0], quad[1]), wBottom = side(quad[3], quad[2]);
    const hLeft = side(quad[0], quad[3]), hRight = side(quad[1], quad[2]);
    const dstW = Math.round(Math.max(1, (wTop + wBottom) / 2));
    const dstH = Math.round(Math.max(1, (hLeft + hRight) / 2));
    const cap = 2000;
    const k = Math.min(1, cap / Math.max(dstW, dstH));
    const W = Math.round(dstW * k), H = Math.round(dstH * k);

    // 目标四角
    const dst = [[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]];
    // 计算单应矩阵 H（src → dst），解 8 元线性方程组
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = quad[i];
      const [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    // 高斯消元
    const h = solveLinear(A, b);
    if (!h) throw new Error('homography singular');

    // 反向映射：dst 每个像素 → src 坐标，双线性采样
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const octx = out.getContext('2d', { willReadFrequently: true });
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, W, H);
    const sctx = canvas.getContext('2d', { willReadFrequently: true });
    const sdata = sctx.getImageData(0, 0, srcW, srcH).data;
    const oimg = octx.createImageData(W, H);
    const od = oimg.data;
    // 求 H 逆（dst → src）
    const Hinv = invert3x3([
      h[0], h[1], h[2],
      h[3], h[4], h[5],
      h[6], h[7], 1,
    ]);
    if (!Hinv) throw new Error('homography not invertible');
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const wInv = Hinv[6] * x + Hinv[7] * y + Hinv[8];
        const sx = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / wInv;
        const sy = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / wInv;
        const xi = Math.floor(sx), yi = Math.floor(sy);
        if (xi < 0 || yi < 0 || xi >= srcW - 1 || yi >= srcH - 1) { /* 留白 */ continue; }
        const fx = sx - xi, fy = sy - yi;
        const idx = (yi * srcW + xi) * 4;
        const idxR = idx + 4, idxD = idx + srcW * 4, idxDR = idxD + 4;
        const oi = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = sdata[idx + c] * (1 - fx) * (1 - fy) +
            sdata[idxR + c] * fx * (1 - fy) +
            sdata[idxD + c] * (1 - fx) * fy +
            sdata[idxDR + c] * fx * fy;
          od[oi + c] = Math.max(0, Math.min(255, Math.round(v)));
        }
        od[oi + 3] = 255;
      }
    }
    octx.putImageData(oimg, 0, 0);
    return out;
  }

  // 高斯消元解 8 元线性方程组（单应矩阵系数）
  function solveLinear(A, b) {
    const n = 8;
    const m = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
      if (Math.abs(m[pivot][col]) < 1e-10) return null;
      [m[col], m[pivot]] = [m[pivot], m[col]];
      const pv = m[col][col];
      for (let c = col; c <= n; c++) m[col][c] /= pv;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = m[r][col];
        if (Math.abs(f) < 1e-12) continue;
        for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
      }
    }
    return m.map(row => row[n]);
  }

  // 3x3 矩阵求逆（单应矩阵）
  function invert3x3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-10) return null;
    const inv = 1 / det;
    return [A * inv, D * inv, G * inv, B * inv, E * inv, H * inv, C * inv, F * inv, I * inv];
  }

  /**
   * 完整预处理管线：load → resize → perspective(QR/auto) → deskew → enhance。
   * opts: { maxEdge, enhanceMode, rotateDeg, deskew, perspectivePoints, upscaleSmall }
   * 返回 { canvas, width, height, scale, deskewAngle, perspectiveAngle }
   */
  async function pipeline(src, opts) {
    const o = opts || {};
    const img = await loadImage(src);
    const { canvas, width, height, scale } = smartResize(img, o.maxEdge || PROFILES.balanced);
    let c = canvas;
    if (o.rotateDeg) c = rotate(c, o.rotateDeg);
    // V4：透视矫正（斜拍/俯拍票据）——QR 四点优先，否则自动检测白纸边界；失败静默回退 deskew
    let perspectiveAngle = 0;
    if (o.perspective !== false) {
      const pc = perspectiveCorrection(c, o.perspectivePoints);
      if (pc.used !== 'none') { c = pc.canvas; perspectiveAngle = 1; }
    }
    // V2：自动倾斜校正（手机斜拍的文字歪斜 → OCR 前扶正；纯投影法，零依赖）
    let deskewAngle = 0;
    if (o.deskew !== false) {
      const d = estimateDeskew(c);
      if (d && Math.abs(d) >= 0.4 && Math.abs(d) <= 15) {
        deskewAngle = d;
        c = rotateCanvas(c, d);
      }
    }
    // V2：反光抑制（高光区域局部压暗，提升热敏纸/塑料卡面识别）
    if (o.glowReduce) c = reduceGlare(c);
    if (o.enhanceMode && o.enhanceMode !== 'none') c = enhance(c, o.enhanceMode);
    return { canvas: c, width: c.width, height: c.height, scale, deskewAngle, perspectiveAngle };
  }

  // canvas → ImageData（送 OCR 引擎）
  function toImageData(canvas) {
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  }

  // canvas → dataURL
  function toDataUrl(canvas, type, quality) {
    return canvas.toDataURL(type || 'image/jpeg', quality == null ? 0.9 : quality);
  }

  global.OcrKit = global.OcrKit || {};
  Object.assign(global.OcrKit, {
    preprocess: { PROFILES, loadImage, smartResize, rotate, rotateCanvas, estimateDeskew, reduceGlare, toGrayscale, enhance, binarize, pipeline, toImageData, toDataUrl,
      perspectiveCorrection, detectDocumentQuad, warpQuad },
  });
})(typeof window !== 'undefined' ? window : globalThis);
