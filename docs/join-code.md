# 房间码与入桌 / Join code & seating

房间码是与玩家签到链接同等级的入场凭据；房主可在准备中的牌桌向同桌展示或复制。原生客户端不要把它当作公开的房间搜索标识。

Web 牌桌在生成签到链接前单独显示房间码；生成后只在二维码邀请面板内显示一次，方便房主同时展示二维码与房间码。

## 座位模型（Phase 2 契约）

- **加入 = 仅成为成员。** 通过房间码或签到链接加入牌桌时，只创建成员身份，不占座、不选座、不自动分座。成员在抽风定座完成前 `seatNo` 与 `wind` 均为 `null`。
- **抽风前房间状态。** 房间/大厅展示成员列表（未定座）。已加入的客人看到等待状态（“已加入，等待房主抽风定座”风格文案）。
- **抽风定座（房主触发）。** 人数到齐（活跃参与成员数 = 牌桌人数）后，房主调用抽风接口；服务端随机洗牌并按座位顺序分风：4 人桌东南西北，3 人桌东南西，每种风恰好一次。抽到东风的成员所在座位即起家（庄家）座位，喂给既有开局逻辑。抽风结果持久化（迁移 014：`matches.seating_drawn_at`、`matches.dealer_seat_no`、`match_members.drawn_wind`），并通过 WebSocket 广播，全端实时更新。
- **房主权力。** 抽风后、开局前，房主仍可换座/调座（`seats/reassign`，风位随新座位重新计算）与移出成员（`members/:principalId/remove`）。房主开局后座位锁定。
- **抽风重置。** 抽风后若有成员被移出或自行离开，全桌抽风结果清空（座位、签到、风位、起家全部重置）；补齐人数后房主重新抽风。
- **令牌机制是实现细节。** 签到令牌/凭据的换取与核销不对用户可见；任何界面不得出现“凭据交换”步骤。

## 格式与生命周期

- 恰好 6 位，字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（无 `I`、`O`、`0`、`1`）。输入时去除首尾空白并转大写；服务端对不符合格式的输入返回与未知房间码相同的 404。
- 创建对局时以加密安全随机数生成，保存在 `app.matches.join_code`；整个对局生命周期内不重新生成。
- 仅未删除且状态为 `preparing` 或 `active` 的对局需要房间码唯一。已结束、已放弃或已删除的对局释放房间码，可由新对局重新使用。
- 准备中可换取签到令牌；进行中返回 409，不能加入；结束、放弃或删除后返回 404，不再解析。已存在的旧对局由迁移补发房间码。

## 解析与加入

`GET /api/matches/by-code/:code` 要求已有主体身份（与其他对局端点相同的登录或访客身份）。成功响应：

```json
{ "matchId": "<match UUID>", "token": "<signed check-in token>", "expiresAt": "<ISO-8601 timestamp>" }
```

令牌采用与 `POST /api/matches/:id/check-in-tokens` 相同的签名与数据库登记方式，有效期 10 分钟。持有签到链接的已登录玩家也可直接使用其中的令牌；Web 打开 `/checkin/:matchId?token=<URL-encoded token>`，原生客户端通过 Universal Links / App Links 或扫码、粘贴链接进入同一流程。令牌属于入桌凭据，不要将房间码或链接当作公开的房间搜索标识。

| 状态 | HTTP | `error` | 说明 |
| --- | --- | --- | --- |
| 无主体身份 | 401 | 现有认证错误 | 先建立身份 |
| 准备中 | 200 | — | 返回对局 ID、令牌和过期时间 |
| 进行中 | 409 | `match_already_started` | 不签发令牌 |
| 未知、格式不符、已结束、已放弃、已删除 | 404 | `join_code_not_found` | 不透露格式是否正确 |
| 触发限流 | 429 | `rate_limited` | 读取 `Retry-After` 响应头（秒）后再试 |

错误响应遵循 `{ "error": "...", "message": "..." }` 格式。每个 IP（`req.ip`）每 10 分钟最多 10 次失败的 404 查询，超限后返回 429；另有每 IP 每分钟最多 60 次总查询的硬限制。成功查询不消耗失败额度，但消耗总查询额度。限流在单个 API 进程内维护，进程重启后计数清零。

## 入桌：先看成员，再加入（不选座）

`GET /api/matches/:id/check-in-seats?token=<URL-encoded token>`：须已有主体身份和有效令牌，无须先加入牌桌。响应：

```json
{
  "match": { "id": "...", "playerCount": 4, "status": "preparing" },
  "caller": { "principalId": "...", "isOwner": false, "isMember": false },
  "members": [{ "principalId": "...", "displayName": "...", "isOwner": false, "seatNo": null, "wind": null }],
  "seating": { "drawn": false, "dealerSeatNo": null, "memberCount": 1, "seatedCount": 0 },
  "seats": []
}
```

其中 `members` 为全部活跃参与成员（房主在前），`seatNo`/`wind` 在抽风前为 `null`；`seats` 为兼容旧客户端保留的座位数组。API 座位编号从 0 开始，界面从 1 开始显示；风位 `E/S/W/N` 界面显示为东/南/西/北。

