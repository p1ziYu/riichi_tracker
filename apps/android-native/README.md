# 一姬 Android 原生在线牌桌

独立 Gradle 8.14.3 / AGP 8.13.0 / Kotlin 2.2.0 项目；通过 composite build 引入 `../../packages/mobile-engine`。applicationId 为 `com.p1ziyu.riichitracker.native`，与旧版 Capacitor 应用并存。

```sh
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64
export ANDROID_HOME=/opt/android-sdk
export QEMU_LD_PREFIX=/usr/x86_64-linux-gnu  # ARM 开发机上的 x86-64 aapt2
./gradlew testDebugUnitTest assembleDebug
```

默认 API 为 `https://riichi.p1ziyu.com`。仅在使用**独立可销毁数据库**的验证 API 时传入 `-PichihimeApiBase=http://100.64.172.17:3199`；勿把真实账户或生产数据用于测试。Debug 网络策略只允许这一台 tailnet 主机使用明文 HTTP，Release 禁止明文。

账户与临时访客令牌保存在 AndroidKeyStore AES-GCM 加密的应用私有文件，禁用备份；本地无身份模式不会创建服务端主体（离线记分尚未实现）。重新进前台会拉权威牌桌快照，WebSocket 仅作刷新通知。账户可用四个服务端模板创建牌桌并编辑 23 项规则、查看 KMP 引擎的四种支付示例；模板仅是本桌调整，不保存私人模板。桌主可自行选座、显示六位房间码及生成十分钟一次性签到链接／二维码、选择可选起家并确认座次；玩家可扫码、粘贴或输入六位房间码换取凭证，按服务端状态签到。已签到玩家可以标记立直、服务端预览并提交结果、开下一局；桌主按规则终局并确认终局成绩。不确定是否成功的结果提交以私有未备份文件保留原请求和 clientEventId，用户核对权威状态后可原样重试。

**限制：** 当前后端的 `POST /check-ins` 要求已由房主批准座位，客户端依照产品要求不提供批准／待批准界面，且后端无待批准列表 API；房间码和链接只能换取签到令牌，不能绕过 `check_in_not_approved`。因此新访客单靠本客户端无法完成首次入座；须另有实际批准途径（后端合同扩充），不能把扫码视为自动批准。原生本地离线记分、完整多赢家和人工裁定结果 UI 不在此在线版实现。API 历史局仅返回服务端最早 100 局以内，而非最近 100 局。“我的 → 关于 / 诊断”运行移动引擎的两项 golden fixture 自检。
