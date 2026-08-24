'use strict';
/**
 * OcrKit · image-quality —— 图像质量分析器 + 方向检测（V5 §13/§16）
 *
 * analyze(canvas)：在降采样（≤160px）副本上计算：
 *   blurScore      拉普拉斯方差归一化（低方差=模糊）
 *   contrastScore  亮度标准差归一化
 *   glareScore     高亮斑（反光）像素占比
 *   shadowScore    暗区像素占比
 *   fadeScore      热敏淡字（低对比 + 直方图收窄）
 *   brightness     平均亮度 0~1
 *   textDensity    深色像素占比（粗略）
 *
 * pickPipeline(scores, srcType, profileHint)：
 *   按质量选择增强管线（V5 §14：普通清晰票尽量不处理）：
 *     srcType=thermal/low_light 优先 → fade → 低对比 → 低亮度 → 模糊 → 否则 none
 *     glare 高 → 建议反光抑制；低端机（profileHint=low）兜底 high_contrast
 *
 * detectOrientation(canvas)：0 vs 90 轴向检测（行投影方差对比）。
 *   ⚠️ 限制：90° 与 270°（文字方向）无法用投影廉价区分——方向判定
 *   需引擎 OSD 或模板记忆（Phase 5）解决；本检测用于 autoRotate 的轴向判断。
 *
 * 全部为只读操作（不修改入参 canvas）。
 */
