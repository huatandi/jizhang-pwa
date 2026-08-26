# 飞常明细 · Final Intelligence V7（2026-08-25）

本版本以“天气已恢复版”为基线，保留现有记账、语音、OCR、提醒、汇率、PWA 离线架构，并完成本轮确定性加强。

## OCR / Document Intelligence V7

- 新增 `js/intelligence/document-intelligence-v7.js`
  - 单据类型分类：零售/加油/公共事业/CFDI/缴费/银行/批发/通用。
  - 金额候选池：TOTAL / TOTAL A PAGAR / TOTAL A COBRAR / IMPORTE COBRADO 等角色化评分。
  - 数学证据：`SUBTOTAL + TAX - DISCOUNT ≈ TOTAL`、`CASH - CHANGE ≈ TOTAL`。
  - 防止重量/数量/税额/找零/现金值误抢 TOTAL。
  - 商户解析增加表头/月份/状态词负面过滤，修复 `CANT / AGOSTO / PAGADO / POR / ESR / FECHAYHORA` 类污染。
  - 数字日期 + 西/英月名日期解析。
  - 人工纠错错误归因：区分 OCR 没看见 vs 已看见但候选排序错误。

## 真正的纠错学习闭环

- 金额纠正不再保存“旧金额 → 新金额”的固定替换规则。
- 第一次人工纠正时自动确保创建 candidate template。
- `TemplateEngine.learnFieldCorrection()` 学习：
  - TOTAL/应付/应收标签；
  - 字段相对 ROI（0~1 坐标）；
  - 支持次数/失败次数；
  - 错误类型。
- 下一次同版式：模板锚点/ROI 参与金额候选评分；低置信时优先只裁学习过的 ROI 重识别。
- 模板连续失败可暂停字段锚点，避免票据换版后死套。

## OCR 性能

- 延续 V6.1：图片导入后先预览，用户点击“开始识别”才 OCR。
- 延续 V6.1：取消低平均置信触发 4 次整图 multipass。
- V7：WASM 单线程环境首轮尺寸从原先 desktop high 2200 调整为 1600 balanced；只有真正 WebGPU 快路径才使用 high。
- Profile：high 1900 / balanced 1600 / low 1300。
- 已知模板低置信字段优先小 ROI 重识别，不重跑整张票。

## 天气

- 保留恢复后的 Weather Intelligence：Open-Meteo、降雨/大风事件、未来 7 天、逐小时、提醒、GPS/城市设置。
- 天气显示支持：中文 / Español / English / 自动；默认可使用中文。

## Voice

- 保留 Voice Draft Session V6：先听成草稿、支持删除/重说/完成词后提交。
- 保留 PersonalVoiceMemory candidate→weak→medium→strong 防污染。
- Whisper 浏览器端不再自动切换 `hf-mirror.com`（已确认 GitHub Pages 会被 CORS 拦截）；只有显式配置可用镜像才切换，减少一次必败等待。

## 汇率

- 修复 BANXICO provider 路由：仅 USD↔MXN 使用 BANXICO；MXN/CNY、MXN/AUD 等不再请求 `?providers=BANXICO` 产生重复 404。

## Service Worker

- Cache：`jizhang-pwa-v160-final-intelligence`
- 已加入 Document Intelligence V7 资产。

## 测试

新增：
- `_test_document_intelligence_v7.cjs`：13/13
- `_test_ocr_learning_v7.cjs`：2/2

并回归通过：
- OCR v2 / constraint / confusion / candidate pool / memory learning / execution planner / preprocess / regions / merge
- Voice QA / recovery / PvM / Voice Draft

## 现实边界

“Final”表示当前架构的整合稳定基线，不表示任何 OCR 在所有照片上达到 100%。GitHub Pages 下 Paddle 仍受 WASM 单线程限制；WebGPU、PP-OCRv6、GLM-OCR、Capacitor 原生推理仍应通过真机 benchmark 后再默认启用。

## V7.1 hotfix — 2026-08-25
- OCR 首轮尺寸进一步调整为 high 1700 / balanced 1400 / low 1100，减少 WASM 单线程整图耗时；低置信字段继续走 ROI 局部救援。
- 修复工作台所有日期写入路径：统一经 wbDateToIso()，无效值清空，避免 OCR 时间/垃圾后缀进入 date input。
- wbDate 增加 CJK 字体回退、en-CA 提示与白色日历图标样式。
- Document Intelligence 增加 fullText 强 TOTAL/VALOR PAGO 候选，解决 line segmentation 把标签和金额拆开时金额丢失。
- 强 V7 金额结果不再被旧 candidatePool 二次覆盖。
- 商户识别增加票头品牌/机构优先与客服句、地址、状态词降权；针对 CAMPUS MF / OXXO / PETROMAX / CFE / CESPM / EL FLORIDO 提供显式品牌证据。
- 回归测试：Document Intelligence 13/13；OCR Learning 2/2。
