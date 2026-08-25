# OCR V6.1 Hotfix (2026-08-25)

- 图片导入/拍照后只预览，不再自动 OCR；用户点击「开始识别」才执行。
- 移除低置信度触发的 4 次整图 Paddle multipass。
- 关键字段救援下沉到已有 RegionRetry ROI 路径。
- 仅在 avgConf < 25 或几乎无文字时允许一次灾难性全文 fallback。
- 保留 TOTAL/金额约束、字符混淆、Region Router、模板学习等既有能力。
- Service Worker 缓存升级到 v141，避免旧 JS 被缓存继续使用。

验证：相关 OCR 单元测试与 JS 语法检查通过。
