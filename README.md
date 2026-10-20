# 一姬 / ICHIHIME · 线下日麻记分

- [完整产品计划书](docs/日麻三端产品计划书.md)：仓库研究、可调规则与个人模板、账户安全、实时共同编辑、二维码签到、三端架构、部署、排期与验收。
- [数据库设计](docs/数据库设计.md)：PostgreSQL 表关系、字段、约束、索引、计分账本、并发事务与恢复验收。
- [技术评审核对与修订记录](docs/评审意见核对与修订记录.md)：逐条说明采纳、调整和后续验证的意见。
- [视觉参考与设计方向](docs/视觉参考与设计方向.md)：雀魂官方截图与具体借鉴方式。
- [已确认需求](PRODUCT.md)：便于后续开发保持需求一致。

当前流程：桌主开桌后作为参赛成员自行选座，确认座位即自动到场、免令牌签到；其他参与者提交入桌申请并由桌主批准座位，再用一次性令牌签到；全员到场后桌主可指定起家（东家）或由服务端随机选择，随后确认座次、录入局结果、终局确认成绩。观战者和未签到的成员只读。
当前前端仅展示已获批准成员的一次性二维码签到；尚未提供桌主查看、批准入桌申请的界面。未获批准的扫码者无法直接入桌。二维码的 HTTPS 链接会在系统浏览器打开；原生应用尚未配置 Universal Links / App Links，浏览器登录态与原生应用登录态不共享。

`apps/api` 提供 Better Auth 登录、只读规则模板、牌桌、签到、记分和 WebSocket 同步。创建牌桌时可在选定模板版本上提交 `rulesOverride`（仅本桌生效）；服务端验证规则、生成归属桌主的不可变临时规则版本并绑定快照与哈希，其他账户不能引用该版本。未调整时直接使用模板版本；原有 `config` 创建入口仍兼容旧的 `startPoints`、本场及流局罚点别名。

`apps/web` 展示真实服务端牌桌；服务端进行中的状态为 `in_progress`，`GET /api/matches/:id` 的 `checkedIn` 是签到人数，每座的签到状态位于 `seats[].status`。牌局标记提交可带 `expectedMarkRevision`；结果提交可带 `clientEventId`，原请求重试返回相同结算，不同请求复用该 ID 返回冲突。通过 `pnpm --filter @riichi/api build`、`pnpm --filter @riichi/api test` 和 `pnpm --filter @riichi/web build` 校验。
每局每座立直标记最多宣言 2 次、取消 1 次（宣言→取消→再宣言后锁定）；只计未标记与已标记之间的转换，不计已标记时的类型修改。此限制固定，不随规则模板变化；需重新标记时由桌主作废并重开本局。`GET /api/matches/:id` 的 `currentHand.seats[].riichiChangeUsage` 提供已用 `{declares,cancels}`；超额更新返回 HTTP 409、`error: riichi_change_budget_exceeded`，标记及 `markRevision` 均不变。
原生应用向服务端提交 Bearer 会话令牌，明确提供 Bearer 时不会回退到 Cookie 身份；401 会清理对应的本地令牌，退出登录即使网络失败也会清理本地令牌。离线退出无法立即撤销服务器端会话，重新联网前旧令牌仍可能有效。WebSocket 在发出每条事件前重新检查会话和桌内权限，空闲连接不会主动收到撤销通知。

Web、iOS、Android 共用 `apps/web` 构建的页面。界面使用本地随包分发的 LXGW WenKai Screen（汉字）与 Nunito Variable（西文和数字）；WOFF2 字形按 `unicode-range` 分片按需加载，分数使用等宽数字，离线也可使用。字体许可与 webfont 版权声明位于 `apps/web/public/fonts/`。更新原生应用资源时先运行 `pnpm --filter @riichi/web build`，再运行 `pnpm --filter @riichi/web exec cap copy ios` 和 `pnpm --filter @riichi/web exec cap copy android`。
图标与启动画面采用 LXGW WenKai Screen 的「東」字牌：米白牌面、竹绿侧边和 `#101c28` 深蓝背景。安装依赖并准备 Chromium（支持 `--headless --no-sandbox`）及 Python Pillow 后，在仓库根目录运行 `python3 scripts/generate_brand_assets.py`，渲染并保存透明／深蓝 2048px 主图到 `apps/web/branding/`，同时生成 Web 图标、iOS 1024px 图标和 2732px 启动画面、Android 密度图标／自适应前景／启动画面；预览写入 `~/riichi-briefs/stageB/icon-preview.png`。iOS 启动画面以等比完整显示居中方图、空白区域维持深蓝；资源更新后需重新构建 Web 并运行 `pnpm --filter @riichi/web exec cap sync ios` 再编译原生包。
iOS WebView 使用 `viewport-fit=cover`；原生顶部导航按 `safe-area-inset-top` 下移，状态栏区域以不透明深蓝遮住滚动内容，并在 `Info.plist` 中固定白色状态栏文字。底部玻璃导航与页面末尾按 `safe-area-inset-bottom` 留白；短页面的页脚位于首屏导航下方，滚动到末尾后可完整阅读。桌面侧栏布局不使用这些偏移。
规则调整、结算结果选择和登录切换共用 `apps/web/src/Segmented.tsx`：组内按钮等宽、同高且不换行；字号由最长选项的字符宽度和选项数量分档（16 / 14 / 13 / 11px），窄屏无需逐按钮调整。开桌规则调整在 360px 与 390px 视口下仍可完整显示「目标点或飞人」与「每位赢家各一份」。

本地牌局存于浏览器 `ichihime.localMatches.v1`；开桌规则调整直接写入该桌快照，不保存为可复用模板。损坏或未知版本会提示先备份且不会被自动覆盖（当前无旧版迁移来源）。终局会作废尚未确认的局及其立直标记；已结算的供托按终局规则处理。多标签页会刷新已保存状态，但同时写入本地存储不具事务隔离。离线模式的 Service Worker 只缓存首页离线后备页和 `/assets/` 静态资源；在线导航优先获取最新 HTML，`/api` 与 `/ws` 不进入缓存。更新旧缓存到 v3 后自动清除旧版本缓存。
本地牌局的每座使用次数随当前局一起保存；旧版 v1 记录没有次数时，已标记座位按宣言 1 次、其他座位按 0 次加载，取消次数为 0。新开局重新计数。

参考模板仍保持 `review_status=pending`：`reference_4p_competition` 按 [WRC 2025 规则](https://static1.squarespace.com/static/634a7884c297a25f06589b79/t/6834d67360e19c1da6c0d12c/1748293243651/WRC%2BRules%2B2025.pdf)结算最近者单人荣和、切上满贯、低于 1000 点立直、负分续行、南四局结束、终局供托不分配及同分均分马点；`reference_3p_common` 按 [天凤段位战说明](https://tenhou.net/man/index.html#RULE)启用双荣最近者领取本场、流局满贯，以及南三局庄家头名止局和西三局封顶。流局满贯的申报必须附上每位获胜者完整的弃牌记录（全部为未被鸣走的幺九牌）；记分系统无法从牌墙或牌谱独立验证申报是否完整、是否听牌，结算层将其视为录入者的证明并用满贯支付替代流局听牌罚点。三麻的 2000 点流局罚点、200/100 本场、无包赔自摸、40,000 点延长赛门槛等未由该段位战说明确定，属于可调整的产品候选值，不应称为天凤官方兼容配置；特殊役、符数和牌山条件仍须录入者核对。
