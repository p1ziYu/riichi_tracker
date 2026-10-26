import Foundation
import AVFoundation
import SwiftUI
import UIKit

// 最后一版原生加入流程（旧签到页已删除）：
// 输房间码 / 扫码 / 粘贴链接 → 直接进桌成为成员；满员中文提示；重复进幂等。
// 链接解析见 FinalModels.JoinDestination；房间码校验见 JoinFlow.canonicalCode。

final class CameraCoordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
    let session = AVCaptureSession()
    let queue = DispatchQueue(label: "ichihime.camera.capture")
    var stopped = false
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
struct JoinScreen: View {
    let service: any FinalMatchService
    let initialLink: String?
    let onJoined: (FinalMatch) -> Void
    init(service: any FinalMatchService, initialLink: String? = nil, onJoined: @escaping (FinalMatch) -> Void) {
        self.service = service
        self.initialLink = initialLink
        self.onJoined = onJoined
    }
    @State private var code = ""
    @State private var link = ""
    @State private var scanning = false
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                Text("输入 6 位房间码，或粘贴加入链接、扫描二维码，点加入即直接进桌。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                TextField("房间码", text: $code, prompt: Text("6 位房间码").foregroundColor(Brand.muted))
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Brand.deep, in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityIdentifier("join.roomCode")
                Button(busy ? "加入中…" : "用房间码加入") { Task { await joinByCode() } }
                    .buttonStyle(.borderedProminent)
                    .tint(Brand.gold)
                    .foregroundStyle(Brand.background)
                    .disabled(busy || JoinFlow.canonicalCode(code) == nil)
                    .accessibilityIdentifier("join.submitCode")
                if JoinFlow.canonicalCode(code) == nil && !code.isEmpty {
                    Text("房间码为 6 位大写字母与数字（不含 0、1、I、O）。")
                        .font(Brand.font(.footnote)).foregroundStyle(Brand.loss)
                }
            } header: { BrandSectionHeader("房间码") }
            .brandPanel()
            Section {
                TextField("加入链接", text: $link, prompt: Text("粘贴加入链接").foregroundColor(Brand.muted))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Brand.deep, in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityIdentifier("join.link")
                Button(busy ? "加入中…" : "用链接加入") { Task { await joinByLink() } }
                    .buttonStyle(.borderedProminent)
                    .tint(Brand.gold)
                    .foregroundStyle(Brand.background)
                    .disabled(busy || JoinDestination(link) == nil)
                    .accessibilityIdentifier("join.submitLink")
                Button(scanning ? "关闭扫码" : "扫描二维码") { scanning.toggle() }
                    .accessibilityIdentifier("join.scan.toggle")
                if scanning {
                    CameraScanner { value in
                        link = value
                        scanning = false
                        Task { await joinByLink() }
                    }
                    .frame(height: 320)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                if let notice { Text(notice).foregroundStyle(Brand.gain) }
                if let error { Text(error).foregroundStyle(Brand.loss) }
            } header: { BrandSectionHeader("链接 / 扫码") }
            .brandPanel()
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle("加入牌桌")
        .keyboardDismissal()
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
        .onAppear { if let initialLink { link = initialLink } }
    }

    @MainActor private func joinByCode() async {
        guard let canonical = JoinFlow.canonicalCode(code), !busy else { return }
        busy = true
        error = nil
        notice = nil
        defer { busy = false }
        do {
            let match = try await service.joinByCode(canonical)
            onJoined(match)
        } catch let failure as APIError {
            self.error = APIErrorCopy.text(failure)
        } catch {
            self.error = "网络异常，请稍后重试。"
        }
    }

    @MainActor private func joinByLink() async {
        guard let destination = JoinDestination(link), !busy else {
            error = "加入链接无效，请检查后重试，或使用房间码。"
            return
        }
        guard destination.token != nil || destination.code != nil else {
            // API 实测：无凭证的链接会被 400 missing_credential；本机先提示，不发请求。
            error = "此链接没有加入凭证，请用房间码加入，或请房主重新分享带凭证的链接。"
            return
        }
        busy = true
        error = nil
        notice = nil
        defer { busy = false }
        do {
            let match = try await service.joinLink(destination)
            onJoined(match)
        } catch let failure as APIError {
            self.error = APIErrorCopy.text(failure)
        } catch {
            self.error = "网络异常，请稍后重试。"
        }
    }
}
