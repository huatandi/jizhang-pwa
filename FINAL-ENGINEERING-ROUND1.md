# Final Engineering Program — Round 1

完成：
- 新增隐私过滤 App Event Bus，宠物只接收抽象事件，不接收金额、账户、照片、RFC/税号。
- Pet Engine 升级 V3；业务事件从 Pet Engine 剥离到 Pet Director。
- Pet Director 接入账务成功、提醒、识别状态、Action Center、离线状态的表现层入口。
- Action Center 仅向宠物发布待处理数量，不发布账务明细。
- 新增“安静1小时 / 安静8小时 / 恢复互动”。
- 增加 yawn / speak 状态基础动画，并保留 sleep/happy/remind/focus/walk。
- 保留十二生肖高清透明资源与低功耗/后台暂停机制。

本轮没有声称完成：
- 真实逐帧奔跑/睡姿/哈欠/说话嘴型素材尚未完成。
- 真机麦克风、相机、TEN-VAD 仍需真实设备验收。
- 宠物真正 TTS 必须复用现有 Reminder/Voice 通道，下一轮再接，避免建立第二套提醒真相源。
