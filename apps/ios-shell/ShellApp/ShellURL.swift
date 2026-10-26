import Foundation

enum ShellURL {
    static let defaultURL = URL(string: "https://riichi.p1ziyu.com/")!

    static func isShellHost(_ host: String?) -> Bool {
        host == "riichi.p1ziyu.com"
    }

    static func isCheckinURL(_ url: URL) -> Bool {
        url.scheme == "https" && isShellHost(url.host) && url.path.hasPrefix("/checkin/")
    }
}
