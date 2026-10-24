# 房间码 / Join code

房间码是与玩家签到链接同等级的入场凭据；房主可在准备中的牌桌向同桌展示或复制。原生客户端不要把它当作公开的房间搜索标识。

Web 牌桌在生成签到链接前单独显示房间码；生成后只在二维码邀请面板内显示一次，方便房主同时展示二维码与房间码。

## 格式与生命周期

- 恰好 6 位，字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（无 `I`、`O`、`0`、`1`）。输入时去除首尾空白并转大写；服务端对不符合格式的输入返回与未知房间码相同的 404。
- 创建对局时以加密安全随机数生成，保存在 `app.matches.join_code`；整个对局生命周期内不重新生成。
- 仅未删除且状态为 `preparing` 或 `active` 的对局需要房间码唯一。已结束、已放弃或已删除的对局释放房间码，可由新对局重新使用。
- 准备中可换取签到令牌；进行中返回 409，不能加入；结束、放弃或删除后返回 404，不再解析。已存在的旧对局由迁移补发房间码。

## 解析与签到

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

## 入桌与抽座

访客先用 `GET /api/matches/:id/check-in-seats?token=<URL-encoded token>` 查看准备中牌桌；须已有主体身份和有效、未使用的令牌，无须先加入。响应包含 `match`、`caller`（`principalId`、`isOwner`、`isMember`）、`members`（含未入座成员的 `seatNo: null`、`wind: null`）、`seating`（`drawn`、`dealerSeatNo`、`memberCount`、`seatedCount`），以及兼容旧客户端的 `seats` 数组。`GET /api/matches/:id` 也返回全部活跃参与成员，以及 `match.seatingDrawnAt`、`match.dealerSeatNo`。

`POST /api/matches/:id/check-ins` 接收 `{ "token": "...", "alias": "可选昵称" }`，仅加入房间，不占座或签到；旧客户端传入的 `seatNo` 会被忽略。返回 `{ "member": { "principalId": "...", "displayName": "..." }, "seated": false, "grantId": "..." }`。活跃成员重复加入不消耗新令牌，并返回现有授权和实际 `seated` 状态。房间满员返回 409 `match_full`，已开局返回 409 `match_already_started`，无效或过期令牌返回 400 `invalid_token` 或 `token_consumed_or_expired`。房间码可重新换取令牌。

满员后桌主调用 `POST /api/matches/:id/seats/draw`，服务端随机洗牌并选择起家，按座位顺序分配 3 人的东南西或 4 人的东南西北风，同时建立座位和签到。返回 `{ "seats": [{ "seatNo": 0, "principalId": "...", "displayName": "...", "wind": "E" }], "dealerSeatNo": 0 }`；未满员返回 409 `room_not_full`，重复抽座返回 409 `seating_already_drawn`，原有完整入座的旧房间返回 409 `seating_already_complete`。`POST /api/matches/:id/seats/claim` 已停用，返回 410 `seat_claim_retired`。

桌主准备阶段仍可调用 `POST /api/matches/:id/seats/reassign { "fromSeatNo": 1, "toSeatNo": 2 }` 移动或交换；抽座后的风位随新座位调整。`POST /api/matches/:id/seats/finalize` 在抽座后以抽出的起家开局，忽略请求体的 `dealerSeatNo`；旧房间未抽座时保留原有选起家流程。抽座后成员被移出或离开会清空全桌座位和签到；补齐人数后桌主重新抽座。

服务端仍保留旧的 `POST /join-requests` 与 `POST /join-requests/:jrId/approve` 命令，但客户端不使用，也不请求待批准列表。

