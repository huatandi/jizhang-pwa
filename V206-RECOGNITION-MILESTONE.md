# V206 Recognition Milestone — 识别强化里程碑

本版本把“语音识别 + OCR”固定为产品第一优先级，并完成代码侧阶段门禁。

## 1. Cross-modal financial fusion
- 新增 `RecognitionFusionGate`.
- OCR 与语音金额一致：提升置信度。
- OCR 13,455 vs Voice 1,345 一类数量级冲突：直接 RETRY，不自动选一个。
- 普通不一致：REVIEW；只有极明确置信优势才允许自动采用。
- 日期冲突同样不静默覆盖。

## 2. Multimodal pipeline hardened
- `AIKit.multimodal` 真正消费 ASR `onAmbiguity`.
- ASR RETRY/CONFIRM 不再被当作普通成功结果。
- OCR 已有金额时，语音金额不再被简单忽略；进入 FusionGate 做交叉验证。
- REVIEW / RETRY 时整条 multimodal 结果不得标记 ok。

## 3. Sherpa release contract
产品的中文增强 ASR 路线固定为：
- Transducer family
- `modified_beam_search`
- `hotwords` capability

不符合上述能力契约的 manifest 无法通过产品安装检查。
这是为了确保“万/十万/百万/银行/商户”等真正进入 ASR contextual bias，而不是只有后处理热词表。

## 4. Production finalizer
新增 `RecognitionFinalizer`：
- 检查 Sherpa Provider 是否真实 READY
- 检查 Neural VAD Provider 是否真实 READY
- 检查模型回滚、OCR Region Retry、金额数量级拦截是否存在
- 定义严格财务识别 release gate：
  - 金额严重数量级错误 > 0 => 不允许宣称通过
  - 达到足够真实样本后，金额准确率目标 >= 98.5%
  - OCR 关键字段准确率目标 >= 97%

## 5. Truth boundary
静态测试/Node 单测通过 != 真机模型准确率通过。
真正最终上线前仍必须完成：
- 真实 Sherpa WASM Provider + 模型资产部署
- 真实 TEN-VAD Web Provider/模型部署
- 店铺噪声环境真实麦克风样本
- 模糊/反光/倾斜/长票据真实图片样本

未完成这些实测前，智能识别中心会明确显示 Provider NOT_READY，而不是伪装成“已完成”。


> 本文档明确不是项目终结声明。真实模型、真实设备和真实数据集未完成前，不得称识别系统已最终完成。
