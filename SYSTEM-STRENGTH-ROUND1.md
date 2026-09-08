# System Strength Round 1

本轮不是萌宠专项，而是主系统审计/修复切片。

## 已修复
- VoiceQA “最终记账正确率”分母污染：提醒/日期隔离用例不再被误算为记账失败；最终门禁只统计明确记账意图。
- 主导航与设置快捷功能从 Emoji/字符图标升级为内置、离线、可主题化的 SVG Icon Registry；4 种图标风格改为视觉皮肤，不再替换成粗糙字符。
- 设置快捷功能移除 10 个 inline hardcoded gradient，改为语义类，浅色/春夏不再被旧皇家蓝内联值穿透。
- 主题切换 tooltip 从“秋色/暗色”修正为四主题。
- 新图标系统加入 Service Worker APP_SHELL。
- 修复 `npm test` 被 `_test_fx.cjs` 外网请求拖死的问题：默认门禁现在确定性跳过网络测试，并提供 `npm run test:network` 单独执行。
- 修复 Golden Benchmark 的“假红/假绿”审计问题：旧门禁会主动注入 `$→5` 与 false-commit 的 demo 故障，再把进程退出 0；现在默认门禁只校验数据集清单，只有存在真实设备/浏览器捕获的 `results/*.json` 才输出真实 KPI，demo 永不用于发布结论。

## 诚实边界
- 本轮能静态/Node 验证 UI 结构、缓存引用和 Voice parser gate；未声称完成真实浏览器视觉验收、真机麦克风、相机、Paddle/Whisper WASM 推理、iOS 生命周期。
- Pet Life OS 保持独立，未触碰 TransactionCore / OCR finalizer / Reminder authoritative logic。

## 验证结果
- 新增专项：14/14 PASS。
- 默认 `npm test`：56 个测试文件通过，0 失败，1 个网络类 FX 测试明确跳过。
- Golden Dataset manifest：OCR 2/2、Voice 10/10 结构校验通过；无真实浏览器/设备 results，因此未宣称真实 KPI。
- Build 连续两次一致：`63356fd4`。
- `npm run verify`：PASS；APP_SHELL 182 项。

## 下一轮最高优先级
1. 真机 Voice：TEN-VAD / Whisper / continuous speech / noise / false-commit 实测结果捕获。
2. 真浏览器 OCR：困难票据 Golden Set，重点 TOTAL/SUBTOTAL/IVA/RFC/FECHA/Folio/Clave rastreo 与 `$→5`。
3. 证件照：可靠人脸检测、姿态/阴影/曝光/模糊门禁与本地分割补光。
4. PWA：断网冷启动、更新不打断编辑、iOS 生命周期、模型缓存完整性。
5. UI：把 SVG 图标体系继续覆盖页面标题、按钮与工具栏，并做四主题真实浏览器视觉验收。
