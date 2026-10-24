import Foundation
import Security
import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

private struct SeatClaim: Encodable { let seatNo: Int }
struct ReassignSeatCommand: Encodable { let fromSeatNo: Int; let toSeatNo: Int }
struct ReassignSeatResultDTO: Decodable { let fromSeatNo: Int; let toSeatNo: Int; let swapped: Bool }
struct RemoveMemberResultDTO: Decodable { let removed: Bool }

@MainActor
extension APIClient {
    func reassignSeat(matchID: String, from: Int, to: Int) async throws -> ReassignSeatResultDTO {
        try await post("/api/matches/\(matchID)/seats/reassign",
                       body: ReassignSeatCommand(fromSeatNo: from, toSeatNo: to))
    }

    func removeMember(matchID: String, principalID: String) async throws -> RemoveMemberResultDTO {
        try await post("/api/matches/\(matchID)/members/\(principalID)/remove")
    }
}
struct PendingResultEnvelope: Codable {
    let principalId: String
    let matchId: String
    let handID: String
    let rawBodyString: String
    let clientEventId: String
    var body: Data { Data(rawBodyString.utf8) }

    init(handID: String, body: Data, principal: String, match: String) throws {
        let command = try JSONDecoder().decode(ResultCommand.self, from: body)
        guard let raw = String(data: body, encoding: .utf8) else {
            throw APIError(status: nil, message: "结算请求不是 UTF-8")
        }
        self.principalId = principal
        self.matchId = match
        self.handID = handID
        self.rawBodyString = raw
        self.clientEventId = command.clientEventId
    }
}
private struct LegacyPendingResultEnvelope: Decodable {
    let handID: String
    let body: Data
}

/// One-time transfer of pending requests written by earlier builds to Keychain.
private enum LegacyKeychainResultStore {
    private static var service: String { "\(Bundle.main.bundleIdentifier ?? "ichihime").pending-result" }
    private static func query(principal: String, match: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "\(principal):\(match)",
         kSecAttrSynchronizable as String: kCFBooleanFalse as Any]
    }
    static func load(principal: String, match: String) throws -> LegacyPendingResultEnvelope? {
        var attributes = query(principal: principal, match: match)
        attributes[kSecReturnData as String] = kCFBooleanTrue
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(attributes as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw APIError(status: nil, message: "旧版待确认结算请求无法读取")
        }
        return try JSONDecoder().decode(LegacyPendingResultEnvelope.self, from: data)
    }
    static func clear(principal: String, match: String) {
        _ = SecItemDelete(query(principal: principal, match: match) as CFDictionary)
    }
}
struct FinalizeSeats: Encodable { let dealerSeatNo: Int? }
struct MarkCommand: Encodable { let seatNo: Int; let riichi: Bool; let expectedMarkRevision: Int64 }
private struct ResultPreviewCommand: Encodable { let resultInput: [String: JSONValue] }
struct ResultCommand: Codable {
    let resultInput: [String: JSONValue]
    let confirmedMarkRevision: Int64
    let clientEventId: String
}

