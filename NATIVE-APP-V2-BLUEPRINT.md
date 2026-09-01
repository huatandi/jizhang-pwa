# 原生 App V2 迁移蓝图（从网页原型到 iOS / Android）

> 目的：当前 `jizhang-pwa` 是**预测试原型**，用来验证并锁定行为。本蓝图把《智能语音记账与视觉识别系统 V2.0 终极优化加强方案》落到具体的原生工程，作为打包 iOS / Android 时的施工图。
>
> 原则：**网页原型是规范和测试基座，原生工程是目标实现。** 下面每个模块都标注【已定标于原型】/【需原生重写】/【可平移逻辑】。

---

## 0. 目标技术栈

```text
App 壳   Flutter (Dart)   — 单代码库，iOS / Android / 桌面
架构     Clean Architecture + MVVM + Repository + Provider Registry
本地库   SQLite / SQLCipher（加密账本）
原生层   Flutter FFI / MethodChannel 回调 C/C++/Kotlin/Swift：
         whisper.cpp, Audio Engine, Camera, Image Processing,
         Notification, Background Task, Keychain / Keystore
推理     onnxruntime / Paddle Lite / Core ML(可选)
```

禁止业务层直接 `import whisper / paddleocr / glm / 某云SDK`；业务层只认识 `SpeechProvider` 与 `VisionProvider`。

---

## 1. 多模态核心（对应方案 §1、§25、§26、§27）

```text
Observer（听 / 看到的东西）  →  Candidate<T>（value + source + confidence + evidence）
        ↓
MultimodalResolver（Voice + Vision + Context + Memory + Rule 五路证据融合）
        ↓
SemanticIntelligence（语义/数学规则/约束）
        ↓
ConfidenceEngine（HIGH ≥0.95 / MEDIUM 0.8–0.95 / LOW <0.80）
        ↓
IntelligenceDraftSession（字段 + Candidate + Evidence + Confidence + Corrections）
        ↓
UserReview → Correction → Confirm → Commit（AI 不直接写库）
```

- 【已定标于原型】`Candidate / Evidence / Confidence / Draft` 的**数据形状与阈值**已在网页版里跑通（Document Intelligence V7 + voice draft）。原生工程照搬这套结构，只是把 Provider 换成原生实现。
- 【原生重写】`MultimodalResolver` 在原生端做成一个独立核心类，输入五路观察，输出 `ResolvedEntity`（amount / merchant / date / type / account / category + confidence）。

---

## 2. 听觉智能（方案 §3–§11）

### 2.1 Provider Registry（原生重写）
```text
ASR Manager
├── WhisperCppProvider   （主要，C/C++，离线）
├── WhisperOnnxProvider  （onnxruntime 备用）
├── NativeSpeechProvider （系统语音兜底）
└── FutureASR
```
- 启动时用 `DeviceCapabilityProfile`（CPU/RAM/ARM/x86/SIMD/GPU/NPU/Battery/Thermal/加载与推理速度）动态选模型。

### 2.2 模型分级（原生重写）
```text
FAST      tiny / quantized tiny        （手机默认）
NORMAL    base / quantized base        （手机/一般 PC）
ACCURATE  small                        （高性能设备）
```
- 手机默认 `tiny/base`；不默认加载大模型。

### 2.3 音频链路（原生重写）
```text
Microphone → AudioFocus → AudioCapture → NoiseGate → AGC → VAD
  → SpeechSegmenter(1–8s) → 16kHz PCM → ASR Manager → Stable Transcript
```
- 关键词：“先说完一句 → 识别 → 停顿 → STABLE”，不是“一直录一直识”。

### 2.4 转录三态（已定标于原型，原生照抄 UI 行为）
```text
PARTIAL（实时浅色）
STABLE（VAD 确认一句结束才进 Parser）
FINAL（用户说“完成”才生成并进入确认）
```
- 【已定标于原型】网页版 `interim/final` + Voice Draft 已实现；原生端按同样三态驱动 UI。

### 2.5 语义在 ASR 之后（已定标于原型）
ASR 只有 `text`。后面的 `Number/Currency/Merchant/Account/Category/Date/Intent Resolver + 数学规则 + 记忆` 全部已在网页版跑通，**逻辑可平移**到 Dart 语言。

### 2.6 模式分离（已定标于原型）
`DICTATION / COMMAND / CORRECTION / CONFIRMATION / SEARCH / REMINDER` —— 网页版字段命令 + 改口引擎 + Draft 已实现；原生端做同样六态路由。

### 2.7 金额特判（已定标于原型，重点）
金额走 `Number Candidate Generator → AccountingResolver → ContextValidation`。低置信度必须**询问**“金额是 X，对吗？”，禁止自动提交。（网页版金额解析刚补齐万/零/块/毛/角/分，原生端移植同套规则。）

### 2.8 个人语音记忆（已定标于原型）
本地词典 + 学习 `一号账户 = BBVA`、商户/银行/分类/常用地点别名。网页版 `personal-voice-memory.js` + 纠错学习已跑通，原生端用 SQLCipher 存。

---

## 3. 视觉智能（方案 §12–§24）

### 3.1 视觉链路（原生重写 Provider，逻辑平移）
```text
Camera/Gallery → ImageQuality → DocumentDetector → PerspectiveCorrection
  → Enhancement → OCR Engine → LayoutAnalysis → DocumentClassification
  → KIE → SemanticResolver → AccountingValidator → VisionDraftSession
```

