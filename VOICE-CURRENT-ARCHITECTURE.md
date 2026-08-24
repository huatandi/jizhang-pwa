# VOICE-CURRENT-ARCHITECTURE.md

> V5 Voice PHASE 0 — VOICE SYSTEM AUDIT(审计报告)
> 依据:Adaptive Voice Intelligence V5.0 指令 §3/§107
> 审计方式:真实源码走读(js/asr/*、js/voice/*、js/voice-engine.js、js/multimodal.js、js/ai/*、js/intelligence/*、js/learning/*)+ 实跑现有语音测试
> 状态:**审计完成;按 §107 提交后暂停,等待确认,未进入 PHASE 1**

---

## A. 当前真实语音架构(已核实)

```
MEDIA / AUDIO
│  js/asr/audio-capture.js    getUserMedia→AudioContext→AudioWorklet(Safari:ScriptProcessor)→16k mono Float32
│  js/asr/audio-processor.js  AudioWorklet processor(rms 回读)
│  js/asr/vad.js              Energy VAD(RMS+ZCR),固定参数(0.012/0.008/700ms/12s/40ms),可插拔接口
├─ ASR 层
│  js/asr/asr-types.js        AsrEngineBase/STATES/14 错误码+三语文案
│  js/asr/whisper-engine.js   transformers.js 动态加载(本地vendor→CDN);WebGPU/WASM;proxy:true
│  js/asr/webspeech-engine.js WebSpeech(伪连续/指数退避/自动续听)
│  js/asr/asr-manager.js      编排:主题选择/序列化/VAD队列/OOM降级tiny
│  js/asr/model-manager.js    profile→tiny/base + 内存预估 + IndexedDB 元数据
├─ 会话层
│  js/voice/voice-sr.js       VoiceSR:sessionId/start-stop串行/2s watchdog/mergeTranscript/warmup/旧错误码映射
├─ 语义层(多套)
│  js/voice-engine.js         VoiceEngine:字段消耗式 extract()(1166行)
│  js/voice/voice-parser.js   VoiceKit(V3抽出,与VoiceEngine重复)
│  js/voice/reminders.js      ReminderParser(再一套 date/time/advance)
├─ 记忆
│  js/voice/personal-voice-memory.js  PvM:实体/短语→目标,IndexedDB+localStorage,5000上限,源优先级
│  js/learning/learning-engine.js     LearningEngine:事件评分/晋升阈值(语音侧)
├─ 融合/决策
│  js/intelligence/evidence-engine.js   static SOURCE_PRIORITY(user1>qr.99>mem.95>voice.90>ocr.85>fuzzy.45)
│  js/intelligence/conflict-resolver.js 记忆加权+rankCandidates+recordChoice→PvM
├─ UI/集成
│  js/voice/quick-voice.js     voiceHandleResult 状态机/60s空闲/重试一次后forceOnline/TTS speak
│  js/voice/reminders.js       提醒语音(共享VoiceSR,自带announce hack)
│  js/ai/multimodal.js         recognizeReceipt+fillByVoice+recognizeAndSpeak
│  js/ai/engine-manager.js     asrPlan(webgpu/wasm→whisper;else webspeech)
│  js/ai/global-config.js      Language/Region→asr/webSpeech/tts 意图(resolveAsrLang等)
```

**调用链(说话→落账)**:`QuickVoice 点击 → VoiceSR.listen → AsrManager._selectEngine(Whisper|WebSpeech) → AudioCapture+VAD 开麦 → VAD 判句==utterance → enqueue → Whisper.transcribe → onFinal(text) → voiceHandleResult → voiceEngine/VoiceKit 解析 → 工作台/表单填入 → 证据裁决`

---

## B. 报告与真实代码不一致处

| 报告假设 | 实际 | 判定 |
|---|---|---|
| "Whisper 降级 tiny" 有效 | `whisper-engine.js` 模块级 `pipeline`/`initPromise` 单例,`_tryDowngrade` 建 tiny 后 `initialize()` 命中原 base pipeline | **假降级(P0)** |
| WebSpeech 在线需授权 | `voice-sr.js` `allowOnline` 默认 true,注释"无需额外授权" | **默认联网(违背 local-first/隐私)** |
| ai-privacy 已接入在线决定 | `ai-privacy.js` 有 local_only/local_first/ai_assist,但**未接入 WebSpeech 在线判断** | **未接入(P0)** |
| 单一解析器 | `voice-engine.js` + `voice-parser.js(VoiceKit)` + `reminders.js(ReminderParser)` 三套,数字/日期/金额重复 | **三重重复(P0)** |
| TTS/ASR 已治理 | quick-voice/reminder 各自 `speak→(延时)→listen` 手工 hack,`reminders.js:578` 注释明言回声风险 | **无统一 AudioFocusManager** |
| 语言三档可扩展 | `quick-voice` speak/announce/voiceLang 硬编码 zh-CN/es-MX/en-US | **语言硬编码(P0)** |
| Evidence 权重动态 | `evidence-engine.js` SOURCE_PRIORITY 静态(voice0.90>ocr0.85) | **写死(否认"Voice永远>OCR"原则)** |
| PvM 学习路径 | 纠错→PvM learn 存在,但 `conflict-resolver.recordChoice`/`voice-engine` 纠错无 Error Attribution | **学习无分层归因** |

---

## C. P0 BUG(确定)

1. **Whisper 假降级(§5/§6 属实)**:`asr-manager._tryDowngrade()` 经 `WhisperEngine.initialize()` → `whisper-engine.js:120 if (pipeline) return pipeline` 命中 base → tiny 从未加载。OOM 降级完全失效,后续仍跑刚 OOM 的 base。
2. **在线回退默认开启、未接隐私(§13/§14)**:`voice-sr.js` `allowOnline=true` 默认;`ai-privacy.js` 存在但 WebSpeech 在线判断**不查询 AIPrivacy** → 语音可能发往云端而用户不知。
3. **语言/TTS 硬编码(§17)**:`quick-voice` speak/announce/voiceLang 仅 zh-CN/es-MX/en-US;`reminders` 同。未走 `resolveTtsLang`。
4. **三重解析器并行(§7/§8)**:voice-engine / VoiceKit / ReminderParser 重复实现数字/金额/日期/时间;真源未收敛。
5. **TTS 被 ASR 再收录(§58)**:quick/reminder 各自 `speak→listen` 手工规避,无集中 AudioFocus;`reminders.js:578` 自证风险。
6. **VAD 固定参数(§44-49)**:0.012/0.008/700ms/12s 写死,无噪声底噪学习/滞回/pre-roll/post-roll。

---

## D. 竞态风险

- `voice-sr.js` watchdog 恢复用 `mgr.cb = null` 手法(§60/§62)——脆弱,恢复期间断开回调再还原,可能漏恢复。
- `start()/stop()` 已串行 Promise + sessionId,较稳;但 watchdog 恢复路径与用户手动 stop 可并发。
- WebSpeechEngine `isActuallyListening`/restartTimer 与 asr-manager stop 竞态(已大部处理)。
- 多路(batch/quick/reminder)可同时 hold 麦克风,无 AudioSessionManager 仲裁(§59)。

---

## E. VAD 问题(§43-51)

- 能量阈值 0.012/0.008 固定;无自适应噪声底噪 → 商店噪声误触发率高。
- 无滞回(Start>End) → 临界抖动(§45)。
- **无 pre-roll**(§46)→ 首字易丢("今天买货"→"天买货");**无 post-roll**(§47)→ 尾音丢失。
- 700ms 静音/12s 截断固定(§48/49),无按语言/语速/噪声动态化;12s 是硬切非软分割。
- VadEngine 接口已可插拔(§50 部分满足);Silero 未引入(符合"不要立即绑定",§51)。

## F. ASR 问题

- `whisper-engine.initialize` 一次性下载模型,无下载进度 UI(§67);`model-manager` 仅元数据,无版本化/cache retire(§65/66)。
- `_tryDowngrade` 假降级(见 C1);`device` 自动、`numThreads=1`,`proxy:true`(无 COEP 正确)。
- Whisper 无置信度(§41/42):`confidence:null`,无 `avg_logprob/no_speech_prob`;当前靠语义/实体置信。
- WebSpeech 在线无显式 policy;`forceOnline` 在 voice-sr 按 opts 设置,但"每次会话是否在线"对用户不透明(§13/14)。

## G. Parser 重复/冲突(重点)

- `voice-engine.js extract()`(字段消耗式,§37 方向正确)与 `voice-parser.js(VoiceKit)` **重复实现** `parseCnNumber/parseEnNumber/parseAmount/parseDate/parseAccount/matchCategory/parseReminder`;`voice-parser.js:9` 自称"与 VoiceEngine V2 的兼容层"。两套已有分歧(如 parseCnNumber 前者支持"亿"后者没有)。
- `reminders.js` 有独立 `ReminderParser`(parseTime/parseAdvance/parse),又一套(§85 要求共享 Core Parser,实际未共享)。
- multimodal 用 VoiceKit,quick-voice 经 app.js 兼容层用 VoiceEngine,reminders 用 ReminderParser → **同句话三入口结果可能不同**。
- 数字解析 3 套、日期 2-3 套(§8 要求单一真源,未满足)。

## H. Memory/Learning 风险

- PvM:`personal-voice-memory.js` 有实体/短语→目标 + 源优先级(§21 基础),但**无分层**(Entity/Phrase/Correction/Intent/Expression/Context 未分,§21-24);`supports resolveSync` 但无错误归因(§81)。
- `learning-engine.js`:评分(重复30/确认20/修改30/跨模态20/拒绝-50/错-30)+ 阈值(30/60/80)+ `checkAutoSuggest`(默认3次);**是全局按 input 键,不区分 user**(§27 要求 USER scope),跨用户可能污染(本地单机影响小,但无 scope 概念)。
- `conflict-resolver.recordChoice` 把"用户从冲突中选择"直接 `pvm.learn(...USER_CONFIRM)` → 一次纠错即入 PvM(§29 要求 candidate→多验证→stable;现状单次即可晋升)。
- LearningEngine 只**提供建议**,不改业务库(§103 满足);但 PvM 纠错无"为什么错"归因(§80),全部当"ASR/phonetic correction"。

## I. OCR/Voice 融合问题

- `multimodal.fillByVoice` 只补缺失(§79 说"过于僵硬"属实);显式"金额改成650"在 `wbSmartRecognize` 里走 EvidenceEngine.fuse(§78 部分满足),但 fillByVoice 路径不覆盖。
- EvidenceEngine 静态权重 voice0.90>ocr0.85(§11/12:"Voice永远>OCR"被否);无 Field×Source×Context 动态 policy。
- OCR/Voice 各自产出,共享 Evidence/Conflict/Validate(§10 部分满足——识别层独立、裁决层共享),但**无统一 FieldCandidate 结构**(§9,OCR/QR/Manual/Memory 各入口直接改表单)。

## J. Privacy 问题(§13/14/88/89)

- `ai-privacy.js`(local_only/local_first/ai_assist)默认 `local_only`,**但未接入**:①WebSpeech 在线;②Whisper 模型下载;③PvM/学习(默认本地,好);④上传(无)。
- WebSpeech `allowOnline` 默认 true → **与 default privacy 冲突**。
- 原始音频不保存(§89 满足);学习为 text/structured。

## K. Offline/Cache 问题(§64-67/§9)

- Whisper 模型:transformers.js 从 HF CDN 下载,浏览器 Cache 缓存;SW 不缓存跨域 cors → **首次离线不可用,之后依赖浏览器 HTTP/transformer cache**(不在我们控制内)。
- `model-manager` 只存元数据(version/checksum),**无 blob 清理**;`MODEL_VERSIONS` 升级不触发旧模型退役(§65/66)。
- `vendor/onnx` 缺 WebGPU/单线程 ort wasm → Whisper/Whisper 推理在当前 Pages 不可用(与 OCR 同因);WebSpeech 兜底(不掩盖事实)。
- PvM/Learning 用 indexedDB/localStorage,离线 OK。

## L. Globalization 问题(§15-18/§86)

- `global-config.js` 有 Language→asr/ocr/webSpeech 映射(30+ 地区),但 `resolveTtsLang` **缺失**(§17);`quick-voice` 硬编码三档。
- Region 与 Language 未分离(§16):currency/banks 由 region,但 ASR 语言走 detectLang 混合;无 MixedLanguageNormalizer(§18)。
- Mexico 词/实体散落 semantics(matchCategory/parseAccount 含 BBVA/Banorte/西班牙词,§86 要求 Region Profile/Entity Dictionary 分离)。

## M. Performance Baseline(静态)

- 现有:`_test_voice_qa.cjs` 18/18(amount18/18,date7/7,kind14/14,category14/14,account1/1);`_test_voice_recovery.cjs` 11/11。
- 模型:base Q8≈76MB / tiny Q8≈30MB(transformers HF CDN);`onProgress` 0~1/0~100 混用(quick-voice 已归一)。
- ⚠️ **音频端到端(采集/VAD/推理)冷启动/延迟在 Node 无法测,需真实浏览器/设备**:Phase 1 前请先在 Safari+iOS + Android Chrome 记录 cold/warm start、mic→speech-detected、speech-end→transcript、真实/反光环境 false-start。

## N. Accuracy Baseline

- 现有单元测试覆盖 Parser 三语数字/金额/日期(通过),但**无真实音频 fixture**;`_test_voice_qa.cjs` 是"注入正确 transcript"测 Parser,非 ASR 全链路(§92 要求 Audio→VAD→ASR→Parser 全链路;当前只有 Parser)。
- 无 Benchmark Corpus(§94),无 Field Exact/Amount/Account/Dates/Intent/Entity 真值集;**WordErrorRate 未测**。

## O. 建议新增模块

| 模块 | 文件 | § |
|---|---|---|
| VoiceKit 单一解析核(收敛) | `js/voice/voice-parser.js` 为主,`voice-engine.js` 变 Facade | §7/8 |
| 统一数字解析器 | `js/voice/number-parser.js`(zh/en/es) | §8 |
| Language Profile + TTS 解析 | `js/voice/language-profile.js`(`resolveTtsLang`) | §16/17 |
| Audio Quality Analyzer | `js/asr/audio-quality.js`(noise floor/clip/SNR) | §52 |
| Adaptive VAD(噪声底噪+滞回+pre-roll/post-roll) | 升级 `js/asr/vad.js` | §44-49 |
| Intent 层 | `js/voice/voice-intent.js`(CREATE/EDIT_FIELD/SET_ACCOUNT/…) | §36 |
| TranscriptCandidate + 置信分层 | `js/asr/transcript-candidate.js`(normalized/entity-corrected) | §40-42 |
| ResidualTextClassifier(填充词/噪声) | `js/voice/residual-classifier.js` | §38 |
| PersonalVocabulary V2(分层记忆) | 升级 `js/voice/personal-voice-memory.js` | §21-24 |
| Error Attribution | `js/voice/voice-error-attribution.js` | §81 |
| AudioSessionManager(QuickVoice+Reminder+TTS 仲裁) | `js/voice/audio-session-manager.js` | §59 |
| Model Manager V2(版本/缓存清理) | 升级 `js/asr/model-manager.js` | §64-67 |
| Async/Abort SessionHandle | `js/voice/session-handle.js` | §60-62 |

## P. 建议修改模块

1. `js/asr/whisper-engine.js` — **修假降级**:`pipelines = new Map(PipelineKey=modelRepo+dtype+backend+lang)`,base/tiny 各真实实例。
2. `js/ai/multimodal.js` / `js/voice/voice-sr.js` — 在线回退接 `AIPrivacy`(LOCAL_ONLY→不联网;LOCAL_FIRST→低置信才在线;UI 明示本地/在线)。
3. `js/voice/quick-voice.js` + `js/voice/reminders.js` — 语言走 `resolveTtsLang`/`resolveAsrLang`;TTS/ASR 交 `AudioSessionManager` 仲裁。
4. `js/voice/reminders.js` — `ReminderParser` 改为复用 VoiceKit 的 date/time/number。
5. `js/asr/vad.js` — 自适应噪声底噪 + 滞回 + pre-roll/post-roll + 软分割。
6. `js/intelligence/evidence-engine.js` — 权重改 EvidencePolicy(可配置/Field×Source×Context),废弃静态 voice>ocr。
7. `js/voice/personal-voice-memory.js` — 分层 + user-scope + 单次纠错仅 candidate。
8. `js/voice/voice-engine.js` — 收敛为 VoiceKit Facade。

## Q. 暂时不要修改的模块

1. **`js/recognition/*`(RecognitionCore)** — 语音+OCR 共享,契约稳,非本轮。
2. **`js/ai/global-config.js`** — 30+ 地区映射已好,只新增 `resolveTtsLang`,勿动结构。
3. **`js/asr/audio-capture.js`/`audio-processor.js`** — 采集链路已稳(iOS 前后台/16k/电平),只微调 AudioCaptureProfile。
4. **`js/ledger-crud.js`/`offline-backend.js`** — 业务数据路径,语音只预填。
5. **`js/ai/engine-manager.js`** — 仅 UI/预案提示;语音引擎路由由 AsrManager 内部做,暂不动。
6. **jsVoice PvM 的 IndexedDB schema** — 迁移成本;仅增强字段,不重建库。

## R. PHASE 1 精确实施计划(待确认;范围=§100 PHASE 1)

> 每项:文件/原因/依赖/风险/兼容/测试。完成→报告→再进 Phase 2。

1. **修 Whisper 假降级(§5/§6)**:`whisper-engine.js` 模块级 `pipeline`→按 `modelRepo+dtype+backend+lang` 的 `Map`;`asr-manager._tryDowngrade` 校验 `modelName` 确实 tiny;新增单测(两引擎 modelName 不同、pipelines key 隔离)。
2. **在线隐私策略(§13/§14)**:`voice-sr.js` 接 `AIPrivacy`;默认 `local_only`;`local_first` 仅低置信才 WebSpeech;UI 提示本地/在线;`multimodal` 透传。
3. **TTS 语言统一(§17)**:`quick-voice`/`reminders` speak/announce 改 `globalConfig.resolveTtsLang()`;新增 `resolveTtsLang`;去除三档硬编码。
4. **会话恢复安全(§60/§62)**:`voice-sr.js` watchdog 弃 `mgr.cb=null`,改用 `SessionHandle`(id/abort/pause/resume)+ AbortController;新增 `session-handle.js`。
5. **Model cache 版本化(§65/66)**:`model-manager.js` 加 `listCached/deleteOld`;升级时先激活新再退旧;设置页显示下载状态。
6. (可选并行)PvM/学习防污染:单次纠错仅 candidate;LearningEngine 增加 user scope 键,避免跨用户/跨会话误晋升。

**PHASE 1 完成后报告**:修改文件/新增模块/修复BUG/测试结果/Baseline对比/性能变化/新风险/是否满足进 Phase 2。

---

*本报告为 Voice PHASE 0 交付物。按 §107:提交后暂停,等待确认,禁止自动进入 PHASE 1。*
