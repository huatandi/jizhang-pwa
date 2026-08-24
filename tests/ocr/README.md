# OCR Benchmark（V5 §81-87）

本目录是 OCR 关键字段基准框架：人工标注的票据图片(fixtures)+ 浏览器实测结果(results)+ KPI 计算器(benchmark.cjs)。

## 目录结构

```
tests/ocr/
├── benchmark.cjs            # KPI 计算器（Node，纯函数可单测）
├── fixtures/
│   ├── manifest.json        # 期望值清单（人工标注）
│   └── <id>.jpg             # 真实/脱敏票据图片（用户提供，未入库）
├── results/
│   └── <fixtureId>.json     # 浏览器实测结果（识别后落盘）
└── README.md
```

## KPI 定义（V5 §82-83）

| 指标 | 定义 |
|---|---|
| Amount / Date / Merchant / TaxId / Reference / Payment Exact Match | 各字段归一化后与期望值完全一致的比例 |
| **Critical Financial Error Rate** | `\|实际−期望\| ≥ max(10, 期望×10%)` 的金额错误比例（60→560 这类）——最高等级指标 |
| Correction Recurrence Rate | 用户已纠正过的问题再次出现的比例（Phase 7 学习系统验收用，当前占位） |

## 使用流程

### 1. 添加 fixture（用户提供脱敏票据）
- 图片放入 `tests/ocr/fixtures/`，命名 `<id>.jpg`；
- 在 `manifest.json` 增加条目：`{ id, file, documentType, region, difficulty, expected: { amount, date, merchant, taxId, reference, payment } }`；
- 期望值为 `null` 表示该字段不评估；
- 校验：`node tests/ocr/benchmark.cjs --check-manifest`。

### 2. 捕获识别结果（浏览器）
在应用的工作台页面选择好图片后，控制台执行：

```js
(async () => {
  const img = document.getElementById('wbImg');
  if (!img || !img.src) return alert('请先在工作台选择图片');
  const res = await wbLocalOcrV2(img);
  const id = prompt('fixtureId（与 manifest 一致）:') || 'unknown';
  const out = {
    fixtureId: id,
    engine: res.engine || null,
    backend: null,
    processingMs: res.processingMs || null,
    fields: {
      amount: res.fields.amount ?? null,
      date: res.fields.date ?? null,
      merchant: res.fields.merchant ?? null,
      taxId: res.fields.tax ?? null,
      reference: null,
      payment: null
    },
    rawText: res.text || '',
    preprocessProfile: null
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = id + '.json';
  a.click();
  console.log('已导出', id + '.json，请放入 tests/ocr/results/');
})();
```

自动化环境（Playwright 等）可等价调用 `wbLocalOcrV2(img)` 并落盘。

### 3. 生成报告
```bash
node tests/ocr/benchmark.cjs          # 读取 manifest + results/*.json
node tests/ocr/benchmark.cjs --demo   # 无结果文件时查看报告格式（含金额严重错误演示）
node tests/ocr/benchmark.cjs --check-manifest
```

## 验收标准（V5 §99 对应）

- A. 原有能力无回归（`_test_ocr_v2.cjs` 等全绿）
- B. 困难票准确率提升（`difficulty: hard` fixture 的字段 Exact Match 提升）
- C. 金额严重错误率下降（Critical Financial Error Rate 趋近 0）
- D. 人工纠正后第二次更准（学习系统验收：同 fixture 二跑对比）
- H. 完全断网核心 OCR 可运行（离线 fixture 专项）

## 注意

- fixture 图片必须为**合法可用的真实/脱敏票据**，禁止上传含个人敏感信息（RFC/账号）的原始票据到公共仓库；
- 每轮代码变更后重跑 benchmark，报告存入 `tests/ocr/results/` 供回归对比——**无对比数据不得声称"已优化"**。