`POST /api/matches/:id/check-ins` 接收 `{ "token": "...", "alias": "可选昵称" }`，仅加入房间，不占座、不签到；旧客户端传入的 `seatNo` 会被忽略。成功返回 `{ "member": { "principalId": "...", "displayName": "..." }, "seated": false, "grantId": "..." }`。已是活跃成员时重复加入幂等：不消耗新令牌，返回现有成员与实际 `seated` 状态。房间码可重新换取令牌，失效的签到链接须重新分享。

## 抽风与开局

`POST /api/matches/:id/seats/draw`（仅房主，准备中）：服务端随机洗牌、随机选起家座位，按座位顺序分风，同时建立全部座位与签到。成功返回 `{ "seats": [{ "seatNo": 0, "principalId": "...", "displayName": "...", "wind": "E" }], "dealerSeatNo": 0 }`，并广播 `seats_drawn` 事件。

房主准备阶段仍可调用 `POST /api/matches/:id/seats/reassign { "fromSeatNo": 1, "toSeatNo": 2 }` 移动或交换；抽风后的风位随新座位调整。`POST /api/matches/:id/members/:principalId/remove {}` 移出非房主成员（抽风后移出将重置全桌抽风）；房主不可移出自己。访客的 `POST /api/matches/:id/leave` 保持不变（抽风后离开同样重置全桌抽风）。

`POST /api/matches/:id/seats/finalize`：抽风后的房间以抽出的东风座位为起家开局，请求体的 `dealerSeatNo` 会被忽略；未抽风的旧房间保留原有选起家流程（不传则随机）。

`GET /api/matches/:id` 同样返回全部活跃参与成员（`members` 数组）以及 `match.seatingDrawnAt`、`match.dealerSeatNo`。WebSocket 事件：`member_joined`（有成员加入）、`seats_drawn`（抽风完成）、既有的 `seat_claimed`/`check_in`/`seats_finalized` 不变。

## 错误码表（加入 / 抽风 / 开局）

| 场景 | HTTP | `error` |
| --- | --- | --- |
| 房间已满员（活跃成员数已达牌桌人数） | 409 | `match_full` |
| 对局已开始 / 不在准备中 | 409 | `match_already_started` |
| 签到令牌缺失 | 400 | `missing_token` |
| 签到令牌无效 | 400 | `invalid_token` |
| 签到令牌已使用或过期 | 400 | `token_consumed_or_expired` |
| 访客身份已绑定其他牌桌 | 403 | `guest_already_bound` |
| 非房主调用房主接口（抽风/调座/移出/开局） | 403 | `forbidden` |
| 房主以客人签到入口加入自己的房间 | 403 | `owner_auto_check_in`（见下：客户端应路由，永不渲染） |
| 抽风时人数未到齐 | 409 | `room_not_full` |
| 重复抽风 | 409 | `seating_already_drawn` |
| 旧房间已全部入座（无需抽风） | 409 | `seating_already_complete` |
| 旧选座接口 | 410 | `seat_claim_retired` |
| 调座来源座位为空 | 409 | `seat_empty` |
| 座位编号非法 | 400 | `invalid_seat` |
| 开局时成员未全部就座 | 400 | `incomplete_check_ins` |
| 起家座位无效（仅旧房间） | 400 | `invalid_dealer_seat` |
| 成员不存在 | 404 | `member_not_found` |
| 牌桌不存在 | 404 | `match_not_found` |
| 房间码查询限流 | 429 | `rate_limited` |

## 客户端渲染规则（硬规矩）

- **永不渲染服务端 `message` 原文。** 加入 / 签到 / 抽风 / 调座 / 移出 / 开局全流程中，客户端只按 `error` 码映射到设计好的中文文案；未映射的码统一落到通用文案（“操作失败，请稍后重试”）。
- **房主路由。** 房主打开自己房间的签到链接/路径时，各端一律路由到房主自己的房间视图，绝不进入客人加入流程。因此 `owner_auto_check_in` 的英文原文在界面上不可达（服务端保留该编码响应仅作 API 兼容）。
- **旧选座入口已退役。** `POST /api/matches/:id/seats/claim` 返回 410 `seat_claim_retired`；任何客户端不得再调用它，旧客户端收到该码时应展示更新提示而非原始消息。

## 兼容规则

- **进行中的对局不受影响。** 已开局（`active`）及之后的对局不适用新流程。
- **旧房间无需强制抽风。** 准备中、按旧流程已全员入座（每位成员已有座位与签到）的房间视为座位已确定，可直接按旧流程开局，无须抽风；对其调用抽风返回 409 `seating_already_complete`。
- **新房间必须抽风开局。** 未抽风且未全员入座的房间不能开局；开局前必须先由房主抽风定座。
- **部分入座的旧房间：** 若旧房间只有部分成员入座，新流程下新加入者仍为无座成员；房主可在人齐后抽风（抽风会重建全部座位与签到）。

服务端仍保留旧的 `POST /join-requests` 与 `POST /join-requests/:jrId/approve` 命令，但客户端不使用，也不请求待批准列表。
