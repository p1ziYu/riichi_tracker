# 房间码 / Join code

房间码是与玩家签到链接同等级的入场凭据；房主可在准备中的牌桌向同桌展示或复制。原生客户端不要把它当作公开的房间搜索标识。

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

令牌采用与 `POST /api/matches/:id/check-in-tokens` 相同的签名与数据库登记方式，有效期 10 分钟。Web 可打开 `/checkin/:matchId?token=<URL-encoded token>`；原生客户端将 `token` 提交给 `POST /api/matches/:id/check-ins`。令牌不代替座位批准：玩家仍须走现有入座申请、房主批准与签到流程。

| 状态 | HTTP | `error` | 说明 |
| --- | --- | --- | --- |
| 无主体身份 | 401 | 现有认证错误 | 先建立身份 |
| 准备中 | 200 | — | 返回对局 ID、令牌和过期时间 |
| 进行中 | 409 | `match_already_started` | 不签发令牌 |
| 未知、格式不符、已结束、已放弃、已删除 | 404 | `join_code_not_found` | 不透露格式是否正确 |
| 触发限流 | 429 | `rate_limited` | 读取 `Retry-After` 响应头（秒）后再试 |

错误响应遵循 `{ "error": "...", "message": "..." }` 格式。每个 IP（`req.ip`）每 10 分钟最多 10 次失败的 404 查询，超限后返回 429；另有每 IP 每分钟最多 60 次总查询的硬限制。成功查询不消耗失败额度，但消耗总查询额度。限流在单个 API 进程内维护，进程重启后计数清零。
