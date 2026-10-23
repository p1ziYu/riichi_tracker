import Foundation
import Security
import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

private struct SeatClaim: Encodable { let seatNo: Int }
struct PendingResultEnvelope: Codable {
    let handID: String
    let body: Data
}
struct FinalizeSeats: Encodable { let dealerSeatNo: Int? }
struct MarkCommand: Encodable { let seatNo: Int; let riichi: Bool; let expectedMarkRevision: Int64 }
private struct ResultPreviewCommand: Encodable { let resultInput: [String: JSONValue] }
struct ResultCommand: Encodable {
    let resultInput: [String: JSONValue]
    let confirmedMarkRevision: Int64
    let clientEventId: String
}

enum OnlineCommandPolicy {
    static func canToggle(_ seat: HandSeatDTO, points: Int, allowLowPointRiichi: Bool) -> Bool {
        if seat.isRiichi { return seat.riichiChangeUsage.cancels < 1 }
        return seat.riichiChangeUsage.declares < 2 && (allowLowPointRiichi || points >= 1000)
    }
    static func refreshAfter(_ error: APIError) -> Bool { error.status == 409 }
    static func approvalError(_ error: APIError) -> String? {
        switch error.code {
        case "seat_taken": return "座位已被占用，请刷新牌桌并选择其他空座。"
        case "join_request_already_decided": return "这份申请已被处理，不能再次批准。"
        case "join_request_not_found": return "申请编号不存在或不属于本桌，请核对回执。"
        case "match_already_started": return "牌桌已经开局，无法批准新的申请。"
        default: return nil
        }
    }
    static func previewBinding(handID: String, revision: Int64, input: [String: JSONValue]) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(input) else { return nil }
        return "\(handID):\(revision):\(data.base64EncodedString())"
    }
}

/// Keychain retains the exact bytes of an ambiguous result POST, scoped to the authenticated principal.
enum PendingResultStore {
    static let service = "\(Bundle.main.bundleIdentifier ?? "ichihime").pending-result"
    static func query(_ principal: String, _ match: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "\(principal):\(match)",
         kSecAttrSynchronizable as String: kCFBooleanFalse as Any]
    }
    static func save(_ data: Data, handID: String, principal: String, match: String) throws {
        let key = query(principal, match)
        _ = SecItemDelete(key as CFDictionary)
        var attributes = key
        attributes[kSecValueData as String] = try JSONEncoder().encode(PendingResultEnvelope(handID: handID, body: data))
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
            throw APIError(status: nil, message: "无法安全保存待确认结算请求")
        }
    }
    static func load(principal: String, match: String) throws -> PendingResultEnvelope? {
        var key = query(principal, match)
        key[kSecReturnData as String] = kCFBooleanTrue
        key[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(key as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw APIError(status: nil, message: "待确认请求无法读取，请检查服务器局状态")
        }
        return try JSONDecoder().decode(PendingResultEnvelope.self, from: data)
    }
    static func clear(principal: String, match: String) {
        _ = SecItemDelete(query(principal, match) as CFDictionary)
    }
    static func clearAll() {
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any
        ]
        _ = SecItemDelete(key as CFDictionary)
    }
}

struct InvitationQR: View {
    let link: String
    @State private var image: UIImage?
    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                    .frame(maxWidth: 240, maxHeight: 240)
                    .accessibilityLabel(link.hasPrefix("{") ? "申请回执二维码" : "签到链接二维码")
            } else { Text("正在生成二维码；也可复制链接") }
        }
        .task(id: link) { image = makeQR() }
    }
    private func makeQR() -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(link.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage,
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}
enum InvitationClock {
    static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    static let standard = ISO8601DateFormatter()
    static func expiration(_ text: String) -> Date? {
        fractional.date(from: text) ?? standard.date(from: text)
    }
}


