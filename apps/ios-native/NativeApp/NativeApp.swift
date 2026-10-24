import SwiftUI
import UIKit

@main
@MainActor
struct IchihimeNativeApp: App {
    @StateObject private var session = AppSession()
    @State private var checkInLink: String?
    @State private var showingCheckIn = false
    @State private var selectedTab = 0
    @State private var lobbyPath: [String] = []
    @State private var historyPath: [String] = []
    @State private var removalNotice = false
    @StateObject private var localStore: LocalMatchStore
    @State private var useLocalDuringRestore = false

    private func leaveRevokedTable() {
        lobbyPath = []
        historyPath = []
        selectedTab = 0
        removalNotice = true
    }

    init() {
        let testStore = ProcessInfo.processInfo.arguments.contains("-UITestSeed")
            ? FileManager.default.temporaryDirectory.appendingPathComponent("LocalUITour-\(UUID().uuidString).sqlite3")
            : nil
        _localStore = StateObject(wrappedValue: LocalMatchStore(location: testStore))
        // Nav titles: ivory text only. Do NOT give this proxy appearance an
        // opaque background: on iOS 27, configureWithOpaqueBackground() +
        // backgroundColor makes SwiftUI reserve an oversized empty bar zone
        // whose title never composites (the "dead band" defect, 2026-10-23).
        // The screens paint Brand.background themselves, so a transparent
        // bar blends seamlessly.
        let appearance = UINavigationBarAppearance()
        appearance.configureWithTransparentBackground()
        let titleColor = UIColor(red: 245 / 255, green: 245 / 255, blue: 239 / 255, alpha: 1)
        appearance.titleTextAttributes = [.foregroundColor: titleColor]
        appearance.largeTitleTextAttributes = [.foregroundColor: titleColor]

        let navigationBar = UINavigationBar.appearance()
        navigationBar.standardAppearance = appearance
        navigationBar.scrollEdgeAppearance = appearance
        navigationBar.compactAppearance = appearance
        navigationBar.compactScrollEdgeAppearance = appearance

        let tabAppearance = UITabBarAppearance()
        tabAppearance.configureWithOpaqueBackground()
        tabAppearance.backgroundColor = UIColor(Brand.background)
        let muted = UIColor(Brand.muted)
        let gold = UIColor(Brand.gold)
        func style(_ item: UITabBarItemAppearance) {
            item.normal.iconColor = muted
            item.normal.titleTextAttributes = [.foregroundColor: muted]
            item.selected.iconColor = gold
            item.selected.titleTextAttributes = [.foregroundColor: gold]
        }
        style(tabAppearance.stackedLayoutAppearance)
        style(tabAppearance.inlineLayoutAppearance)
        style(tabAppearance.compactInlineLayoutAppearance)
        UITabBar.appearance().standardAppearance = tabAppearance
        UITabBar.appearance().scrollEdgeAppearance = tabAppearance
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if session.identity == .restoring && !useLocalDuringRestore {
                    VStack(spacing: 18) {
                        ProgressView("恢复安全会话中…")
                        Button("先进入本地牌桌（保留在线凭据）") {
                            useLocalDuringRestore = true
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Brand.gold)
                        .foregroundStyle(Brand.background)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Brand.background)
                } else if session.authenticated && !useLocalDuringRestore {
                    TabView(selection: $selectedTab) {
                        NavigationStack(path: $lobbyPath) {
                            MatchListScreen(session: session, lobby: true, onRevoked: leaveRevokedTable)
                                .navigationDestination(for: String.self) { id in
                                    TableScreen(session: session, matchId: id, onRevoked: leaveRevokedTable)
                                }
                        }
                        .tabItem { Label("大厅", systemImage: "house") }
                        .tag(0)
                        NavigationStack(path: $historyPath) {
                            MatchListScreen(session: session, lobby: false, onRevoked: leaveRevokedTable)
                                .navigationDestination(for: String.self) { id in
                                    TableScreen(session: session, matchId: id, onRevoked: leaveRevokedTable)
                                }
                        }
                        .tabItem { Label("战绩", systemImage: "list.bullet.rectangle") }
                        .tag(1)
                        NavigationStack {
                            LocalMatchListScreen(store: localStore)
                        }
                        .tabItem { Label("本地", systemImage: "square.stack.3d.up") }
                        .tag(3)
                        NavigationStack {
                            ProfileScreen(session: session, onCheckIn: {
                                checkInLink = nil
                                showingCheckIn = true
                            })
                        }
                        .tabItem { Label("我的", systemImage: "person.crop.circle") }
                        .tag(2)
                    }
                    .tint(Brand.gold)
                    .alert("你已被房主移出牌桌", isPresented: $removalNotice) {
                        Button("知道了", role: .cancel) {}
                    }
                } else {
                    TabView {
                        NavigationStack {
                            LocalMatchListScreen(store: localStore)
                                .toolbar {
                                    if session.authenticated {
                                        ToolbarItem(placement: .primaryAction) {
                                            Button("返回在线") { useLocalDuringRestore = false }
                                        }
                                    }
                                }
                        }
                        .tabItem { Label("本地牌桌", systemImage: "square.stack.3d.up") }
                        if session.identity == .restoring {
                            ProgressView("在线账户恢复中；本地牌桌可以独立使用。")
                                .tabItem { Label("在线恢复中", systemImage: "person.crop.circle") }
                        } else if session.authenticated {
                            Button("在线账户已恢复，返回在线牌桌") { useLocalDuringRestore = false }
                                .tabItem { Label("在线牌桌", systemImage: "person.crop.circle") }
                        } else {
                            NavigationStack { AuthScreen(session: session) }
                                .tabItem { Label("在线登录", systemImage: "person.crop.circle") }
                        }
                    }
                    .tint(Brand.gold)
                }
            }
            .tint(Brand.gold)
            .preferredColorScheme(.dark)
            .task {
                // CI/verification hook: `simctl launch ... -EngineSelfCheck` runs the
                // bundled golden-fixture replay through the MobileEngine framework and
                // writes the summary to Documents/engine-selfcheck.txt.
                if ProcessInfo.processInfo.arguments.contains("-EngineSelfCheck") {
                    let result = await EngineBridgeCheck.runSample()
                    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                        .appendingPathComponent("engine-selfcheck.txt")
                    try? result.write(to: url, atomically: true, encoding: .utf8)
                    print("ENGINE_SELFCHECK_RESULT: \(result)")
                }
            }
            .sheet(isPresented: $showingCheckIn) {
                NavigationStack {
                    Group {
                        if session.authenticated {
                            CheckInScreen(session: session, link: checkInLink) { matchID in
                                checkInLink = nil
                                selectedTab = 0
                                lobbyPath = [matchID]
                                showingCheckIn = false
                            }
                        } else {
                            AuthScreen(session: session, joiningByLink: checkInLink != nil)
                                .safeAreaInset(edge: .bottom) {
                                    Button("关闭签到") { showingCheckIn = false; checkInLink = nil }
                                        .frame(maxWidth: .infinity).padding()
                                }
                        }
                    }
                    .toolbar { ToolbarItem(placement: .confirmationAction) {
                        Button("关闭") { showingCheckIn = false; checkInLink = nil }
                    } }
                }
            }
            .onChange(of: showingCheckIn) { _, shown in
                if !shown { checkInLink = nil }
            }
            .onChange(of: session.identity) { _, identity in
                if identity == .localOnly {
                    lobbyPath = []
                    selectedTab = 0
                }
            }
            .onOpenURL { url in
                if CheckInDestination(url.absoluteString) != nil {
                    checkInLink = url.absoluteString
                    showingCheckIn = true
                }
            }
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                guard let url = activity.webpageURL, CheckInDestination(url.absoluteString) != nil else { return }
                checkInLink = url.absoluteString
                showingCheckIn = true
            }
        }
    }
}
