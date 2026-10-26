import Foundation
import Security
import Combine

struct APIError: LocalizedError {
    let status: Int?
    let code: String?
    let retryAfter: TimeInterval?
    let message: String

    init(status: Int?, code: String? = nil, retryAfter: TimeInterval? = nil, message: String) {
        self.status = status
        self.code = code
        self.retryAfter = retryAfter
        self.message = message
    }

    var errorDescription: String? { message }
}

enum APIErrorCopy {
    static func text(_ error: APIError) -> String {
        switch error.code {
        // iosfix10 B1: bad credentials must never surface the
        // server's English message ("Invalid email or password").
        case "invalid_credentials", "invalid_email_or_password", "invalid_login", "bad_credentials":
            return "邮箱或密码不正确，请重试。"
        case "match_full": return "牌桌已满员，无法加入。"
        case "match_already_started": return "牌局已开始，无法加入。"
        case "invalid_token", "token_consumed_or_expired", "missing_token":
            return "签到链接无效或已过期，请房主重新分享链接，或使用房间码。"
        case "seat_claim_retired": return "入座方式已更新，请重新加入牌桌。"
        case "owner_auto_check_in": return "你是房主，已为你打开牌桌。"
        case "guest_already_bound": return "当前访客身份已绑定其他牌桌。"
        case "room_not_full": return "人数尚未到齐，无法抽风定座。"
        case "seating_already_drawn": return "已完成抽风定座。"
        case "seating_already_complete": return "座位已确定，可直接开局。"
        case "forbidden": return "只有房主可以执行此操作。"
        case "member_not_found": return "成员已不在牌桌中。"
        case "seat_empty": return "该座位暂无成员。"
        case "invalid_seat": return "座位选择无效。"
        case "rate_limited": return "尝试过于频繁，请稍后再试。"
        case "join_code_not_found": return "房间码不正确，或牌桌已结束。"
        case "incomplete_check_ins": return "成员尚未全部就座，无法开局。"
        case "match_not_found": return "牌桌不存在或已被删除。"
        case "match_not_deletable": return "这张牌桌已抽风定座或已开始，无法彻底删除。"
        case "owner_must_delete": return "房主不能退出牌桌，请使用删除。"
        default:
            // iosfix10 B1: better-auth login failures arrive as 401
            // with no machine code and the English message, so sniff
            // that message here instead of leaking it to the UI.
            if error.status == 401, error.message.localizedCaseInsensitiveContains("invalid email or password") {
                return "邮箱或密码不正确，请重试。"
            }
            return "操作失败，请稍后重试。"
        }
    }
}

private struct ErrorResponse: Decodable {
    let message: String?
    let error: String?
}

private struct AuthPayload: Encodable {
    let email: String
    let password: String
    let name: String?

    private enum CodingKeys: String, CodingKey { case email, password, name }

    func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: CodingKeys.self)
        try fields.encode(email, forKey: .email)
        try fields.encode(password, forKey: .password)
        try fields.encodeIfPresent(name, forKey: .name)
    }
}

private struct EncodableBody: Encodable {
    let value: any Encodable
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

private struct EmptyBody: Encodable {}

private final class TokenStore {
    private let service = "\(Bundle.main.bundleIdentifier ?? "riichi.p1ziyu.com").auth-token\(ProcessInfo.processInfo.arguments.contains("-UITestSeed") ? ".uitest" : "")"
    private let account = "session"

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: kCFBooleanFalse as Any]
    }

    func load() throws -> String? {
        var request = query
        request[kSecReturnData as String] = kCFBooleanTrue
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let token = String(data: data, encoding: .utf8), !token.isEmpty else {
            // Invalidated or unreadable credentials must never restore an authenticated session.
            _ = SecItemDelete(query as CFDictionary)
            throw APIError(status: nil, message: "登录凭据无法读取，请重新登录")
        }
        return token
    }

    func save(_ token: String) throws {
        guard !token.isEmpty else { throw APIError(status: nil, message: "服务端未返回登录凭据") }
        var attributes = query
        attributes[kSecValueData as String] = Data(token.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let changes: [String: Any] = [kSecValueData as String: Data(token.utf8),
                                           kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
            guard SecItemUpdate(query as CFDictionary, changes as CFDictionary) == errSecSuccess else {
                throw APIError(status: nil, message: "无法保存登录凭据，请重新登录")
            }
        } else if status != errSecSuccess {
            throw APIError(status: nil, message: "无法保存登录凭据，请重新登录")
        }
    }

    func clear() {
        _ = SecItemDelete(query as CFDictionary)
    }
}
private final class SameOriginRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        guard let original = task.originalRequest?.url, let next = request.url,
              original.scheme == next.scheme, original.host == next.host,
              original.port == next.port else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }
}


