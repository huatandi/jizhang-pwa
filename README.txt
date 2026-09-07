V211 CI Fix — 基线 cd0f7e7

覆盖到项目根目录，保持目录结构：
- js/voice/reminders.js
- _test_v188_recognition_upgrade.cjs

修复：
1. 提醒方式字段隔离：
   - “只要/仅/only/solo” = 互斥选择；
   - “开启/打开/裸方式词” = 只开启提到的通道，其他保持；
   - “关闭/不要” = 只关闭提到的通道，其他保持。
2. V188/V211 契约融合：
   - reminder 普通上下文“一三千”不补“万”；
   - ledger 金额上下文严格语法“一三千”恢复“一万三千”。

验证（生成包环境）：
- _test_reminder_mode.cjs: 13/13 PASS
- _test_v188_recognition_upgrade.cjs: 6/6 PASS
- 除联网 FX 测试外的 48 个 _test_*.cjs: 48/48 PASS
- npm run build 连跑两次: buildId 均为 fb48d9bd

说明：当前执行容器无外网，完整 npm test 会在 _test_fx.cjs 的实时汇率网络请求处等待/失败；该 FX 测试在 GitHub CI #47 中已通过。请以 GitHub CI 作为最终完整门禁。
