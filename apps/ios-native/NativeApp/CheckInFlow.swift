import Foundation
import Security
import AVFoundation
import SwiftUI
import UIKit

struct CheckInDestination {
    let matchID: String
    let token: String
    init?(_ raw: String) {
        guard let components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.user == nil, components.password == nil,
              components.port == nil, components.fragment == nil else { return nil }
        let acceptedHTTPS = components.scheme?.lowercased() == "https" && components.host?.lowercased() == "riichi.p1ziyu.com"
        let acceptedScheme = components.scheme?.lowercased() == "ichihime-native" && components.host?.lowercased() == "checkin"
        guard acceptedHTTPS || acceptedScheme else { return nil }
        let path = components.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false)
        let query = components.queryItems ?? []
        let ids = query.filter { $0.name == "matchId" }
        let id: String
        if acceptedHTTPS, path.count == 3, path[0].isEmpty, path[1] == "checkin", ids.isEmpty {
            id = String(path[2])
        } else if acceptedScheme, path.count == 2, path[0].isEmpty, ids.isEmpty {
            id = String(path[1])
        } else if acceptedScheme, (components.percentEncodedPath.isEmpty || components.percentEncodedPath == "/"),
                  ids.count == 1, let specified = ids.first?.value {
            id = specified
        } else { return nil }
        guard id.count == 36, UUID(uuidString: id) != nil else { return nil }
        let tokens = query.filter { $0.name == "token" }
        guard tokens.count == 1, let value = tokens[0].value,
              !value.isEmpty, !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              query.count == (ids.isEmpty ? 1 : 2) else { return nil }
        matchID = id
        token = value
    }
}

struct JoinReceipt: Codable, Equatable {
    let v: Int
    let matchId: String
    let joinRequestId: String
    let name: String

    init?(matchId: String, joinRequestId: String, name: String) {
        guard UUID(uuidString: matchId) != nil, UUID(uuidString: joinRequestId) != nil,
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        self.v = 1
        self.matchId = matchId
        self.joinRequestId = joinRequestId
        self.name = name
    }

    init?(_ raw: String) {
        guard let data = raw.trimmingCharacters(in: .whitespacesAndNewlines).data(using: .utf8),
              let value = try? JSONDecoder().decode(JoinReceipt.self, from: data),
              value.v == 1,
              let receipt = JoinReceipt(matchId: value.matchId, joinRequestId: value.joinRequestId, name: value.name) else { return nil }
        self = receipt
    }

    var text: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return String(data: try! encoder.encode(self), encoding: .utf8)!
    }
}

