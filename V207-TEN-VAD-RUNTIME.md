# V207 — TEN‑VAD Real WebAssembly Runtime

这是“逐个完成”的第 1 项：TEN‑VAD 真接入。它不是整个识别项目的终结版本。

## 已完成的工程链
1. 官方 Web ABI 固定：
   - `_ten_vad_create`
   - `_ten_vad_process`
   - `_ten_vad_destroy`
   - `_ten_vad_get_version`
2. 官方资产来源固定到 TEN-framework/ten-vad 的不可变 revision `b50f2a2`。
3. 用户明确点击后才下载，约 300 KB，不静默下载。
4. `ten_vad.wasm` 使用官方发布 SHA‑256：
   `1ec0b9640683987e15a4e54e4ce5642b2447c6e5d82b1be889b5099c75434fc3`
5. 下载后的 JS/WASM 存入独立 CacheStorage，并映射为本项目 same-origin 虚拟运行路径。
6. Service Worker 在 APP 升级时保留 TEN‑VAD cache，并支持离线加载。
7. Provider 使用官方 16 kHz / 256 samples / threshold 0.5 默认参数。
8. Float32 microphone PCM → Int16 WASM PCM 转换、256-frame buffering、ABI memory management 已实现。
9. AsrManager 在本地识别启动前初始化 NeuralVadBridge。
10. VAD 主循环真正消费 TEN‑VAD probability。
11. TEN‑VAD 失败/未安装/运行异常时立即回退 Adaptive VAD。
12. READY 不再只看“文件存在”：必须完成 SHA‑256 + WASM 实例化 + create/process/destroy 单帧自检。
13. 智能识别中心提供 安装 / 检查 / 删除 TEN‑VAD。

## 仍需真实设备证据（不能伪称已验证）
代码与运行链已接通，但本施工环境没有真实移动浏览器/麦克风，也无法替用户的 GitHub Pages origin 执行远程 WASM。
因此“第 1 项最终验收”仍需在部署后的真实手机上：
- 点击安装 TEN‑VAD；
- 健康检查显示 WASM ABI 实测通过；
- 实际说话连续识别；
- 对比店铺噪声下误启动/漏启动/句首吞字；
- 记录 RecognitionBenchmarkLab 数据。

只有真实设备证据通过，才把第 1 项标为 VERIFIED，然后进入第 2 项 Sherpa。
