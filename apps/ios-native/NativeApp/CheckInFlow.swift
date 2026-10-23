import Foundation
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

struct CheckInCommand: Encodable {
    let token: String
    let seatNo: Int?
    let alias: String?

    private enum CodingKeys: String, CodingKey { case token, seatNo, alias }

    func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: CodingKeys.self)
        try fields.encode(token, forKey: .token)
        try fields.encodeIfPresent(seatNo, forKey: .seatNo)
        try fields.encodeIfPresent(alias, forKey: .alias)
    }
}

@MainActor
extension APIClient {
    func checkInSeats(matchID: String, token: String) async throws -> CheckInSeatsDTO {
        var url = URLComponents()
        url.path = "/api/matches/\(matchID)/check-in-seats"
        url.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let path = url.string else { throw APIError(status: nil, message: "签到链接无效") }
        return try await get(path)
    }

    func checkIn(matchID: String, command: CheckInCommand) async throws -> CheckInResultDTO {
        try await post("/api/matches/\(matchID)/check-ins", body: command)
    }
}

enum JoinFlow {
    static func canonicalCode(_ code: String) -> String? {
        let canonical = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard canonical.count == 6,
              canonical.allSatisfy({ "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains($0) }) else { return nil }
        return canonical
    }
    static func tokenExpired(_ error: APIError) -> Bool {
        error.status == 400 && (error.code == "token_consumed_or_expired" || error.code == "invalid_token")
    }
    static func joinError(_ error: APIError) -> String? {
        if tokenExpired(error) { return "签到凭证无效或已过期。请重新输入房间码，或向桌主索取新的签到链接。" }
        switch error.code {
        case "seat_taken": return "座位已被占用，请重新选择空座。"
        case "match_full": return "牌桌已满，无法加入。"
        case "match_already_started": return "牌桌已经开局，无法加入。"
        case "guest_already_bound": return "当前临时访客已绑定其他牌桌，请使用账户身份加入。"
        default: return nil
        }
    }
    static func codeError(_ error: APIError) -> String? {
        if error.status == 404 && error.code == "join_code_not_found" {
            return "房间码不存在或已失效，请向房主核对。"
        }
        if error.status == 409 && error.code == "match_already_started" {
            return "牌桌已经开局，无法通过房间码加入。"
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
    @State private var alias = ""
    @State private var scanning = false
    @State private var busy = false
    @State private var loadingSeats = false
    @State private var notice: String?
    @State private var resolved: JoinCodeDTO?
    @State private var preview: CheckInSeatsDTO?
    @State private var previewKey: String?
    @State private var recoverableKey: String?
    @State private var selectedSeat: Int?
    @State private var joinedSeat: Int?
    @State private var seatsRequest = 0
    let link: String?
    let onCompleted: (String) -> Void

    init(session: AppSession, link: String?, onCompleted: @escaping (String) -> Void = { _ in }) {
        self.session = session
        self.link = link
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
    private var destinationKey: String? {
        guard let destination else { return nil }
        return "\(destination.matchID):\(destination.token)"
    }
    var body: some View {
        Form {
            if joinedSeat == nil {
                Section {
                    SecureField("HTTPS 签到链接", text: $input, prompt: Text("HTTPS 签到链接").foregroundColor(Brand.muted))
                        .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                        .textContentType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: input) { _, _ in
                            resolved = nil
                            preview = nil
                            previewKey = nil
                            selectedSeat = nil
                        }
                        .brandPanel()
                    Button("粘贴剪贴板中的链接") { input = UIPasteboard.general.string ?? "" }.brandPanel()
                    Button("扫描二维码") { requestCamera() }
                        .accessibilityIdentifier("checkIn.scanQRCode").brandPanel()
                    if let displayedDestination = destination {
                        Text("牌桌：\(displayedDestination.matchID) · 含签到凭证")
                            .foregroundStyle(Brand.muted).brandPanel()
                    } else if !input.isEmpty {
                        Text("仅接受一姬 HTTPS 签到链接和有效 UUID").foregroundStyle(Brand.loss).brandPanel()
                    }
                } header: { BrandSectionHeader("扫码或粘贴签到链接") }
                Section {
                    TextField("6 位房间码", text: $code, prompt: Text("6 位房间码").foregroundColor(Brand.muted))
                        .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .onChange(of: code) { _, _ in
                            resolved = nil
                            input = ""
                            preview = nil
                            previewKey = nil
                            selectedSeat = nil
                        }
                        .accessibilityIdentifier("checkIn.roomCode").brandPanel()
                    Button("换取签到凭证") { Task { await lookupCode() } }
                        .disabled(!session.authenticated || busy || code.isEmpty)
                        .accessibilityIdentifier("checkIn.redeemCode").brandPanel()
                    Text("房间码换取短时签到凭证；选择空座后即可直接入座。")
                        .font(.footnote).foregroundStyle(Brand.muted).brandPanel()
                } header: { BrandSectionHeader("通过房间码") }
            }
            if !session.authenticated {
                Section {
                    Text("请先登录账户或选择在线临时访客，再回到此处签到。离线本地身份不能签到。")
                        .foregroundStyle(Brand.muted).brandPanel()
                }
            }
            if let notice {
                Section { Text(notice).foregroundStyle(joinedSeat == nil ? Brand.gold : Brand.gain).brandPanel() }
            }
            joinedSeatControls
        }
        .scrollContentBackground(.hidden)
        .foregroundStyle(Brand.text)
        .background(Brand.background)
        .tint(Brand.gold)
        .navigationTitle("签到")
        .task(id: destinationKey) {
            preview = nil
            previewKey = nil
            recoverableKey = nil
            selectedSeat = nil
            if destination != nil && session.authenticated && joinedSeat == nil { await loadSeats() }
        }
        .onChange(of: link) { _, newLink in
            guard let newLink else { return }
            joinedSeat = nil
            notice = nil
            resolved = nil
            input = newLink
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
    @ViewBuilder private var joinedSeatControls: some View {
        if let joinedSeat = joinedSeat, let destination = destination {
            Section {
                Text("你在 \(joinedSeat + 1) 号位，等待房主开局。").brandPanel()
                Button("查看牌桌") { onCompleted(destination.matchID) }
                    .accessibilityIdentifier("checkIn.viewTable").brandPanel()
            } header: { BrandSectionHeader("已加入牌桌") }
        } else if let destinationForSeats = destination, session.authenticated {
            Section {
                if loadingSeats { ProgressView("读取座位中…").brandPanel() }
                if let seatsPreview = preview, previewKey == destinationKey, seatsPreview.match.id == destinationForSeats.matchID {
                    let occupiedCount = seatsPreview.seats.reduce(0) { $0 + ($1.principalId == nil ? 0 : 1) }
                    let fullForGuest = occupiedCount >= seatsPreview.match.playerCount &&
                        !seatsPreview.seats.contains(where: { $0.principalId == session.principalID })
                    Text("\(seatsPreview.match.playerCount) 人牌桌 · \(seatsPreview.match.status == "preparing" ? "待开局" : "已开局")")
                        .foregroundStyle(Brand.muted).brandPanel()
                    Picker("座位", selection: $selectedSeat) {
                        Text("自动选择第一个空座").tag(Int?.none)
                        ForEach(0..<seatsPreview.match.playerCount, id: \.self) { number in
                            let seat = seatsPreview.seat(at: number)
                            Text("\(number + 1) 号位 · \(seat?.principalId == nil ? "空座" : seat?.displayName ?? "已占用")")
                                .tag(Optional(number))
                                .disabled(seat?.principalId != nil)
                        }
                    }
                    .accessibilityIdentifier("checkIn.seatPicker").brandPanel()
                    Text("已有成员：\(occupiedCount) / \(seatsPreview.match.playerCount)。自动选择会在提交时取最低空座。")
                        .font(.footnote).foregroundStyle(Brand.muted).brandPanel()
                    if fullForGuest {
                        Text("牌桌已满，暂无可选座位。").foregroundStyle(Brand.gold).brandPanel()
                    }
                    TextField("昵称（可选；更新个人展示名）", text: $alias,
                              prompt: Text("昵称（可选；更新个人展示名）").foregroundColor(Brand.muted))
                        .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                        .textInputAutocapitalization(.words)
                        .brandPanel()
                    Button(busy ? "正在签到…" : "确认座位并加入") { Task { await checkIn() } }
                        .disabled(busy || loadingSeats || seatsPreview.match.status != "preparing" || fullForGuest ||
                                  (selectedSeat.map { seatsPreview.seat(at: $0)?.principalId != nil } ?? false))
                        .accessibilityIdentifier("checkIn.confirmSeat").brandPanel()
                }
                if recoverableKey == destinationKey, preview == nil {
                    Button("已签到？找回座位") { Task { await recoverCheckIn() } }
                        .disabled(busy || loadingSeats).brandPanel()
                }
                Button("刷新座位") { Task { await loadSeats() } }
                    .disabled(loadingSeats || busy).brandPanel()
            } header: { BrandSectionHeader("选择座位") }
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
        guard !busy, session.authenticated else { return }
        busy = true; notice = nil; resolved = nil
        defer { busy = false }
        guard let canonical = JoinFlow.canonicalCode(code) else {
            notice = "请输入 6 位房间码（不含 I、O、0、1）"
            return
        }
        do {
            let found: JoinCodeDTO = try await session.api.get("/api/matches/by-code/\(canonical)")
            guard JoinFlow.canonicalCode(code) == canonical, input.isEmpty else { return }
            resolved = found
        } catch let failure as APIError {
            guard JoinFlow.canonicalCode(code) == canonical, input.isEmpty else { return }
            notice = JoinFlow.codeError(failure) ?? failure.localizedDescription
        } catch {
            guard JoinFlow.canonicalCode(code) == canonical, input.isEmpty else { return }
            notice = error.localizedDescription
        }
    }
    private func loadSeats() async {
        guard let destination = destination, let key = destinationKey else { return }
        seatsRequest += 1
        let request = seatsRequest
        loadingSeats = true
        defer { if seatsRequest == request { loadingSeats = false } }
        do {
            let seats = try await session.api.checkInSeats(matchID: destination.matchID, token: destination.token)
            guard !Task.isCancelled, seatsRequest == request, destinationKey == key else { return }
            guard seats.match.id == destination.matchID else {
                throw APIError(status: nil, message: "座位预览与签到链接不匹配")
            }
            preview = seats
            previewKey = key
            recoverableKey = nil
            if let ownSeat = seats.seats.first(where: { $0.principalId == session.principalID && $0.status == "checked_in" }) {
                joinedSeat = ownSeat.seatNo
                notice = "已加入牌桌。"
            }
            if let selectedSeat, seats.seat(at: selectedSeat)?.principalId != nil { self.selectedSeat = nil }
            if seats.match.status != "preparing" { notice = "牌桌已经开局，无法加入。" }
        } catch let failure as APIError {
            guard seatsRequest == request, destinationKey == key else { return }
            preview = nil; previewKey = nil
            recoverableKey = failure.code == "token_consumed_or_expired" ? key : nil
            notice = JoinFlow.joinError(failure) ?? failure.localizedDescription
        } catch {
            guard seatsRequest == request, destinationKey == key else { return }
            preview = nil; previewKey = nil
            recoverableKey = nil
            notice = error.localizedDescription
        }
    }
    private func recoverCheckIn() async {
        guard !busy, let destination, let key = destinationKey, recoverableKey == key else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await session.api.checkIn(
                matchID: destination.matchID,
                command: CheckInCommand(token: destination.token, seatNo: nil, alias: nil))
            guard destinationKey == key else { return }
            joinedSeat = result.seat.seatNo
            recoverableKey = nil
            notice = "已找回签到座位。"
        } catch let failure as APIError {
            guard destinationKey == key else { return }
            notice = JoinFlow.joinError(failure) ?? failure.localizedDescription
        } catch {
            guard destinationKey == key else { return }
            notice = error.localizedDescription
        }
    }
    private func checkIn() async {
        guard !busy, !loadingSeats, let destination, let key = destinationKey,
              let current = preview, previewKey == key, current.match.status == "preparing",
              selectedSeat.map({ current.seat(at: $0)?.principalId == nil }) ?? true else { return }
        busy = true; notice = nil
        defer { busy = false }
        do {
            let chosenAlias = alias.trimmingCharacters(in: .whitespacesAndNewlines)
            let result = try await session.api.checkIn(
                matchID: destination.matchID,
                command: CheckInCommand(token: destination.token, seatNo: selectedSeat,
                                        alias: chosenAlias.isEmpty ? nil : chosenAlias))
            guard destinationKey == key else { return }
            joinedSeat = result.seat.seatNo
            notice = "签到成功，已入座。"
        } catch let failure as APIError {
            guard destinationKey == key else { return }
            notice = JoinFlow.joinError(failure) ??
                (failure.status == 429 ? "请求过于频繁，请在 \(Int(failure.retryAfter ?? 60)) 秒后重试。" : failure.localizedDescription)
            if failure.code == "seat_taken" {
                selectedSeat = nil
                await loadSeats()
            } else if JoinFlow.tokenExpired(failure) {
                preview = nil; previewKey = nil
                resolved = nil; input = ""
            }
        } catch {
            guard destinationKey == key else { return }
            notice = error.localizedDescription
        }
    }
}
