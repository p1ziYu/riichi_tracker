# 一姬 Android 原生在线牌桌

独立 Gradle 8.14.3 / AGP 8.13.0 / Kotlin 2.2.0 项目；通过 composite build 引入 `../../packages/mobile-engine`。applicationId 为 `com.p1ziyu.riichitracker.native`，与旧版 Capacitor 应用并存。

```sh
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64
export ANDROID_HOME=/opt/android-sdk
export QEMU_LD_PREFIX=/usr/x86_64-linux-gnu  # ARM 开发机上的 x86-64 aapt2
./gradlew testDebugUnitTest assembleDebug
```

默认 API 为 `https://riichi.p1ziyu.com`。仅在使用**独立可销毁数据库**的验证 API 时传入 `-PichihimeApiBase=http://100.64.172.17:3199`；勿把真实账户或生产数据用于测试。Debug 网络策略只允许这一台 tailnet 主机使用明文 HTTP，Release 禁止明文。

账户与临时访客令牌保存在 AndroidKeyStore AES-GCM 加密的应用私有文件，禁用备份；本地无身份模式不会创建服务端主体（离线记分尚未实现）。重新进前台会拉权威牌桌快照，WebSocket 仅作刷新通知。账户可用四个服务端模板创建牌桌并编辑 23 项规则、查看 KMP 引擎的四种支付示例；模板仅是本桌调整，不保存私人模板。

**直接加入：** 桌主自行选座后，分享六位房间码或生成十分钟单次签到链接／二维码。已登录账户或临时访客可扫描 `/checkin/*` App Link、粘贴链接或输入房间码（经 `GET /api/matches/by-code/:code` 换取令牌）；客户端通过令牌读取 `GET /api/matches/:id/check-in-seats`，显示占用座位与昵称（屏幕编号从 1 开始），玩家显式选空座或自动选首个空座，填写可选昵称并调用 `POST /api/matches/:id/check-ins` 一步取得座位及签到。已签到者重新加入保留原有座位。座位被抢占时刷新座位再选；满员、已开局、无效／过期凭证分别提示，房间码可再次换取令牌，过期链接须请桌主重发。入桌后显示自身座位并等待桌主开局；访客退出、会话失效或卸载后不能恢复原身份。

**桌主控制：** 准备阶段桌主面板实时显示入座成员与昵称，可移动到空座、与已占座玩家交换位置、移除非桌主成员腾出座位；指定起家或使用随机起家并在所有座位签到后确认座次开局。已签到玩家可以标记立直、服务端预览并提交多赢家荣和、役满与立直宣言牌荣和结果、开下一局；桌主按规则终局并确认终局成绩。不确定是否成功的结果提交以私有未备份文件保留原请求和 clientEventId：重新读取权威快照后，同局同标记版本才能原样重试；版本变化须重新预览。结果草稿按身份、牌桌和局保存，立直可用次数仅来自服务端快照。

**限制：** 原生本地离线记分与人工裁定结果 UI 不在此在线版实现。“局历史”显示最早的已结算局摘要（最多 100 局），非完整牌谱回放，也不是最近 100 局。“我的 → 关于 / 诊断”运行移动引擎的两项 golden fixture 自检。
