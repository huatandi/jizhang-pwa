# 中文增强语音模型发布槽

这里**没有内置真实 Sherpa 大模型**。

正式部署步骤：
1. 选定并验证可在目标浏览器运行的 Sherpa Transducer 模型与 WASM Provider。
2. 将模型/WASM/JS 资产放在本目录或同源路径。
3. 记录每个文件的真实 `size` 和 SHA-256。
4. 由 `manifest.example.json` 生成真正的 `manifest.json`。
5. 在 `js/config/recognition-models.js` 中把 `sherpaZh.manifest` 指向这个同源 manifest。
6. 用户在“智能识别中心”点击“安装中文增强识别”后才下载。
7. 安装完成仅代表模型文件健康；运行 Provider 还必须通过 READY 检查后，ASR Manager 才可选用 Sherpa。

不要把占位 manifest 改名为 `manifest.json` 后直接发布。