enum JoinReceiptStore {
    private static let service = "\(Bundle.main.bundleIdentifier ?? "ichihime").join-receipt"
    private static func query(principal: String, match: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "\(principal):\(match)",
         kSecAttrSynchronizable as String: kCFBooleanFalse as Any]
    }
    static func save(_ receipt: JoinReceipt, principal: String) throws {
        let data = Data(receipt.text.utf8)
        try saveData(data, key: query(principal: principal, match: receipt.matchId))
        try saveData(data, key: query(principal: principal, match: "last"))
    }
    private static func saveData(_ data: Data, key: [String: Any]) throws {
        var attributes = key
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let result = SecItemAdd(attributes as CFDictionary, nil)
        if result == errSecDuplicateItem {
            guard SecItemUpdate(key as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecSuccess else {
                throw APIError(status: nil, message: "无法保存申请回执")
            }
        } else if result != errSecSuccess {
            throw APIError(status: nil, message: "无法保存申请回执")
        }
    }
    static func load(principal: String, match: String) throws -> JoinReceipt? {
        var key = query(principal: principal, match: match)
        key[kSecReturnData as String] = kCFBooleanTrue
        key[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(key as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data,
              let text = String(data: data, encoding: .utf8), let receipt = JoinReceipt(text),
              (match == "last" || receipt.matchId == match) else { throw APIError(status: nil, message: "申请回执无法读取") }
        return receipt
    }
    static func clear(principal: String, match: String) {
        _ = SecItemDelete(query(principal: principal, match: match) as CFDictionary)
        if (try? load(principal: principal, match: "last"))?.matchId == match {
            _ = SecItemDelete(query(principal: principal, match: "last") as CFDictionary)
        }
    }
}

struct JoinRequestDTO: Decodable {
    let joinRequestId: String
    let status: String
}

enum JoinFlow {
    static func canonicalCode(_ code: String) -> String? {
        let canonical = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard canonical.count == 6,
              canonical.allSatisfy({ "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains($0) }) else { return nil }
        return canonical
    }
    static func receipt(_ raw: String, forMatch matchID: String) -> JoinReceipt? {
        guard let receipt = JoinReceipt(raw), receipt.matchId == matchID else { return nil }
        return receipt
    }
    static func canResolveExpiredToken(code: String, resolvedByCode: Bool) -> Bool {
        resolvedByCode && canonicalCode(code) != nil
    }
    static func isWaiting(_ error: APIError) -> Bool {
        error.status == 403 && error.code == "forbidden"
    }
    static func tokenExpired(_ error: APIError) -> Bool {
        error.status == 400 && (error.code == "token_consumed_or_expired" || error.code == "invalid_token")
    }
    static func codeError(_ error: APIError) -> String? {
        if error.status == 404 && error.code == "join_code_not_found" {
            return "房间码不存在或已失效，请向房主核对。"
        }
        if error.status == 409 && error.code == "match_already_started" {
            return "牌桌已经开局，无法再通过房间码申请。"
        }
        if error.status == 429 {
            return "房间码查询过于频繁，请在 \(Int(error.retryAfter ?? 60)) 秒后重试。"
        }
        return nil
    }
}

final class CameraCoordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
    let session = AVCaptureSession()
    let queue = DispatchQueue(label: "ichihime.camera.capture")
    var stopped = false // Accessed only on queue.
    var onScan: ((String) -> Void)?
    private var scanned = false
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !scanned, let value = metadataObjects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first else { return }
        scanned = true
        DispatchQueue.main.async { self.onScan?(value) }
    }
}

struct CameraScanner: UIViewRepresentable {
    let onScan: (String) -> Void
    func makeCoordinator() -> CameraCoordinator { CameraCoordinator() }
    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        let coordinator = context.coordinator
        coordinator.onScan = onScan
        let layer = AVCaptureVideoPreviewLayer(session: coordinator.session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = UIScreen.main.bounds
        view.layer.addSublayer(layer)
        coordinator.queue.async {
            guard !coordinator.stopped,
                  let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  coordinator.session.canAddInput(input) else { return }
            coordinator.session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard coordinator.session.canAddOutput(output) else { return }
            coordinator.session.addOutput(output)
            output.setMetadataObjectsDelegate(coordinator, queue: .main)
            output.metadataObjectTypes = [.qr]
            if !coordinator.stopped { coordinator.session.startRunning() }
        }
        return view
    }
    func updateUIView(_ uiView: UIView, context: Context) { context.coordinator.onScan = onScan }
    static func dismantleUIView(_ view: UIView, coordinator: CameraCoordinator) {
        coordinator.queue.async {
            coordinator.stopped = true
            if coordinator.session.isRunning { coordinator.session.stopRunning() }
        }
    }
}

@MainActor
struct CheckInScreen: View {
    @ObservedObject var session: AppSession
    @State private var input: String
    @State private var code = ""
    @State private var scanning = false
    @State private var busy = false
    @State private var notice: String?
    @State private var completed = false
    @State private var resolved: JoinCodeDTO?
    @State private var receipt: JoinReceipt?
    @State private var approved = false
    @State private var recoveryAttempts = 0
    let onCompleted: (String) -> Void
    init(session: AppSession, link: String?, onCompleted: @escaping (String) -> Void = { _ in }) {
        self.session = session
        self.onCompleted = onCompleted
        _input = State(initialValue: link ?? "")
    }
    private var destination: CheckInDestination? {
        if let resolved {
            var components = URLComponents(string: "https://riichi.p1ziyu.com/checkin/\(resolved.matchId)")!
            components.queryItems = [URLQueryItem(name: "token", value: resolved.token)]
            return components.url.flatMap { CheckInDestination($0.absoluteString) }
        }
        return CheckInDestination(input)
    }
    var body: some View {
        Form {
            Section("扫码或粘贴签到链接") {
                SecureField("HTTPS 签到链接", text: $input)
                    .textContentType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onChange(of: input) { _, value in
                        resolved = nil
                        recoveryAttempts = 0
                        if !value.isEmpty { completed = false }
                    }
                Button("粘贴剪贴板中的链接") { input = UIPasteboard.general.string ?? "" }
                Button("扫描二维码") { requestCamera() }
                if let destination { Text("牌桌：\(destination.matchID) · 含签到凭证") }
                else if !input.isEmpty { Text("仅接受一姬 HTTPS 签到链接和有效 UUID").foregroundStyle(.red) }
            }
            Section("通过房间码") {
                TextField("6 位房间码", text: $code)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .onChange(of: code) { _, value in
                        recoveryAttempts = 0
                        if !value.isEmpty { completed = false }
                    }
                Button("换取签到凭证") { Task { await lookupCode() } }
                    .disabled(!session.authenticated || busy || code.isEmpty)
                Text("房间码也是入场凭据；不会替代桌主的座位批准。").font(.footnote)
            }
            if !session.authenticated {
                Section { Text("请先登录账户或选择在线临时访客，再回到此处签到。离线本地身份不能签到。") }
            }
            if let notice { Section { Text(notice).foregroundStyle(completed ? Color.green : Color.orange) } }
            if let receipt, !completed {
                Section("等待房主确认座次") {
                    Text("自述昵称（未验证）：\(receipt.name)")
                    Text("牌桌：\(receipt.matchId)")
                    Text("申请编号：\(receipt.joinRequestId)")
                        .font(.caption2).textSelection(.enabled)
                    Button("复制申请编号") { UIPasteboard.general.string = receipt.joinRequestId }
                    InvitationQR(link: receipt.text)
                    Text(receipt.text).font(.caption2).textSelection(.enabled)
                    Button("复制申请回执") { UIPasteboard.general.string = receipt.text }
                    Text("临时访客须保留当前登录会话；回执不能恢复丢失或过期的匿名身份。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("检查状态") { Task { await refreshApproval(receipt) } }.disabled(busy)
                    if approved {
                        Button("已获批准，签到") { Task { await checkIn() } }
                            .disabled(busy || destination?.matchID != receipt.matchId)
                        if destination?.matchID != receipt.matchId {
                            Text("请重新输入此桌的房间码或新的签到链接，取得有效凭证。")
                        }
                    } else {
                        Text("请向桌主展示二维码或发送回执文本。批准前无法签到；申请只会发送一次。")
                    }
                }
            } else if destination != nil && session.authenticated && !completed {
                Section {
                    Button(busy ? "请求中…" : "申请加入牌桌") { Task { await requestJoin() } }.disabled(busy)
                    Text("桌主扫描申请回执并指定空座后，才会尝试签到。").font(.footnote)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .navigationTitle("签到")
        .task(id: session.principalID) {
            guard let principal = session.principalID else { receipt = nil; return }
            do {
                if let saved = try JoinReceiptStore.load(principal: principal, match: "last"),
                   destination == nil || destination?.matchID == saved.matchId {
                    receipt = saved
                }
            } catch { notice = error.localizedDescription }
        }
        .task(id: receipt?.joinRequestId) {
            guard let receipt else { return }
            for attempt in 0..<12 {
                if Task.isCancelled || completed || approved { return }
                await refreshApproval(receipt)
                if Task.isCancelled || completed || approved { return }
                if attempt < 11 {
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }
                }
            }
            notice = "等待房主确认座次"
        }
        .sheet(isPresented: $scanning) {
            NavigationStack {
                CameraScanner { value in
                    scanning = false
                    input = value
                    if CheckInDestination(value) == nil { notice = "二维码不是有效的一姬签到链接" }
                }
                .navigationTitle("扫描签到二维码")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { scanning = false } } }
            }
        }
    }
    private func requestCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: scanning = true
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { allowed in
                DispatchQueue.main.async {
                    if allowed { scanning = true }
                    else { notice = "相机权限未授予，请粘贴签到链接或到系统设置开启相机权限" }
                }
            }
        default: notice = "相机不可用；请粘贴签到链接或到系统设置开启权限"
        }
    }
    private func lookupCode() async {
        guard !busy else { return }
        busy = true; notice = nil; resolved = nil
        defer { busy = false }
        do {
            guard let canonical = JoinFlow.canonicalCode(code) else {
                notice = "请输入 6 位房间码（不含 I、O、0、1）"
                return
            }
            let found: JoinCodeDTO = try await session.api.get("/api/matches/by-code/\(canonical)")
            guard receipt == nil || receipt?.matchId == found.matchId else {
                notice = "房间码与已保存的申请回执不属于同一牌桌"
                return
            }
            resolved = found
            if approved {
                busy = false
                await checkInAfterApproval()
            }
        } catch let failure as APIError {
            notice = JoinFlow.codeError(failure) ?? failure.localizedDescription
        } catch { notice = error.localizedDescription }
    }
    private func requestJoin() async {
        guard !busy, receipt == nil, let destination, let principal = session.principalID,
              let name = session.profile?.principal.displayName else { return }
        busy = true; notice = nil
        defer { busy = false }
        do {
            if let saved = try JoinReceiptStore.load(principal: principal, match: destination.matchID) {
                receipt = saved
                return
            }
            let response: JoinRequestDTO = try await session.api.post("/api/matches/\(destination.matchID)/join-requests")
            guard response.status == "pending",
                  let created = JoinReceipt(matchId: destination.matchID, joinRequestId: response.joinRequestId, name: name) else {
                throw APIError(status: nil, message: "服务端未返回有效申请回执")
            }
            try JoinReceiptStore.save(created, principal: principal)
            receipt = created
            notice = "等待房主确认座次"
        } catch { notice = error.localizedDescription }
    }
    private func refreshApproval(_ expected: JoinReceipt) async {
        guard receipt == expected, !busy else { return }
        do {
            let table: TableSnapshot = try await session.api.get("/api/matches/\(expected.matchId)")
            guard !Task.isCancelled, receipt == expected else { return }
            if table.seats.contains(where: { $0.principalId == session.principalID && $0.status == "checked_in" }) {
                if let principal = session.principalID { JoinReceiptStore.clear(principal: principal, match: expected.matchId) }
                receipt = nil
                input = ""; resolved = nil; completed = true
                notice = "已签到，服务器已确认座位。"
                onCompleted(expected.matchId)
                return
            }
            approved = true
            await checkInAfterApproval()
        } catch let failure as APIError where JoinFlow.isWaiting(failure) {
            notice = "等待房主确认座次"
        } catch { notice = error.localizedDescription }
    }
    private func checkInAfterApproval() async {
        guard let receipt, let destination, destination.matchID == receipt.matchId else {
            notice = "已获批准。请重新输入本桌房间码或新的签到链接。"
            return
        }
        if let resolved, let expires = InvitationClock.expiration(resolved.expiresAt), expires <= Date() {
            guard JoinFlow.canonicalCode(code) != nil else {
                self.resolved = nil
                notice = "房间码已失效。请重新输入本桌房间码或新的签到链接。"
                return
            }
            await lookupCode()
            return
        }
        await checkIn()
    }
    private func checkIn() async {
        guard !busy, approved, let receipt, let destination, destination.matchID == receipt.matchId else { return }
        busy = true; notice = nil
        defer { busy = false }
        do {
            let _: CheckInResultDTO = try await session.api.post("/api/matches/\(receipt.matchId)/check-ins", body: ["token": destination.token])
            if let principal = session.principalID { JoinReceiptStore.clear(principal: principal, match: receipt.matchId) }
            input = ""; resolved = nil; completed = true
            self.receipt = nil
            notice = "签到成功，服务器已确认座位。"
            onCompleted(receipt.matchId)
        } catch let failure as APIError where JoinFlow.tokenExpired(failure) {
            if JoinFlow.canResolveExpiredToken(code: code, resolvedByCode: resolved != nil), recoveryAttempts < 1 {
                recoveryAttempts += 1
                busy = false
                await lookupCode()
            } else {
                resolved = nil
                input = ""
                notice = "签到凭证已使用或过期。请重新输入本桌房间码，或向桌主索取新的签到链接。"
            }
        } catch let failure as APIError where failure.code == "check_in_not_approved" {
            approved = false
            notice = "座位尚未获桌主批准，请继续等待。"
        } catch let failure as APIError where failure.status == 429 {
            notice = "请求过于频繁，请在 \(Int(failure.retryAfter ?? 60)) 秒后重试"
        } catch { notice = error.localizedDescription }
    }
}
