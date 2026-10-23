import SwiftUI

enum Brand {
    static let background = Color(red: 16 / 255, green: 28 / 255, blue: 40 / 255)
    static let panel = Color(red: 28 / 255, green: 41 / 255, blue: 66 / 255)
    static let deep = Color(red: 21 / 255, green: 43 / 255, blue: 59 / 255)
    static let gold = Color(red: 196 / 255, green: 166 / 255, blue: 106 / 255)
    static let cream = Color(red: 234 / 255, green: 229 / 255, blue: 215 / 255)
    static let ink = Color(red: 24 / 255, green: 79 / 255, blue: 70 / 255)
    static let text = Color(red: 245 / 255, green: 245 / 255, blue: 239 / 255)
    static let muted = Color(red: 174 / 255, green: 189 / 255, blue: 193 / 255)
    static let gain = Color(red: 169 / 255, green: 220 / 255, blue: 172 / 255)
    static let loss = Color(red: 243 / 255, green: 169 / 255, blue: 167 / 255)
    static let hairline = Color.white.opacity(0.13)
    static func display(_ size: CGFloat) -> Font { .custom("LXGWWenKaiScreenR", size: size, relativeTo: .title) }
}

private struct EastTile: View {
    var size: CGFloat = 48

    var body: some View {
        Text("東")
            .font(Brand.display(size * 0.58))
            .foregroundStyle(Brand.ink)
            .frame(width: size, height: size * 1.12)
            .background(Brand.cream, in: RoundedRectangle(cornerRadius: size * 0.13))
            .overlay(RoundedRectangle(cornerRadius: size * 0.13).stroke(Color(red: 187 / 255, green: 169 / 255, blue: 135 / 255), lineWidth: 2))
            .shadow(color: Brand.gold.opacity(0.65), radius: 0, y: 3)
            .accessibilityLabel("东风牌")
    }
}

private struct BrandPanel: ViewModifier {
    func body(content: Content) -> some View {
        content
            .listRowBackground(Brand.panel)
            .listRowSeparatorTint(Brand.hairline)
    }
}

private extension View {
    func brandPanel() -> some View { modifier(BrandPanel()) }
}

private func localDate(_ value: String?) -> String {
    guard let value, !value.isEmpty else { return "未提供" }
    let date = ISO8601DateFormatter.standard.date(from: value)
        ?? ISO8601DateFormatter.withFractionalSeconds.date(from: value)
    guard let date else { return "时间未提供" }
    return DateFormatter.localMinute.string(from: date)
}

private extension ISO8601DateFormatter {
    static let standard = ISO8601DateFormatter()
    static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

private extension DateFormatter {
    static let localMinute: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter
    }()
}

private func handLabel(_ kind: String) -> String {
    switch kind.lowercased() {
    case "ron": "荣和"
    case "tsumo": "自摸"
    case "draw", "ryuukyoku", "exhaustive_draw": "流局"
    case "abortive_draw": "途中流局"
    case "nagashi_mangan": "流局满贯"
    case "chombo": "犯规罚符"
    default: "其他结果"
    }
}

private func accountLabel(_ type: String) -> String {
    switch type.lowercased() {
    case "anonymous", "guest": "访客"
    case "account", "user", "email", "registered": "注册用户"
    case "admin": "管理员"
    default: "账号类型未提供"
    }
}

private func isFinished(_ status: String) -> Bool {
    ["finished", "completed", "settled"].contains(status.lowercased())
}

private func statusLabel(_ status: String) -> String {
    switch status.lowercased() {
    case "preparing", "lobby": "等待座次确认"
    case "active", "in_progress": "牌局进行中"
    case "finished", "completed", "settled": "牌局已结束"
    case "abandoned", "cancelled": "牌局已取消"
    default: "未知状态"
    }
}

private func windLabel(_ wind: String?) -> String {
    switch wind {
    case "E": "东"
    case "S": "南"
    case "W": "西"
    case "N": "北"
    default: wind ?? "?"
    }
}

