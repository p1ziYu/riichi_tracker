# 一姬 / ICHIHIME · 线下日麻记分

- [完整产品计划书](docs/日麻三端产品计划书.md)：仓库研究、可调规则与个人模板、账户安全、实时共同编辑、二维码签到、三端架构、部署、排期与验收。
- [数据库设计](docs/数据库设计.md)：PostgreSQL 表关系、字段、约束、索引、计分账本、并发事务与恢复验收。
- [技术评审核对与修订记录](docs/评审意见核对与修订记录.md)：逐条说明采纳、调整和后续验证的意见。
- [视觉参考与设计方向](docs/视觉参考与设计方向.md)：雀魂官方截图与具体借鉴方式。
- [已确认需求](PRODUCT.md)：便于后续开发保持需求一致。

当前流程（Web、iOS WebView、Android WebView 共用）：必须注册或登录邮箱账户才能开桌、加入牌局。桌主选择三麻或四麻开桌，分享六位房间码或加入链接；其他已登录账户使用房间码或链接直接加入。牌桌满员时服务端随机分配座位，东座为庄家；房主录入终局得点，并可更正。匿名登录已停用，存量访客主体不能加入；现存访客行及 `guest_sessions`、`principal_links` 保留，不执行破坏性迁移。

`POST /api/matches/:id/join` 接受 `{code?,token?}`（六位房间码或有效加入链接令牌），仅允许账户主体；存量访客主体返回 403 `account_required`，Web 显示中文提示。旧的 `/check-ins` 与 `/join-requests` 路由返回 410。`https://riichi.p1ziyu.com/checkin/{matchId}?token=...` 的二维码及加入链接在已安装的应用中通过 Universal Links / App Links 打开；浏览器登录态与原生应用登录态不共享。iOS 的 `apps/web/public/.well-known/apple-app-site-association` 中 `REPLACE_TEAM_ID` 必须替换为实际 Apple Team ID 并重新部署后，Universal Links 才能生效。Android 的 `assetlinks.json` 使用本仓库生成的调试 APK 证书指纹；使用其他签名密钥发布时必须将对应指纹加入该文件并重新部署。

`apps/api` 提供 Better Auth 邮箱注册／登录、Bearer 会话、牌桌加入、终局得点与更正，以及 WebSocket 同步。`POST /api/matches` 使用 `{mode:'3p'|'4p'}` 开桌；旧规则模板选桌及逐局记分入口已停用（410）。

`apps/api` 的 API 在启动时先创建 `public` 中的 Better Auth 表，再初始化 Better Auth 的 schema 检查；业务表在 `app`，数据库迁移 001–015 须手工执行。本次账号化没有新增迁移。通过 `pnpm -r build`、`pnpm --filter @riichi/api test` 和 `pnpm --filter @riichi/web test` 校验。API E2E 只允许显式设置 `DATABASE_URL` 为独立 PostgreSQL 测试库（库名含 `test`、`e2e`、`disp` 或 `tmp`，且不能是 `riichi` 或 `apps/api/.env` 配置的库）；未设置或指向其他库时测试入口在任何数据库连接前拒绝运行。先用该库的 `DATABASE_URL` 执行 `pnpm --filter @riichi/api exec tsx src/migrate.ts`，再用相同的 URL 执行 API 测试。

账户页 `/account` 可通过 `POST /api/auth/sign-out` 退出，或在二次确认并输入当前密码后调用 `POST /api/me/delete-account`，请求体为 `{ currentPassword, confirmed: true }`。服务端使用 Better Auth 的密码校验器验证当前密码；注销将账户主体标记为 `已注销玩家` 并删除认证用户及会话，历史成员、牌局、终局得点保留。唯一在职管理员不能自助注销，须先指定另一位管理员；管理员删除玩家的接口仍禁止删除自己，`GET /api/admin/players` 只显示非已注销的用户主体，不包含访客。开发用 Vite 代理可设置 `RIICHI_API_PORT` 指向隔离 API，默认仍为 `3101`；若 Web 运行在默认 `5173` 以外的端口，隔离 API 同时设置 `RIICHI_WEB_ORIGIN` 为该 Web 的完整来源，供跨站来源检查与 Better Auth 验证使用。
每局每座立直标记最多宣言 2 次、取消 1 次（宣言→取消→再宣言后锁定）；只计未标记与已标记之间的转换，不计已标记时的类型修改。此限制固定，不随规则模板变化；需重新标记时由桌主作废并重开本局。`GET /api/matches/:id` 的 `currentHand.seats[].riichiChangeUsage` 提供已用 `{declares,cancels}`；超额更新返回 HTTP 409、`error: riichi_change_budget_exceeded`，标记及 `markRevision` 均不变。
原生应用向服务端提交 Bearer 会话令牌，明确提供 Bearer 时不会回退到 Cookie 身份；401 会清理对应的本地令牌，退出登录即使网络失败也会清理本地令牌。离线退出无法立即撤销服务器端会话，重新联网前旧令牌仍可能有效。WebSocket 在发出每条事件前重新检查会话和桌内权限，空闲连接不会主动收到撤销通知。

