# 日麻记分产品规划

- [完整产品计划书](docs/日麻三端产品计划书.md)：仓库研究、可调规则与个人模板、账户安全、实时共同编辑、二维码签到、三端架构、部署、排期与验收。
- [数据库设计](docs/数据库设计.md)：PostgreSQL 表关系、字段、约束、索引、计分账本、并发事务与恢复验收。
- [技术评审核对与修订记录](docs/评审意见核对与修订记录.md)：逐条说明采纳、调整和后续验证的意见。
- [视觉参考与设计方向](docs/视觉参考与设计方向.md)：雀魂官方截图与具体借鉴方式。
- [已确认需求](PRODUCT.md)：便于后续开发保持需求一致。

当前流程：开桌时桌主占东家座位 → 其他参与者提交入桌申请并由桌主批准座位 → 各人用一次性令牌签到 → 全员签到后确认座次 → 同桌已签到参与者录入局结果 → 终局确认成绩。观战者和未签到的成员只读。

`apps/api` 提供 Better Auth 登录、规则模板、牌桌、签到、记分和 WebSocket 同步。私有规则版本只对其所有者开放；系统模板公开。创建牌桌的规则配置以 `startingPoints` 为起始点字段，API 兼容旧的 `startPoints` 输入，两个字段同时提供时以 `startingPoints` 为准；本场数使用 `honba.ronTotal`、`honba.tsumoPerPayer`，流局罚点总额使用 `ryuukyokuPenaltyTotal`。临时规则配置中的旧本场数和流局罚点字段仅在创建时合并，规范字段优先，保存的快照不保留别名。

`apps/web` 展示真实服务端牌桌；服务端进行中的状态为 `in_progress`，`GET /api/matches/:id` 的 `checkedIn` 是签到人数，每座的签到状态位于 `seats[].status`。牌局标记提交可带 `expectedMarkRevision`；结果提交可带 `clientEventId`，原请求重试返回相同结算，不同请求复用该 ID 返回冲突。通过 `pnpm --filter @riichi/api build`、`pnpm --filter @riichi/api test` 和 `pnpm --filter @riichi/web build` 校验。