(function (global) {
  const TARGET_W = 160;

  /** 降采样到 ≤160px 宽（≤160 时直接用原图，只读） */
  function _downsample(canvas, targetW) {
    const W = targetW || TARGET_W;
    if (canvas.width <= W) return { c: canvas, W: canvas.width, H: canvas.height };
    const scale = W / canvas.width;
    const H = Math.max(1, Math.round(canvas.height * scale));
    const c2 = (typeof OffscreenCanvas !== 'undefined' && canvas.constructor === OffscreenCanvas)
      ? new OffscreenCanvas(W, H) : global.document.createElement('canvas');
    c2.width = W; c2.height = H;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, W, H);
    return { c: c2, W, H };
  }

  function _grayArray(c, W, H) {
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, W, H).data;
    const g = new Float32Array(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    return g;
  }

  /**
   * 图像质量评分（只读）。
   * @param {HTMLCanvasElement|OffscreenCanvas} canvas
   * @returns {Object} { blurScore, contrastScore, glareScore, shadowScore, fadeScore, brightness, textDensity, width, height }
   */
  function analyze(canvas) {
    if (!canvas || !canvas.width || !canvas.height) {
      return { blurScore: 0.5, contrastScore: 0.5, glareScore: 0, shadowScore: 0, fadeScore: 0, brightness: 0.5, textDensity: 0, width: 0, height: 0 };
    }
    const { c, W, H } = _downsample(canvas, TARGET_W);
    const lum = _grayArray(c, W, H);
    const n = W * H;
    let sum = 0, sumSq = 0, max = 0, min = 255, darkCount = 0;
    for (let i = 0; i < n; i++) {
      const l = lum[i];
      sum += l; sumSq += l * l;
      if (l > max) max = l;
      if (l < min) min = l;
      if (l < 128) darkCount++;
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    const brightness = mean / 255;

    // 反光：亮斑 = 明显亮于"纸面基准亮度"（60 百分位）且 ≥245 的像素
    // （与 reduceGlare 的 paper/glareLum 逻辑一致，避免把正常白底当反光）
    const sorted = Float32Array.from(lum).sort();
    const paper = sorted[Math.floor(n * 0.6)] || 220;
    const glareLum = Math.max(245, paper + 20);
    // 阴影：暗斑（< min(90, mean−σ)）
    const shadowThresh = Math.min(90, mean - std);
    let glare = 0, shadow = 0;
    for (let i = 0; i < n; i++) {
      if (lum[i] > glareLum) glare++;
      else if (lum[i] < shadowThresh) shadow++;
    }
    const glareScore = Math.min(1, glare / n);
    const shadowScore = Math.min(1, shadow / n);

    // 模糊：拉普拉斯方差（低 → 模糊）
    let lapSum = 0, lapSumSq = 0, lapN = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const lap = lum[i - 1] + lum[i + 1] + lum[i - W] + lum[i + W] - 4 * lum[i];
        lapSum += lap; lapSumSq += lap * lap; lapN++;
      }
    }
    let blurScore = 0.5;
    if (lapN > 0) {
      const lapMean = lapSum / lapN;
      const lapVar = Math.max(0, lapSumSq / lapN - lapMean * lapMean);
      blurScore = Math.min(1, Math.max(0, 1 - Math.sqrt(lapVar) / 12));
    }
    const contrastScore = Math.min(1, std / 64);
    const range = (max - min) / 255;
    // 热敏淡字：低对比 + 直方图收窄
    const fadeScore = Math.min(1, Math.max(0, (0.45 - contrastScore) * 1.5 + (0.35 - range) * 1.0));
    const textDensity = darkCount / n;

    return { blurScore, contrastScore, glareScore, shadowScore, fadeScore, brightness, textDensity, width: W, height: H };
  }

  /**
   * 按质量选择增强管线（V5 §14）。
   * @param {Object} scores analyze() 输出（可为 null）
   * @param {string} srcType thermal | low_light | ...（工作台已知票据类型优先）
   * @param {string} profileHint high | balanced | low
   * @returns {{ enhanceMode: string, glowReduce: boolean }}
   */
  function pickPipeline(scores, srcType, profileHint) {
    const out = { enhanceMode: 'normal', glowReduce: false };
    if (srcType === 'thermal') { out.enhanceMode = 'thermal'; return out; }
    if (srcType === 'low_light') { out.enhanceMode = 'low_light'; return out; }
    if (scores) {
      // fade 仅适用于"纸面偏亮"的热敏淡字（暗图低对比不是淡字，走 low_light）
      if (scores.fadeScore >= 0.55 && scores.brightness >= 0.45) out.enhanceMode = 'thermal';
      else if (scores.brightness < 0.30) out.enhanceMode = 'low_light'; // 低亮度优先于低对比
      else if (scores.contrastScore < 0.30) out.enhanceMode = 'high_contrast';
      else if (scores.blurScore > 0.62) out.enhanceMode = 'normal';
      else out.enhanceMode = 'none'; // 清晰票尽量不处理
      if (scores.glareScore >= 0.25) out.glowReduce = true;
    }
    // 低端机兜底：即使清晰也提对比（利于识别）
    if (profileHint === 'low' && out.enhanceMode === 'none') out.enhanceMode = 'high_contrast';
    return out;
  }

  /**
   * 轴向方向检测（V5 §16）：0 vs 90。
   * 原理：文字行在"行向水平"时行投影方差最大；比较 0° 与 90° 投影方差。
   * @param {HTMLCanvasElement|OffscreenCanvas} canvas
   * @returns {number} 0 | 90（180/270 与 0/90 同轴向，方向需 OSD/模板记忆判定）
   */
  function detectOrientation(canvas) {
    try {
      if (!canvas || !canvas.width || !canvas.height) return 0;
      const { c, W, H } = _downsample(canvas, TARGET_W);
      const lum = _grayArray(c, W, H);
      const dark = (x, y) => lum[y * W + x] < 128;
      const projVar = (axis) => {
        // axis=0：按行投影；axis=90：按列投影（等价于旋转 90° 后的行投影）
        const len = axis === 90 ? W : H;
        const rows = new Float64Array(len);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (!dark(x, y)) continue;
            rows[axis === 90 ? x : y]++;
          }
        }
        let mean = 0;
        for (let i = 0; i < len; i++) mean += rows[i];
        mean /= len;
        let v = 0;
        for (let i = 0; i < len; i++) v += (rows[i] - mean) * (rows[i] - mean);
        return v / len;
      };
      const v0 = projVar(0);
      const v90 = projVar(90);
      // 90° 行投影方差显著更高 → 竖排文字 → 旋转 90
      if (v90 > v0 * 1.15 && v90 > 0.5) return 90;
      return 0;
    } catch (e) { return 0; }
  }

  global.OcrKit = global.OcrKit || {};
  Object.assign(global.OcrKit, {
    imageQuality: { analyze, pickPipeline, detectOrientation, TARGET_W },
  });
})(typeof window !== 'undefined' ? window : globalThis);