Web、iOS、Android 共用 `apps/web` 构建的页面。界面使用本地随包分发的 LXGW WenKai Screen（汉字）与 Nunito Variable（西文和数字）；WOFF2 字形按 `unicode-range` 分片按需加载，离线也可使用。字体许可与 webfont 版权声明位于 `apps/web/public/fonts/`。更新原生应用资源时先运行 `pnpm --filter @riichi/web build`，再运行 `pnpm --filter @riichi/web exec cap sync ios` 和 `pnpm --filter @riichi/web exec cap sync android`。Vite 直接把 `apps/web/public/.well-known/` 复制到 `dist/.well-known/`，部署时一并同步该目录。
图标与启动画面采用 LXGW WenKai Screen 的「東」字牌：米白牌面、竹绿侧边和 `#101c28` 深蓝背景。安装依赖并准备 Chromium（支持 `--headless --no-sandbox`）及 Python Pillow 后，在仓库根目录运行 `python3 scripts/generate_brand_assets.py`，渲染并保存透明／深蓝 2048px 主图到 `apps/web/branding/`，同时生成 Web 图标、iOS 1024px 图标和 2732px 启动画面、Android 密度图标／自适应前景／启动画面；预览写入 `~/riichi-briefs/stageB/icon-preview.png`。iOS 启动画面以等比完整显示居中方图、空白区域维持深蓝；资源更新后需重新构建 Web 并运行 `pnpm --filter @riichi/web exec cap sync ios` 再编译原生包。
iOS WebView 使用 `viewport-fit=cover`；原生顶部导航按 `safe-area-inset-top` 下移，状态栏区域以不透明深蓝遮住滚动内容，并在 `Info.plist` 中固定白色状态栏文字。底部玻璃导航与页面末尾按 `safe-area-inset-bottom` 留白；短页面的页脚位于首屏导航下方，滚动到末尾后可完整阅读。桌面侧栏布局不使用这些偏移。
规则调整、结算结果选择和登录切换共用 `apps/web/src/Segmented.tsx`：组内按钮等宽、同高且不换行；字号由最长选项的字符宽度和选项数量分档（16 / 14 / 13 / 11px），窄屏无需逐按钮调整。开桌规则调整在 360px 与 390px 视口下仍可完整显示「目标点或飞人」与「每位赢家各一份」。

本地牌局存于浏览器 `ichihime.localMatches.v1`；开桌规则调整直接写入该桌快照，不保存为可复用模板。损坏或未知版本会提示先备份且不会被自动覆盖（当前无旧版迁移来源）。终局会作废尚未确认的局及其立直标记；已结算的供托按终局规则处理。多标签页会刷新已保存状态，但同时写入本地存储不具事务隔离。离线模式的 Service Worker 只缓存首页离线后备页和 `/assets/` 静态资源；在线导航优先获取最新 HTML，`/api` 与 `/ws` 不进入缓存。更新旧缓存到 v3 后自动清除旧版本缓存。
本地牌局的每座使用次数随当前局一起保存；旧版 v1 记录没有次数时，已标记座位按宣言 1 次、其他座位按 0 次加载，取消次数为 0。新开局重新计数。

参考模板仍保持 `review_status=pending`：`reference_4p_competition` 按 [WRC 2025 规则](https://static1.squarespace.com/static/634a7884c297a25f06589b79/t/6834d67360e19c1da6c0d12c/1748293243651/WRC%2BRules%2B2025.pdf)结算最近者单人荣和、切上满贯、低于 1000 点立直、负分续行、南四局结束、终局供托不分配及同分均分马点；`reference_3p_common` 按 [天凤段位战说明](https://tenhou.net/man/index.html#RULE)启用双荣最近者领取本场、流局满贯，以及南三局庄家头名止局和西三局封顶。流局满贯的申报必须附上每位获胜者完整的弃牌记录（全部为未被鸣走的幺九牌）；记分系统无法从牌墙或牌谱独立验证申报是否完整、是否听牌，结算层将其视为录入者的证明并用满贯支付替代流局听牌罚点。三麻的 2000 点流局罚点、200/100 本场、无包赔自摸、40,000 点延长赛门槛等未由该段位战说明确定，属于可调整的产品候选值，不应称为天凤官方兼容配置；特殊役、符数和牌山条件仍须录入者核对。
