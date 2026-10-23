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

private final class CameraCoordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
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

private struct CameraScanner: UIViewRepresentable {
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
    @State private var attempted: String?
    let onCompleted: () -> Void
    init(session: AppSession, link: String?, onCompleted: @escaping () -> Void = {}) {
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
                    .onChange(of: input) { _, _ in resolved = nil; completed = false }
                Button("粘贴剪贴板中的链接") { input = UIPasteboard.general.string ?? "" }
                Button("扫描二维码") { requestCamera() }
                if let destination { Text("牌桌：\(destination.matchID) · 含签到凭证") }
                else if !input.isEmpty { Text("仅接受一姬 HTTPS 签到链接和有效 UUID").foregroundStyle(.red) }
            }
            Section("通过房间码") {
                TextField("6 位房间码", text: $code).textInputAutocapitalization(.characters).autocorrectionDisabled()
                Button("换取签到凭证") { Task { await lookupCode() } }
                    .disabled(!session.authenticated || busy || code.isEmpty)
                Text("房间码也是入场凭据；不会替代桌主的座位批准。")
                    .font(.footnote)
            }
            if !session.authenticated {
                Section { Text("请先登录账户或选择在线临时访客，再回到此处签到。离线本地身份不能签到。") }
            }
            if let notice { Section { Text(notice).foregroundStyle(completed ? Color.green : Color.orange) } }
            if destination != nil && session.authenticated && !completed {
                Section {
                    Button(busy ? "请求中…" : "提交签到") { Task { await checkIn() } }.disabled(busy)
                    Text("仅已获桌主批准的当前身份可使用一次性凭证签到；未批准时不会绕过服务器审批。")
                        .font(.footnote)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .navigationTitle("签到")
        .task(id: session.authenticated ? destination?.token : nil) {
            guard session.authenticated, let destination else { return }
            let key = "\(destination.matchID):\(destination.token)"
            guard attempted != key else { return }
            attempted = key
            await checkIn()
        }
        .sheet(isPresented: $scanning) {
            NavigationStack {
                CameraScanner { value in
                    scanning = false
                    input = value
                    if destination == nil { notice = "二维码不是有效的一姬签到链接" }
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
            let canonical = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard canonical.count == 6,
                  canonical.allSatisfy({ "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains($0) }) else {
                notice = "请输入 6 位房间码（不含 I、O、0、1）"
                return
            }
            resolved = try await session.api.get("/api/matches/by-code/\(canonical)")
        } catch let failure as APIError where failure.status == 429 {
            notice = "查询过于频繁，请在 \(Int(failure.retryAfter ?? 60)) 秒后重试"
        } catch { notice = error.localizedDescription }
    }
    private func checkIn() async {
        guard !busy, let destination else { return }
        busy = true; notice = nil
        defer { busy = false }
        do {
            let _: CheckInResultDTO = try await session.api.post("/api/matches/\(destination.matchID)/check-ins", body: ["token": destination.token])
            onCompleted()
            input = ""; resolved = nil; completed = true
            notice = "签到成功，服务器已确认座位。"
        } catch let failure as APIError where failure.code == "check_in_not_approved" {
            notice = "当前身份尚未获桌主批准座位。请联系桌主；客户端不能自行批准。"
        } catch let failure as APIError where failure.status == 429 {
            notice = "请求过于频繁，请在 \(Int(failure.retryAfter ?? 60)) 秒后重试"
        } catch { notice = error.localizedDescription }
    }
}
