# Voice Golden Dataset —— 使用说明

## 作用

把"语音输入 + 期望字段"（fixtures/manifest.json）与"引擎/浏览器实测结果"（results/*.json）对比，
产出语音 KPI 报告：Amount / Date / Entity / Intent 准确率 + **False Commit Rate（关键安全指标）**。

对齐架构文档 V7.0 §28（Voice Golden Dataset）与 §30（Regression Gate）。

## 目录

```
tests/voice/
  fixtures/manifest.json  ← 语音样例 + 期望字段（人工标注真值）
  results/                ← 引擎实测结果 <fixtureId>.json（由识别链路落盘）
  benchmark.cjs           ← KPI 计算器
  README.md               ← 本文件
```

## 结果文件格式（results/<fixtureId>.json）

```json
{
  "fixtureId": "voice-zh-clean-001",
  "engine": "whisper",
  "lang": "zh-CN",
  "processingMs": 320,
  "fields": {
    "amount": "850",
    "currency": "MXN",
    "merchant": "Costco",
    "category": "材料",
    "date": null,
    "account": null,
    "intent": "CONTENT"
  },
  "rawTranscript": "今天 Costco 买货 850 比索"
}
```

> fields 只包含实际解析到的字段；未解析字段可省略或为 null（manifest 中 expected 为 null 的字段不评估）。

## 如何捕获真实结果

### 方式 A：浏览器工作台（推荐，最真实）

1. 在应用中打开语音记账（快速记账 / 提醒）。
2. 对 manifest 中每个 utterance 实际说一遍（或导入音频）。
3. 在控制台读取 VoiceDraftSession / VoiceSR 的解析结果，按上述格式写入
   `tests/voice/results/<fixtureId>.json`。

### 方式 B：脚本直调（适合回归）

写一个 node 脚本用真实 VoiceParser + EntityResolver 对 utterance 解析，落盘结果：

```js
// 示例（伪代码）：capture-voice-results.cjs
const fs = require('fs');
// 1) 读取 manifest
// 2) 对每条 utterance 调用 VoiceParser.parse / EntityResolver.resolve
// 3) 把结果写为 tests/voice/results/<id>.json
```

> ⚠️ 注意：node 环境没有浏览器 ASR（Whisper/WebSpeech），方式 B 只能测 **Parser/Entity 层**，
> 不能测 ASR 转写。要测完整链路（含 ASR）必须用方式 A（浏览器）。

## 生成报告

```bash
# 有 results 时出真值 KPI
node tests/voice/benchmark.cjs

# 无 results 时看报告格式（内置演示数据）
node tests/voice/benchmark.cjs --demo

# 校验 manifest 结构
node tests/voice/benchmark.cjs --check-manifest
```

## 指标口径

| 指标 | 含义 | 安全方向 |
|---|---|---|
| Amount Accuracy | 金额解析精确命中 | 只升不降 |
| Date Accuracy | 日期解析精确命中 | 只升不降 |
| Entity Accuracy | 商户/账户/银行名命中（精确/别名等价） | 只升不降 |
| Intent Accuracy | 提交/取消/删除/重说意图命中 | 只升不降 |
| **False Commit Rate** | 非提交意图被误判为提交 | **只降不升（关键）** |
| Session Recovery Rate | 会话异常自动恢复成功率 | 只升不降 |
