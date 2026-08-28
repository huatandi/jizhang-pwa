# tests/golden —— 统一真值库（Golden Dataset）

> 对应架构文档《V7.0 Universal Recognition Kernel》§27-§30（Golden Dataset / Metrics / Regression Gate）。
> 原则：**先建立 baseline，后谈优化**。任何 Voice / OCR / Parser / Memory / Entity / Region / Provider 修改，
> 必须先跑通本真值库 + Regression Gate，证明关键指标不倒退。

## 目录结构

```
tests/golden/
  README.md              ← 本文件
  ocr/                   ← OCR 真值（复用 tests/ocr/ 现有 benchmark，见下）
  voice/                 ← 语音真值（Voice Golden Dataset）
    fixtures/manifest.json  ← 语音样例 + 期望字段
    results/                ← 浏览器/引擎实测结果（<fixtureId>.json）
    benchmark.cjs           ← Voice KPI 计算器（Amount/Date/Entity/Intent/False-Commit）
  vision/                ← 预留（QR/Barcode/未来模态）
```

## 使用方式

```bash
# 全部测试 + 回归门禁（含 golden 对比）
node tests/run-all.cjs

# 仅 OCR 关键字段基准（已有设施）
node tests/ocr/benchmark.cjs --demo

# 仅 Voice 基准
node tests/voice/benchmark.cjs --demo

# 仅回归门禁（跑全部 + golden 对比）
node tests/regression-gate.cjs
```

## 指标口径（对齐 V7.0 §28/§29）

### Voice
- **Amount Accuracy**：语音金额解析精确命中率（归一化后相等）
- **Date Accuracy**：语音日期解析精确命中率
- **Entity Accuracy**：商户/账户/银行名解析命中率（精确或别名等价）
- **Intent Accuracy**：指令意图（提交/取消/删除/重说）识别命中率
- **False Commit Rate（关键安全指标）**：非提交意图被误判为提交的比例，**只降不升**
- **Session Recovery Rate**：会话异常自动恢复成功率

### OCR（复用 tests/ocr/benchmark.cjs）
- 逐字段 Exact Match（Amount/Date/Merchant/TaxId/Reference/Payment）
- **Critical Financial Error Rate**：金额严重错误率（60 → 560 这类），**只降不升**

## 回归门禁初始阈值（V7.0 §30：先建立 baseline 再固定，禁止凭空设定）

| 指标 | 门槛（待基线冻结后固定） |
|---|---|
| Critical Total Accuracy | 不得下降 |
| False Commit Rate | 不得上升 |
| Critical Field Accuracy | 不得明显下降（>5% 即告警） |
| Crash | 0 |
| P95 Latency | 不得无理由恶化 >15% |

> 首次运行会冻结当前结果为 `baseline/` 快照；后续修改用 `--compare` 与快照对比。
