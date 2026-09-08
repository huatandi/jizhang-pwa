# Voice Commit Lane V214

修复范围：语音 ASR 文本已正确但 UI 执行/字段写入错误。

- 显式“金额改成/改为 X”从当前 final utterance 的 value tail 原子解析并写入，不再经过累计草稿多候选仲裁。
- 写入金额后锁定 confirmed，清除 pending/failure 状态，并派发 input/change 事件。
- 显式收入/支出切换不再重放旧 voiceBuffer，避免旧草稿反向覆盖 UI。
- 显式账户选择同样走当前 utterance 的直接提交路径。
- 普通自然语言记账仍走原 DraftSession/Parser，不扩大高权限直写范围。

验证：新增 _test_voice_commit_lane.cjs 8/8 PASS；全 npm test 64 PASS / 0 FAIL / 1 SKIP；build/verify PASS。
真实麦克风与浏览器 UI 仍需部署后设备验收。
