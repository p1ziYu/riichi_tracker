# 一姬 Android P1（只读体验版）

独立 Gradle 8.14.3 / AGP 8.13.0 / Kotlin 2.2.0 项目；通过 composite build 引入 `../../packages/mobile-engine`。applicationId 为 `com.p1ziyu.riichitracker.native`，与旧版 Capacitor 应用并存。

```sh
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64
export ANDROID_HOME=/opt/android-sdk
export QEMU_LD_PREFIX=/usr/x86_64-linux-gnu  # ARM 开发机上的 x86-64 aapt2
./gradlew testDebugUnitTest assembleDebug
```

默认 API 为 `https://riichi.p1ziyu.com`。仅在使用**独立可销毁数据库**的验证 API 时传入 `-PichihimeApiBase=http://100.64.172.17:3199`；勿把真实账户或生产数据用于测试。Debug 网络策略只允许这一台 tailnet 主机使用明文 HTTP，Release 禁止明文。

登录令牌只存储于 AndroidKeyStore AES-GCM 加密的应用私有文件，禁用备份；WebSocket 仅作刷新信号，数据始终从 REST 重新获取。对局创建、签到、标记和结算写入均不可用；签到链接只交给外部浏览器打开。历史局数为服务端返回的**最早** 100 局以内，并非最近 100 局。API 当前的对局列表不返回更新时间，界面明确标示“未提供”。“我的 → 关于 / 诊断”运行移动引擎的两项 golden fixture 自检。
