# 一姬 / ICHIHIME · 线下日麻记分

- [完整产品计划书](docs/日麻三端产品计划书.md)：仓库研究、可调规则与个人模板、账户安全、实时共同编辑、二维码签到、三端架构、部署、排期与验收。
- [数据库设计](docs/数据库设计.md)：PostgreSQL 表关系、字段、约束、索引、计分账本、并发事务与恢复验收。
- [技术评审核对与修订记录](docs/评审意见核对与修订记录.md)：逐条说明采纳、调整和后续验证的意见。
- [视觉参考与设计方向](docs/视觉参考与设计方向.md)：雀魂官方截图与具体借鉴方式。
- [已确认需求](PRODUCT.md)：便于后续开发保持需求一致。

当前流程：开桌时桌主占东家座位 → 其他参与者提交入桌申请并由桌主批准座位 → 各人用一次性令牌签到 → 全员签到后确认座次 → 同桌已签到参与者录入局结果 → 终局确认成绩。观战者和未签到的成员只读。
当前前端仅展示已获批准成员的一次性二维码签到；尚未提供桌主查看、批准入桌申请的界面。未获批准的扫码者无法直接入桌。二维码的 HTTPS 链接会在系统浏览器打开；原生应用尚未配置 Universal Links / App Links，浏览器登录态与原生应用登录态不共享。

`apps/api` 提供 Better Auth 登录、规则模板、牌桌、签到、记分和 WebSocket 同步。私有规则版本只对其所有者开放；系统模板公开。创建牌桌的规则配置以 `startingPoints` 为起始点字段，API 兼容旧的 `startPoints` 输入，两个字段同时提供时以 `startingPoints` 为准；本场数使用 `honba.ronTotal`、`honba.tsumoPerPayer`，流局罚点总额使用 `ryuukyokuPenaltyTotal`。临时规则配置中的旧本场数和流局罚点字段仅在创建时合并，规范字段优先，保存的快照不保留别名。

`apps/web` 展示真实服务端牌桌；服务端进行中的状态为 `in_progress`，`GET /api/matches/:id` 的 `checkedIn` 是签到人数，每座的签到状态位于 `seats[].status`。牌局标记提交可带 `expectedMarkRevision`；结果提交可带 `clientEventId`，原请求重试返回相同结算，不同请求复用该 ID 返回冲突。通过 `pnpm --filter @riichi/api build`、`pnpm --filter @riichi/api test` 和 `pnpm --filter @riichi/web build` 校验。
原生应用向服务端提交 Bearer 会话令牌，明确提供 Bearer 时不会回退到 Cookie 身份；401 会清理对应的本地令牌，退出登录即使网络失败也会清理本地令牌。离线退出无法立即撤销服务器端会话，重新联网前旧令牌仍可能有效。WebSocket 在发出每条事件前重新检查会话和桌内权限，空闲连接不会主动收到撤销通知。

Web、iOS、Android 共用 `apps/web` 构建的页面。界面使用本地随包分发的 LXGW WenKai Screen（汉字）与 Nunito Variable（西文和数字）；WOFF2 字形按 `unicode-range` 分片按需加载，分数使用等宽数字，离线也可使用。字体许可与 webfont 版权声明位于 `apps/web/public/fonts/`。更新原生应用资源时先运行 `pnpm --filter @riichi/web build`，再运行 `pnpm --filter @riichi/web exec cap copy ios` 和 `pnpm --filter @riichi/web exec cap copy android`。
