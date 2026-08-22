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
   * 完整预处理管线：load → resize → deskew → enhance。
   * opts: { maxEdge, enhanceMode, rotateDeg, deskew, upscaleSmall }
   * 返回 { canvas, width, height, scale, deskewAngle }
   */
  async function pipeline(src, opts) {
    const o = opts || {};
    const img = await loadImage(src);
    const { canvas, width, height, scale } = smartResize(img, o.maxEdge || PROFILES.balanced);
    let c = canvas;
    if (o.rotateDeg) c = rotate(c, o.rotateDeg);
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
    return { canvas: c, width: c.width, height: c.height, scale, deskewAngle };
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
    preprocess: { PROFILES, loadImage, smartResize, rotate, rotateCanvas, estimateDeskew, reduceGlare, toGrayscale, enhance, binarize, pipeline, toImageData, toDataUrl },
  });
})(typeof window !== 'undefined' ? window : globalThis);
