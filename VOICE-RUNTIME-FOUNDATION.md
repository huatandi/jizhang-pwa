# VOICE-RUNTIME-FOUNDATION.md

> V5 Voice PHASE 1 — Voice Runtime Foundation(运行时可信底座)执行契约
> 我接受用户修正:Phase 1 不做"更聪明",而是建立可信底座。所有后续智能化都建在这上面。

---

## 一、一条铁律

**Phase 1 期间,不同时改"音频输入、ASR模型、Parser、自学习规则"四类变量。**

每次只允许改动一类主要变量,否则准确率变化无法归因。顺序:

```
Phase 1  Runtime 正确(本次)
Phase 2  Parser 收敛
Phase 3  VAD / Audio
Phase 4  Intent / Context
Phase 5  Learning
```

---

## 二、五个"必须能回答的问题"(每次识别)

1. 到底用了哪个引擎?(whisper / webspeech / tesseract / paddle)
2. 到底用了哪个模型?(whisper-base/tiny;PP-OCRv5)
3. 音频有没有被截断?(VAD 是否早切/截断)
4. ASR 原始听到了什么?(rawTranscript 不可篡改)
5. 最终为什么填成这个字段?(per-field attribution)

系统必须能回答这 5 个问题,否则后面 Adaptive VAD / Personal Memory / FAST-SMART-RESCUE 都做不稳。

---

## 三、9 层保险(全部纳入 Phase 1)

### 1. Runtime Capability Gate(不靠异常探路)
一次启动生成 `VoiceRuntimeProfile`:
- WebGPU / WASM-SIMD / SharedArrayBuffer(crossOriginIsolated) / AudioWorklet / OffscreenCanvas
- 可用内存(navigator.deviceMemory) / 当前模型缓存状态
AsrManager 据此路由,不在每次点击说话时现试。

### 2. Model Health 状态(不是 cached/not-cached)
`NOT_INSTALLED / DOWNLOADING / READY / BROKEN / INCOMPATIBLE / OOM_RISK / DISABLED`。
"缓存了但 ORT 不匹配"→ 显示 INCOMPATIBLE,不能当"已安装"。

### 3. 一次性 Self-Test(模型加载≠推理成功)
Whisper/ORT 更新后,用内置极短测试音频跑一次真实 `audio→text`,通过才标 `READY`。OCR 以后同样。

### 4. Error Attribution(先做诊断版)
区分 `MIC / AUDIO / VAD / MODEL_LOAD / INFERENCE / ASR / PARSER / MEMORY / EVIDENCE / TTS_LOOPBACK`。
否则用户说"识别错",无法定位是 VAD 吃了首字 / Whisper 听错 / Parser 理解错。

### 5. rawTranscript 不可篡改
三层分离:`rawTranscript`(ASR 原文,不可改)/ `normalizedTranscript` / `resolvedEntity`。
绝对不把纠正后的文字覆盖原始 ASR 文本。

### 6. 最小 AudioFocusManager
TTS speaking → ASR input suppressed → TTS 结束 → 延迟 100~300ms 再恢复监听(真机调参)。
Phase 1 不做复杂调度,只解决"TTS 被麦克风再次收录"这个现存问题。

### 7. Circuit Breaker
某设备连续 2~3 次 Whisper 初始化失败 → 记录设备级"暂不健康",直接走允许的 fallback;过段时间/版本变化/用户手动"重新检测"再恢复。避免每次点击都浪费十几秒。

### 8. Feature Flag + Kill Switch
本地可控安全开关(勿依赖远端):`whisperV2Pipeline / sessionHandleV2 / memoryCandidateMode / audioFocusV2` 等。新模块出问题能立即关闭恢复旧链路。

### 9. Golden Path 验收(非单测)
固定若干句真实语音(中文/西语/英语/中西混合各几句),保存"预期 raw transcript 可接受范围 + 最终字段真值";每次升级 Whisper/Parser/Memory/VAD 跑同一批。**KPI = Final Field Accuracy**(非仅 WER)。

---

## 四、开发顺序(Phase 1 内)

```
1. 最小真机 Baseline           (记录 cold/warm start,VAD false-start,WER 起点)
2. VoiceRuntimeProfile         (能力门控)
3. Whisper/ORT 真正跑通         (已在 v122 ORT→1.24.3 对齐)
4. 修 base→tiny 假降级          (pipeline → Map(PipelineKey))
5. Model Health + Self-Test    (确认模型推理真成功)
6. Privacy Policy              (WebSpeech 接 AIPrivacy)
7. SessionHandle / Abort       (弃 cb=null)
8. 最小 AudioFocus             (TTS↔ASR 互斥)
9. PvM 防污染                  (单次纠错仅 candidate;user scope)
10. Error Attribution 基础记录
11. Golden Path 回归
12. Phase 1 结束               (每个辨识能回答 5 问)
```

---

## 五、自学习的严格分类原则(写死到指令)

`ASR 错 ≠ Parser 错 ≠ 用户表达歧义`:

| 场景 | 归因 | 进入哪类记忆 |
|---|---|---|
| Whisper 听对"一百五", 解析成105, 用户改150 | **非 ASR 错** | Expression Memory(中文金额上下文"一百五"→150) |
| Whisper 把 BBVA 听成"比比娃", 用户改回 BBVA | **实体/音近错** | Entity / Phonetic Memory |
| 整句听对"从BBVA支付650", 但 Parser 把650填进备注 | **Parser 错** | Parser Error(污染 ASR Memory 是错的) |

否则会"越用规则越多、越来越难维护"。

---

## 六、每项交付规范(§101/102)

每项完成后报告:修改文件 / 新增模块 / 修复BUG / 测试 / Baseline 对比 / 性能变化 / 新风险 / 是否满足进下一项。

---

## 七、Phase 1 完成标准

每次语音识别,系统能回答 5 问(引擎/模型/是否截断/rawTranscript/为何填此字段),且:
- VoiceRuntimeProfile 已生效(不再点击时试错);
- Whisper ModelHealth 有真实状态(Self-Test 通过才算 READY);
- 假降级已修;
- WebSpeech 遵守隐私策略;
- 最小 AudioFocus 已接入;
- Circuit Breaker 已接入;
- Feature Flags 就绪;
- Golden Path 可跑(先小规模)。

完成后再进入 Phase 2(Parser 收敛)。