private func reviewLabel(_ review: String) -> String {
    switch review.lowercased() {
    case "approved", "verified": "已审核"
    case "reviewed": "已复核"
    case "pending", "unreviewed": "待审核"
    case "draft": "草稿"
    case "rejected": "未通过"
    default: "审核状态未提供"
    }
}

private func customRuleLabel(_ key: String) -> String {
    switch key {
    case "startingPoints": "起始点数"
    case "returnPoints": "返还点数"
    case "targetPoints": "目标点数"
    case "uma", "umaTenths": "顺位马点"
    case "fixedSouth4EndPolicy", "automaticEndPolicy", "bustEndsGame": "终局条件"
    case "terminalRiichiPoolPolicy": "终局供托分配"
    case "tiedUmaPolicy": "同点顺位"
    case "notenPenaltyTotal": "流局罚符"
    case "honbaRon", "honbaPerPayer": "本场棒"
    case "multiRon", "doubleRonHonbaPolicy": "多家荣和"
    case "allowLowPointRiichi": "低点立直"
    case "nagashiManganEnabled", "nagashiCollectsRiichiPool", "nagashiDealerRepeatRequiresTenpai": "流局满贯"
    case "tsumoLoss": "三麻自摸损"
    case "kiriageMangan": "切上满贯"
    case "kazoeYakuman", "compositeYakuman", "doubleYakuman": "役满"
    default: "其他规则调整"
    }
}

private struct RuleInfo: View {
    let snapshot: [String: JSONValue]?
    let templates: [TemplateDTO]
    let versionID: String?

    var body: some View {
        let details = ruleDetails(snapshot: snapshot, template: templates.first { $0.versionId == versionID })
        VStack(alignment: .leading, spacing: 4) {
            Text("规则：\(details.title)")
            Text("来源：\(sourceLabel(details.source)) · \(reviewLabel(details.reviewStatus))")
            Text("自定义：\(details.customizedKeys.isEmpty ? "无（按模板）" : details.customizedKeys.map(customRuleLabel).joined(separator: "、"))")
        }
        .font(.subheadline)
        .foregroundStyle(Brand.muted)
    }

    private func sourceLabel(_ source: String) -> String {
        switch source {
        case "system", "global", "public": "系统模板"
        case "private", "mine": "私有模板"
        default: "来源未提供"
        }
    }

}