enum OnlineCommandPolicy {
    enum PendingResolution: Equatable {
        case unverified, settled, sameRevision, changedRevision
    }
    static func pendingResolution(_ command: ResultCommand?, handID: String,
                                  snapshot: TableSnapshot?) -> PendingResolution {
        guard let command = command, let snapshot = snapshot else { return .unverified }
        let hand = snapshot.currentHand
        if snapshot.match.status == "finished" || hand?.state == "settled" ||
            (hand != nil && hand?.id != handID) { return .settled }
        guard hand?.id == handID, hand?.state == "open" else { return .unverified }
        return hand?.markRevision == command.confirmedMarkRevision ? .sameRevision : .changedRevision
    }
    static func canWrite(_ snapshot: TableSnapshot, principal: String?) -> Bool {
        guard let principal, snapshot.match.status == "in_progress" else { return false }
        return snapshot.seats.contains { $0.principalId == principal && $0.status == "checked_in" }
    }
    static func canConfirmSettlement(_ snapshot: TableSnapshot, principal: String?) -> Bool {
        principal != nil && snapshot.match.ownerPrincipalId == principal &&
            snapshot.match.status == "finished" && snapshot.match.settlementConfirmed != true
    }
    static func mustClearVisibleTable(_ error: APIError) -> Bool {
        error.status == 401 || error.status == 403
    }
    static func wasRemoved(previous: TableSnapshot?, updated: TableSnapshot?,
                           status: Int?, principal: String?) -> Bool {
        guard let previous = previous, let principal = principal, previous.match.status == "preparing",
              previous.seats.contains(where: { $0.principalId == principal }) else { return false }
        if status == 403 { return true }
        return updated.map { !$0.seats.contains(where: { $0.principalId == principal }) } ?? false
    }
    static func canResend(_ command: ResultCommand?, hand: CurrentHandDTO?, handID: String) -> Bool {
        guard let command = command, let hand = hand else { return false }
        return hand.id == handID && hand.state == "open" &&
            hand.markRevision == command.confirmedMarkRevision
    }
    static func canToggle(_ seat: HandSeatDTO, points: Int, allowLowPointRiichi: Bool) -> Bool {
        if seat.isRiichi { return seat.riichiChangeUsage.cancels < 1 }
        return seat.riichiChangeUsage.declares < 2 && (allowLowPointRiichi || points >= 1000)
    }
    static func refreshAfter(_ error: APIError) -> Bool { error.status == 409 }
    static func resultError(_ error: APIError) -> String {
        switch error.code {
        case "client_event_id_conflict":
            return "请求 ID 与已有不同内容冲突；请保留原请求，核对服务端状态后重新录入。"
        case "mark_revision_mismatch", "stale_mark_revision":
            return "立直标记在预览后变化；草稿已保留，请核对标记并重新预览。"
        case "hand_already_settled":
            return "本局已由其他设备结算；请刷新牌桌核对服务端分数。"
        default: return error.localizedDescription
        }
    }
    static func seatError(_ error: APIError) -> String? {
        switch error.code {
        case "seat_taken": return "座位已被占用，请刷新牌桌后重试。"
        case "match_already_started": return "牌桌已经开局，无法再调整座次。"
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

struct ResultDraft: Codable, Equatable {
    var kind = "ron"
    var winners: [Int] = [0]
    var dealIn = 1
    var han: [Int: String] = [:]
    var fu: [Int: String] = [:]
    var yakuman: [Int: String] = [:]
    var doubleYakuman: [Int: String] = [:]
    var declarationDealIn = false
    var tenpai: [Int: Bool] = [:]
    var rivers: [Int: String] = [:]
    var called: [Int: String] = [:]
    var attested = false
}

enum ResultInputBuilder {
    static func ronCap(rules: [String: JSONValue]?, playerCount: Int) -> Int {
        switch rules?["multiRon"] {
        case .string("head_bump"): return 1
        case .string("allow_all"): return playerCount - 1
        default: return min(2, playerCount - 1)
        }
    }

    static func fieldErrors(_ draft: ResultDraft, rules: [String: JSONValue]?) -> [String: String] {
        guard draft.kind == "ron" || draft.kind == "tsumo" else { return [:] }
        var errors: [String: String] = [:]
        for seat in draft.winners {
            let ordinary = Int(draft.yakuman[seat, default: "0"])
            let special = Int(draft.doubleYakuman[seat, default: "0"])
            let ordinaryCap = rules?["compositeYakuman"] == .bool(true) ? 10 : 1
            if ordinary.map({ (0...ordinaryCap).contains($0) }) != true {
                errors["\(seat).yakuman"] = "普通役满数须为 0–\(ordinaryCap) 的整数"
            }
            if special.map({ (0...10).contains($0) && ($0 == 0 || rules?["doubleYakuman"] == .bool(true)) }) != true {
                errors["\(seat).doubleYakuman"] = "特殊双倍役满数须为已启用规则下 0–10 的整数"
            }
            if (ordinary ?? 0) == 0 && (special ?? 0) == 0 {
                let han = Int(draft.han[seat, default: "2"])
                if han.map({ (1...130).contains($0) }) != true {
                    errors["\(seat).han"] = "番须为 1–130 的整数"
                }
                let fu = Int(draft.fu[seat, default: "30"])
                if fu.map({ (20...140).contains($0) }) != true {
                    errors["\(seat).fu"] = "符须为 20–140 的整数"
                }
            }
        }
        return errors
    }

    static func build(_ draft: ResultDraft, hand: CurrentHandDTO, seats: [SeatDTO],
                      rules: [String: JSONValue]?) -> [String: JSONValue]? {
        guard hand.state == "open", (3...4).contains(seats.count) else { return nil }
        let numbers = seats.sorted { $0.seatNo < $1.seatNo }.map(\.seatNo)
        let kind = draft.kind
        guard kind == "ron" || !draft.declarationDealIn else { return nil }
        if kind == "ryuukyoku" {
            return ["kind": .string(kind), "winners": .array([]),
                    "tenpai": .array(numbers.map { .bool(draft.tenpai[$0] ?? false) })]
        }
        let winners = draft.winners.sorted()
        guard !winners.isEmpty, Set(winners).count == winners.count,
              winners.allSatisfy(numbers.contains) else { return nil }
        if kind == "ron" {
            guard winners.count <= ronCap(rules: rules, playerCount: numbers.count),
                  numbers.contains(draft.dealIn), !winners.contains(draft.dealIn),
                  !draft.declarationDealIn || hand.seats.contains(where: {
                      $0.seatNo == draft.dealIn && $0.isRiichi
                  }) else { return nil }
        } else if kind == "tsumo" {
            guard winners.count == 1 else { return nil }
        } else if kind == "nagashi_mangan" {
            guard rules?["nagashiManganEnabled"] == .bool(true), draft.attested else { return nil }
            var eligibility: [JSONValue] = []
            for winner in winners {
                let raw = draft.rivers[winner, default: ""]
                    .split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == "，" }).map(String.init)
                guard draft.called[winner, default: ""].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      !raw.isEmpty, raw.allSatisfy({ tile in
                          let chars = Array(tile)
                          return chars.count == 2 &&
                              (("19".contains(chars[0]) && "mps".contains(chars[1])) ||
                               ("1234567".contains(chars[0]) && chars[1] == "z"))
                      }) else { return nil }
                eligibility.append(.object(["seatNo": .number(Double(winner)),
                    "discards": .array(raw.map { .object(["tile": .string($0), "called": .bool(false)]) })]))
            }
            return ["kind": .string(kind),
                    "winners": .array(winners.map { .object(["seatNo": .number(Double($0)),
                                                             "han": .number(5), "fu": .number(30)]) }),
                    "tenpai": .array(numbers.map { .bool(draft.tenpai[$0] ?? false) }),
                    "nagashiEligibility": .array(eligibility)]
        } else { return nil }
        var entries: [JSONValue] = []
        for winner in winners {
            let yakumanText = draft.yakuman[winner, default: "0"]
            let doubleText = draft.doubleYakuman[winner, default: "0"]
            guard let yakuman = Int(yakumanText), (0...(rules?["compositeYakuman"] == .bool(true) ? 10 : 1)).contains(yakuman),
                  let double = Int(doubleText), (0...10).contains(double),
                  double == 0 || rules?["doubleYakuman"] == .bool(true) else { return nil }
            let isYakuman = yakuman > 0 || double > 0
            let han: Int
            let fu: Int
            if isYakuman {
                han = 1
                fu = 30
            } else {
                guard let enteredHan = Int(draft.han[winner, default: "2"]), (1...130).contains(enteredHan),
                      let enteredFu = Int(draft.fu[winner, default: "30"]), (20...140).contains(enteredFu) else { return nil }
                han = enteredHan
                fu = enteredFu
            }
            var entry: [String: JSONValue] = ["seatNo": .number(Double(winner)),
                                               "han": .number(Double(han)),
                                               "fu": .number(Double(fu))]
            if yakuman > 0 { entry["yakumanCount"] = .number(Double(yakuman)) }
            if double > 0 { entry["doubleYakumanCount"] = .number(Double(double)) }
            if kind == "ron" { entry["dealInSeatNo"] = .number(Double(draft.dealIn)) }
            entries.append(.object(entry))
        }
        var result: [String: JSONValue] = ["kind": .string(kind), "winners": .array(entries)]
        if kind == "ron", draft.declarationDealIn {
            result["riichiDeclarationDealInSeatNo"] = .number(Double(draft.dealIn))
        }
        return result
    }
}

/// Private app-support files contain drafts and verbatim pending POST bytes, never the bearer token.
struct OnlinePrivateStore {
    let root: URL
    static var live: Self {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return Self(root: support.appendingPathComponent("OnlineResults", isDirectory: true))
    }
    private func component(_ text: String) -> String {
        Data(text.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "=", with: "")
    }
    private func directory(_ principal: String) -> URL {
        root.appendingPathComponent(component(principal), isDirectory: true)
    }
    private func pendingURL(principal: String, match: String) -> URL {
        directory(principal).appendingPathComponent("\(component(match)).pending")
    }
    private func draftURL(principal: String, match: String, hand: String) -> URL {
        directory(principal).appendingPathComponent("\(component(match)).\(component(hand)).draft")
    }
    private func save<T: Encodable>(_ value: T, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.complete])
        try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtection])
    }
    func savePending(_ body: Data, handID: String, principal: String, match: String) throws {
        if let existing = try loadPending(principal: principal, match: match) {
            guard existing.handID == handID && existing.body == body else {
                throw APIError(status: nil, message: "已有未确认结算请求，请先处理旧请求")
            }
            return
        }
        try save(PendingResultEnvelope(handID: handID, body: body, principal: principal, match: match),
                 to: pendingURL(principal: principal, match: match))
    }
    func loadPending(principal: String, match: String) throws -> PendingResultEnvelope? {
        let url = pendingURL(principal: principal, match: match)
        if !FileManager.default.fileExists(atPath: url.path) {
            guard let legacy = try LegacyKeychainResultStore.load(principal: principal, match: match) else { return nil }
            let migrated = try PendingResultEnvelope(handID: legacy.handID, body: legacy.body,
                                                     principal: principal, match: match)
            try save(migrated, to: url)
            LegacyKeychainResultStore.clear(principal: principal, match: match)
            return migrated
        }
        let data = try Data(contentsOf: url)
        if let old = try? JSONDecoder().decode(LegacyPendingResultEnvelope.self, from: data) {
            let migrated = try PendingResultEnvelope(handID: old.handID, body: old.body,
                                                    principal: principal, match: match)
            try save(migrated, to: url)
            return migrated
        }
        let record = try JSONDecoder().decode(PendingResultEnvelope.self, from: data)
        guard record.principalId == principal, record.matchId == match else {
            throw APIError(status: nil, message: "待确认请求身份不符")
        }
        return record
    }
    func clearPending(principal: String, match: String) throws {
        let url = pendingURL(principal: principal, match: match)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        LegacyKeychainResultStore.clear(principal: principal, match: match)
    }
    func saveDraft(_ draft: ResultDraft, principal: String, match: String, hand: String) throws {
        try save(draft, to: draftURL(principal: principal, match: match, hand: hand))
    }
    func loadDraft(principal: String, match: String, hand: String) throws -> ResultDraft? {
        let url = draftURL(principal: principal, match: match, hand: hand)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(ResultDraft.self, from: Data(contentsOf: url))
    }
    func clearDraft(principal: String, match: String, hand: String) throws {
        let url = draftURL(principal: principal, match: match, hand: hand)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
    func clearPrincipal(_ principal: String) throws {
        let url = directory(principal)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
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
                    .accessibilityLabel("签到链接二维码")
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


private struct PendingResolutionInput {
    let body: Data
    let handID: String
    let command: ResultCommand?
}

private struct ResultEntryInput {
    let hand: CurrentHandDTO
    let principal: String
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
    @State private var pendingCommand: ResultCommand?
    @State private var pendingLoaded = false
    @State private var pendingReviewed = false
    @State private var reviewedHand: CurrentHandDTO?
    @State private var fromSeat: Int?
    @State private var toSeat: Int?
    @State private var memberToRemove: String?
    @State private var memberName = ""

    private var matchID: String { snapshot.match.id }
    private var base: String { "/api/matches/\(matchID)" }
    private var isOwner: Bool { session.principalID != nil && session.principalID == snapshot.match.ownerPrincipalId }
    private var signedIn: Bool { session.principalID != nil && snapshot.seats.contains { $0.principalId == session.principalID && $0.status == "checked_in" } }
    private var pendingResolutionInput: PendingResolutionInput? {
        guard signedIn, let pendingBody, let pendingHand else { return nil }
        return PendingResolutionInput(body: pendingBody, handID: pendingHand, command: pendingCommand)
    }
    private var resultEntryInput: ResultEntryInput? {
        guard let hand = snapshot.currentHand, let principal = session.principalID,
              OnlineCommandPolicy.canWrite(snapshot, principal: principal) else { return nil }
        return ResultEntryInput(hand: hand, principal: principal)
    }
    private var occupiedSeats: [SeatDTO] {
        snapshot.seats.filter { $0.principalId != nil }.sorted { $0.seatNo < $1.seatNo }
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
        Section {
            if let error { Text(error).foregroundStyle(Brand.loss).brandPanel() }
            if !OnlineCommandPolicy.canWrite(snapshot, principal: session.principalID) &&
                !OnlineCommandPolicy.canConfirmSettlement(snapshot, principal: session.principalID) &&
                !(isOwner && snapshot.match.status == "preparing") {
                Text("当前身份未签到入座，仅可只读查看牌桌；写入操作需由已签到玩家执行。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted).brandPanel()
            }
            if let code = snapshot.match.joinCode, isOwner, snapshot.match.status == "preparing" {
                LabeledContent {
                    Text(code).foregroundStyle(Brand.muted)
                } label: { Text("房间码").foregroundStyle(Brand.text) }
                .brandPanel()
                Button("复制房间码") { UIPasteboard.general.string = code }.brandPanel()
            }
            preparingControls
            handControls
            if OnlineCommandPolicy.canWrite(snapshot, principal: session.principalID) && !pendingLoaded {
                Button("重试读取安全保存的结算请求") { loadPending() }.brandPanel()
            }
            pendingResolutionControls
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
                }.disabled(busy).brandPanel()
                if let currentTerminal = terminal, terminalVersion == snapshot.match.version {
                    ForEach(currentTerminal.standings.sorted { $0.rank < $1.rank }, id: \.seatNo) { standing in
                        Text("第 \(standing.rank) 名 · \(standing.seatNo + 1) 号位 · \(Double(standing.totalTenths) / 10) 分")
                            .brandPanel()
                    }
                    if OnlineCommandPolicy.canConfirmSettlement(snapshot, principal: session.principalID) {
                        Button("房主确认终局结算") {
                            execute { let _: CommandReceiptDTO = try await session.api.post("\(base)/settlement/confirm") }
                        }.disabled(busy).brandPanel()
                    }
                }
            }
        } header: { BrandSectionHeader("牌桌操作") }
        .foregroundStyle(Brand.text)
        .tint(Brand.gold)
        .brandPanel()
        .alert("移除成员？", isPresented: Binding(
            get: { memberToRemove != nil },
            set: { if !$0 { memberToRemove = nil } }
        )) {
            Button("取消", role: .cancel) { memberToRemove = nil }
            Button("移除", role: .destructive) {
                guard let principal = memberToRemove else { return }
                memberToRemove = nil
                execute {
                    let result = try await session.api.removeMember(matchID: matchID, principalID: principal)
                    guard result.removed else { throw APIError(status: nil, message: "服务器未确认移除成员") }
                    fromSeat = nil; toSeat = nil; dealer = nil
                }
            }
        } message: {
            Text("移除 \(memberName) 将释放其座位；对方可使用新的有效凭证重新加入。")
        }
        .sheet(isPresented: $showResult) {
            if let input = resultEntryInput {
                NavigationStack {
                    ResultEntry(snapshot: snapshot, hand: input.hand, api: session.api, principal: input.principal,
                                onAccessDenied: { await onUpdated() }) { body in
                        guard session.principalID == input.principal,
                              OnlineCommandPolicy.canWrite(snapshot, principal: input.principal) else {
                            throw APIError(status: 403, message: "当前身份已无本局写入权限")
                        }
                        try OnlinePrivateStore.live.savePending(body, handID: input.hand.id, principal: input.principal, match: matchID)
                        pendingBody = body
                        pendingHand = input.hand.id
                        pendingCommand = try JSONDecoder().decode(ResultCommand.self, from: body)
                        pendingReviewed = false
                        reviewedHand = nil
                        do {
                            let hand = input.hand
                            let _: PaymentPreviewDTO = try await session.api.postRaw("\(base)/hands/\(hand.id)/results", data: body)
                            try OnlinePrivateStore.live.clearPending(principal: input.principal, match: matchID)
                            if session.principalID == input.principal {
                                pendingBody = nil
                                pendingHand = nil
                                pendingCommand = nil
                            }
                            try? OnlinePrivateStore.live.clearDraft(principal: input.principal, match: matchID, hand: input.hand.id)
                            showResult = false
                            await onUpdated()
                        } catch {
                            if let failure = error as? APIError,
                               failure.code == "hand_already_settled" ||
                               failure.code == "mark_revision_mismatch" {
                                await resolvePending()
                            } else {
                                await onUpdated()
                            }
                            throw error
                        }
                    }
                }
            }
        }
        .task(id: session.principalID) {
            loadPending()
            if pendingBody != nil { await resolvePending() }
        }
        .task(id: invitation?.token) {
            guard let invitation = invitation, let expires = InvitationClock.expiration(invitation.expiresAt) else { return }
            let seconds = max(0, min(600, expires.timeIntervalSinceNow))
            do { try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
            catch { return }
            if !Task.isCancelled { invitationExpired = true }
        }
    }
    @ViewBuilder private var pendingResolutionControls: some View {
        if let input = pendingResolutionInput {
            Text("结果未确认：待确认请求必须先核对，不能编辑后复用旧 clientEventId。")
                .foregroundStyle(Brand.muted).brandPanel()
            if let command = input.command, snapshot.currentHand?.id == input.handID,
               snapshot.currentHand?.markRevision != command.confirmedMarkRevision {
                Text("立直标记版本已变化；旧请求不可更改版本后重发。请核对标记并重新预览。")
                    .foregroundStyle(Brand.gold).brandPanel()
            }
            Button("刷新确认服务端状态") { Task { await resolvePending() } }
                .disabled(busy).brandPanel()
            Button("原样重发结算请求") {
                execute {
                    guard let principal = session.principalID,
                          OnlineCommandPolicy.canWrite(snapshot, principal: principal),
                          pendingReviewed,
                          OnlineCommandPolicy.canResend(input.command, hand: reviewedHand, handID: input.handID),
                          OnlineCommandPolicy.canResend(input.command, hand: snapshot.currentHand, handID: input.handID) else {
                        throw APIError(status: nil, message: "标记已变化或尚未刷新核对，请重新预览")
                    }
                    let pendingHand = input.handID
                    let _: PaymentPreviewDTO = try await session.api.postRaw("\(base)/hands/\(pendingHand)/results", data: input.body)
                    try OnlinePrivateStore.live.clearPending(principal: principal, match: matchID)
                    if session.principalID == principal {
                        pendingBody = nil; self.pendingHand = nil; pendingCommand = nil
                    }
                    try? OnlinePrivateStore.live.clearDraft(principal: principal, match: matchID, hand: input.handID)
                }
            }.disabled(busy || !pendingReviewed ||
                        !OnlineCommandPolicy.canWrite(snapshot, principal: session.principalID) ||
                        !OnlineCommandPolicy.canResend(input.command, hand: reviewedHand, handID: input.handID) ||
                        !OnlineCommandPolicy.canResend(input.command, hand: snapshot.currentHand, handID: input.handID))
                .brandPanel()
        }
    }
    @ViewBuilder private var preparingControls: some View {
            if isOwner && snapshot.match.status == "preparing" {
                Text("访客通过签到链接或房间码直接选择空座入座；加入者会实时显示在下方。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted).brandPanel()
                if !occupiedSeats.isEmpty {
                    Group {
                        Text("已加入成员 · 调整座次").font(Brand.font(.headline)).brandPanel()
                        ForEach(occupiedSeats) { seat in
                            HStack {
                                Text("\(seat.seatNo + 1) 号位 · \(seat.displayName ?? "未命名")")
                                Spacer()
                                if seat.principalId != snapshot.match.ownerPrincipalId, let principal = seat.principalId {
                                    Button("移除") {
                                        memberName = seat.displayName ?? "此成员"
                                        memberToRemove = principal
                                    }
                                    .disabled(busy)
                                }
                            }
                            .brandPanel()
                        }
                        Picker("从座位", selection: $fromSeat) {
                            Text("选择成员").tag(Int?.none)
                            ForEach(occupiedSeats) { seat in
                                Text("\(seat.seatNo + 1) 号位 · \(seat.displayName ?? "未命名")").tag(Optional(seat.seatNo))
                            }
                        }.brandPanel()
                        Picker("到座位", selection: $toSeat) {
                            Text("选择目标").tag(Int?.none)
                            ForEach(0..<snapshot.match.playerCount, id: \.self) { number in
                                let occupant = snapshot.seats.first { $0.seatNo == number }
                                Text("\(number + 1) 号位 · \(occupant?.displayName ?? "空座")").tag(Optional(number))
                            }
                        }.brandPanel()
                        Button(snapshot.seats.contains { $0.seatNo == toSeat && $0.principalId != nil }
                               ? "交换座位" : "移动到空座") {
                            guard let fromSeat = fromSeat, let toSeat = toSeat, fromSeat != toSeat,
                                  occupiedSeats.contains(where: { $0.seatNo == fromSeat }),
                                  (0..<snapshot.match.playerCount).contains(toSeat) else { return }
                            execute {
                                do {
                                    let _: ReassignSeatResultDTO = try await session.api.reassignSeat(matchID: matchID, from: fromSeat, to: toSeat)
                                    self.fromSeat = nil
                                    self.toSeat = nil
                                    dealer = nil
                                } catch let failure as APIError {
                                    throw APIError(status: failure.status, code: failure.code,
                                                   retryAfter: failure.retryAfter,
                                                   message: OnlineCommandPolicy.seatError(failure) ?? failure.localizedDescription)
                                }
                            }
                        }
                        .disabled(busy || fromSeat == nil || toSeat == nil || fromSeat == toSeat ||
                                  !occupiedSeats.contains(where: { $0.seatNo == fromSeat }))
                        .brandPanel()
                    }
                }
                ForEach(snapshot.seats.sorted { $0.seatNo < $1.seatNo }) { seat in
                    if seat.principalId == nil || (seat.principalId == session.principalID && seat.status != "checked_in") {
                        Button("房主选择 \(seat.seatNo + 1) 号位") {
                            execute {
                                let _: [String: JSONValue] = try await session.api.post("\(base)/seats/claim", body: SeatClaim(seatNo: seat.seatNo))
                                dealer = nil
                            }
                        }.disabled(busy).brandPanel()
                    }
                }
                Button("生成单人签到链接（10 分钟）") {
                    execute {
                        invitation = nil
                        invitationExpired = false
                        issuingCount = snapshot.seats.filter { $0.status == "checked_in" }.count
                        invitation = try await session.api.post("\(base)/check-in-tokens")
                    }
                }.disabled(busy).brandPanel()
                if let invitationURL {
                    InvitationQR(link: invitationURL).brandPanel()
                    Button("复制签到链接") { UIPasteboard.general.string = invitationURL }.brandPanel()
                    Text("签入凭证仅供一人使用。请勿公开转发；使用或过期后需重新生成。")
                        .font(Brand.font(.footnote)).foregroundStyle(Brand.muted).brandPanel()
                }
                Picker("指定起家（可选）", selection: $dealer) {
                    Text("服务器随机").tag(Int?.none)
                    ForEach(snapshot.seats) { seat in Text("\(seat.seatNo + 1) 号位").tag(Optional(seat.seatNo)) }
                }.brandPanel()
                Button("全员签到后确认座次") {
                    execute {
                        let _: [String: JSONValue] = try await session.api.post("\(base)/seats/finalize", body: FinalizeSeats(dealerSeatNo: dealer))
                    }
                }
                .disabled(busy || snapshot.seats.count != snapshot.match.playerCount || snapshot.seats.contains { $0.status != "checked_in" })
                .brandPanel()
            }
    }
    @ViewBuilder private var handControls: some View {
            if OnlineCommandPolicy.canWrite(snapshot, principal: session.principalID) {
                if let hand = snapshot.currentHand, hand.state == "open" {
                    ForEach(hand.seats, id: \.seatNo) { seat in
                        let used = seat.riichiChangeUsage
                        let points = snapshot.seats.first { $0.seatNo == seat.seatNo }?.points ?? 0
                        let lowAllowed = snapshot.match.rulesSnapshot?["allowLowPointRiichi"] == .bool(true)
                        let markTitle: String = "\(seat.seatNo + 1) 号位 · \(seat.isRiichi ? "取消立直" : "宣言立直") · 宣言 \(used.declares)/2 取消 \(used.cancels)/1"
                        let toggleDisabled: Bool = busy || !OnlineCommandPolicy.canToggle(seat, points: points, allowLowPointRiichi: lowAllowed)
                        Button(markTitle) {
                            execute {
                                let _: CommandReceiptDTO = try await session.api.post("\(base)/hands/\(hand.id)/marks", body: MarkCommand(seatNo: seat.seatNo, riichi: !seat.isRiichi, expectedMarkRevision: hand.markRevision))
                            }
                        }
                        .disabled(toggleDisabled).brandPanel()
                    }
                    Button("录入本局结果") { showResult = true }
                        .disabled(busy || !pendingLoaded || pendingBody != nil)
                        .accessibilityIdentifier("online.table.resultEntry").brandPanel()
                } else {
                    Button("新开一局") {
                        execute { let _: [String: JSONValue] = try await session.api.post("\(base)/hands") }
                    }.disabled(busy).brandPanel()
                    if isOwner, snapshot.match.rulesSnapshot?["automaticEndPolicy"] != .string("ranked_sanma") {
                        Button("终局") {
                            execute { let _: [String: JSONValue] = try await session.api.post("\(base)/finish") }
                        }.disabled(busy).brandPanel()
                    }
                }
            }
    }
    private func resolvePending() async {
        guard let principal = session.principalID, let handID = pendingHand, pendingCommand != nil else { return }
        pendingReviewed = false
        reviewedHand = nil
        do {
            let latest: TableSnapshot = try await session.api.get(base)
            guard session.principalID == principal, pendingHand == handID else { return }
            switch OnlineCommandPolicy.pendingResolution(pendingCommand, handID: handID, snapshot: latest) {
            case .settled:
                try clearPending()
                try? OnlinePrivateStore.live.clearDraft(principal: principal, match: matchID, hand: handID)
                error = "本局已由服务端结算，已清除待确认请求。"
            case .changedRevision:
                try clearPending()
                error = "立直标记已变化，请重新预览；旧请求不可重发，草稿已保留。"
            case .sameRevision:
                reviewedHand = latest.currentHand
                pendingReviewed = true
            case .unverified:
                error = "未能确认本局状态，待确认请求仍保留。"
            }
            await onUpdated()
        } catch {
            self.error = "结果未确认：刷新失败，暂不可重发。\(error.localizedDescription)"
            if let failure = error as? APIError, OnlineCommandPolicy.mustClearVisibleTable(failure) {
                await onUpdated()
            }
        }
    }
    private func loadPending() {
        pendingReviewed = false
        reviewedHand = nil
        pendingLoaded = false
        guard let principal = session.principalID else {
            pendingBody = nil; pendingHand = nil
            pendingCommand = nil
            return
        }
        do {
            let saved = try OnlinePrivateStore.live.loadPending(principal: principal, match: matchID)
            pendingBody = saved?.body
            pendingCommand = try saved.map { try JSONDecoder().decode(ResultCommand.self, from: $0.body) }
            pendingHand = saved?.handID
            pendingLoaded = true
        } catch let loadError { error = loadError.localizedDescription }
    }
    private func clearPending() throws {
        if let principal = session.principalID {
            try OnlinePrivateStore.live.clearPending(principal: principal, match: matchID)
        }
        pendingBody = nil; pendingHand = nil
        pendingReviewed = false
        reviewedHand = nil
        pendingCommand = nil
    }
    private func execute(refresh: Bool = true, _ operation: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true; error = nil
        Task {
            do { try await operation(); if refresh { await onUpdated() } }
            catch {
                if let failure = error as? APIError,
                   OnlineCommandPolicy.refreshAfter(failure) || OnlineCommandPolicy.mustClearVisibleTable(failure) {
                    await onUpdated()
                }
                self.error = (error as? APIError).map(OnlineCommandPolicy.resultError) ?? error.localizedDescription
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
    let principal: String
    let onAccessDenied: () async -> Void
    let onConfirm: (Data) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ResultDraft()
    @State private var preview: PaymentPreviewDTO?
    @State private var binding: String?
    @State private var busy = false
    @State private var error: String?
    @State private var initialDraft = ResultDraft()
    @State private var draftReady = false
    @State private var submitted = false
    @State private var revisionChanged = false
    @State private var confirmClose = false
    private var seats: [SeatDTO] { snapshot.seats.sorted { $0.seatNo < $1.seatNo } }
    private var base: String { "/api/matches/\(snapshot.match.id)/hands/\(hand.id)" }
    private var input: [String: JSONValue]? {
        ResultInputBuilder.build(draft, hand: hand, seats: seats, rules: snapshot.match.rulesSnapshot)
    }
    private var inputBinding: String? {
        guard let input else { return nil }
        return OnlineCommandPolicy.previewBinding(handID: hand.id, revision: hand.markRevision, input: input)
    }
    private func nextHandText(_ preview: PaymentPreviewDTO) -> String {
        "下一局：\(preview.nextHand.roundWind) \(preview.nextHand.roundNumber) · 庄 \(preview.nextHand.dealerSeatNo + 1) · 本场 \(preview.nextHand.honba) · 供托 \(preview.nextHand.riichiPool) 点"
    }
    var body: some View {
        Form {
            ResultInputFields(draft: $draft, snapshot: snapshot, hand: hand)
            if let error { Section { Text(error).foregroundStyle(Brand.loss).brandPanel() } }
            Section {
                Button("计算逐座支付") { Task { await fetchPreview() } }
                    .disabled(input == nil || busy || !draftReady)
                    .accessibilityIdentifier("online.result.preview").brandPanel()
                if let paymentPreview = preview, binding == inputBinding {
                    ForEach(paymentPreview.perSeat, id: \.seatNo) { payment in
                        VStack(alignment: .leading) {
                            Text("\(payment.seatNo + 1) 号位：\(payment.netPoints >= 0 ? "+" : "")\(payment.netPoints) 点").monospacedDigit()
                            ForEach(0..<payment.breakdown.count, id: \.self) { index in
                                Text("\(payment.breakdown[index].reason)：\(payment.breakdown[index].amount)")
                                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                            }
                        }
                        .brandPanel()
                    }
                    Text(nextHandText(paymentPreview)).foregroundStyle(Brand.muted).brandPanel()
                    Button("确认并结算") { Task { await submit() } }
                        .disabled(busy || submitted || !draftReady)
                        .accessibilityIdentifier("online.result.confirm").brandPanel()
                } else {
                    Text(revisionChanged ? "立直标记已变化，请重新预览" : "输入变化后，请重新预览。")
                        .foregroundStyle(Brand.muted).brandPanel()
                }
            } header: { BrandSectionHeader("服务器支付预览") }
        }
        .scrollContentBackground(.hidden)
        .foregroundStyle(Brand.text)
        .background(Brand.background)
        .tint(Brand.gold)
        .navigationTitle("本局结算")
        .toolbar { ToolbarItem(placement: .cancellationAction) {
            Button("关闭") {
                if submitted || preview != nil || draft != initialDraft { confirmClose = true }
                else { dismiss() }
            }.disabled(busy)
        } }
        .interactiveDismissDisabled()
        .onAppear {
            do {
                if let saved = try OnlinePrivateStore.live.loadDraft(
                    principal: principal, match: snapshot.match.id, hand: hand.id) {
                    draft = saved
                }
                initialDraft = draft
                draftReady = true
            } catch { self.error = "草稿无法读取，请保留原文件并检查设备存储：\(error.localizedDescription)" }
        }
        .alert("关闭录入？", isPresented: $confirmClose) {
            Button("继续录入", role: .cancel) {}
            Button("保存草稿并关闭") { dismiss() }
        } message: {
            Text(submitted ? "请求可能仍在服务器处理中。请回牌桌查看待确认请求及服务器状态。" : "输入已按当前身份和局保存在本机；关闭后可以继续录入，预览须重新计算。")
        }
        .onChange(of: draft.kind) { _, kind in
            if kind != "ron" { draft.declarationDealIn = false }
        }
        .onChange(of: draft.dealIn) { _, discarder in
            if !hand.seats.contains(where: { $0.seatNo == discarder && $0.isRiichi }) {
                draft.declarationDealIn = false
            }
        }
        .onChange(of: inputBinding) { _, _ in preview = nil; binding = nil }
        .onChange(of: hand.markRevision) { _, _ in
            revisionChanged = true
            preview = nil
            binding = nil
        }
        .onChange(of: draft) { _, changed in
            guard draftReady && !submitted else { return }
            do {
                try OnlinePrivateStore.live.saveDraft(changed, principal: principal,
                                                       match: snapshot.match.id, hand: hand.id)
            } catch {
                draftReady = false
                self.error = "草稿保存失败，已禁止提交：\(error.localizedDescription)"
            }
        }
    }
    private func fetchPreview() async {
        guard draftReady, let input, let key = inputBinding else { return }
        busy = true; error = nil; preview = nil; binding = nil
        defer { busy = false }
        do {
            let result: PaymentPreviewDTO = try await api.post("\(base)/preview", body: ResultPreviewCommand(resultInput: input))
            guard result.perSeat.count == seats.count,
                  Set(result.perSeat.map(\.seatNo)) == Set(seats.map(\.seatNo)) else {
                throw APIError(status: nil, message: "服务器未返回完整逐座支付")
            }
            if inputBinding == key { preview = result; binding = key }
        } catch {
            if let failure = error as? APIError, OnlineCommandPolicy.mustClearVisibleTable(failure) {
                await onAccessDenied()
            }
            self.error = error.localizedDescription
        }
    }
    private func submit() async {
        guard draftReady, !busy, !submitted, preview != nil, binding == inputBinding, let input else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let command = ResultCommand(resultInput: input, confirmedMarkRevision: hand.markRevision, clientEventId: UUID().uuidString)
            let body = try JSONEncoder().encode(command)
            submitted = true
            try await onConfirm(body)
        } catch {
            self.error = (error as? APIError).map(OnlineCommandPolicy.resultError) ?? error.localizedDescription
        }
    }
}
/// The same winner, tenpai, yakuman and full river inputs serve online and offline settlement.
@MainActor
struct ResultInputFields: View {
    @Binding var draft: ResultDraft
    let snapshot: TableSnapshot
    let hand: CurrentHandDTO
    private var seats: [SeatDTO] { snapshot.seats.sorted { $0.seatNo < $1.seatNo } }
    private var nagashiEnabled: Bool { snapshot.match.rulesSnapshot?["nagashiManganEnabled"] == .bool(true) }
    private var fieldErrors: [String: String] {
        ResultInputBuilder.fieldErrors(draft, rules: snapshot.match.rulesSnapshot)
    }
    private var input: [String: JSONValue]? {
        ResultInputBuilder.build(draft, hand: hand, seats: seats, rules: snapshot.match.rulesSnapshot)
    }
    var body: some View {
            Section {
                Picker("结果类型", selection: $draft.kind) {
                    Text("荣和").tag("ron"); Text("自摸").tag("tsumo"); Text("荒牌流局").tag("ryuukyoku")
                    if nagashiEnabled { Text("流局满贯").tag("nagashi_mangan") }
                }.brandPanel()
                if draft.kind == "ron" {
                    Picker("放铳座位", selection: $draft.dealIn) {
                        ForEach(seats) { Text("\($0.seatNo + 1) 号位").tag($0.seatNo) }
                    }.brandPanel()
                    if hand.seats.contains(where: { $0.seatNo == draft.dealIn && $0.isRiichi }) {
                        Toggle("放铳牌是立直宣言牌（不扣宣言棒）", isOn: $draft.declarationDealIn).brandPanel()
                    }
                }
                winningControls
                if draft.kind == "ryuukyoku" || draft.kind == "nagashi_mangan" {
                    ForEach(seats) { seat in
                        Toggle("\(seat.seatNo + 1) 号位听牌", isOn: Binding(
                            get: { draft.tenpai[seat.seatNo] ?? false },
                            set: { draft.tenpai[seat.seatNo] = $0 })).brandPanel()
                    }
                }
                if input == nil {
                    Text("请填写合法座位、每位赢家番符及役满数；流满须提供每位赢家完整的弃牌河。")
                        .foregroundStyle(Brand.loss).brandPanel()
                }
            } header: { BrandSectionHeader("支付输入") }
            .foregroundStyle(Brand.text)
            .tint(Brand.gold)
            .brandPanel()
    }
    @ViewBuilder private var winningControls: some View {
                if draft.kind == "ron" || draft.kind == "tsumo" || draft.kind == "nagashi_mangan" {
                    ForEach(seats) { seat in
                        winnerSeatFields(seat)
                    }
                    if draft.kind == "nagashi_mangan" {
                        Toggle("确认每位赢家的弃牌河完整且未被鸣走", isOn: $draft.attested).brandPanel()
                    }
                }
    }
    @ViewBuilder private func winnerSeatFields(_ seat: SeatDTO) -> some View {
                        let number = seat.seatNo
                        if draft.kind == "ron" || draft.kind == "nagashi_mangan" {
                            let winnerBinding: Binding<Bool> = Binding(
                                get: { draft.winners.contains(number) },
                                set: { selected in
                                    if selected && !draft.winners.contains(number) &&
                                        (draft.kind != "ron" || draft.winners.count <
                                         ResultInputBuilder.ronCap(rules: snapshot.match.rulesSnapshot,
                                                                   playerCount: seats.count)) {
                                        draft.winners.append(number)
                                    }
                                    if !selected { draft.winners.removeAll { $0 == number } }
                                })
                            let selectionDisabled: Bool = draft.kind == "ron" && !draft.winners.contains(number) &&
                                (number == draft.dealIn || draft.winners.count >=
                                 ResultInputBuilder.ronCap(rules: snapshot.match.rulesSnapshot,
                                                           playerCount: seats.count))
                            Toggle("\(number + 1) 号位 · \(seat.displayName ?? "未命名")和牌", isOn: winnerBinding)
                                .disabled(selectionDisabled).brandPanel()
                        } else {
                            Button("\(number + 1) 号位 · \(seat.displayName ?? "未命名")\(draft.winners == [number] ? " ✓" : "")") {
                                draft.winners = [number]
                            }.brandPanel()
                        }
                        if draft.winners.contains(number) {
                            if draft.kind == "nagashi_mangan" {
                                TextField("按顺序填写完整幺九弃牌，如 1m 9m 1z",
                                          text: field(number, keyPath: \.rivers),
                                          prompt: Text("按顺序填写完整幺九弃牌，如 1m 9m 1z").foregroundColor(Brand.muted))
                                    .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                                    .brandPanel()
                                TextField("被鸣走弃牌（如有则不能流满）",
                                          text: field(number, keyPath: \.called),
                                          prompt: Text("被鸣走弃牌（如有则不能流满）").foregroundColor(Brand.muted))
                                    .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                                    .brandPanel()
                            } else {
                                if (Int(draft.yakuman[number, default: "0"]) ?? 0) == 0 &&
                                    (Int(draft.doubleYakuman[number, default: "0"]) ?? 0) == 0 {
                                    TextField("\(number + 1) 号位番 1–130",
                                              text: field(number, keyPath: \.han, fallback: "2"),
                                              prompt: Text("\(number + 1) 号位番 1–130").foregroundColor(Brand.muted))
                                        .keyboardType(.numberPad)
                                        .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                                        .brandPanel()
                                    if let fieldError = fieldErrors["\(number).han"] {
                                        Text(fieldError).foregroundStyle(Brand.loss).brandPanel()
                                    }
                                    TextField("\(number + 1) 号位符 20–140",
                                              text: field(number, keyPath: \.fu, fallback: "30"),
                                              prompt: Text("\(number + 1) 号位符 20–140").foregroundColor(Brand.muted))
                                        .keyboardType(.numberPad)
                                        .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                                        .brandPanel()
                                    if let fieldError = fieldErrors["\(number).fu"] {
                                        Text(fieldError).foregroundStyle(Brand.loss).brandPanel()
                                    }
                                } else {
                                    Text("役满按引擎要求提交番 1、符 30")
                                        .font(Brand.font(.footnote)).foregroundStyle(Brand.muted).brandPanel()
                                }
                                let ordinaryCap = snapshot.match.rulesSnapshot?["compositeYakuman"] == .bool(true) ? 10 : 1
                                TextField("\(number + 1) 号位普通役满数 0–\(ordinaryCap)",
                                          text: field(number, keyPath: \.yakuman, fallback: "0"),
                                          prompt: Text("\(number + 1) 号位普通役满数 0–\(ordinaryCap)").foregroundColor(Brand.muted))
                                    .keyboardType(.numberPad)
                                    .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                                    .brandPanel()
                                if let fieldError = fieldErrors["\(number).yakuman"] {
                                    Text(fieldError).foregroundStyle(Brand.loss).brandPanel()
                                }
                                if snapshot.match.rulesSnapshot?["doubleYakuman"] == .bool(true) {
                                    TextField("\(number + 1) 号位特殊双倍役满数 0–10",
                                              text: field(number, keyPath: \.doubleYakuman, fallback: "0"),
                                              prompt: Text("\(number + 1) 号位特殊双倍役满数 0–10").foregroundColor(Brand.muted))
                                        .keyboardType(.numberPad)
                                        .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                                        .brandPanel()
                                    if let fieldError = fieldErrors["\(number).doubleYakuman"] {
                                        Text(fieldError).foregroundStyle(Brand.loss).brandPanel()
                                    }
                                }
                            }
                        }
    }
    private func field(_ seat: Int, keyPath: WritableKeyPath<ResultDraft, [Int: String]>,
                       fallback: String = "") -> Binding<String> {
        Binding(get: { draft[keyPath: keyPath][seat] ?? fallback },
                set: { draft[keyPath: keyPath][seat] = $0 })
    }
}
