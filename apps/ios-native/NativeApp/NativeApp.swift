import SwiftUI

@main
@MainActor
struct IchihimeNativeApp: App {
    @StateObject private var session = AppSession()
    @State private var checkInLink: String?
    @State private var showingCheckIn = false

    var body: some Scene {
        WindowGroup {
            Group {
                if session.authenticated {
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
                    CheckInScreen(link: checkInLink)
                        .toolbar { ToolbarItem(placement: .confirmationAction) {
                            Button("关闭") { showingCheckIn = false }
                        } }
                }
            }
            .onOpenURL { url in
                guard url.scheme?.lowercased() == "ichihime-native",
                      url.host?.lowercased() == "checkin" else { return }
                checkInLink = url.absoluteString
                showingCheckIn = true
            }
        }
    }
}