### 3.2 模型分层（原生重写）
```text
第一层  PP-OCRv6  tiny/small/medium（按设备）       快速 OCR
第二层  PaddleOCR-VL 1.6（复杂表格/Factura/版式乱/倾斜）  文档理解
第三层  GLM-OCR / Future VLM                        仅 deep fallback
```
- 禁止“每张图都上大模型”。

### 3.3 预处理（原生重写，保留原图）
Blur/Exposure/Shadow/Glare/Perspective/Rotation/DocumentBoundary 检测 → Deskew/Perspective/Contrast/Grayscale/Sharpen/Denoise/AdaptiveThreshold/LocalContrast。**保留 Original Image**。

### 3.4 多版本识别 + 候选融合（已定标于原型）
Original/Enhanced/HighContrast/Grayscale/Sharpened 各 OCR → Candidate Fusion。同值 → 置信度↑↑。

### 3.5 分类 Parser（已定标于原型，逻辑平移）
`RECEIPT / BANK_TRANSFER / FACTURA / UTILITY_BILL / INVOICE / CARD_PAYMENT / OTHER`，不同文档进不同 Parser；小票/银行凭证/Factura 各有专用 Resolver，**禁止“最大数字=TOTAL”**。

### 3.6 KIE + 数学验证（已定标于原型）
`TOTAL $656.38` → OCR=文字、KIE=`field=TOTAL,value=656.38`；数学层验证 `SUBTOTAL+IVA≈TOTAL`、`CASH−CHANGE≈TOTAL`。网页版 Document Intelligence V7 已跑通，原生端平移规则。

### 3.7 证据系统（已定标于原型）
字段保存 `value+confidence+source+bbox+label+evidence+alternatives`。

---

## 4. 记忆引擎（方案 §28–§30，已定标于原型）
```text
MemoryEngine
├── VoiceMemory
├── VisionTemplateMemory
├── MerchantMemory
├── BankMemory
├── UserCorrectionMemory
└── UsagePatternMemory
```
- 不直接改 AI 参数；用 `Memory + Resolver` 学习，可解释、可回滚。网页版文件：`personal-voice-memory.js / ocr-memory-store.js / template-engine.js / correction-learner.js / document-fingerprint.js`。

---

## 5. 数据库（方案 §35）—— 原生用 SQLCipher 建表
```sql
intelligence_observations(id, session_id, modality, provider, raw_text, confidence, created_at);
field_candidates(id, session_id, field_name, candidate_value, source, confidence, evidence_json, selected);
correction_memory(id, input_pattern, corrected_value, context, count, confidence, updated_at);
```
- 网页版已有同类结构（IndexedDB/sql.js 的 evidence/candidate 存储），原生端统一为以上三表并加密。

---

## 6. 本地优先 / 隐私（方案 §33、§34）
- 离线也能：语音记账、图片识别、提醒、搜索、查询、修改。
- 默认 `Audio/Image/Ledger 留在本地`；仅用户显式开启 Cloud Sync / Cloud AI / Backup 才上传。
- 原生端用 `Data Protection` / `Android Keystore` 保护密钥与账本。

---

## 7. 对应“最终产品原则”验收（方案 §38、§39）
| 原则 | 落地 |
|---|---|
| AI 不直接写数据库 | 一律进 `Draft → 用户确认 → Commit` |
| AI 输出永远是 Candidate | `Candidate<T>` 统一，不直接作真值 |
| 多证据一致才提高置信度 | MultimodalResolver 五路融合 |
| 低置信度宁可留空/询问 | LOW→标红/询问，禁止自动写库 |
| 用户纠错成为学习资料 | CorrectionMemory / PersonalVoiceMemory / TemplateLearning |
| 模型可替换 | ProviderRegistry，业务层只认 `SpeechProvider/VisionProvider` |
| 无网能完成核心任务 | 全本地 + SQLCipher + whisper.cpp + PP-OCRv6 |

验收不是“识别率 99%”，而是：**正确识别 + 知道何时可能错 + 能交叉验证 + 能向用户询问 + 记住纠正 + 下次少错。**

---

## 8. 从原型到原生：迁移清单（建议顺序）
1. 【已做】网页原型锁定行为：金额(万/零/块/毛/角/分)、模式分离、Draft、中文金额、低置信度确认。
2. 搭 Flutter 骨架 + Clean Architecture + Repository + ProviderRegistry（先桩）。
3. 移植 SQLite/SQLCipher 表 + CRUD（对齐网页 backend）。
4. 移植语义层（Resolver / 规则 / 数学验证 / 记忆）——逻辑来自网页 `js/` 各模块。
5. 接 whisper.cpp（FFI）实现 ASR Manager + 模型分级。
6. 接 PP-OCRv6 / PaddleOCR-VL / GLM（FFI）实现 Vision Pipeline。
7. 前端按网页原型还原（Draft 确认、置信度显示、低置信度询问、提醒/汇率/统计）。
8. 打包：iOS（证书/签名）+ Android（AAB/Play）。

---

*本文档对应《智能语音记账与视觉识别系统 V2.0 终极优化加强方案》。网页原型保持为规范与行为基座。*
