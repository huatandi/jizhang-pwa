# CURRENT-OCR-ARCHITECTURE.md

> V5.0 Phase 0 — OCR SYSTEM AUDIT(审计报告)
> 依据:Adaptive OCR / Document Intelligence V5.0 指令 §6 / §101
> 审计方式:真实源码走读(js/ocr/*、js/mexico/*、js/intelligence/*、js/learning/*、js/ai/*、js/offline-ocr.js、sw.js、index.html、boot.js)+ 实跑现有 5 个 Node 测试脚本
> 审计日期:2026 代码库当前版本(SW CACHE_NAME=v104,app.js?v=104)
> 状态:**审计完成;用户已批准开始执行。执行计划按"聪明先行、学习后置"修订(见 O-rev);P1a/P1b/P2/P3/P4/P5/P6 全部完成(2026 当前轮),统一验证 16/16 测试套件通过。**

---

## A. 当前真实架构

### A.1 分层结构(已逐文件核实)

```
┌─ 业务/UI 层 ─────────────────────────────────────────────────┐
│  js/ai/ai-workbench.js   工作台: wbLocalOcr / wbLocalOcrV2 /  │
│                           wbSmartRecognize / wbApplyCoreFields │
│                           wbSave / wbLearnCorrections / wbRetry│
│  js/offline-ocr.js        旧版 OfflineOCR(兼容入口,仍被引用)    │
│  js/ai/multimodal.js      OCR+ASR 合一流水线                    │
│  js/app.js                扫描页 preloadOcr 预热 / 能力徽标      │
├─ 语义/证据层 ─────────────────────────────────────────────────┤
│  js/mexico/*              MexicoParser: CFDI/SPEI/OXXO 解析     │
│  js/intelligence/*        EvidenceEngine / ConflictResolver     │
│  js/recognition/*         RecognitionCore: QR/知识库/银行词典/   │
│                           confidenceEngine(OCR+ASR 共享)        │
│  js/learning/*            LearningEngine(语音纠错学习,OCR未接入) │
├─ OCR 编排层 ──────────────────────────────────────────────────┤
│  js/ocr/ocr-manager.js    OcrManager: 档位/预处理调度/主备回退/  │
│                           低置信 multipass+对比合并/文档类型检测 │
│  js/ocr/ocr-types.js      引擎接口 + OcrResult 统一结构 + 行聚类 │
│  js/ocr/region-retry.js   金额区域裁剪重识别                     │
├─ 引擎层 ──────────────────────────────────────────────────────┤
│  js/ocr/paddle-engine.js  PaddleOCR.js/PP-OCRv5(本地SDK→CDN回退)│
│  js/ocr/tesseract-engine.js tesseract.js v5(本地vendor→CDN回退) │
│  js/ocr/preprocess.js     纯 Canvas 2D 预处理管线               │
├─ 能力/配置层 ─────────────────────────────────────────────────┤
│  js/ai/engine-manager.js  WebGPU/WASM 探测 + ocrPlan(仅UI提示)  │
│  js/ai/global-config.js   30+ 地区→OCR/ASR 语言映射             │
│  sw.js                    PWA 预缓存(v104,~59MB)               │
└───────────────────────────────────────────────────────────────┘
```

### A.2 主识别链路(核实)

```
图片 → 设备档位(UA/deviceMemory → high2200/balanced1800/low1400)
     → QR 先行检测(四点→透视矫正,失败不影响)
     → preprocess.pipeline(load→smartResize→rotate→perspective→deskew→glare→enhance)
     → 主引擎 Paddle → 失败回退 Tesseract
     → 平均置信<55% → multipass 多版本重跑取最优 + Tesseract 对比合并
     → detectDocType(invoice/receipt/bank_transfer)
     → OcrResult{words(bbox+conf), lines, fullText, _canvas}
     → [MX 地区] MexicoParser.parse(CFDI/SPEI/OXXO,含 QR 融合)
     → extractCommonFields 通用兜底(标签0.90/importe0.80/最大猜测0.45)
     → [金额置信<0.65] regionRetry.retry('amount')
     → 工作台 DOM 预填 → 用户核对 → wbSave → 记账弹窗 → 用户确认入账
```

### A.3 引擎/实例现状

- **Paddle**:`worker:false`(主线程推理)、`numThreads:2`、SDK 本地 `vendor/paddleocr/index.mjs` + `vendor/onnx/*.wasm` 本地;**模型文件运行时从 SDK CDN 拉取**(未 vendor)。
- **Tesseract**:真 Worker(worker.min.js),核心 wasm + spa/eng/chi_sim 语言包全部本地 vendor。
- **OcrManager 实例**:三处独立创建 —— `ai-workbench.getOcrManager()`、`multimodal._getOcrManager()`、`preloadOcr`(复用 workbench 那份)。**无统一单例**。
- **服务器链路**:`/api/ai/*` 远程后端存在但**是独立手动流程**(wbExtract/checkServerAi),未注册进 OcrManager;`checkServerAi` 超时 4s 探测失败即视为无服务器。

---

## B. 与 V5 预期架构不一致的位置

| # | V5 要求 | 现状核实 | 差距 |
|---|---|---|---|
| B1 | 全局化 Core + Region Plugin | `global-config` 已有 30+ 地区映射,`MexicoParser` 仅 MX 激活 | 半满足:核心文件里仍散落西语/MX 关键词(见 H) |
| B2 | 统一语义字段(TOTAL_AMOUNT 等) | 内部字段为 `amount/importe/max`、`tax/rfc` 混用,无统一语义字段 | **缺失** |
| B3 | Image Quality Analyzer → Adaptive Preprocess | 仅按 `documentType` 猜 enhanceMode,无质量检测 | **缺失** |
| B4 | Orientation(0/90/180/270)独立于 Deskew | 只有手动 rotateDeg + 投影 deskew(±8°),无自动方向检测 | **缺失** |
| B5 | LongReceiptMode 重叠切片 | 超长票直接缩到 maxEdge(1800px),小字消失 | **缺失** |
| B6 | Candidate Pool(不早定唯一答案) | 引擎直接产出唯一结果,merge 只整份替换 | **缺失** |
| B7 | Character Confusion Model | 无 | **缺失** |
| B8 | Layout Analyzer / 行聚类升级 | 行聚类仅 center-Y + X 排序(cfdi 内部另有 6px 分桶) | 基础版 |
| B9 | Document Classifier V2(通用类别) | 通用仅 3 类,细分类只有 MX_CFDI/SPEI/OXXO | **缺失** |
| B10 | Constraint Engine / 数学闭环 | 仅 CFDI 一处 subtotal+iva-descuento≈total(容差1比索),无现金闭环 | **缺失** |
| B11 | 金额类型区分(TOTAL/SUBTOTAL/TAX/CASH/CHANGE) | 统一归 amount,现金/找零仅做"排除" | **缺失** |
| B12 | Region Retry V2(全字段) | 仅 amount(工作台内 <0.65 触发) | 部分 |
| B13 | EvidencePolicy 可配置 | `SOURCE_PRIORITY` 静态写死(evidence-engine.js:21-24) | **缺失** |
| B14 | Template/Fingerprint/Correction Learning | 无(仅有 PvM 语音记忆 + 语音 LearningEngine) | **缺失** |
| B15 | FAST/SMART/RESCUE 三档 + Early Exit | 无;无 criticalFieldConfidence | **缺失** |
| B16 | Worker 化预处理/Abort | 预处理全主线程;180s 超时只 reject 不取消 | **缺失** |
| B17 | ServerOcrEngine 统一接口 | 服务器是独立流程,未实现 OcrEngineBase | **缺失**(且 UI 宣称存在) |

**结论:V5 描述与真实实现基本一致;核心骨架(OcrKit/引擎抽象/证据层/地区门控)已具备,V5 的多数增量是"新增",而非"推翻"。**

---

## C. 已确认 BUG(确定性)

1. **multipass Canvas 原地污染(V5 §8.1 属实)** — `js/ocr/preprocess.js`: `toGrayscale/contrast/enhance/binarize` 均原地改 canvas 并返回同一引用;`multipass()`(516-526 行)中 `original` 与 `contrast` 指向**同一对象**,original 已被污染;且 OcrManager 低置信分支(multipass)执行后,传给 Tesseract 回退的 `input` 也已被改。
2. **mergeResults 注释与实现不符(V5 §9 属实)** — `js/ocr/ocr-manager.js:240-250`:注释声称"行级按位置取置信高者",实现是"整份平均置信高者整体替换",好引擎中的差行无法被纠正。
3. **无统一 OcrManager 单例(V5 §10 属实)** — 三处各自 new 引擎实例(见 A.3),Paddle 会话/Tesseract worker/语言缓存重复。
4. **auto 语言 = spa+eng(V5 §11 属实)** — `js/ai/ai-workbench.js:1176-1183` `wbOcrLang()` auto 恒返回 `'spa+eng'`,无视 `globalConfig.resolveOcrLang()`;中文用户默认拿西语+英语识别。
5. **Paddle 非真离线(V5 §12 属实)** — 模型(det/rec/orientation/dict/config)由 SDK 从 CDN 拉取;SW 只缓存同源(basic/default)响应,跨域 CORS 不入缓存;断网首次必失败。vendor 仅 SDK + worker-entry + onnx wasm。
6. **服务器链路 UI 宣称失实(V5 §75 属实)** — app.js:2958 提示"Paddle → Tesseract → 服务器",但 OcrManager 无 ServerEngine 注册,服务器是手动独立流程。
7. **Paddle `recognize` 无意义三元** — `js/ocr/paddle-engine.js:108` `image instanceof HTMLCanvasElement ? image : image`,dataURL 直传引擎未处理;`deviceProfile` 配置项未使用。
8. **OfflineOCR worker 泄漏** — `js/offline-ocr.js`:workers Map 按语言缓存永不释放;`shutdown()` 只 terminate 第一个 `worker`(与 Map 无关)。
9. **语音侧(多模态相关)假降级** — `js/asr/whisper-engine.js` `pipeline` 模块级单例,`asr-manager._tryDowngrade()` 新建 tiny 引擎后 `initialize()` 命中缓存返回原模型,降级无效(影响 multimodal 可靠性,一并记录)。
10. **OCR→学习污染入口(§54 风险)** — `js/ai/ai-workbench.js:1949-1952`:`wbLearnCorrections` 对**金额**任何差异无条件 `learnCorrection`,无确认阈值/无作用域/无负样本保护;`wbSave` 每次保存都触发。

---

## D. 高风险代码

| 位置 | 风险 |
|---|---|
| `preprocess.js` 全部增强函数原地改图 | multipass/回退引擎输入被污染(已证 C1) |
| `region-retry.js` 依赖 `result._canvas` | _canvas 是预处理后(可能已被 multipass 污染)的画布,区域裁剪坐标/内容不可靠 |
| `paddle-engine.js` worker:false | PP-OCR 推理跑主线程,大图/低端机卡 UI(对比 tesseract 有真 worker) |
| `ocr-manager.js` 180s withTimeout | 不取消底层任务,超时后旧任务仍在跑,可能回写 UI(无 jobId/AbortSignal) |
| `ai-workbench.js` wbLearnCorrections 金额无条件学习 | 一次误改即入库,污染 merchant/bank/amount 别名知识 |
| `sw.js` 网络优先策略 | 跨域 CDN 资源(cors)不入缓存;traineddata/wasm 缓存优先是安全的 |
| `offline-ocr.js` workers Map | 长期会话内存只增不减 |
| `voice-sr.js` watchdog `mgr.cb = null` 手法 | 恢复期间回调断开/还原,脆弱(语音侧,影响 multimodal) |
| `extractCommonFields` 最大金额猜测兜底 | 现金/找零排除正则被绕过时取错总额(置信 0.45 仍可能入账,§26 风险) |

---

## E. 性能瓶颈

1. **预处理全主线程**:`estimateDeskew`(33 角度×全图降采样扫描)、`reduceGlare`(全数组排序 ~3.2M 项)、`warpQuad`(逐像素双线性,最高 2000×2000)、`getImageData/putImageData` 大拷贝。
2. **multipass 触发 = 额外 4 次全图 OCR**:低置信时 Paddle 4 版本 + Tesseract 1 次,设备上每次数秒。
3. **Paddle 主线程推理**(worker:false)叠加上述。
4. **区域重试**:×2.5 放大 + 灰度/高对比 + 再 OCR(整幅,非仅 ROI 引擎侧)。
5. **无冷/热启动缓存层**:Paddle 每次会话首次初始化拉模型;`preloadOcr` 仅预热,无持久会话复用策略(除模块级 initPromise)。
6. 无 **Early Exit**(§69):无 criticalFieldConfidence,即使高置信也全量跑完。

---

## F. OCR 准确率瓶颈

1. 平均置信(全词)作为唯一门控,噪声词拉低,无法反映关键字段。
2. 无数学约束/无字符混淆模型/无布局分析,`$→5` 类错误无路可纠(V5 §33 场景当前必然错)。
3. 金额兜底"最大数字猜测"(0.45)与 `EFECTIVO/CAMBIO` 排除正则耦合,绕过即错(§26)。
4. 区域重试仅 amount;date/merchant/taxId/folio 无重试。
5. 行聚类仅 center-Y;长票据缩图后小字丢失。
6. 无模板记忆/无历史经验;同商户票据每次从零识别。
7. 语言:CN 用户默认 spa+eng;vendor 仅 3 语言包,日/韩/德等离线不可用。

---

## G. 离线能力真实状态

| 能力 | 离线状态 |
|---|---|
| Tesseract OCR(spa/eng/chi_sim) | ✅ 真离线(vendor wasm+语言包,SW 预缓存) |
| Paddle OCR | ❌ 模型运行时 CDN,断网首次必失败;失败自动回退 Tesseract |
| 语言包(日/韩/德/法…) | ❌ 未 vendor,离线缺失 |
| Whisper ASR | ⚠️ 模型 HF CDN 首次下载;transformers.js 自带缓存,下载后可离线重跑 |
| WebSpeech | ❌ 需网络(且默认授权在线,隐私风险) |
| App 壳 | ✅ SW v104 预缓存 |

**结论:真正离线 OCR = Tesseract + 3 语言。README"本地图片识别离线识别"宣传对 Paddle 路径不成立(V5 §12 要求真实测试)。**

---

## H. 地区耦合情况

**已解耦**:MexicoParser 仅 `isMexicoRegion()` 激活;global-config 30+ 地区映射。

**仍写死(需迁移为 Region Plugin)**:
1. `ai-workbench.js extractCommonFields`: `EFECTIVO/CAMBIO/VUELTO/CASH/CHANGE` 排除、`IMPORTE/MONTO` 标签、RFC 正则(仅 MX)。
2. `offline-ocr.js parseFields`: 墨西哥日期格式优先、`BANCO ORDENANTE/BENEFICIARIO`、RFC。
3. `ocr-manager.js detectDocType` 与 `region-retry.js FIELD_LABELS`: 西语标签优先(esp 权重最高)。
4. `extractCommonFields` 银行兜底表:BANORTE/BBVA… 仅墨西哥银行。
5. `wbOcrLang()` auto → spa+eng(全球用户受害)。
6. 字段命名 `rfc/tax` 混用,无统一语义字段。

---

## I. 数据库 / IndexedDB 迁移风险

| 存储 | 位置 | 风险 |
|---|---|---|
| IndexedDB `asr-model-store` v1 | model-manager.js | 仅元数据,无 schema 升级风险低 |
| IndexedDB `voice-memory` v1 | personal-voice-memory.js | 5 store,无 OCR 相关 |
| localStorage `sm_learning_events` | learning-engine.js | 无版本,2000 条截断 |
| localStorage `sm_*` 系列 | 全局 | 无迁移 |
| **新增 OCR 学习库**(V5 §60:ocr_merchants/ocr_templates/ocr_learning_events…) | 全新 | **当前无任何 OCR 学习数据**,新增为纯加法;**无迁移风险**,但必须:versioned schema + onupgradeneeded 防御 + 多标签页升级死锁防护 |
| SW CACHE_NAME | sw.js | 新 js/ocr/* 模块必须同步加入 APP_SHELL,否则 PWA 离线加载 404 |

**结论:OCR 学习体系从零建库,迁移风险极低;真正风险在 SW 预缓存清单漏更新。**

---

## J. 旧接口兼容风险(Phase 1 必须保持的契约)

1. `window.OcrKit.{OcrManager,OcrEngineBase,ENGINES,normalizeResult,normalizeBox,clusterLines,ocrUtil,preprocess,regionRetry,PaddleOcrEngine,TesseractEngine}`
2. `window.OfflineOCR.{recognize,parseFields,shutdown}`(旧工作台按钮仍调用)
3. `window.MexicoParser.{parse,detectDocumentType,parseCfdi,parseSpei,parseOxxo,money,nearestRight,rowWords,boxCenterY,boxHeight}`
4. `window.EvidenceEngine.{create,user,fuse,explain,sourceWeight,SOURCE_PRIORITY}` / `window.ConflictResolver.{rankCandidates,rankCandidatesSync,recordChoice}`
5. `window.RecognitionCore.*`(qrEngine/knowledgeBase/bankDictionary/confidenceEngine/entityResolver,语音+OCR 共享)
6. `window.AIKit.{globalConfig,multimodal,detectCapability,deviceProfile,ocrPlan,asrPlan,capabilityBadge,preloadOcr}`
7. `window.VoiceSR/VoiceEngine/VoiceKit` 协议(interim/final/error/end)与 app.js 兼容层(2030-2050、2545-2560 行)
8. index.html 脚本加载顺序(ocr-types → preprocess → tesseract → paddle → manager → region-retry → mexico → …)与 sw.js APP_SHELL
9. `wbAiValues` / `wbLockedFields`(工作台字段锁,AI 不覆盖用户修改)内部契约
10. app.js `preloadOcr` 钩子(进入扫描页触发)

---

## K. 建议新增模块(V5 顺序)

| 模块 | 文件 | 对应 V5 |
|---|---|---|
| OcrManager 统一工厂 | `js/ocr/ocr-manager.js` 内增 `getManager()` | §10 |
| Image Quality Analyzer | `js/ocr/image-quality.js` | §13 |
| Orientation Detector | `js/ocr/image-quality.js` 内(或独立) | §16 |
| LongReceipt 切片 | `js/ocr/preprocess.js` 内增 | §17 |
| OCR Candidate Pool | `js/ocr/ocr-candidate-pool.js` | §19 |
| Layout Analyzer | `js/ocr/layout-analyzer.js` | §21 |
| Character Confusion Model | `js/intelligence/ocr-confusion-model.js` | §20 |
| Constraint Engine | `js/intelligence/constraint-engine.js` | §27-32 |
| Field Candidate Generator | `js/intelligence/field-candidate-generator.js` | §24 |
| EvidencePolicy(可配置权重) | `js/intelligence/evidence-policy.js` | §37 |
| Document Fingerprint | `js/intelligence/document-fingerprint.js` | §42 |
| Template Engine(Semantic Template) | `js/intelligence/template-engine.js` | §40-47 |
| Correction Learner | `js/intelligence/correction-learner.js` | §48-56 |
| Merchant/Template Memory 存储层 | `js/intelligence/ocr-memory-store.js`(IndexedDB) | §57-64 |
| Region Router + CN Profile | `js/regions/router.js`、`js/regions/mx.js`、`js/regions/cn.js` | §5 |
| OcrJobManager(Abort) | `js/ocr/ocr-job-manager.js` | §73 |
| ServerOcrEngine(可选) | `js/ocr/server-engine.js` | §75 |

## L. 建议修改模块

1. `js/ocr/preprocess.js` — 修 multipass 克隆;增强函数改为返回新 canvas(不原地改);加 thermalReceiptEnhance/longReceipt。
2. `js/ocr/ocr-manager.js` — mergeResults 行级合并;统一 getManager();criticalFieldConfidence;Early Exit;AbortSignal 透传。
3. `js/ocr/paddle-engine.js` — 修输入归一化;deviceProfile 生效;worker 线程调查(§72)。
4. `js/ai/ai-workbench.js` — wbOcrLang auto 走 globalConfig;wbLearnCorrections 加确认/作用域防护;服务器提示文案修正。
5. `js/ocr/region-retry.js` — 全字段扩展;从原图(非 _canvas)裁剪。
6. `js/ai/multimodal.js` / `js/voice/voice-sr.js` — 复用统一 manager;修复假降级(联动 C9)。
7. `js/offline-ocr.js` — workers Map 全量 shutdown。
8. `js/mexico/*` → 迁移为 `js/regions/mx/*`(迁移不是删除,保留 MexicoParser 兼容导出)。
9. `sw.js` — 新增模块同步预缓存;评估 cors 资源缓存策略(Paddle 模型)。
10. `js/intelligence/evidence-engine.js` — 权重改为 EvidencePolicy 注入,新增 evidence 类型(§36)。

## M. 建议暂时不要修改的模块

1. **`js/recognition/*`(RecognitionCore)** — 语音+OCR 共享,契约稳定,非本轮重点;仅做只读消费。
2. **`js/ai/global-config.js`** — 30+ 地区映射已良好,勿动结构;只新增 `resolveOcrLang` 消费方。
3. **`js/voice-engine.js` / `js/voice/voice-parser.js`** — 语音解析双实现收敛是独立议题(Phase C 语音方案),OCR Phase 不碰,避免跨域耦合。
4. **`js/ledger-crud.js` / `js/offline-backend.js`** — 账目写入路径,OCR 只做预填,禁止学习模块直写。
5. **`js/exchange-rate/*`、`js/pull-refresh.js`** — 无关模块。
6. **`index.html` 既有 script 顺序** — 新模块只追加在 ocr 段之后,不重排。

---

## N. Baseline 测试结果(实跑)

| 测试 | 结果 |
|---|---|
| `_test_ocr_v2.cjs`(money/clusterLines/detectDocType/normalizeLabel/normalizeResult) | **47 通过 / 0 失败** |
| `_test_voice_qa.cjs`(三语解析 18 用例) | 18/18;amount 18/18、date 7/7、kind 14/14、category 14/14、account 1/1 |
| `_test_voice_recovery.cjs`(错误恢复 6 场景) | **11 通过 / 0 失败** |
| `_test_global.cjs`(地区检测 MX/US/ES) | 通过 |
| `_test_fx.cjs`(汇率,无关) | 通过 |

**注意:现有测试覆盖的是"纯函数/状态机",不含真实票据图片识别。V5 §81-87 要求的图片级 KPI(Amount/Date/Merchant 等 Critical Field Exact Match、金额严重错误率、学习回归)当前为 0 覆盖 —— 这是 Phase 0 之后最先要补的基础设施。**

---

## O. Phase 1 精确实施计划(待确认)

> 范围严格按 V5 §94 PHASE 1;每项输出:文件/原因/依赖/风险/兼容性/测试。全部完成后再进入 Phase 2。

### O.1 修 multipass Canvas 污染(V5 §8.1)
- **文件**:`js/ocr/preprocess.js`(`multipass`/`enhance`/`toGrayscale`/`contrast`/`binarize`)
- **做法**:增强函数改为"读源→写新 canvas→返回新对象";`multipass` 每个版本 `cloneCanvas` 后处理,original 保持纯净;`OcrManager` multipass 后回退引擎使用克隆副本而非被改的 input。
- **依赖**:无;**风险**:低(纯函数改造,行为等价);**兼容**:API 不变(返回仍是 canvas)。
- **测试**:新增单测:multipass 后 original.canvas 与原图逐像素一致;enhance 不修改入参。

### O.2 修 mergeResults → 行级合并(V5 §9)
- **文件**:`js/ocr/ocr-manager.js`
- **做法**:按 `clusterLines` 行级对齐(中心 Y 聚类 + X 重叠),同行取置信高者,行级拼接;无 bbox 时保留整份替换兜底。
- **风险**:中(合并逻辑是准确率敏感点,需 fixture 对比);**兼容**:返回结构不变,`_merge` 元数据保留。
- **测试**:构造 Paddle/Tesseract 同图差异行 fixture,断言行级择优。

### O.3 OcrManager 统一单例(V5 §10)
- **文件**:`js/ocr/ocr-manager.js`(增 `getManager()` 工厂 + `config` 合并)+ `js/ai/ai-workbench.js`、`js/ai/multimodal.js`、app.js preloadOcr 改用之。
- **做法**:模块级单例,首次调用按能力注册 Paddle+Tesseract;暴露 `OcrKit.getManager()`;保留构造函数供测试/多租户。
- **风险**:中(实例共享后,disposeAll/语言切换需语义明确:语言切换走 `setLang` 而非重建)。
- **测试**:两处调用返回同一实例;dispose 后重建可用。

### O.4 修复 auto 语言(V5 §11)
- **文件**:`js/ai/ai-workbench.js`(`wbOcrLang`)
- **做法**:auto → `globalConfig.resolveOcrLang()`(地区 → 浏览器语言 → eng);`aiOcrLang` 下拉加"跟随地区"选项;vendor 缺语言包时提示"该语言需联网下载"。
- **风险**:低;**测试**:CN/MX/US 语言解析单测(复用 `_test_global.cjs` 数据)。

### O.5 Paddle 离线审计 + 修复(V5 §12)
- **文件**:`js/ocr/paddle-engine.js` + `sw.js`
- **做法**:①核对 SDK 默认模型 URL(det/rec/orientation/dict/config);②评估:vendor PP-OCR 模型(需确认体积与许可)或:文档明确"Paddle 需联网,离线自动回退 Tesseract";③断网冷启动实测(新页面→无网→Paddle 失败→Tesseract 成功)。
- **风险**:中(涉及资产体积/许可);**测试**:离线场景手测脚本 + 回退日志断言。

### O.6 服务器链路一致性(V5 §75)
- **文件**:`js/ai/ai-workbench.js`、`js/ai/engine-manager.js`(提示文案)、可选 `js/ocr/server-engine.js`
- **做法**:本期先**修正 UI 文案**(去掉误导的"→ 服务器",改为"本地 Paddle/Tesseract;服务器提取为独立功能");ServerOcrEngine 注册推迟到 Phase 5 与 Region Router 一起(或用户确认后提前)。
- **风险**:低;**测试**:文案断言 + 无回归。

### O.7 Worker 生命周期与内存治理(V5 §74)
- **文件**:`js/offline-ocr.js`(workers Map 全量 shutdown)、`js/ocr/ocr-manager.js`(disposeAll 幂等)、`js/ai/ai-workbench.js`(任务结束释放 Blob URL/ImageBitmap)
- **做法**:`shutdown()` 遍历 Map terminate;OcrManager.disposeAll 加防重入;`imgToDataUrl` 产物及时 revoke。
- **风险**:低;**测试**:多次 initialize/dispose 循环无泄漏(内存快照对比)。

### O.8 快速防线(审计新发现,建议并入 O 组)
- **文件**:`js/ai/ai-workbench.js` `wbLearnCorrections`
- **做法**:金额纠错学习加门槛(仅当用户主动修改且差异可解释时记录;加 `scope:'workbench'` 元数据;学习记录可回滚/清除),为 Phase 7 Correction Learner 预留数据结构。
- **风险**:低;**测试**:修改后不触发 learnCorrection 的用例。

### O.9 每项完成后的统一动作
1. 更新 `sw.js` APP_SHELL(新 js/ocr/* 文件)+ 版本号提升。
2. `_test_ocr_v2.cjs` 全绿 + 新增项通过。
3. 与 N 节 Baseline 对比(纯函数测试无回归)。
4. 输出"Phase 1 完成报告"(修改文件/核心变化/测试结果/Baseline 对比/新风险),再申请进入 Phase 2。

---

## O-rev 修订执行计划(用户确认后采纳)

> 原 O 节按 V5 §94 的 PHASE 1 列出。经评审后按"**聪明先行(L1 验证/L2 复核)→ 学习后置(L3 记忆)→ 被度量(L4 基准)**"原则重排,并压缩为 P1a~P6。V5 完整蓝图(§1-§100)保留为远期路线,不在本表重复。

| 阶段 | 内容 | 交付物 | 状态 |
|---|---|---|---|
| **P1a** | 修确定性 bug:multipass 污染、mergeResults 行级合并、OcrManager 统一单例、auto 语言;堵 wbLearnCorrections 金额学习污染;服务器文案修正 | 代码 + 单测 | ✅ 已完成 |
| **P1b** | fixture + 基准框架(manifest/KPI 计算器/捕获流程) | `tests/ocr/*` + 单测 | ✅ 已完成 |
| **P2** | 约束引擎 + 候选池 + 混淆模型 + 全字段区域重试(V5 Phase 3+4 精华提前) | 新模块 + fixture KPI 对比 | ✅ 已完成 |
| **P3** | 质量分析/方向检测/长票切片/Worker 化/Abort/内存治理 | 新模块 | ✅ 已完成 |
| **P4** | Region Router 迁移(MX 插件化,迁移不删除) | `js/regions/*` | ✅ 已完成 |
| **P5** | 模板/纠错学习(带完整护栏:作用域/晋升/降级/负样本/漂移) | 新模块 + 学习基准 | ✅ 已完成 |
| **P6** | FAST/SMART/RESCUE + 画像学习 + 全量回归/性能基准/离线实测 | 基准报告 | ✅ 已完成 |

### P1a 已交付明细

1. `js/ocr/preprocess.js` — 全部增强原语(`toGrayscale/contrast/convolve/binarize/enhance`)改为**非破坏性**(克隆后处理返回新 canvas);`multipass` 的 original 为源图克隆,源图全程不被污染。
2. `js/ocr/ocr-manager.js` — `mergeResults` 升级为**行级候选合并**(跨引擎行聚类 + X 重叠去重取置信高者,回退整份替换并带 `strategy` 元数据);修复回退路径 `engine: undefined_fallback` 潜在 bug;新增 **`OcrKit.getManager()` 统一单例** + `resetManager()`。
3. `js/ai/ai-workbench.js` — `wbOcrLang()` auto 改走 `globalConfig.resolveOcrLang()`(CN→chi_sim+eng);`getOcrManager()` 优先返回统一单例;**移除金额/日期无条件别名学习**(原会把 "560"→"60" 写入知识库污染 `resolveAlias`)。
4. `js/ai/multimodal.js` — `_getOcrManager()` 复用统一单例。
5. `js/app.js` — 服务器链路文案修正(不再宣称"→ 服务器"自动回退)。
6. 版本号:sw.js `v104→v105`、boot.js `app.js?v=105`、index.html `boot.js?v=54`、preprocess?v=40、ocr-manager?v=47、multimodal?v=39、ai-workbench?v=65。
7. 新增测试(全部通过):
   - `_test_ocr_preprocess.cjs` — 19 通过(multipass 纯净性回归)
   - `_test_ocr_merge.cjs` — 15 通过(行级合并 + engine 兜底)
   - `_test_ocr_benchmark.cjs` — 31 通过(KPI 函数)

### P1b 已交付明细

- `tests/ocr/benchmark.cjs` — Critical-Field KPI 计算器(Amount/Date/Merchant/TaxId/Reference/Payment Exact Match + **Critical Financial Error Rate**),`--demo`/`--check-manifest` 模式,纯函数可单测;
- `tests/ocr/fixtures/manifest.json` — fixture 清单 schema(2 个示例条目,图片待用户提供脱敏票据);
- `tests/ocr/README.md` — KPI 定义 + 浏览器捕获流程(控制台片段)+ 验收标准;
- 演示报告已产出(见测试输出)。

### P2 已交付明细

1. `js/intelligence/constraint-engine.js`(新)—— 约束引擎:
   - 现金闭环 `cashClosure`(CASH−CHANGE≈TOTAL)、财务闭环 `financialClosure`(SUBTOTAL+TAX−DISCOUNT+FEE≈TOTAL)、商品闭环 `itemClosure`(Σ≈subtotal、qty×price≈line,辅助证据);
   - `CurrencyRoundingPolicy`(30+ 货币容差表,JPY/KRW 无小数 =1,默认 0.01)+ `looseTolerance`;
   - `DocumentRuleProvider`(`registerDocumentRule` 注册制,内置 fuel 示例:升×单价≈行额)—— 规则不写死进 Core;
   - 全部 diff 先按货币精度舍入再比较(修复 116−115.99 浮点尾差);
   - `verify()` 汇总 + `parseAmount`(美式/欧式)。
2. `js/intelligence/ocr-confusion-model.js`(新)—— 字符混淆模型:
   - 字段感知混淆集(amount/date/tax_id/text,§35);`generateVariants`(≤2 处替换、数量上限、替换溯源 `{idx,from,to}` + 强度分);`variantsForCandidates`(候选池批量,综合分=OCR置信×混淆分)。
   - **只生成候选,绝不全局替换**(§20 禁令)。
3. `js/ocr/ocr-candidate-pool.js`(新)—— 候选池 + 金额智能:
   - `CandidatePool`(同值去重取优、综合分排序、conflict 判定);`scoreCandidate` = OCR置信×来源权重+标签/数学证据(软上限 1.5 保留区分度);
   - `applyAmountIntelligence`(V5 §33 保守版):现金闭环命中当前值→置信提升 0.97;未命中→混淆变体命中闭环→采用变体(归一化去 $、保留 `original` 溯源 + 可解释 `reason`);财务闭环同规则;**无数学证据绝不改动**(§91);模块缺失静默降级(§98)。
4. `js/ocr/region-retry.js` — 全字段扩展:FIELD_LABELS/VALUE_RES 新增 `tax_id/folio/reference/account_last4`(原 amount/date/tax/merchant/rfc 保留)。
5. `js/ai/ai-workbench.js` — `wbLocalOcrV2` 接入:
   - 金额智能(约束+混淆,currency 从 settings/global-config 推导);
   - Region Retry 扩展:date/merchant 缺失时自动区域重识别;
   - 全部 try/catch 静默降级,失败不影响主结果。
6. 版本:sw.js v106、新模块 `?v=1`、region-retry?v=2、ai-workbench?v=66、index.html 加载顺序(evidence/conflict → **constraint → confusion** → ocr 段 → **candidate-pool**)。
7. 新增测试(全部通过):
   - `_test_ocr_confusion.cjs` — 17 通过($→5 变体、字段约束、数量控制)
   - `_test_ocr_constraint.cjs` — 33 通过(三闭环、舍入策略、规则注册、verify)
   - `_test_ocr_candidate_pool.cjs` — 26 通过(池/计分/§33 场景/降级)
8. 全量回归:OCR 7 套 188 项 + 语音 18/18 + recovery 11 + global 全绿;11 文件 `node --check` 通过。

### P3 已交付明细

1. `js/ocr/image-quality.js`(新)—— 图像质量分析器 + 方向检测:
   - `analyze`:降采样(≤160px)只读计算 blurScore(拉普拉斯方差)/contrastScore/glareScore(纸面百分位亮斑法,与 reduceGlare 逻辑一致)/shadowScore/fadeScore(热敏淡字)/brightness/textDensity;
   - `pickPipeline`(V5 §14):srcType 优先 → 淡字(需纸面偏亮)→ 低亮度 → 低对比 → 模糊 → **清晰票 'none' 尽量不处理**;glare ≥0.25 建议反光抑制;低端机兜底 high_contrast;
   - `detectOrientation`(V5 §16):行/列投影方差对比,返回 0|90 轴向。⚠️ 已知限制:90° 与 270°(文字朝向)无法廉价区分,方向判定留待 OSD/模板记忆(Phase 5)——`autoRotate` 因此默认关(实验性)。
2. `js/ocr/preprocess.js` — pipeline 升级:
   - **长票据模式**(V5 §17):原始比例 h/w>2.5 → 保宽缩放(高度封顶 4×maxEdge)返回 `longMode`;
   - `longReceiptSlices`(重叠 12% 切片)+ `autoRotate` 轴向旋转 + enhanceMode 'auto' 走质量分析(分析器缺失回退启发式 `fallbackEnhanceMode`);
   - `throwIfAborted`/`abortError`(V5 §73 阶段检查)+ `runPipeline`(Worker 优先/主线程回退,V5 §71)+ loadImage 支持 OffscreenCanvas。
3. `js/ocr/ocr-manager.js` — recognize 升级:
   - 长票分支 `_recognizeSlices`:逐片主引擎(失败逐片回退)、`remapSliceWords`(y 重映射+重叠带丢弃,保留上方切片)、`mergeSliceResults`(行聚类重建 + 全文按行拼接)均导出可单测;
   - signal 阶段检查(qr/预处理/主引擎/multipass/回退/切片);DEFAULT_OPTS 增 autoRotate(false)/longReceipt(true)/worker(false)/signal;
   - enhanceMode 'auto' 交由 pipeline 质量分析(原 detectEnhanceMode 保留为回退)。
4. `js/ocr/ocr-job-manager.js`(新)—— jobId/status/phase/AbortSignal/startedAt,`abortAll` 批量中止,`list/count` 诊断。
5. `js/ocr/preprocess-worker.js`(新)—— OffscreenCanvas Worker(importScripts 复用 preprocess.js + document 桩);特性开关 `opts.worker===true` **默认关**(真机验证后开启),失败自动主线程回退。
6. `js/ai/ai-workbench.js` — `wbLocalOcrV2` 接入 jobManager:超时即 `abort('timeout-or-error')` 中止任务链;`AbortError` 或 `job.aborted` 时**禁止回写 UI**;正常结束 `job.finish()`。
7. 版本:sw.js v107、image-quality/ocr-job-manager/preprocess-worker `?v=1`、preprocess?v=41、ocr-manager?v=48、ai-workbench?v=67。
8. 新增测试(全部通过):
   - `_test_ocr_image_quality.cjs` — 24 通过(评分/方向/规则/只读)
   - `_test_ocr_long_receipt.cjs` — 18 通过(切片/重映射/合并)
   - `_test_ocr_job_manager.cjs` — 23 通过(生命周期/中止/阶段检查)
9. 全量回归:**13 套测试 0 失败**(OCR 10 套 253 项 + 语音 18/18 + recovery 11 + global);7 文件 `node --check` 通过。

### P4 已交付明细

1. `js/regions/router.js`(新)—— Region Router 核心:
   - **统一语义字段**(V5 §4):TOTAL_AMOUNT/SUBTOTAL/TAX/DISCOUNT/CASH_TENDERED/CHANGE/DATE/MERCHANT/LEGAL_ENTITY/TAX_ID/PAYMENT_METHOD/PAYER_BANK/PAYEE_BANK/ACCOUNT_LAST4/REFERENCE/FOLIO/TRACE_KEY/DOCUMENT_ID/CURRENCY/INCOME_EXPENSE——Core 不再出现 EFECTIVO/CAMBIO/RFC 等地区词;
   - `semanticExtract(text, region)` 按地区 Profile 标签提取语义字段;`classifyDocument` 通用分类(V5 §23,结构信号+通用关键词+地区词只加分);`semanticToBusiness` 映射;GENERIC 兜底 Profile;`registerProfile` 注册表。
2. `js/regions/mx.js` + `js/regions/cn.js`(新)—— 地区插件(迁移不是删除:MexicoParser 保留兼容)。CN 示例证明**非墨西哥地区无需修改 Core**(合计/实付/找零/税额/税号/统一社会信用代码)。
3. 接入 `ai-workbench.wbLocalOcrV2`:semanticExtract 补全缺失字段(所有地区)、classifyDocument 设通用 docType、**语义字段喂给金额智能**(CN 实付−找零≈合计 自动获得现金闭环)。
4. `js/ocr/server-engine.js`(新)—— ServerOcrEngine(OcrEngineBase 统一接口,上传+轮询 extract,`_normalize` 归一为 OcrResult);**特性开关注册**(localStorage `sm_ocr_server_engine=1`,默认不启用服务器依赖,§75)。
5. `ocr-manager._fallback` 升级:按注册顺序迭代除失败引擎外的全部引擎——Server 等新引擎自动入回退链,业务层零特殊判断。
6. `constraint-engine.parseAmount` 兼容币种后缀(MXN/元 等,语义提取值可直接解析)。

### P5 已交付明细

1. `js/intelligence/ocr-memory-store.js`(新)—— IndexedDB(versioned schema,只增不改,rollback-safe)+ 内存回退(Node 测试/无 IDB 环境);4 store:ocr_merchants/ocr_templates/ocr_learning_events/ocr_learned_rules。
2. `js/intelligence/document-fingerprint.js`(新)—— 多证据指纹(§42-43):税号 0.50/商户 0.20/关键词 0.15/布局 0.10/文档类型 0.05 加权相似度;QR 签名。
3. `js/intelligence/template-engine.js`(新)—— **语义模板**(§40-47):字段-锚点相对关系(非绝对坐标)、画像(偏好引擎/预处理 §65-66)、数学关系、统计;**等级受生命周期约束**(candidate 模板即使相似度高也不算 stable,§90);晋升(3 成功)→降级(3 连败)→恢复(2 连胜)→归档(§52-53/64);商户记忆与模板分离(§57)。
4. `js/intelligence/correction-learner.js`(新)—— LearningEvent(§48-56):字段/原值/纠正值/指纹/模板/地区/引擎/数学上下文;规则**学原因**(char-confusion 对 / math 上下文,不背答案 §50);minSupport 生效(§54);作用域晋升 L0→L5 **禁止跳级**(§51);负样本抑制(§55);弱正样本(§56:保存+高置信+数学验证,用户改过不算)。
5. 接入:wbLearnCorrections(别名学习保留 + LearningEvent 记录 + 低置信金额负样本)、wbSave(模板 record/候选模板创建 §63)、wbLocalOcrV2(指纹→模板匹配→负样本抑制置信下调)。

### P6 已交付明细

1. `js/ocr/execution-planner.js`(新)—— `criticalFieldConfidence`(金额/日期形态词独立置信,§70)+ `planExecution`(§68):**FAST**(清晰+关键高置信→早退 §69)/ **SMART**(阈值逻辑)/ **RESCUE**(关键缺失或置信过低→强制 multipass+回退合并)。
2. `ocr-manager.recognize` 接入执行计划(result._plan 透出;无模块时回退旧行为)。
3. 模板画像统计随 record 累积(engineCounts/preprocessCounts → preferredEngine/preferredPreprocess)。
4. 版本:sw.js **v108**;新增 15 个模块(共 82.5KB)均入 SW 预缓存 + index.html 加载序(注意:regions 在 mexico 后/ai-workbench 前;intelligence 学习模块在 learning-engine 后;execution-planner/server-engine 在 ocr-manager 后)。

### 统一验证报告(全部阶段完成)

| 验证项 | 结果 |
|---|---|
| 测试套件 | **16/16 通过**(OCR 13 套 341 项:47+19+15+31+17+33+26+24+18+23+27+39+22;语音 18/18 + recovery 11/11 + 全局通过) |
| node --check | 28 个 JS 文件 0 语法失败 |
| benchmark --demo | 报告正常(Amount 1/2、Critical Err 检测、CRIT 标记) |
| 旧接口兼容 | OcrKit/OfflineOCR/MexicoParser/EvidenceEngine/RecognitionCore/VoiceSR 契约未破坏(测试回归确认) |
| 新模块规模 | 15 个新文件 82.5KB,全部本地自托管 |

**遗留事项(需真机/数据)**:
- `autoRotate`(轴向检测)与预处理 Worker 特性开关默认关,待真机 90° 票据样本验证后开启;
- ServerOcrEngine 特性开关默认关,服务器可用后置 `localStorage sm_ocr_server_engine=1` 验证;
- benchmark 图片 fixture 待用户提供脱敏票据后出真实字段 KPI 与 P1a→P6 前后对比;
- 180°/270° 方向判定需引擎 OSD 或模板记忆(已文档化)。

---

## 附:Phase 0 结论

- V5 蓝图与现有架构兼容度**高**:分层、证据、地区门控、离线策略等骨架已就位,增量以"新增模块 + 局部修复"为主,**无需推倒重写**。
- **立即阻止项**:multipass 污染、auto 语言、服务器文案、假离线宣传(4 项都属 Phase 1 必做)。
- **最大空白**:图片级准确率 Benchmark 与 fixture(§81-87)完全缺失 —— 建议 Phase 1 并行搭建(不阻塞修 bug,但后续 Phase 的"已优化"声明必须依赖它)。
- **安全底线**:OCR 只预填、不直写账目(现状符合);学习系统(Phase 7)上线前必须完成作用域/反污染/回滚设计(§51-55)。

---
*本报告为 Phase 0 交付物。按 V5 §101:提交后暂停,等待用户确认,禁止直接进入 Phase 1。*