struct AuthScreen: View {
    @ObservedObject var session: AppSession
    let joiningByLink: Bool
    init(session: AppSession, joiningByLink: Bool = false) {
        self.session = session
        self.joiningByLink = joiningByLink
    }
    @State private var registering = false
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("ACCOUNT / 账户")
                    .font(.caption)
                    .foregroundStyle(Brand.gold)
                HStack(spacing: 12) {
                    EastTile(size: 38)
                    Text("登录一姬").font(Brand.display(32)).foregroundStyle(Brand.text)
                }
                HStack(spacing: 8) {
                    modeButton("邮箱登录", registering: false)
                    modeButton("注册账户", registering: true)
                }
                TextField("邮箱", text: $email, prompt: Text("邮箱").foregroundColor(Brand.muted))
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Brand.deep, in: RoundedRectangle(cornerRadius: 10))
                SecureField("密码", text: $password, prompt: Text("密码").foregroundColor(Brand.muted))
                    .textContentType(registering ? .newPassword : .password)
                    .padding(12)
                    .background(Brand.deep, in: RoundedRectangle(cornerRadius: 10))
                if registering {
                    TextField("昵称", text: $name, prompt: Text("昵称").foregroundColor(Brand.muted))
                        .textContentType(.nickname)
                        .padding(12)
                        .background(Brand.deep, in: RoundedRectangle(cornerRadius: 10))
                }
                if let error {
                    Text("登录或注册失败：\(error)")
                        .foregroundStyle(.red)
                        .accessibilityAddTraits(.updatesFrequently)
                }
                Button {
                    Task { await submit() }
                } label: {
                    Text(busy ? "请稍候…" : registering ? "注册并登录" : "登录")
                        .fontWeight(.semibold)
                        .foregroundStyle(Brand.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Brand.gold, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .disabled(busy || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty || (registering && name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                Button(joiningByLink ? "临时访客加入此桌" : "以在线临时访客进入") {
                    Task {
                        guard !busy else { return }
                        busy = true; error = nil
                        defer { busy = false }
                        do { try await session.signInGuest() }
                        catch { self.error = error.localizedDescription }
                    }
                }
                .disabled(busy)
                Text("访客仅能参与已批准的在线牌桌，不能开桌；本地模式不使用此身份。")
                    .font(.footnote).foregroundStyle(Brand.muted)
                Text("本地无身份模式不创建服务端访客；离线牌桌将在本地阶段提供。")
                    .font(.footnote).foregroundStyle(Brand.muted)
                if let warning = session.sessionError {
                    Text(warning).font(.footnote).foregroundStyle(.red)
                }
            }
            .textFieldStyle(.plain)
            .foregroundStyle(Brand.cream)
            .tint(Brand.gold)
            .padding(24)
            .background(Brand.panel, in: RoundedRectangle(cornerRadius: 18))
            .padding(24)
            .frame(maxWidth: 540)
            .frame(maxWidth: .infinity)
        }
        .background(Brand.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
    }

    private func modeButton(_ title: String, registering mode: Bool) -> some View {
        Button(title) { registering = mode }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(registering == mode ? Brand.background : Brand.cream)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(registering == mode ? Brand.gold : Brand.deep, in: RoundedRectangle(cornerRadius: 8))
            .buttonStyle(.plain)
            .accessibilityValue(registering == mode ? "已选中" : "未选中")
    }

    @MainActor private func submit() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await session.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password, name: registering ? name.trimmingCharacters(in: .whitespacesAndNewlines) : nil)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct MatchListScreen: View {
    @ObservedObject var session: AppSession
    let lobby: Bool
    @State private var matches: [MatchSummary]?
    @State private var templates: [TemplateDTO] = []
    @State private var loading = false
    @State private var error: String?
    @State private var showCreate = false
    @State private var createdMatchID: String?

    private var ordered: [MatchSummary] {
        (matches ?? []).sorted { lhs, rhs in
            if lobby && isFinished(lhs.status) != isFinished(rhs.status) {
                return !isFinished(lhs.status)
            }
            return lhs.createdAt > rhs.createdAt
        }
    }

    private var liveMatches: [MatchSummary] { ordered.filter { !isFinished($0.status) } }
    private var recentMatches: [MatchSummary] { lobby ? ordered.filter { isFinished($0.status) } : ordered }

    private func row(_ match: MatchSummary) -> some View {
        NavigationLink(value: match.id) {
            HStack(alignment: .top, spacing: 14) {
                EastTile(size: 30)
                VStack(alignment: .leading, spacing: 6) {
                    Text(ruleDetails(snapshot: match.rulesSnapshot, template: templates.first { $0.versionId == match.rulesetVersionId }).title)
                        .font(.headline).foregroundStyle(Brand.gold)
                    Text("\(statusLabel(match.status)) · \(match.playerCount) 麻")
                        .foregroundStyle(Brand.text)
                    Text(localDate(match.createdAt))
                        .font(.subheadline).foregroundStyle(Brand.muted).monospacedDigit()
                    Text("牌桌 \(match.id)")
                        .font(.caption2).foregroundStyle(Brand.muted).textSelection(.enabled)
                }
            }
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .brandPanel()
    }

    var body: some View {
        List {
            if lobby {
                Section {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(spacing: 10) {
                            EastTile(size: 38)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("一姬").font(Brand.display(29)).foregroundStyle(Brand.text)
                                Text("ICHIHIME").font(.caption2).tracking(3).foregroundStyle(Brand.gold)
                            }
                            Spacer()
                            EastTile(size: 66).rotationEffect(.degrees(12))
                        }
                        Text("落座，即开局。").font(Brand.display(27)).foregroundStyle(Brand.text)
                        Text("从规则到结算，给同桌每一分一个清楚的去处。")
                            .font(.subheadline).foregroundStyle(Brand.muted)
                        Button {
                            showCreate = true
                        } label: {
                            Text("开桌 ↗").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Brand.gold)
                        .foregroundStyle(Brand.background)
                        .disabled(!session.canHost)
                        Text(session.canHost ? "选择模板、调整规则、预览支付后创建" : "访客不能创建牌桌，请使用注册账户")
                            .font(.footnote).foregroundStyle(Brand.muted)
                    }
                    .padding(20)
                    .background(LinearGradient(stops: [
                        .init(color: Brand.panel, location: 0),
                        .init(color: Color(red: 27 / 255, green: 56 / 255, blue: 68 / 255), location: 0.58),
                        .init(color: Color(red: 38 / 255, green: 78 / 255, blue: 66 / 255), location: 1)
                    ], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(Brand.gold.opacity(0.7), lineWidth: 1))
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Brand.background)
                }
            }
            if loading && matches == nil {
                ProgressView("读取对局中…")
            }
            if let error {
                Section {
                    Text("加载失败：\(error)").foregroundStyle(.red)
                    Button("重试") { Task { await refresh() } }
                }
            }
            if lobby {
                Section("正在进行的牌桌") {
                    if matches != nil && liveMatches.isEmpty { Text("暂无进行中的牌桌").foregroundStyle(Brand.muted).brandPanel() }
                    ForEach(liveMatches, id: \.id) { match in row(match) }
                }
                Section("规则模板 / 桌边入口") {
                    if templates.isEmpty {
                        Text("规则模板暂未提供").foregroundStyle(Brand.muted).brandPanel()
                    }
                    ForEach(templates.prefix(3)) { template in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(template.name).font(.headline).foregroundStyle(Brand.gold)
                            Text("\(template.scope == "system" ? "系统模板" : "私有模板") · \(reviewLabel(template.reviewStatus))")
                                .font(.subheadline).foregroundStyle(Brand.muted)
                        }
                        .brandPanel()
                    }
                }
            }
            Section(lobby ? "战绩 · 最近对局" : "战绩 · 对局记录") {
                if matches != nil && recentMatches.isEmpty {
                    Text("暂无对局记录，下拉刷新试试").foregroundStyle(Brand.muted).brandPanel()
                }
                ForEach(recentMatches, id: \.id) { match in row(match) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .foregroundStyle(Brand.text)
        .navigationTitle(lobby ? "大厅" : "战绩")
        .refreshable { await refresh() }
        .task { await refresh() }
        .sheet(isPresented: $showCreate) {
            NavigationStack {
                RulesWizard(api: session.api) { id in
                    createdMatchID = id
                    showCreate = false
                    Task { await refresh() }
                }
            }
        }
        .navigationDestination(isPresented: Binding(get: { createdMatchID != nil }, set: { if !$0 { createdMatchID = nil } })) {
            if let createdMatchID { TableScreen(session: session, matchId: createdMatchID) }
        }
    }

    @MainActor private func refresh() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let updated: [MatchSummary] = try await session.api.get("/api/matches?mine=1")
            matches = updated
        } catch {
            self.error = error.localizedDescription
        }
        // Templates are optional metadata; the rule details still show their honest unknown values on failure.
        if let updated: [TemplateDTO] = try? await session.api.get("/api/rulesets/templates") {
            templates = updated
        }
    }
}

