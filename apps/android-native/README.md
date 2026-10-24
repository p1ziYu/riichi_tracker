# 一姬 Android 原生在线与本地牌桌

独立 Gradle 8.14.3 / AGP 8.13.0 / Kotlin 2.2.0 项目；通过 composite build 引入 `../../packages/mobile-engine`。applicationId 为 `com.p1ziyu.riichitracker.native`，与旧版 Capacitor 应用并存。

```sh
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64
export ANDROID_HOME=/opt/android-sdk
export QEMU_LD_PREFIX=/usr/x86_64-linux-gnu  # ARM 开发机上的 x86-64 aapt2
./gradlew testDebugUnitTest assembleDebug
```

本机是 Linux arm64 时，Robolectric 4.17 的官方 SDK 36 native runtime 仅提供 x86_64，测试需额外传入已校验的**仅用于测试**的 [arm64 loader](https://github.com/LavishSonbhurra/robolectric-native-arm64/releases/tag/v4.17-16-robolectric-13921718-2)，不放进应用依赖或仓库。下载 `robolectric-nativeruntime-linux-aarch64-4.17-16-robolectric-13921718-2.jar`，核对 SHA-256 `bc04263c07078c3c12b2b023634446c4de23a9b23d4a760fe809c9ac97a6ed85`，然后执行 `./gradlew -ProbolectricArm64Runtime=/path/to/verified.jar testDebugUnitTest assembleDebug`；x86_64 不需此参数。JDK 21 的 SDK 36 反射 export 已在 `app/build.gradle.kts` 的 test task 配置。此第三方 loader 不进入 APK。

默认 API 为 `https://riichi.p1ziyu.com`。仅在使用**独立可销毁数据库**的验证 API 时传入 `-PichihimeApiBase=http://100.64.172.17:3199`；勿把真实账户或生产数据用于测试。Debug 网络策略只允许这一台 tailnet 主机使用明文 HTTP，Release 禁止明文。

账户与临时访客令牌保存在 AndroidKeyStore AES-GCM 加密的应用私有文件，禁用备份；本地无身份模式不会创建服务端主体，亦不读取在线牌桌。重新进前台会拉在线权威牌桌快照，WebSocket 仅作刷新通知。账户可用四个服务端模板创建牌桌并编辑 23 项规则、查看 KMP 引擎的四种支付示例；模板仅是本桌调整，不保存私人模板。

**直接加入：** 房主建桌即成为成员，无需选座。已登录账户或临时访客扫描 `/checkin/*` App Link、粘贴十分钟单次加入链接，或输入六位房间码（通过 `GET /api/matches/by-code/:code` 换取令牌）。客户端以令牌读取 `GET /api/matches/:id/check-in-seats`，展示房主与成员；房主直接进入自己的牌桌，已加入者等待抽风，其他人在未满员时填写可选昵称并调用 `POST /api/matches/:id/check-ins`，仅加入成员名单，不发送座位号。满员、已开局、无效／过期凭证分别提示；房间码可重新换取令牌，过期链接须请房主重发。访客退出、会话失效或卸载后不能恢复原身份。

**房主控制：** 准备阶段显示未定座成员，满员后由房主调用 `POST /api/matches/:id/seats/draw` 抽风定座；展示东／南／西／北及座位号，东风座位为庄家。房主可调整已有座位或移除未定座成员；抽风后移除成员会重置所有座次，需要人齐后重新抽风。抽风完成（或旧牌桌所有座位已签到）后发送空对象到 `POST /api/matches/:id/seats/finalize` 开局，不再手动指定起家。已签到玩家可以标记立直、服务端预览并提交多赢家荣和、役满与立直宣言牌荣和结果、开下一局；房主按规则终局并确认终局成绩。不确定是否成功的结果提交以私有未备份文件保留原请求和 clientEventId：重新读取权威快照后，同局同标记版本才能原样重试；版本变化须重新预览。结果草稿按身份、牌桌和局保存，立直可用次数仅来自服务端快照。

**本地离线：** 欢迎页或「我的」进入本地无身份模式，四份随包模板沿用同一 23 项规则向导和四项计算示例；输入牌桌名、每座姓名（最多 40 字）和指定起家后立即开始首局。牌桌、草稿、每座每局立直预算、起家座位及完整局前状态／输入／引擎支付输出／终局成绩存于独立的 `offline_matches.sqlite`（schema v1）；规则快照保存 SHA-256 哈希，确认终局保存 KMP 完整的逐座、排名与十分位输出。结算日志与余额、供托、下局及自动终局状态在同一事务写入，历史直接显示冻结的输出。重启后可继续，整桌删除、带未结算立直标记的终局放弃均要求两次确认；已结束牌桌除终局确认外只读，已结算局不能回撤。不支持的引擎版本仅供查看，未知数据库版本或损坏会报错且不会删除原始数据。账户或访客身份与本地桌不混用，也不上传／同步。schema v1 创建列于 `LocalMatchStore.MIGRATIONS` 的 0→1 迁移；schema 提升须逐级增加非破坏性迁移，不得清空数据库。

**限制：** 人工裁定结果 UI 尚未实现。在线“局历史”显示最早的已结算局摘要（最多 100 局），非完整牌谱回放，也不是最近 100 局。“我的 → 关于 / 诊断”运行移动引擎的两项 golden fixture 自检。
