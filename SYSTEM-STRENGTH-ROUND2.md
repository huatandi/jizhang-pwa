# 飞常明细 — System Strength Round2

日期：2026-09-07
基线：System Strength Round1（Build ID 63356fd4）
本轮 Build ID：d801a35a

## 目标

本轮不扩张功能面，优先处理两类会直接影响“账是否可信”的系统性问题：

1. **基础货币显示真值**：数据库已经按基础货币持久化，但多个首页、台账、预算、异常雷达仍硬编码 `¥`，在墨西哥 MXN 或其它地区会造成“数据本身正确、界面却显示成另一币种”的严重语义错误。
2. **备份/恢复持久化闭环**：恢复流程已有结构校验和回滚，但导出仍主要是裸 SQLite；同时 `flush()` 不可等待，恢复成功提示可能早于 IndexedDB 真正写完。

## 已实施

### A. 基础货币表现层统一

- `js/app.js` 新增 `fmtCurrencyMoney / fmtBaseMoney / fmtBaseMoneySigned`。
- 所有本轮覆盖到的核心账务金额展示统一显示 `ISO货币代码 + 金额`，例如 `MXN 1,234.56`，避免 `$` 在 MXN/USD 之间、`¥` 在 CNY/JPY 之间产生歧义。
- 首页 8 类 KPI、月度、查询、预算、排行榜、内部转账、周期账单、回收站等改为跟随 `BASE_CURRENCY()`。
- `js/ledger-crud.js` 收入/支出/进货/分次付款/未付/超付/退款关联等界面移除硬编码人民币符号。
- `js/offline-backend.js` Action Center / 异常雷达中的长期未付款、周期到期、疑似重复、支出激增等金额文本改为跟随数据库基础货币。
- `index.html` 预算初始值在 settings 尚未加载时显示 `—`，不再先闪现 `¥0.00`。
- **未改变持久化币种不变量、汇率算法、交易金额或数据库 schema。** 本轮只是修正表现层和提示文本。

### B. Backup V2 自描述安全信封

新增 `js/core/backup-envelope.js`：

- Backup format：`jizhang-backup-v2`
- Payload：Base64 SQLite
- Checksum：SHA-256
- Metadata：生成时间、schema version、base currency、payload encoding、checksum scope
- 字节级 create/decode 往返测试
- payload 被篡改时 checksum 必须拒绝
- 兼容旧 `.db` 裸 SQLite 恢复
- 兼容早期 V2 JSON checksum 口径
- 不支持的 format / payload encoding 明确拒绝

默认“立即备份并下载”现在生成：

`飞常明细_安全备份_YYYY-MM-DD.jzb.json`

导出前先运行 SQLite `integrity_check`；恢复时先校验信封 checksum，再运行 SQLite 结构/完整性检查。

### C. 恢复持久化闭环

- `OfflineDB.flush(strict=false)` 改为 async，可等待 IndexedDB transaction 真正完成。
- 恢复成功前：`await DB.flush(true)`。
- 自动回滚后：`await DB.flush(true)`。
- 从持久化 recovery snapshot 二次恢复后：`await DB.flush(true)`。
- `saveRecoverySnapshot()` 使用 strict IndexedDB write；恢复点如果不能可靠写入，恢复流程直接停止，不再假装已建立安全恢复点。
- 修正 `pagehide` 直接传 `Event` 给 `flush(strict)` 的参数污染：现在显式 `flush(false)`。
- 恢复入口增加 128MB 异常大文件保护。

### D. 离线链路

`js/core/backup-envelope.js` 已加入：

- index.html 内容哈希版本引用
- Service Worker APP_SHELL
- Build manifest

最终 APP_SHELL：183 项。

## 验证

- `System Strength Round2`：16/16 PASS
- 全默认离线测试：57 PASS / 0 FAIL / 1 SKIP
- SKIP：`_test_fx.cjs`（显式网络测试，仍由 `npm run test:network` 单独执行）
- 两次连续 build：Build ID 均为 `d801a35a`
- build manifest：完全一致
- `npm run verify`：PASS
- Service Worker APP_SHELL：183 项全部存在

## 明确未冒充完成的事项

- 没有真实浏览器关闭/重开后的 IndexedDB 持久化实测证据。
- 没有在真实手机上执行 Backup V2 下载 → 清库 → 恢复 → 重启的端到端测试。
- 没有执行外网 FX 测试。
- 没有把本轮 Node/静态测试当成真实麦克风、真实 OCR、真实 PWA 生命周期证据。

## 下一优先级

下一轮建议进入 **PWA/数据恢复真实生命周期 + Diagnostics Center**：启动恢复点检测、异常中断恢复提示、离线冷启动门禁、模型/麦克风/相机/WASM/WebGPU/存储能力统一诊断；随后再进入 OCR 困难票据 Golden Set 和 Voice 真机门禁。