@MainActor struct TableScreen: View {
    @ObservedObject var session: AppSession
    let matchId: String
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var live: LiveUpdates
    @State private var snapshot: TableSnapshot?
    @State private var hands: [HandDTO]?
    @State private var settlement: SettlementPreview?
    @State private var templates: [TemplateDTO] = []
    @State private var loading = false
    @State private var pendingRefresh = false
    @State private var error: String?
    @State private var visible = false
    @State private var requestGeneration = 0

    init(session: AppSession, matchId: String) {
        self.session = session
        self.matchId = matchId
        _live = StateObject(wrappedValue: LiveUpdates(api: session.api))
    }

    var body: some View {
        List {
            Section {
                Label("连接状态：\(live.connection)", systemImage: live.connection == "实时同步中" ? "wifi" : "arrow.clockwise")
                    .foregroundStyle(live.connection == "实时同步中" ? Brand.gain : Brand.muted)
                    .accessibilityLabel("实时连接状态：\(live.connection)")
                if loading && snapshot == nil { ProgressView("读取对局中…") }
                if let error {
                    Text("加载失败：\(error)").foregroundStyle(.red)
                    Button("重试") { Task { await refresh() } }
                }
                if snapshot == nil && !loading && error == nil {
                    Text("暂无对局数据，下拉刷新试试")
                }
            }
            .listRowBackground(Brand.deep)
            if let snapshot {
                Section("对局信息") {
                    let details = ruleDetails(snapshot: snapshot.match.rulesSnapshot, template: templates.first { $0.versionId == snapshot.match.rulesetVersionId })
                    HStack(spacing: 12) {
                        EastTile(size: 40)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(details.title).font(Brand.display(24)).foregroundStyle(Brand.gold)
                            Text("\(statusLabel(snapshot.match.status)) · \(snapshot.match.playerCount) 麻")
                                .foregroundStyle(Brand.text)
                        }
                    }
                    Text("创建时间：\(localDate(snapshot.match.createdAt))").monospacedDigit()
                    Text("牌桌 \(snapshot.match.id)")
                        .font(.caption2).foregroundStyle(Brand.muted).textSelection(.enabled)
                    RuleInfo(snapshot: snapshot.match.rulesSnapshot, templates: templates, versionID: snapshot.match.rulesetVersionId)
                }
                .listRowBackground(Brand.panel)
                if snapshot.match.status == "preparing",
                   let ownSeat = snapshot.seats.first(where: { $0.principalId == session.principalID && $0.status == "checked_in" }) {
                    Section {
                        Text("你在 \(ownSeat.seatNo + 1) 号位，等待房主开局。")
                            .foregroundStyle(Brand.gold)
                    }
                    .listRowBackground(Brand.panel)
                }
                Section("座位与点数") {
                    ForEach(snapshot.seats.sorted { $0.seatNo < $1.seatNo }, id: \.seatNo) { seat in
                        HStack(spacing: 12) {
                            Text(windLabel(["E", "S", "W", "N"][seat.seatNo % 4]))
                                .font(.headline)
                                .foregroundStyle(Brand.ink)
                                .frame(width: 30, height: 30)
                                .background(Brand.cream, in: RoundedRectangle(cornerRadius: 6))
                            VStack(alignment: .leading, spacing: 5) {
                                Text("\(seat.seatNo + 1) 号位 · \(seat.displayName ?? "空座")")
                                    .font(.headline).foregroundStyle(Brand.text)
                                Text(seatLabel(seat.status))
                                    .font(.caption).foregroundStyle(Brand.muted)
                            }
                            Spacer(minLength: 4)
                            Text(seat.points.map { "\($0) 点" } ?? "点数未提供")
                                .font(.subheadline.weight(.semibold))
                                .monospacedDigit()
                                .foregroundStyle(Brand.ink)
                                .padding(.horizontal, 9).padding(.vertical, 7)
                                .background(Brand.cream, in: RoundedRectangle(cornerRadius: 6))
                        }
                        .padding(.vertical, 6)
                        .listRowBackground(RadialGradient(colors: [
                            Color(red: 43 / 255, green: 100 / 255, blue: 93 / 255),
                            Color(red: 36 / 255, green: 83 / 255, blue: 79 / 255),
                            Color(red: 23 / 255, green: 61 / 255, blue: 66 / 255)
                        ], center: .center, startRadius: 0, endRadius: 260))
                        .listRowSeparatorTint(Brand.gold.opacity(0.5))
                    }
                }
                Section("当前局") {
                    if let hand = snapshot.currentHand {
                        Text("\(windLabel(hand.roundWind)) \(hand.roundNumber.map { String($0) } ?? "?") 局 · 庄家 \(hand.dealerSeatNo.map { String($0 + 1) } ?? "?") 号位")
                            .monospacedDigit()
                        Text("本场棒：\(hand.honba.map { String($0) } ?? "未提供")")
                            .monospacedDigit()
                        Text("立直供托：\(hand.riichiPool.map { "\($0) 点 / \($0 / 1000) 根" } ?? "未提供")")
                            .monospacedDigit()
                        ForEach(hand.seats.sorted { $0.seatNo < $1.seatNo }, id: \.seatNo) { seat in
                            Text("\(seat.seatNo + 1) 号位 · \(seat.isRiichi ? "已立直" : "未立直") · 宣言 \(seat.riichiChangeUsage.declares)/2 取消 \(seat.riichiChangeUsage.cancels)/1")
                                .monospacedDigit()
                        }
                    } else {
                        Text("暂无进行中的牌局")
                    }
                }
                .listRowBackground(Brand.deep)
                if isFinished(snapshot.match.status) {
                    Section("最终排名") {
                        if let settlement, !settlement.standings.isEmpty {
                            ForEach(settlement.standings.sorted { $0.rank < $1.rank }, id: \.seatNo) { standing in
                                Text("第 \(standing.rank) 名 · \(standing.seatNo + 1) 号位 · \(standing.finalPoints) 点 · 总成绩 \(Double(standing.totalTenths) / 10)")
                                    .monospacedDigit()
                            }
                        } else {
                            Text("结算数据暂未提供")
                        }
                    }
                    .listRowBackground(Brand.panel)
                }
                OnlineTableActions(session: session, snapshot: snapshot) { await refresh() }
            }
            Section(hands.map { "局记录 · 最早的 \($0.count) 局（按对局顺序）" } ?? "局记录 · 读取中") {
                if let hands {
                    if hands.isEmpty { Text("暂无牌局记录") }
                    ForEach(hands.sorted { $0.handNo < $1.handNo }, id: \.handNo) { hand in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("第 \(hand.handNo) 局 · \(windLabel(hand.roundWind)) \(hand.roundNumber) 局 · \(handLabel(hand.kind))")
                                .font(.headline)
                                .monospacedDigit()
                            Text("庄家 \(hand.dealerSeatNo + 1) 号位 · 本场棒 \(hand.honba)")
                                .monospacedDigit()
                            ForEach(hand.perSeat.sorted { $0.seatNo < $1.seatNo }, id: \.seatNo) { delta in
                                Text("\(delta.seatNo + 1) 号位：\(delta.netPoints > 0 ? "+" : "")\(delta.netPoints) 点")
                                    .foregroundStyle(delta.netPoints > 0 ? Brand.gain : delta.netPoints < 0 ? Brand.loss : Brand.text)
                                    .monospacedDigit()
                            }
                        }
                        .brandPanel()
                    }
                } else {
                    Text("牌局记录暂未提供")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .foregroundStyle(Brand.text)
        .navigationTitle("牌桌")
        .refreshable { await refresh() }
        .task(id: matchId) { await refresh() }
        .onAppear {
            visible = true
            if scenePhase == .active { connect() }
        }
        .onDisappear {
            requestGeneration += 1
            visible = false
            live.stop()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active && visible {
                connect()
                Task { await refresh() }
            } else {
                live.stop()
            }
        }
        .onChange(of: session.identity) { _, identity in
            if identity == .localOnly { clearPrivateState() }
        }
    }

    private func clearPrivateState() {
        requestGeneration += 1
        snapshot = nil
        hands = nil
        settlement = nil
        templates = []
        live.stop()
    }

    private func connect() {
        live.start(matchID: matchId) { await refresh() }
    }

    @MainActor private func refresh() async {
        guard !Task.isCancelled else { return }
        guard !loading else {
            pendingRefresh = true
            return
        }
        loading = true
        error = nil
        defer {
            loading = false
            if pendingRefresh && visible && scenePhase == .active {
                pendingRefresh = false
                Task { await refresh() }
            }
        }
        let path = "/api/matches/\(matchId)"
        let current = requestGeneration
        let principalGeneration = session.generationID
        do {
            let updated: TableSnapshot = try await session.api.get(path)
            guard !Task.isCancelled, current == requestGeneration, principalGeneration == session.generationID else { return }
            snapshot = updated
            settlement = nil
            do {
                let updatedHands: [HandDTO] = try await session.api.get("\(path)/hands?limit=100")
                if current == requestGeneration, principalGeneration == session.generationID { hands = updatedHands }
            } catch {
                if current == requestGeneration { self.error = "读取局记录失败：\(error.localizedDescription)" }
            }
            if isFinished(updated.match.status) {
                do {
                    let updatedSettlement: SettlementPreview = try await session.api.get("\(path)/settlement/preview")
                    if current == requestGeneration, principalGeneration == session.generationID { settlement = updatedSettlement }
                } catch {
                    if current == requestGeneration { self.error = "读取终局成绩失败：\(error.localizedDescription)" }
                }
            }
            if let updatedTemplates: [TemplateDTO] = try? await session.api.get("/api/rulesets/templates"),
               current == requestGeneration, principalGeneration == session.generationID {
                templates = updatedTemplates
            }
        } catch {
            guard current == requestGeneration else { return }
            if let failure = error as? APIError, failure.status == 401 || failure.status == 403 {
                clearPrivateState()
            }
            self.error = error.localizedDescription
        }
    }

    private func seatLabel(_ status: String?) -> String {
        switch status {
        case "empty": "空座"
        case "assigned": "已入座"
        case "checked_in": "已签到"
        default: "状态未提供"
        }
    }
}

struct ProfileScreen: View {
    @ObservedObject var session: AppSession
    let onCheckIn: () -> Void
    @State private var loading = false
    @State private var error: String?
    @State private var diagnostic: String?
    @State private var checking = false
    @State private var signingOut = false

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    EastTile(size: 38)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("一姬").font(Brand.display(29)).foregroundStyle(Brand.text)
                        Text("ICHIHIME").font(.caption2).tracking(3).foregroundStyle(Brand.gold)
                    }
                }
                .padding(.vertical, 12)
            }
            .listRowBackground(Brand.panel)
            Section("我的账号") {
                if loading && session.profile == nil { ProgressView("读取账号中…") }
                if let error {
                    Text("加载失败：\(error)").foregroundStyle(.red)
                    Button("重试") { Task { await refresh() } }
                }
                if let principal = session.profile?.principal {
                    LabeledContent("昵称", value: principal.displayName)
                    LabeledContent("账号类型", value: accountLabel(principal.type))
                    LabeledContent("创建时间", value: localDate(principal.createdAt))
                    if session.identity == .onlineGuest {
                        Text("临时访客会话已安全保存；不能开桌，也不承诺升级账户后自动继承战绩。")
                            .font(.footnote).foregroundStyle(Brand.muted)
                    }
                }
            }
            .listRowBackground(Brand.panel)
            Section("关于 / 诊断") {
                Button(checking ? "自检中…" : "引擎自检") {
                    Task {
                        checking = true
                        diagnostic = await EngineBridgeCheck.runSample()
                        checking = false
                    }
                }
                .disabled(checking)
                if let diagnostic { Text("诊断结果：\(diagnostic)") }
            }
            .listRowBackground(Brand.panel)
            Section {
                Button("扫描二维码 / 粘贴签到链接 / 房间码", action: onCheckIn)
                Button("退出登录", role: .destructive) {
                    Task {
                        signingOut = true
                        await session.signOut()
                        signingOut = false
                    }
                }
                .disabled(signingOut)
            }
            .listRowBackground(Brand.panel)
        }
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .foregroundStyle(Brand.text)
        .navigationTitle("我的")
        .refreshable { await refresh() }
        .task { await refresh() }
    }

    @MainActor private func refresh() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            try await session.refreshProfile()
        } catch {
            self.error = error.localizedDescription
        }
    }
}


