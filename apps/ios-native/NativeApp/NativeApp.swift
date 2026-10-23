import SwiftUI
import UIKit

@main
@MainActor
struct IchihimeNativeApp: App {
    @StateObject private var session = AppSession()
    @State private var checkInLink: String?
    @State private var showingCheckIn = false

    init() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(red: 16 / 255, green: 28 / 255, blue: 40 / 255, alpha: 1)
        let titleColor = UIColor(red: 245 / 255, green: 245 / 255, blue: 239 / 255, alpha: 1)
        appearance.titleTextAttributes = [.foregroundColor: titleColor]
        appearance.largeTitleTextAttributes = [.foregroundColor: titleColor]

        let navigationBar = UINavigationBar.appearance()
        navigationBar.standardAppearance = appearance
        navigationBar.scrollEdgeAppearance = appearance
        navigationBar.compactAppearance = appearance
        navigationBar.compactScrollEdgeAppearance = appearance
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if session.identity == .restoring {
                    ProgressView("恢复安全会话中…")
                } else if session.authenticated {
                    TabView {
                        NavigationStack {
                            MatchListScreen(session: session, lobby: true)
                                .navigationDestination(for: String.self) { id in
                                    TableScreen(session: session, matchId: id)
                                }
                        }
                        .tabItem { Label("大厅", systemImage: "house") }
                        NavigationStack {
                            MatchListScreen(session: session, lobby: false)
                                .navigationDestination(for: String.self) { id in
                                    TableScreen(session: session, matchId: id)
                                }
                        }
                        .tabItem { Label("战绩", systemImage: "list.bullet.rectangle") }
                        NavigationStack {
                            ProfileScreen(session: session, onCheckIn: {
                                checkInLink = nil
                                showingCheckIn = true
                            })
                        }
                        .tabItem { Label("我的", systemImage: "person.crop.circle") }
                    }
                } else {
                    NavigationStack { AuthScreen(session: session) }
                }
            }
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
                            CheckInScreen(session: session, link: checkInLink) {
                                checkInLink = nil
                            }
                        } else {
                            AuthScreen(session: session)
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