@MainActor
struct OnlineTableActions: View {
    let session: AppSession
    let snapshot: TableSnapshot
    let onUpdated: () async -> Void
    @State private var busy = false
    @State private var error: String?
    @State private var dealer: Int?
    @State private var invitation: CheckInTokenDTO?
    @State private var invitationExpired = false
    @State private var issuingCount = 0
    @State private var showResult = false
    @State private var terminal: SettlementPreview?
    @State private var terminalVersion: Int?
    @State private var pendingBody: Data?
    @State private var pendingHand: String?
    @State private var pendingLoaded = false
    @State private var confirmDiscard = false
    @State private var receiptInput = ""
    @State private var scanningReceipt = false
    @State private var approvalSeat: Int?

    private var matchID: String { snapshot.match.id }
    private var base: String { "/api/matches/\(matchID)" }
    private var isOwner: Bool { session.principalID != nil && session.principalID == snapshot.match.ownerPrincipalId }
    private var signedIn: Bool { snapshot.seats.contains { $0.principalId == session.principalID && $0.status == "checked_in" } }
    private var scannedReceipt: JoinReceipt? { JoinReceipt(receiptInput) }
    private var approvalReceipt: JoinReceipt? {
        JoinFlow.receipt(receiptInput, forMatch: matchID)
    }
    private var emptySeats: [SeatDTO] {
        snapshot.seats.filter { $0.principalId == nil }.sorted { $0.seatNo < $1.seatNo }
    }
    private var invitationURL: String? {
        guard let invitation, !invitationExpired, snapshot.match.status == "preparing",
              let expires = InvitationClock.expiration(invitation.expiresAt), expires > Date(),
              snapshot.seats.filter({ $0.status == "checked_in" }).count <= issuingCount else { return nil }
        var url = URLComponents(string: "https://riichi.p1ziyu.com/checkin/\(matchID)")!
        url.queryItems = [URLQueryItem(name: "token", value: invitation.token)]
        return url.url?.absoluteString
    }
    var body: some View {
        Section("牌桌操作") {
            if let error { Text(error).foregroundStyle(.red) }
            if let code = snapshot.match.joinCode, isOwner, snapshot.match.status == "preparing" {
                LabeledContent("房间码", value: code)
                Button("复制房间码") { UIPasteboard.general.string = code }
            }
            if isOwner && snapshot.match.status == "preparing" {
                Text("申请者须出示申请回执。房主扫描或粘贴回执，批准一个空座后，再发送一次性签到凭证。")
                    .font(.footnote).foregroundStyle(.secondary)
                TextField("粘贴申请回执 JSON", text: $receiptInput, axis: .vertical)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("粘贴申请回执") { receiptInput = UIPasteboard.general.string ?? "" }
                Button("扫码确认入座") { scanningReceipt = true }
                if let approvalReceipt {
                    Text("自述昵称（未验证）：\(approvalReceipt.name)")
                    Text("申请编号：\(approvalReceipt.joinRequestId)")
                        .font(.caption2).textSelection(.enabled)
                    if !emptySeats.isEmpty {
                        Picker("批准座位", selection: $approvalSeat) {
                            Text("请选择空座").tag(Int?.none)
                            ForEach(emptySeats) { seat in Text("\(seat.seatNo + 1) 号位").tag(Optional(seat.seatNo)) }
                        }
                        Button("批准申请者入座") {
                            guard let seat = approvalSeat, emptySeats.contains(where: { $0.seatNo == seat }) else { return }
                            execute {
                                do {
                                    let _: [String: JSONValue] = try await session.api.post(
                                        "\(base)/join-requests/\(approvalReceipt.joinRequestId)/approve",
                                        body: SeatClaim(seatNo: seat))
                                    receiptInput = ""
                                    approvalSeat = nil
                                } catch let failure as APIError {
                                    throw APIError(status: failure.status, code: failure.code,
                                                   retryAfter: failure.retryAfter,
                                                   message: OnlineCommandPolicy.approvalError(failure) ?? failure.localizedDescription)
                                }
                            }
                        }.disabled(busy || approvalSeat == nil || !emptySeats.contains(where: { $0.seatNo == approvalSeat }))
                    } else { Text("没有可批准的空座。").foregroundStyle(.secondary) }
                } else if !receiptInput.isEmpty {
                    Text(scannedReceipt == nil
                         ? "申请回执格式无效，请重新扫码或粘贴完整 JSON。"
                         : "申请回执不属于本桌，请核对牌桌编号。")
                        .foregroundStyle(.red)
                }
                ForEach(snapshot.seats.sorted { $0.seatNo < $1.seatNo }) { seat in
                    if seat.principalId == nil || (seat.principalId == session.principalID && seat.status != "checked_in") {
                        Button("房主选择 \(seat.seatNo + 1) 号位") {
                            execute {
                                let _: [String: JSONValue] = try await session.api.post("\(base)/seats/claim", body: SeatClaim(seatNo: seat.seatNo))
                                dealer = nil
                            }
                        }.disabled(busy)
                    }
                }
                Button("生成单人签到链接（10 分钟）") {
                    execute {
                        invitation = nil
                        invitationExpired = false
                        issuingCount = snapshot.seats.filter { $0.status == "checked_in" }.count
                        invitation = try await session.api.post("\(base)/check-in-tokens")
                    }
                }.disabled(busy)
                if let invitationURL {
                    InvitationQR(link: invitationURL)
                    Button("复制签到链接") { UIPasteboard.general.string = invitationURL }
                    Text("签入凭证仅供一人使用。请勿公开转发；使用或过期后需重新生成。")
                        .font(.footnote)
                }
                Picker("指定起家（可选）", selection: $dealer) {
                    Text("服务器随机").tag(Int?.none)
                    ForEach(snapshot.seats) { seat in Text("\(seat.seatNo + 1) 号位").tag(Optional(seat.seatNo)) }
                }
                Button("全员签到后确认座次") {
                    execute {
                        let _: [String: JSONValue] = try await session.api.post("\(base)/seats/finalize", body: FinalizeSeats(dealerSeatNo: dealer))
                    }
                }
                .disabled(busy || snapshot.seats.count != snapshot.match.playerCount || snapshot.seats.contains { $0.status != "checked_in" })
            }
            if snapshot.match.status == "in_progress", signedIn {
                if let hand = snapshot.currentHand, hand.state == "open" {
                    ForEach(hand.seats, id: \.seatNo) { seat in
                        let used = seat.riichiChangeUsage
                        let points = snapshot.seats.first { $0.seatNo == seat.seatNo }?.points ?? 0
                        let lowAllowed = snapshot.match.rulesSnapshot?["allowLowPointRiichi"] == .bool(true)
                        Button("\(seat.seatNo + 1) 号位 · \(seat.isRiichi ? "取消立直" : "宣言立直") · 宣言 \(used.declares)/2 取消 \(used.cancels)/1") {
                            execute {
                                let _: CommandReceiptDTO = try await session.api.post("\(base)/hands/\(hand.id)/marks", body: MarkCommand(seatNo: seat.seatNo, riichi: !seat.isRiichi, expectedMarkRevision: hand.markRevision))
                            }
                        }
                        .disabled(busy || !OnlineCommandPolicy.canToggle(seat, points: points, allowLowPointRiichi: lowAllowed))
                    }
                    Button("录入本局结果") { showResult = true }
                        .disabled(busy || !pendingLoaded || pendingBody != nil)
                } else {
                    Button("新开一局") {
                        execute { let _: [String: JSONValue] = try await session.api.post("\(base)/hands") }
                    }.disabled(busy)
                    if isOwner, snapshot.match.rulesSnapshot?["automaticEndPolicy"] != .string("ranked_sanma") {
                        Button("终局") {
                            execute { let _: [String: JSONValue] = try await session.api.post("\(base)/finish") }
                        }.disabled(busy)
                    }
                }
            }
            if signedIn && !pendingLoaded {
                Button("重试读取安全保存的结算请求") { loadPending() }
            }
            if let pendingBody, let pendingHand, signedIn {
                Text("上一笔结算结果尚未确认。请先刷新服务器状态；若该局仍未结算，可原样重发同一请求。")
                Button("原样重发结算请求") {
                    execute {
                        let _: PaymentPreviewDTO = try await session.api.postRaw("\(base)/hands/\(pendingHand)/results", data: pendingBody)
                        clearPending()
                    }
                }.disabled(busy || snapshot.currentHand?.id != pendingHand || snapshot.currentHand?.state != "open")
                Button("服务器已结算，清除待确认请求") { clearPending() }
                    .disabled(snapshot.currentHand?.id == pendingHand && snapshot.currentHand?.state == "open")
                if snapshot.currentHand?.id == pendingHand && snapshot.currentHand?.state == "open" {
                    Button("放弃旧请求并重新录入", role: .destructive) { confirmDiscard = true }
                        .disabled(busy)
                }
            }
            if snapshot.match.status == "finished" {
                Button("预览终局成绩") {
                    execute(refresh: false) {
                        terminal = nil
                        terminalVersion = nil
                        let received: SettlementPreview = try await session.api.get("\(base)/settlement/preview")
                        guard received.terminalTenths.count == snapshot.match.playerCount,
                              received.standings.count == snapshot.match.playerCount else {
                            throw APIError(status: nil, message: "服务器未返回完整的终局逐座成绩")
                        }
                        terminal = received
                        terminalVersion = snapshot.match.version
                    }
                }.disabled(busy)
                if let terminal, terminalVersion == snapshot.match.version {
                    ForEach(terminal.standings.sorted { $0.rank < $1.rank }, id: \.seatNo) { standing in
                        Text("第 \(standing.rank) 名 · \(standing.seatNo + 1) 号位 · \(Double(standing.totalTenths) / 10) 分")
                    }
                    if isOwner && snapshot.match.settlementConfirmed != true {
                        Button("房主确认终局结算") {
                            execute { let _: CommandReceiptDTO = try await session.api.post("\(base)/settlement/confirm") }
                        }.disabled(busy)
                    }
                }
            }
        }
        .listRowBackground(Brand.panel)
        .alert("放弃未确认结算请求？", isPresented: $confirmDiscard) {
            Button("保留", role: .cancel) {}
            Button("已核实未结算，放弃", role: .destructive) { clearPending() }
        } message: {
            Text("先刷新确认服务器仍显示本局未结算。放弃后若旧请求实际已入账，新输入可能与服务器状态冲突；服务器始终只允许一笔有效结果。")
        }
        .sheet(isPresented: $scanningReceipt) {
            NavigationStack {
                CameraScanner { text in
                    scanningReceipt = false
                    receiptInput = text
                }
                .navigationTitle("扫描申请回执")
                .toolbar { ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { scanningReceipt = false }
                } }
            }
        }
        .sheet(isPresented: $showResult) {
            if let hand = snapshot.currentHand {
                NavigationStack {
                    ResultEntry(snapshot: snapshot, hand: hand, api: session.api) { body in
                        guard let principal = session.principalID else { throw APIError(status: nil, message: "未认证身份") }
                        try PendingResultStore.save(body, handID: hand.id, principal: principal, match: matchID)
                        pendingBody = body
                        pendingHand = hand.id
                        do {
                            let _: PaymentPreviewDTO = try await session.api.postRaw("\(base)/hands/\(hand.id)/results", data: body)
                            clearPending()
                            showResult = false
                            await onUpdated()
                        } catch {
                            await onUpdated()
                            throw error
                        }
                    }
                }
            }
        }
        .task(id: session.principalID) { loadPending() }
        .task(id: invitation?.token) {
            guard let invitation, let expires = InvitationClock.expiration(invitation.expiresAt) else { return }
            let seconds = max(0, min(600, expires.timeIntervalSinceNow))
            do { try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
            catch { return }
            if !Task.isCancelled { invitationExpired = true }
        }
    }
    private func loadPending() {
        pendingLoaded = false
        guard let principal = session.principalID else {
            pendingBody = nil; pendingHand = nil
            return
        }
        do {
            let saved = try PendingResultStore.load(principal: principal, match: matchID)
            pendingBody = saved?.body
            pendingHand = saved?.handID
            pendingLoaded = true
        } catch let loadError { error = loadError.localizedDescription }
    }
    private func clearPending() {
        if let principal = session.principalID { PendingResultStore.clear(principal: principal, match: matchID) }
        pendingBody = nil; pendingHand = nil
    }
    private func execute(refresh: Bool = true, _ operation: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true; error = nil
        Task {
            do { try await operation(); if refresh { await onUpdated() } }
            catch {
                if let failure = error as? APIError, OnlineCommandPolicy.refreshAfter(failure) { await onUpdated() }
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}

@MainActor
private struct ResultEntry: View {
    let snapshot: TableSnapshot
    let hand: CurrentHandDTO
    let api: APIClient
    let onConfirm: (Data) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "ron"
    @State private var winner = 0
    @State private var dealIn = 1
    @State private var han = "2"
    @State private var fu = "30"
    @State private var tenpai: [Int: Bool] = [:]
    @State private var rivers: [Int: String] = [:]
    @State private var called: [Int: String] = [:]
    @State private var attested = false
    @State private var preview: PaymentPreviewDTO?
    @State private var binding: String?
    @State private var busy = false
    @State private var error: String?
    @State private var initialBinding: String?
    @State private var confirmClose = false
    @State private var submitted = false
    private var seats: [SeatDTO] { snapshot.seats.sorted { $0.seatNo < $1.seatNo } }
    private var base: String { "/api/matches/\(snapshot.match.id)/hands/\(hand.id)" }
    private var nagashiEnabled: Bool { snapshot.match.rulesSnapshot?["nagashiManganEnabled"] == .bool(true) }
    private var input: [String: JSONValue]? {
        guard hand.state == "open" else { return nil }
        if kind == "ryuukyoku" { return ["kind": .string(kind), "winners": .array([]), "tenpai": .array(seats.map { .bool(tenpai[$0.seatNo] ?? false) })] }
        guard seats.contains(where: { $0.seatNo == winner }) else { return nil }
        if kind == "nagashi_mangan" {
            guard nagashiEnabled, attested else { return nil }
            let raw = rivers[winner, default: ""].split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == "，" }).map(String.init)
            guard called[winner, default: ""].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !raw.isEmpty,
                  raw.allSatisfy({ tile in
                      let characters = Array(tile)
                      return characters.count == 2 && (("19".contains(characters[0]) && "mps".contains(characters[1])) || ("1234567".contains(characters[0]) && characters[1] == "z"))
                  }) else { return nil }
            let discards: [JSONValue] = raw.map { tile in
                .object(["tile": .string(tile), "called": .bool(false)])
            }
            return ["kind": .string(kind), "winners": .array([.object(["seatNo": .number(Double(winner)), "han": .number(5), "fu": .number(30)])]),
                    "tenpai": .array(seats.map { .bool(tenpai[$0.seatNo] ?? false) }),
                    "nagashiEligibility": .array([.object(["seatNo": .number(Double(winner)), "discards": .array(discards)])])]
        }
        guard let han = Int(han), let fu = Int(fu), (1...130).contains(han), (20...140).contains(fu),
              kind != "ron" || (winner != dealIn && seats.contains(where: { $0.seatNo == dealIn })) else { return nil }
        var entry: [String: JSONValue] = ["seatNo": .number(Double(winner)), "han": .number(Double(han)), "fu": .number(Double(fu))]
        if kind == "ron" { entry["dealInSeatNo"] = .number(Double(dealIn)) }
        return ["kind": .string(kind), "winners": .array([.object(entry)])]
    }
    private var inputBinding: String? {
        guard let input else { return nil }
        return OnlineCommandPolicy.previewBinding(handID: hand.id, revision: hand.markRevision, input: input)
    }
    var body: some View {
        Form {
            Section("支付输入") {
                Picker("结果类型", selection: $kind) {
                    Text("荣和").tag("ron"); Text("自摸").tag("tsumo"); Text("荒牌流局").tag("ryuukyoku")
                    if nagashiEnabled { Text("流局满贯").tag("nagashi_mangan") }
                }
                if kind != "ryuukyoku" {
                    Picker("和牌座位", selection: $winner) { ForEach(seats) { Text("\($0.seatNo + 1) 号位 · \($0.displayName ?? "未命名")").tag($0.seatNo) } }
                    if kind == "ron" {
                        Picker("放铳座位", selection: $dealIn) { ForEach(seats) { Text("\($0.seatNo + 1) 号位").tag($0.seatNo) } }
                    }
                    if kind == "nagashi_mangan" {
                        TextField("按顺序填写完整幺九弃牌，如 1m 9m 1z", text: Binding(get: { rivers[winner, default: ""] }, set: { rivers[winner] = $0 }))
                        TextField("被鸣走弃牌（如有则不能流满）", text: Binding(get: { called[winner, default: ""] }, set: { called[winner] = $0 }))
                        Toggle("确认记录为完整弃牌河及鸣牌情况", isOn: $attested)
                    } else {
                        TextField("番 1–130", text: $han).keyboardType(.numberPad)
                        TextField("符 20–140", text: $fu).keyboardType(.numberPad)
                    }
                }
                if kind == "ryuukyoku" || kind == "nagashi_mangan" {
                    ForEach(seats) { seat in
                        Toggle("\(seat.seatNo + 1) 号位听牌", isOn: Binding(get: { tenpai[seat.seatNo] ?? false }, set: { tenpai[seat.seatNo] = $0 }))
                    }
                }
                if input == nil { Text("请填写合法座位与番符；流满须提供完整的河牌和鸣牌情况。 ").foregroundStyle(.red) }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
            Section("服务器支付预览") {
                Button("计算逐座支付") { Task { await fetchPreview() } }.disabled(input == nil || busy)
                if let preview, binding == inputBinding {
                    ForEach(preview.perSeat, id: \.seatNo) { payment in
                        VStack(alignment: .leading) {
                            Text("\(payment.seatNo + 1) 号位：\(payment.netPoints >= 0 ? "+" : "")\(payment.netPoints) 点").monospacedDigit()
                            ForEach(0..<payment.breakdown.count, id: \.self) { index in
                                Text("\(payment.breakdown[index].reason)：\(payment.breakdown[index].amount)").font(.footnote)
                            }
                        }
                    }
                    Text("下一局：\(preview.nextHand.roundWind) \(preview.nextHand.roundNumber) · 庄 \(preview.nextHand.dealerSeatNo + 1) · 本场 \(preview.nextHand.honba) · 供托 \(preview.nextHand.riichiPool) 点")
                    Button("确认并结算") { Task { await submit() } }.disabled(busy || submitted)
                } else { Text("输入或立直版本变化后，请重新预览。") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .navigationTitle("本局结算")
        .toolbar { ToolbarItem(placement: .cancellationAction) {
            Button("关闭") {
                if submitted || preview != nil || inputBinding != initialBinding { confirmClose = true }
                else { dismiss() }
            }.disabled(busy)
        } }
        .interactiveDismissDisabled()
        .onAppear { initialBinding = inputBinding }
        .alert("放弃未提交的录入？", isPresented: $confirmClose) {
            Button("继续录入", role: .cancel) {}
            Button("关闭录入", role: .destructive) { dismiss() }
        } message: {
            Text(submitted ? "结算请求可能仍在服务器处理中。关闭只会离开录入界面；请回到牌桌检查待确认请求及服务器局状态。" : "未提交的输入和预览将丢失。")
        }
        .onChange(of: inputBinding) { _, _ in preview = nil; binding = nil }
    }
    private func fetchPreview() async {
        guard let input, let key = inputBinding else { return }
        busy = true; error = nil; preview = nil; binding = nil
        defer { busy = false }
        do {
            let result: PaymentPreviewDTO = try await api.post("\(base)/preview", body: ResultPreviewCommand(resultInput: input))
            guard result.perSeat.count == seats.count,
                  Set(result.perSeat.map(\.seatNo)) == Set(seats.map(\.seatNo)) else {
                throw APIError(status: nil, message: "服务器未返回完整逐座支付")
            }
            if inputBinding == key { preview = result; binding = key }
        } catch { self.error = error.localizedDescription }
    }
    private func submit() async {
        guard !busy, !submitted, preview != nil, binding == inputBinding, let input else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let command = ResultCommand(resultInput: input, confirmedMarkRevision: hand.markRevision, clientEventId: UUID().uuidString)
            let body = try JSONEncoder().encode(command)
            submitted = true
            try await onConfirm(body)
        } catch { self.error = error.localizedDescription }
    }
}
