import SwiftUI
import UIKit

// 最后一版原生 App 入口。
// Tabs：大厅（在线）/ 本地 / 我的。旧的战绩独立 tab 已并入大厅的历史区。
// 演示模式：启动参数 -UITestSeed 时在线走内存 StubFinalService（不触网），
// 管理门禁另由 -UITestAdmin 控制；正常流程的管理门禁只认 /api/me 的 isAdmin。

/// 单例服务盒：在线服务（Live 或 Stub）在一次启动内只建一次，
/// 否则大厅/牌桌/管理各拿到不同 stub 实例，内存状态会分裂。
final class ServiceBox: ObservableObject {
    let service: any FinalMatchService
    init(service: any FinalMatchService) { self.service = service }
}

@main
@MainActor
struct IchihimeNativeApp: App {
    @StateObject private var session: AppSession
    @StateObject private var serviceBox: ServiceBox
    @State private var joinLink: String?
    @State private var showingJoin = false
    @State private var selectedTab = 0
    @State private var lobbyPath: [String] = []
    @State private var localPath: [String] = []
    @StateObject private var localStore: LocalMatchStore
    @State private var useLocalDuringRestore = false

    private var stubMode: Bool {
        ProcessInfo.processInfo.arguments.contains("-UITestSeed")
    }
    private var stubAdmin: Bool {
        ProcessInfo.processInfo.arguments.contains("-UITestAdmin")
    }

    /// 演示服务只在 stub 模式下创建；正常流程走 LiveFinalService。
    private var onlineService: any FinalMatchService { serviceBox.service }
    private var adminVisible: Bool {
        stubMode ? stubAdmin : session.isAdmin
    }

    init() {
        let sess = AppSession()
        _session = StateObject(wrappedValue: sess)
        let isStub = ProcessInfo.processInfo.arguments.contains("-UITestSeed")
        let isStubAdmin = ProcessInfo.processInfo.arguments.contains("-UITestAdmin")
        let service: any FinalMatchService = isStub
            ? StubFinalService(isAdmin: isStubAdmin)
            : LiveFinalService(api: sess.api, session: sess)
        _serviceBox = StateObject(wrappedValue: ServiceBox(service: service))
        let testStore = ProcessInfo.processInfo.arguments.contains("-UITestSeed")
            ? FileManager.default.temporaryDirectory.appendingPathComponent("LocalUITour-\(UUID().uuidString).json")
            : nil
        _localStore = StateObject(wrappedValue: LocalMatchStore(location: testStore))
        let appearance = UINavigationBarAppearance()
        appearance.configureWithTransparentBackground()
        let titleColor = UIColor(red: 245 / 255, green: 245 / 255, blue: 239 / 255, alpha: 1)
        appearance.titleTextAttributes = [.foregroundColor: titleColor, .font: BrandFont.uiFont(size: 17, weight: .semibold)]
        appearance.largeTitleTextAttributes = [.foregroundColor: titleColor, .font: BrandFont.uiFont(size: 34, weight: .bold)]

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
            item.normal.titleTextAttributes = [.foregroundColor: muted, .font: BrandFont.uiFont(size: 10)]
            item.selected.iconColor = gold
            item.selected.titleTextAttributes = [.foregroundColor: gold, .font: BrandFont.uiFont(size: 10, weight: .semibold)]
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
                if session.identity == .restoring && !useLocalDuringRestore && !stubMode {
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
                } else if session.authenticated || stubMode {
                    TabView(selection: $selectedTab) {
                        NavigationStack(path: $lobbyPath) {
                            LobbyScreen(session: session, service: onlineService, isAdmin: adminVisible) { id in
                                lobbyPath.append(id)
                            }
                            .navigationDestination(for: String.self) { id in
                                OnlineTableScreen(service: onlineService, matchId: id)
                            }
                        }
                        .tabItem { Label("大厅", systemImage: "house") }
                        .tag(0)
                        NavigationStack(path: $localPath) {
                            LocalMatchListScreen(store: localStore)
                        }
                        .tabItem { Label("本地", systemImage: "square.stack.3d.up") }
                        .tag(1)
                        NavigationStack {
                            ProfileScreen(session: session, service: onlineService, isAdmin: adminVisible, isStub: stubMode) {
                                joinLink = nil
                                showingJoin = true
                            }
                        }
                        .tabItem { Label("我的", systemImage: "person.crop.circle") }
                        .tag(2)
                    }
                    .tint(Brand.gold)
                } else {
                    TabView {
                        NavigationStack(path: $localPath) {
                            LocalMatchListScreen(store: localStore)
                                .toolbar {
                                    if session.authenticated {
                                        ToolbarItem(placement: .primaryAction) {
                                            Button("返回在线") { useLocalDuringRestore = false }
                                        }
                                    }
                                }
                        }
                        .tabItem { Label("本地", systemImage: "square.stack.3d.up") }
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
            .font(BrandFont.font(.body))
            .sheet(isPresented: $showingJoin) {
                NavigationStack {
                    Group {
                        if session.authenticated || stubMode {
                            JoinScreen(service: onlineService, initialLink: joinLink) { match in
                                joinLink = nil
                                selectedTab = 0
                                lobbyPath = [match.id]
                                showingJoin = false
                            }
                        } else {
                            AuthScreen(session: session, joiningByLink: joinLink != nil)
                                .safeAreaInset(edge: .bottom) {
                                    Button("关闭加入") { showingJoin = false; joinLink = nil }
                                        .frame(maxWidth: .infinity).padding()
                                }
                        }
                    }
                    .toolbar { ToolbarItem(placement: .confirmationAction) {
                        Button("关闭") { showingJoin = false; joinLink = nil }
                    } }
                }
            }
            .onChange(of: showingJoin) { _, shown in
                if !shown { joinLink = nil }
            }
            .onChange(of: session.identity) { _, identity in
                if identity == .localOnly && !stubMode {
                    lobbyPath = []
                    selectedTab = 0
                }
            }
            .onOpenURL { url in
                if JoinDestination(url.absoluteString) != nil {
                    joinLink = url.absoluteString
                    showingJoin = true
                }
            }
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                guard let url = activity.webpageURL, JoinDestination(url.absoluteString) != nil else { return }
                showingJoin = true
                joinLink = url.absoluteString
            }
        }
    }
}
