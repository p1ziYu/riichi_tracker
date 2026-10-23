import SafariServices
import SwiftUI

private func isFinished(_ status: String) -> Bool {
    ["finished", "completed", "settled"].contains(status.lowercased())
}

private func statusLabel(_ status: String) -> String {
    switch status.lowercased() {
    case "preparing", "lobby": "等待座次确认"
    case "active", "in_progress": "进行中"
    case "finished", "completed", "settled": "已结束"
    default: status
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

private struct RuleInfo: View {
    let snapshot: [String: JSONValue]?
    let templates: [TemplateDTO]
    let versionID: String?

    var body: some View {
        let details = ruleDetails(snapshot: snapshot, template: templates.first { $0.versionId == versionID })
        VStack(alignment: .leading, spacing: 4) {
            Text("规则：\(details.title)")
            Text("来源：\(sourceLabel(details.source)) · 审核：\(reviewLabel(details.reviewStatus))")
            Text("自定义：\(details.customizedKeys.isEmpty ? "无（按模板）" : details.customizedKeys.joined(separator: "、"))")
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }

    private func sourceLabel(_ source: String) -> String {
        switch source {
        case "system": "系统模板"
        case "private": "私有模板"
        default: source
        }
    }

    private func reviewLabel(_ review: String) -> String {
        switch review {
        case "approved", "verified": "已审核"
        case "pending", "unreviewed": "待审核"
        case "rejected": "未通过"
        default: review
        }
    }
}

struct AuthScreen: View {
    @ObservedObject var session: AppSession
    @State private var registering = false
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(registering ? "注册账号" : "登录")
                    .font(.largeTitle.bold())
                TextField("邮箱", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("密码", text: $password)
                    .textContentType(registering ? .newPassword : .password)
                if registering {
                    TextField("昵称", text: $name)
                        .textContentType(.nickname)
                }
                if let error {
                    Text("登录或注册失败：\(error)")
                        .foregroundStyle(.red)
                        .accessibilityAddTraits(.updatesFrequently)
                }
                Button {
                    Task { await submit() }
                } label: {
                    Text(busy ? "请稍候…" : registering ? "注册" : "登录")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty || (registering && name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                Button(registering ? "已有账号？登录" : "没有账号？注册") {
                    registering.toggle()
                    error = nil
                }
                .disabled(busy)
            }
            .textFieldStyle(.roundedBorder)
            .padding()
            .frame(maxWidth: 540)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(registering ? "注册" : "登录")
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
    @State private var showCreateNotice = false

    private var ordered: [MatchSummary] {
        (matches ?? []).sorted { lhs, rhs in
            if lobby && isFinished(lhs.status) != isFinished(rhs.status) {
                return !isFinished(lhs.status)
            }
            return lhs.createdAt > rhs.createdAt
        }
    }

    var body: some View {
        List {
            if lobby {
                Section {
                    Button {
                        showCreateNotice = true
                    } label: {
                        Label("开桌", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    Text("只读体验版暂不支持创建对局")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
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
            if matches != nil && ordered.isEmpty {
                ContentUnavailableView("暂无对局", systemImage: "square.stack", description: Text("下拉刷新试试"))
            }
            ForEach(ordered, id: \.id) { match in
                NavigationLink(value: match.id) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("对局 \(match.id)")
                            .font(.headline)
                            .monospacedDigit()
                            .textSelection(.enabled)
                        Text("\(statusLabel(match.status)) · \(match.playerCount) 人")
                            .monospacedDigit()
                        Text("创建时间：\(match.createdAt)")
                            .monospacedDigit()
                        Text("更新时间：\(match.updatedAt ?? "未提供")")
                            .monospacedDigit()
                        RuleInfo(snapshot: match.rulesSnapshot, templates: templates, versionID: match.rulesetVersionId)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .navigationTitle(lobby ? "对局大厅" : "历史对局")
        .refreshable { await refresh() }
        .task { await refresh() }
        .alert("只读体验", isPresented: $showCreateNotice) {
            Button("知道了", role: .cancel) {}
        } message: {
            Text("当前试用版仅供查看；完整版本将提供创建牌桌功能。")
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

    init(session: AppSession, matchId: String) {
        self.session = session
        self.matchId = matchId
        _live = StateObject(wrappedValue: LiveUpdates(api: session.api))
    }

    var body: some View {
        List {
            Section {
                Label("连接状态：\(live.connection)", systemImage: live.connection == "实时同步中" ? "wifi" : "arrow.clockwise")
                    .foregroundStyle(live.connection == "实时同步中" ? Color.green : Color.secondary)
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
            if let snapshot {
                Section("对局信息") {
                    Text("对局 \(snapshot.match.id) · \(statusLabel(snapshot.match.status)) · \(snapshot.match.playerCount) 人")
                        .font(.headline)
                        .monospacedDigit()
                    Text("创建时间：\(snapshot.match.createdAt ?? "未提供")")
                        .monospacedDigit()
                    RuleInfo(snapshot: snapshot.match.rulesSnapshot, templates: templates, versionID: snapshot.match.rulesetVersionId)
                }
                Section("座位与点数") {
                    ForEach(snapshot.seats.sorted { $0.seatNo < $1.seatNo }, id: \.seatNo) { seat in
                        VStack(alignment: .leading) {
                            Text("\(seat.seatNo + 1) 号位 · \(seat.displayName ?? "空座")")
                                .font(.headline)
                                .monospacedDigit()
                            Text("\(seat.points.map { "\($0) 点" } ?? "点数未提供") · \(seatLabel(seat.status))")
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
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
                            Text("\(seat.seatNo + 1) 号位 · \(seat.isRiichi.map { $0 ? "已立直" : "未立直" } ?? "立直状态未知")")
                                .monospacedDigit()
                        }
                    } else {
                        Text("暂无进行中的牌局")
                    }
                }
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
                }
            }
            Section(hands.map { "局记录 · 最早的 \($0.count) 局（按对局顺序）" } ?? "局记录 · 读取中") {
                if let hands {
                    if hands.isEmpty { Text("暂无牌局记录") }
                    ForEach(hands.sorted { $0.handNo < $1.handNo }, id: \.handNo) { hand in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("第 \(hand.handNo) 局 · \(windLabel(hand.roundWind)) \(hand.roundNumber) 局 · \(hand.kind)")
                                .font(.headline)
                                .monospacedDigit()
                            Text("庄家 \(hand.dealerSeatNo + 1) 号位 · 本场棒 \(hand.honba)")
                                .monospacedDigit()
                            ForEach(hand.perSeat.sorted { $0.seatNo < $1.seatNo }, id: \.seatNo) { delta in
                                Text("\(delta.seatNo + 1) 号位：\(delta.netPoints > 0 ? "+" : "")\(delta.netPoints) 点")
                                    .monospacedDigit()
                            }
                        }
                    }
                } else {
                    Text("牌局记录暂未提供")
                }
            }
        }
        .navigationTitle("对局详情")
        .refreshable { await refresh() }
        .task(id: matchId) { await refresh() }
        .onAppear {
            visible = true
            if scenePhase == .active { connect() }
        }
        .onDisappear {
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
        do {
            let updated: TableSnapshot = try await session.api.get(path)
            guard !Task.isCancelled else { return }
            snapshot = updated
            settlement = nil
            do {
                let updatedHands: [HandDTO] = try await session.api.get("\(path)/hands?limit=100")
                if !Task.isCancelled { hands = updatedHands }
            } catch {
                self.error = "读取局记录失败：\(error.localizedDescription)"
            }
            if isFinished(updated.match.status) {
                do {
                    let updatedSettlement: SettlementPreview = try await session.api.get("\(path)/settlement/preview")
                    if !Task.isCancelled { settlement = updatedSettlement }
                } catch {
                    self.error = "读取终局成绩失败：\(error.localizedDescription)"
                }
            }
            if let updatedTemplates: [TemplateDTO] = try? await session.api.get("/api/rulesets/templates"), !Task.isCancelled {
                templates = updatedTemplates
            }
        } catch {
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
            Section("我的账号") {
                if loading && session.profile == nil { ProgressView("读取账号中…") }
                if let error {
                    Text("加载失败：\(error)").foregroundStyle(.red)
                    Button("重试") { Task { await refresh() } }
                }
                if let principal = session.profile?.principal {
                    LabeledContent("昵称", value: principal.displayName)
                    LabeledContent("账号类型", value: principal.type)
                    LabeledContent("创建时间", value: principal.createdAt ?? "未提供")
                }
            }
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
            Section {
                Button("粘贴签到链接", action: onCheckIn)
                Button("退出登录", role: .destructive) {
                    Task {
                        signingOut = true
                        await session.signOut()
                        signingOut = false
                    }
                }
                .disabled(signingOut)
            }
        }
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

private struct CheckInDestination {
    let url: URL
    let matchID: String
    let hasToken: Bool

    init?(_ input: String) {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: value),
              components.port == nil,
              components.user == nil,
              components.password == nil,
              components.fragment == nil else { return nil }
        let query = components.queryItems ?? []
        let tokens = query.filter { $0.name == "token" }
        guard tokens.count <= 1 else { return nil }
        if let token = tokens.first {
            guard let value = token.value,
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) else { return nil }
        }
        hasToken = !tokens.isEmpty

        if components.scheme?.lowercased() == "https",
           components.host?.lowercased() == "riichi.p1ziyu.com" {
            let path = components.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false)
            guard path.count == 3, path[0].isEmpty, path[1] == "checkin",
                  path[2].count == 36, UUID(uuidString: String(path[2])) != nil,
                  let url = components.url else { return nil }
            self.url = url
            matchID = String(path[2])
        } else if components.scheme?.lowercased() == "ichihime-native",
                  components.host?.lowercased() == "checkin" || components.host == nil {
            let matches = query.filter { $0.name == "matchId" }
            let path = components.percentEncodedPath
            let id: String
            if matches.count == 1,
               (components.host == nil ? path == "/checkin" : path.isEmpty || path == "/"),
               let requestedID = matches[0].value {
                id = requestedID
            } else if matches.isEmpty {
                let segments = path.split(separator: "/", omittingEmptySubsequences: false)
                if segments.count == 2, segments[0].isEmpty, components.host?.lowercased() == "checkin" {
                    id = String(segments[1])
                } else if segments.count == 3, segments[0].isEmpty, segments[1] == "checkin" {
                    id = String(segments[2])
                } else {
                    return nil
                }
            } else {
                return nil
            }
            guard id.count == 36, UUID(uuidString: id) != nil else { return nil }
            var website = URLComponents()
            website.scheme = "https"
            website.host = "riichi.p1ziyu.com"
            website.path = "/checkin/\(id)"
            website.queryItems = tokens.isEmpty ? nil : tokens
            guard let url = website.url else { return nil }
            self.url = url
            matchID = id
        } else {
            return nil
        }
    }
}

private struct CheckInBrowser: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

struct CheckInScreen: View {
    @State private var input: String
    @State private var showBrowser = false

    init(link: String?) {
        _input = State(initialValue: link ?? "")
    }

    private var destination: CheckInDestination? { CheckInDestination(input) }

    var body: some View {
        Form {
            Section("签到链接") {
                Text("当前只读体验版暂不支持签到；可打开网页版签到。")
                Text("粘贴或通过链接打开后，确认对局编号与签到凭证是否存在。")
                    .foregroundStyle(.secondary)
                SecureField("粘贴签到链接（内容隐藏）", text: $input)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !input.isEmpty {
                    if let destination {
                        Text("对局：\(destination.matchID)")
                        Text(destination.hasToken ? "链接含签到凭证；不会在页面展示" : "链接不含签到凭证")
                    } else {
                        Text("链接无效，请检查后重试").foregroundStyle(.red)
                    }
                }
                Button("打开网页版签到") { showBrowser = true }
                    .disabled(destination == nil)
            }
        }
        .navigationTitle("签到")
        .sheet(isPresented: $showBrowser) {
            if let destination { CheckInBrowser(url: destination.url) }
        }
    }
}

