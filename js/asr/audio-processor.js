// AudioWorklet 处理器：采集单声道 Float32 块 + 电平回读
// 注意：本文件只应在 AudioWorklet 上下文中通过 audioWorklet.addModule('js/asr/audio-processor.js') 加载，
// 不应作为普通 <script> 在主线程执行（registerProcessor 仅存在于 AudioWorkletGlobalScope）。
if (typeof registerProcessor !== 'undefined') {
  class AudioCaptureProcessor extends AudioWorkletProcessor {
    process(inputs) {
      const input = inputs[0];
      if (!input || !input.length || !input[0] || !input[0].length) return true;
      const ch = input[0];
      // 电平（RMS）
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      const level = Math.sqrt(sum / ch.length);
      this.port.postMessage({ buffer: new Float32Array(ch), level });
      return true;
    }
  }
  registerProcessor('audio-capture-processor', AudioCaptureProcessor);
}