@MainActor
final class APIClient {
    private let store = TokenStore()
    private let origin: URLComponents?
    private let transport: URLSession
    private let bearerOverride: String?
    var onSessionExpired: (() -> Void)?

    init(transport: URLSession? = nil, bearerOverride: String? = nil) {
        self.transport = transport ?? URLSession(configuration: .default, delegate: SameOriginRedirects(), delegateQueue: nil)
        self.bearerOverride = bearerOverride
        let configured = (Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let value = configured.flatMap { $0.isEmpty ? nil : $0 } ?? "https://riichi.p1ziyu.com"
        var components = URLComponents(string: value)
        if let scheme = components?.scheme?.lowercased(), ["http", "https"].contains(scheme),
           components?.host != nil, components?.user == nil, components?.password == nil,
           components?.query == nil, components?.fragment == nil,
           components?.path.isEmpty == true || components?.path == "/" {
            components?.scheme = scheme
            components?.path = ""
            origin = components
        } else {
            origin = nil
        }
        // UI tours never read or revoke the owner's real Keychain session.
        if ProcessInfo.processInfo.arguments.contains("-UITestSeed") { store.clear() }
    }

    var hasStoredToken: Bool {
        (try? store.load()) != nil
    }

    func storedToken() throws -> String? { try store.load() }

    func get<T: Decodable>(_ path: String) async throws -> T {
        let (data, _) = try await request(path, method: "GET")
        return try JSONDecoder().decode(T.self, from: data)
    }

    func post<T: Decodable>(_ path: String, body: (any Encodable)? = nil) async throws -> T {
        let (data, _) = try await request(path, method: "POST", body: body ?? EmptyBody())
        return try JSONDecoder().decode(T.self, from: data)
    }
    func postRaw<T: Decodable>(_ path: String, data: Data) async throws -> T {
        let (response, _) = try await request(path, method: "POST", encodedBody: data)
        return try JSONDecoder().decode(T.self, from: response)
    }

    func signIn(email: String, password: String, name: String?) async throws {
        let path = name == nil ? "/api/auth/sign-in/email" : "/api/auth/sign-up/email"
        _ = try await request(path, method: "POST", body: AuthPayload(email: email, password: password, name: name))
    }

    func signInGuest() async throws {
        _ = try await request("/api/auth/sign-in/anonymous", method: "POST", body: EmptyBody())
    }

    // iosfix6 item 5: owner-only DELETE for preparing rooms; /hide for
    // everyone else and every other state; /unhide backs the undo banner.
    // Responses are decoded only for status — callers map APIError.code
    // through APIErrorCopy and never render the raw server message.
    func deleteMatch(_ id: String) async throws {
        _ = try await request("/api/matches/\(id)", method: "DELETE")
    }

    func hideMatch(_ id: String) async throws {
        _ = try await request("/api/matches/\(id)/hide", method: "POST", body: EmptyBody())
    }

    func unhideMatch(_ id: String) async throws {
        _ = try await request("/api/matches/\(id)/unhide", method: "POST", body: EmptyBody())
    }

    func signOut() async -> Bool {
        let oldToken = try? store.load()
        // Forget locally BEFORE any network suspension, including offline sign-out.
        store.clear()
        guard let oldToken else { return true }
        guard let baseURL = origin?.url,
              let url = URL(string: "/api/auth/sign-out", relativeTo: baseURL)?.absoluteURL else { return false }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("https://riichi.p1ziyu.com", forHTTPHeaderField: "Origin")
        request.setValue("Bearer \(oldToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        do {
            let (_, response) = try await transport.data(for: request)
            return (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
        } catch { return false }
    }

    func webSocketURL(matchID: String, ticket: String) throws -> URL {
        guard var components = origin else {
            throw APIError(status: nil, message: "APIBaseURL 配置无效")
        }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ws/matches/\(matchID)"
        components.queryItems = [URLQueryItem(name: "ticket", value: ticket)]
        guard let url = components.url else {
            throw APIError(status: nil, message: "实时连接地址无效")
        }
        return url
    }

    private func request(_ path: String, method: String, body: (any Encodable)? = nil, encodedBody: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        guard path.hasPrefix("/"), !path.hasPrefix("//"),
              let base = origin, let baseURL = base.url,
              let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
              url.host == baseURL.host, url.scheme == baseURL.scheme else {
            throw APIError(status: nil, message: "请求地址配置无效")
        }
        let isEmailAuth = path == "/api/auth/sign-in/email" || path == "/api/auth/sign-up/email"
        let isAuth = isEmailAuth || path == "/api/auth/sign-in/anonymous"
        let token: String?
        if isAuth {
            // A damaged saved credential must not prevent an explicit fresh login.
            token = nil
        } else {
            do { token = try bearerOverride ?? store.load() }
            catch {
                onSessionExpired?()
                throw error
            }
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        // Better Auth requires a trusted Origin on native sign-in; bearer match requests do not.
        if isAuth { request.setValue("https://riichi.p1ziyu.com", forHTTPHeaderField: "Origin") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let encodedBody {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = encodedBody
        } else if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            // Canonical key order: Swift's JSONEncoder does not guarantee struct key
            // order across processes when encoding through an existential, which
            // made repeat-request byte equality nondeterministic. Sorted keys keep
            // every API body byte-stable (servers parse objects unordered).
            let bodyEncoder = JSONEncoder()
            bodyEncoder.outputFormatting = [.sortedKeys]
            request.httpBody = try bodyEncoder.encode(EncodableBody(value: body))
        }
        let (data, response) = try await transport.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw APIError(status: nil, message: "服务器响应无效")
        }
        guard (200..<300).contains(response.statusCode) else {
            if response.statusCode == 401, bearerOverride == nil, let token, (try? store.load()) == token {
                store.clear()
                onSessionExpired?()
            }
            let detail = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            let text = String(data: data, encoding: .utf8)
            throw APIError(status: response.statusCode, code: detail?.error,
                           retryAfter: response.value(forHTTPHeaderField: "Retry-After").flatMap { TimeInterval($0) },
                           message: detail?.message ?? detail?.error ?? (text?.isEmpty == false ? text! : "请求失败 (\(response.statusCode))"))
        }
        if isAuth {
            let fallback = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["token"] as? String
            let bearer = response.value(forHTTPHeaderField: "set-auth-token") ?? fallback
            guard let bearer, !bearer.isEmpty else {
                throw APIError(status: nil, message: "服务端未返回登录凭据")
            }
            do { try store.save(bearer) }
            catch {
                store.clear()
                throw error
            }
        }
        return (data, response)
    }
}

@MainActor
final class AppSession: ObservableObject {
    enum Identity { case restoring, account, onlineGuest, localOnly }
    @Published private(set) var identity: Identity = .restoring
    @Published private(set) var profile: MeResponse?
    @Published private(set) var sessionError: String?
    let api: APIClient
    private var generation = 0

    init() {
        api = APIClient()
        api.onSessionExpired = { [weak self] in
            self?.generation += 1
            self?.identity = .localOnly
            self?.profile = nil
            self?.sessionError = "会话已失效，请重新认证"
        }
        Task { await restore() }
    }

    var authenticated: Bool { identity == .account || identity == .onlineGuest }
    var canHost: Bool { identity == .account }
    var principalID: String? { profile?.principal.id }
    var generationID: Int { generation }

    func restore() async {
        do {
            guard try api.storedToken() != nil else { identity = .localOnly; return }
            try await refreshProfile()
        } catch let error as APIError where error.status == nil {
            // Keychain access failures must not silently become a fresh local identity.
            identity = .localOnly
            sessionError = error.localizedDescription
        } catch {
            identity = .localOnly
            sessionError = error.localizedDescription
        }
    }

    func signIn(email: String, password: String, name: String? = nil) async throws {
        try await api.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                             password: password, name: name?.trimmingCharacters(in: .whitespacesAndNewlines))
        generation += 1
        try await refreshProfile()
    }

    func signInGuest() async throws {
        try await api.signInGuest()
        generation += 1
        try await refreshProfile()
    }

    func signOut() async {
        generation += 1
        let current = generation
        let oldPrincipal = principalID
        identity = .localOnly
        profile = nil
        if let oldPrincipal {
            do { try OnlinePrivateStore.live.clearPrincipal(oldPrincipal) }
            catch { sessionError = "本机在线草稿清理失败：\(error.localizedDescription)" }
        }
        let revoked = await api.signOut()
        if !revoked, generation == current {
            sessionError = "本机凭据已清除；网络请求失败，服务器会话尚未确认撤销。"
        }
    }

    func refreshProfile() async throws {
        let current = generation
        let response: MeResponse = try await api.get("/api/me")
        guard current == generation else { return }
        profile = response
        identity = response.principal.type == "anonymous" || response.principal.type == "guest" ? .onlineGuest : .account
        sessionError = nil
    }
}
