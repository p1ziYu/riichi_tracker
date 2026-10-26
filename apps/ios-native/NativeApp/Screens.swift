import SwiftUI
import UIKit

// Shared keyboard dismissal (iosfix6, item 4): numberPad/decimalPad have no
// return key, so every form that hosts a TextField gets a keyboard toolbar
// with 完成, drag-to-dismiss, and a background tap that only fires where no
// control consumed the touch (a background tap can never steal focus from
// the TextField itself, because the field is hit-tested first).
extension View {
    func keyboardDismissal() -> some View {
        self
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
                }
            }
            .scrollDismissesKeyboard(.immediately)
            // iosfix10 P8: the iOS 27 floating keyboard toolbar pill
            // straddles the keyboard's top edge, so a focused field
            // scrolled flush above the keyboard ends up under the pill.
            // A clear bottom inset lifts the field above the pill
            // (same safeAreaInset mechanism as the undo banner, which
            // already floats correctly above the floating tab bar).
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: 72)
            }
            // NOTE (iosfix6, measured 2026-10-24): .interactively broke
            // drag-to-dismiss here — three swipeUps moved the sheet's
            // content 0pt and left the numberPad open, because a flick never
            // crosses the interactive-dismiss threshold and the keyboard
            // springs back. .immediately dismisses on scroll start, then the
            // content scrolls normally. Dismissal is the keyboard toolbar's
            // 完成 button plus drag-to-dismiss; tapping another control also
            // resigns focus.
    }
}

enum Brand {
    // iosfix6 item 2: the single leading-edge token. The large title sits
    // at 16pt (system inset), List/Form section backgrounds sit at 16pt,
    // and section headers are shifted to 16pt in BrandSectionHeader.
    // Every card and header in the app aligns to this edge.
    static let contentLeading: CGFloat = 16
    // iosfix9: the single INNER padding for card content. A bar's text,
    // a row's tile/text and the hero's content all start at
    // contentLeading + cardInnerPadding (16 + 16 = 32pt) on every
    // screen, so no bar text is ever flush against its card edge
    // (the fix8 empty-state bar was 0pt, the local strips ~4pt).
    // Boxes themselves stay on contentLeading exactly.
    static let cardInnerPadding: CGFloat = 16
    // iosfix8 item 1: the row-inset token, REVERTING fix7. fix7 set
    // this to 0 horizontal on the theory that the insetGrouped
    // section supplies 16pt; on the screens Ryan actually uses
    // (online lobby, local tab) that section inset does not move the
    // content, so rows and cards landed at the screen edge with the
    // east tile / intro text clipped. The fix is one shared EXPLICIT
    // 16pt inset applied directly to every element, and a list style
    // that supplies no section inset of its own: the two lists below
    // use .listStyle(.plain), so 16pt here is 16pt on screen, never
    // 0 and never 16+16. Hero, ongoing rows, history rows and the
    // local intro card all share this token, so hero left == row
    // left and hero right == row right on every screen. Vertical 4
    // gives 8pt gaps between cards (separators hidden).
    static let rowInsets = EdgeInsets(top: 4, leading: Brand.contentLeading, bottom: 4, trailing: Brand.contentLeading)
    // Swipe rows only: vertical 0, because their 4pt spacing lives
    // INSIDE the row (padding outside the card) so the trailing
    // delete block spans the full row slot, not just the card.
    static let swipeRowInsets = EdgeInsets(top: 0, leading: Brand.contentLeading, bottom: 0, trailing: Brand.contentLeading)
    // Hero only: the same horizontal token, plus its own 8pt vertical
    // rhythm (a lone row in its section; the gap above/below the card).
    static let heroRowInsets = EdgeInsets(top: 8, leading: rowInsets.leading, bottom: 8, trailing: rowInsets.trailing)
    static let background = Color(red: 16 / 255, green: 28 / 255, blue: 40 / 255)
    static let panel = Color(red: 28 / 255, green: 41 / 255, blue: 66 / 255)
    static let deep = Color(red: 21 / 255, green: 43 / 255, blue: 59 / 255)
    static let gold = Color(red: 196 / 255, green: 166 / 255, blue: 106 / 255)
    static let cream = Color(red: 234 / 255, green: 229 / 255, blue: 215 / 255)
    static let ink = Color(red: 24 / 255, green: 79 / 255, blue: 70 / 255)
    static let text = Color(red: 245 / 255, green: 245 / 255, blue: 239 / 255)
    static let muted = Color(red: 174 / 255, green: 189 / 255, blue: 193 / 255)
    static let gain = Color(red: 169 / 255, green: 220 / 255, blue: 172 / 255)
    static let loss = Color(red: 243 / 255, green: 169 / 255, blue: 167 / 255)
    static let hairline = Color.white.opacity(0.13)
    static func display(_ size: CGFloat) -> Font { BrandFont.display(size) }
    static func font(_ style: UIFont.TextStyle, weight: UIFont.Weight? = nil) -> Font {
        BrandFont.font(style, weight: weight)
    }
}

private struct EastTile: View {
    var size: CGFloat = 48

    var body: some View {
        Text("東")
            .font(Brand.display(size * 0.58))
            .foregroundStyle(Brand.ink)
            .frame(width: size, height: size * 1.12)
            .background(Brand.cream, in: RoundedRectangle(cornerRadius: size * 0.13))
            .overlay(RoundedRectangle(cornerRadius: size * 0.13).stroke(Color(red: 187 / 255, green: 169 / 255, blue: 135 / 255), lineWidth: 2))
            .shadow(color: Brand.gold.opacity(0.65), radius: 0, y: 3)
            .accessibilityLabel("东风牌")
    }
}

private struct BrandPanel: ViewModifier {
    func body(content: Content) -> some View {
        content
            .listRowBackground(Brand.panel)
            .listRowSeparatorTint(Brand.hairline)
    }
}

struct BrandSectionHeader: View {
    // iosfix9: a plain List lays a section header's TEXT at 16pt
    // (the List's header inset, measured by gold ink on all three
    // tabs -- the header view itself spans full width, so its
    // accessibility frame is not the text column). The plain shift
    // is therefore derived from the token, not a magic 0: if
    // contentLeading ever moves, headers move with the cards.
    // Form screens keep the old default (-contentLeading), because a
    // Form header's base is 32pt (16 section + 16 header inset).
    static let plainHeaderBase: CGFloat = 16
    static let plainLeadingShift: CGFloat = Brand.contentLeading - plainHeaderBase
    let title: String
    let leadingShift: CGFloat

    init(_ title: String, leadingShift: CGFloat = -Brand.contentLeading) {
        self.title = title
        self.leadingShift = leadingShift
    }

    var body: some View {
        Text(title)
            .font(Brand.display(17))
            .foregroundStyle(Brand.gold)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
            // iosfix6 item 2: List/Form section headers are laid out at
            // 32pt (16 section inset + 16 header inset) while the large
            // title and the card backgrounds sit at Brand.contentLeading
            // (16pt). Shift once, here, so every header in the app shares
            // the title/card leading edge instead of per-screen padding.
            // iosfix8: the plain lists below pass 0 here: a plain
            // header's base is already ~16pt, so +16 put headers at
            // 33pt (measured); 0 lands them on the 16pt card edge.
            .padding(.leading, leadingShift)
    }
}

extension View {
    func brandPanel() -> some View { modifier(BrandPanel()) }
}

extension View {
    /// iosfix10 M3: the iOS 27 floating tab bar (pill) overlays the
    /// bottom of tab content, and the List's own safe area does not
    /// clear it, so static last rows end up half-covered. A clear
    /// bottom safe-area inset lifts content above the pill (same
    /// mechanism as the undo banner, which already floats correctly
    /// above the pill). Applied to tab roots only, never to sheets
    /// (sheets cover the tab bar).
    func tabBarClearance() -> some View {
        self.safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear.frame(height: 96)
        }
    }
}

// iosfix8 item 1: the plain-list card. In .plain style
// listRowBackground fills the full screen width, so brandPanel()
// (a listRowBackground) makes rows full-width bands, not cards.
// A card must therefore be painted on the row content itself: the
// content area is already 16-385.7pt via Brand.rowInsets, so a panel
// background here spans exactly hero left == row left, hero right ==
// row right. The list row behind it is clear, separators hidden
// (cards are separated by the 4+4pt row insets instead).
struct BrandCard: ViewModifier {
    let cornerRadius: CGFloat
    func body(content: Content) -> some View {
        content
            .background(Brand.panel, in: RoundedRectangle(cornerRadius: cornerRadius))
            // iosfix9: clip the CONTENT to the same rounded shape.
            // The panel's top corners curve inward (radius 12/10) while
            // a square-ish tile does not, so an unclipped tile pokes
            // ~1pt past the corner on every list. Clipping here fixes
            // all three lists at once, with no per-row geometry.
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
    }
}

extension View {
    func brandCard(cornerRadius: CGFloat = 12) -> some View { modifier(BrandCard(cornerRadius: cornerRadius)) }
}

// iosfix8 item 2: the trailing delete row. Stock swipeActions sizes
// its button with a system inset (measured: 80pt tall on a 110.7pt
// row, 10pt off the trailing edge) -- the fix6 floating pill, and
// no listRowInsets value changes it. This row is gesture-driven
// instead (same simultaneousGesture + tap-to-collapse machinery as
// fix7's row, which proved reliable against List scroll competition
// and interrupted-drag freezes), but it is NOT full-width: the
// content slides only 88pt and a SMALL trailing gold block is
// revealed. The block's height is the row height by construction:
// it fills the row-high ZStack (maxHeight: .infinity), flush with
// the row's top and bottom edges, trailing edge on the row's
// trailing edge. The drag never deletes by itself -- tapping the
// revealed block calls onDeleteTap, which opens the existing
// Chinese confirm dialog. Opacity follows the drag so the gold
// never shows through the card's rounded corners while unrevealed.
private let trailingDeleteWidth: CGFloat = 88

struct TrailingSwipeDeleteRow<Content: View>: View {
    var cornerRadius: CGFloat = 12
    let deleteIdentifier: String
    let onDeleteTap: () -> Void
    @ViewBuilder let content: Content
    @State private var offset: CGFloat = 0
    @State private var revealed = false
    @State private var dragging = false

    private var buttonOpacity: Double {
        min(1, max(0, -offset / (trailingDeleteWidth * 0.5)))
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            Button(action: onDeleteTap) {
                Text("删除")
                    .frame(minWidth: trailingDeleteWidth, maxWidth: trailingDeleteWidth, maxHeight: .infinity)
                    .background(Brand.gold)
                    .foregroundStyle(Brand.background)
                    .font(Brand.font(.headline, weight: .semibold))
            }
                .accessibilityIdentifier(deleteIdentifier)
                .buttonStyle(.plain)
                .frame(minWidth: trailingDeleteWidth, maxWidth: trailingDeleteWidth, maxHeight: .infinity)
                .background(Brand.gold, in: UnevenRoundedRectangle(
                    topLeadingRadius: 0, bottomLeadingRadius: 0,
                    bottomTrailingRadius: cornerRadius, topTrailingRadius: cornerRadius))
                .opacity(buttonOpacity)
                .accessibilityHidden(!(revealed || offset < -trailingDeleteWidth * 0.5))
                .allowsHitTesting(revealed || offset < -trailingDeleteWidth * 0.5)
            content
                .disabled(revealed || offset != 0)
                // iosfix10 B2: the outer TapGesture that used to live here
                // swallowed the row's NavigationLink tap on all three
                // lists (lobby, history, local), so rows never navigated.
                // Collapse-on-tap is now an overlay that exists ONLY
                // while the row is swiped open, and the overlay sits
                // INSIDE the offset (offset outermost) so it rides with
                // the shifted content: its right edge stops 88pt short
                // of the row edge and never covers the delete block.
                // (Overlay after offset would sit on the unshifted
                // frame and eat delete taps — that mis-ordering failed
                // testFix8LocalSwipe/testLocalSwipeDelete in phase A.)
                // Disabled stays before the overlay so the overlay tap
                // itself is not disabled.
                .overlay {
                    if revealed || offset != 0 {
                        Color.clear
                            .contentShape(Rectangle())
                            .onTapGesture {
                                revealed = false
                                offset = 0
                            }
                    }
                }
                .offset(x: offset)
        }
        .clipped()
        // iosfix10 P5: a row hidden by undo (or scrolled away) resets to
        // its resting state, so it never reappears still swiped open.
        .onDisappear {
            revealed = false
            offset = 0
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 12, coordinateSpace: .local)
                .onChanged { value in
                    dragging = true
                    let base = revealed ? -trailingDeleteWidth : 0
                    offset = min(0, max(-trailingDeleteWidth, base + value.translation.width))
                }
                .onEnded { value in
                    dragging = false
                    if revealed {
                        revealed = !(value.translation.width > trailingDeleteWidth * 0.5)
                    } else {
                        revealed = value.translation.width < -trailingDeleteWidth * 0.5
                    }
                    offset = revealed ? -trailingDeleteWidth : 0
                }
        )
        .animation(dragging ? nil : .easeOut(duration: 0.22), value: offset)
    }
}

func localDate(_ value: String?) -> String {
    guard let value, !value.isEmpty else { return "未提供" }
    let date = ISO8601DateFormatter.standard.date(from: value)
        ?? ISO8601DateFormatter.withFractionalSeconds.date(from: value)
    guard let date else { return "时间未提供" }
    return DateFormatter.localMinute.string(from: date)
}

private extension ISO8601DateFormatter {
    static let standard = ISO8601DateFormatter()
    static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

private extension DateFormatter {
    static let localMinute: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter
    }()
}

// iosfix10 B3: shared with LocalScreens (was private; the local
// history rows need the same kind labels as the online history).
func handLabel(_ kind: String) -> String {
    switch kind.lowercased() {
    case "ron": "荣和"
    case "tsumo": "自摸"
    case "draw", "ryuukyoku", "exhaustive_draw": "流局"
    case "abortive_draw": "途中流局"
    case "nagashi_mangan": "流局满贯"
    case "chombo": "犯规罚符"
    default: "其他结果"
    }
}

private func accountLabel(_ type: String) -> String {
    switch type.lowercased() {
    case "anonymous", "guest": "访客"
    case "account", "user", "email", "registered": "注册用户"
    case "admin": "管理员"
    default: "账号类型未提供"
    }
}

private func isFinished(_ status: String) -> Bool {
    ["finished", "completed", "settled"].contains(status.lowercased())
}

private func statusLabel(_ status: String) -> String {
    switch status.lowercased() {
    case "preparing", "lobby": "等待抽风定座"
    case "active", "in_progress": "牌局进行中"
    case "finished", "completed", "settled": "牌局已结束"
    case "abandoned", "cancelled": "牌局已取消"
    default: "未知状态"
    }
}

func windLabel(_ wind: String?) -> String {
    switch wind {
    case "E": "东"
    case "S": "南"
    case "W": "西"
    case "N": "北"
    default: wind ?? "?"
    }
}

/// iosfix10 P9: point fields and preset chips share one format
/// (25,000). The field's getter formats the stored digits, so typed
/// values display grouped; parsing strips grouping separators so a
/// grouped display (or paste) still parses back to the same value.
func formatPoints(_ value: Int) -> String { value.formatted() }
func parsePoints(_ text: String) -> Int? {
    let digits = text.filter { $0.isASCII && $0.isNumber }
    guard !digits.isEmpty else { return nil }
    return Int(digits)
}

func reviewLabel(_ review: String) -> String {
    switch review.lowercased() {
    // iosfix10 P10: reviewed and approved are the same state in the
    // UI — one word (已审核) on both wizards, matching the local
    // wizard's bundled templates.
    case "approved", "verified", "reviewed": "已审核"
    case "pending", "unreviewed": "待审核"
    case "draft": "草稿"
    case "rejected": "未通过"
    default: "审核状态未提供"
    }
}

private func customRuleLabel(_ key: String) -> String {
    switch key {
    case "startingPoints": "起始点数"
    case "returnPoints": "返还点数"
    case "targetPoints": "目标点数"
    case "uma", "umaTenths": "顺位马点"
    case "fixedSouth4EndPolicy", "automaticEndPolicy", "bustEndsGame": "终局条件"
    case "terminalRiichiPoolPolicy": "终局供托分配"
    case "tiedUmaPolicy": "同点顺位"
    case "notenPenaltyTotal": "流局罚符"
    case "honbaRon", "honbaPerPayer": "本场棒"
    case "multiRon", "doubleRonHonbaPolicy": "多家荣和"
    case "allowLowPointRiichi": "低点立直"
    case "nagashiManganEnabled", "nagashiCollectsRiichiPool", "nagashiDealerRepeatRequiresTenpai": "流局满贯"
    case "tsumoLoss": "三麻自摸损"
    case "kiriageMangan": "切上满贯"
    case "kazoeYakuman", "compositeYakuman", "doubleYakuman": "役满"
    default: "其他规则调整"
    }
}

private struct RuleInfo: View {
    let snapshot: [String: JSONValue]?
    let templates: [TemplateDTO]
    let versionID: String?

    var body: some View {
        let details = ruleDetails(snapshot: snapshot, template: templates.first { $0.versionId == versionID })
        VStack(alignment: .leading, spacing: 4) {
            Text("规则：\(details.title)")
            Text("来源：\(sourceLabel(details.source)) · \(reviewLabel(details.reviewStatus))")
            Text("自定义：\(details.customizedKeys.isEmpty ? "无（按模板）" : details.customizedKeys.map(customRuleLabel).joined(separator: "、"))")
        }
        .font(Brand.font(.subheadline))
        .foregroundStyle(Brand.muted)
    }

    private func sourceLabel(_ source: String) -> String {
        switch source {
        case "system", "global", "public": "系统模板"
        case "private", "mine": "私有模板"
        default: "来源未提供"
        }
    }

}

struct AuthScreen: View {
    @ObservedObject var session: AppSession
    let joiningByLink: Bool
    init(session: AppSession, joiningByLink: Bool = false) {
        self.session = session
        self.joiningByLink = joiningByLink
    }
    @State private var registering = false
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("ACCOUNT / 账户")
                    .font(Brand.font(.caption1))
                    .foregroundStyle(Brand.gold)
                HStack(spacing: 12) {
                    EastTile(size: 38)
                    Text("登录一姬").font(Brand.display(32)).foregroundStyle(Brand.text)
                }
                HStack(spacing: 8) {
                    modeButton("邮箱登录", registering: false)
                    modeButton("注册账户", registering: true)
                }
                TextField("邮箱", text: $email, prompt: Text("邮箱").foregroundColor(Brand.muted))
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Brand.deep, in: RoundedRectangle(cornerRadius: 10))
                SecureField("密码", text: $password, prompt: Text("密码").foregroundColor(Brand.muted))
                    .textContentType(registering ? .newPassword : .password)
                    .padding(12)
                    .background(Brand.deep, in: RoundedRectangle(cornerRadius: 10))
                if registering {
                    TextField("昵称", text: $name, prompt: Text("昵称").foregroundColor(Brand.muted))
                        .textContentType(.nickname)
                        .padding(12)
                        .background(Brand.deep, in: RoundedRectangle(cornerRadius: 10))
                }
                if let error {
                    Text("登录或注册失败：\(error)")
                        .foregroundStyle(Brand.loss)
                        .accessibilityAddTraits(.updatesFrequently)
                }
                Button {
                    Task { await submit() }
                } label: {
                    Text(busy ? "请稍候…" : registering ? "注册并登录" : "登录")
                        .font(Brand.font(.body, weight: .semibold))
                        .foregroundStyle(Brand.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Brand.gold, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .disabled(busy || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty || (registering && name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                Button(joiningByLink ? "临时访客加入此桌" : "以在线临时访客进入") {
                    Task {
                        guard !busy else { return }
                        busy = true; error = nil
                        defer { busy = false }
                        do { try await session.signInGuest() }
                        // iosfix10 B1: never render a raw error (the
                        // server's English message) on the login screen.
                        catch let failure as APIError { self.error = APIErrorCopy.text(failure) }
                        catch { self.error = "网络异常，请稍后重试。" }
                    }
                }
                .disabled(busy)
                Text("访客扫码或输入房间码即可加入牌桌，等待房主抽风定座；不能开桌。本地模式不使用此身份。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                Text("本地无身份模式在“本地牌桌”标签中开桌；不登录、不创建访客、不上传。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                if let warning = session.sessionError {
                    Text(warning).font(Brand.font(.footnote)).foregroundStyle(Brand.loss)
                }
            }
            .textFieldStyle(.plain)
            .foregroundStyle(Brand.cream)
            .tint(Brand.gold)
            .padding(24)
            .background(Brand.panel, in: RoundedRectangle(cornerRadius: 18))
            .padding(24)
            .frame(maxWidth: 540)
            .frame(maxWidth: .infinity)
        }
        .background(Brand.background)
        .keyboardDismissal()
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
    }

    private func modeButton(_ title: String, registering mode: Bool) -> some View {
        Button(title) { registering = mode }
            .font(Brand.font(.subheadline, weight: .semibold))
            .foregroundStyle(registering == mode ? Brand.background : Brand.cream)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(registering == mode ? Brand.gold : Brand.deep, in: RoundedRectangle(cornerRadius: 8))
            .buttonStyle(.plain)
            .accessibilityValue(registering == mode ? "已选中" : "未选中")
    }

    @MainActor private func submit() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await session.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password, name: registering ? name.trimmingCharacters(in: .whitespacesAndNewlines) : nil)
        } catch let failure as APIError {
            // iosfix10 B1: map through APIErrorCopy so a failed login
            // shows 邮箱或密码不正确 instead of the server's English.
            self.error = APIErrorCopy.text(failure)
        } catch {
            self.error = "网络异常，请稍后重试。"
        }
    }
}

@MainActor struct MatchListScreen: View {
    @ObservedObject var session: AppSession
    let lobby: Bool
    let onRevoked: @MainActor () -> Void
    let onJoin: () -> Void
    @State private var matches: [MatchSummary]?
    @State private var templates: [TemplateDTO] = []
    @State private var loading = false
    @State private var error: String?
    @State private var pendingRefresh = false
    @State private var showCreate = false
    @State private var createdMatchID: String?
    // iosfix6 item 5: swipe-to-delete. Only an owner deleting a preparing
    // (not yet drawn) room calls DELETE; every other row calls /hide, which
    // is per-user and reversible via the undo banner. A refused DELETE
    // (409 match_not_deletable) offers hide instead of failing silently.
    @State private var pendingDelete: MatchSummary?
    @State private var deleteRefused: MatchSummary?
    @State private var hiddenUndoId: String?
    @State private var deleteError: String?
    @State private var deleting = false

    private func isDeletable(_ match: MatchSummary) -> Bool {
        match.isOwner && match.status == "preparing"
    }

    private func performDelete(_ match: MatchSummary, asHide: Bool = false) {
        guard !deleting else { return }
        deleting = true
        let hide = asHide || !isDeletable(match)
        Task {
            do {
                if hide { try await session.api.hideMatch(match.id) }
                else { try await session.api.deleteMatch(match.id) }
                matches?.removeAll { $0.id == match.id }
                if hide { hiddenUndoId = match.id }
                Task { await refresh() }
            } catch let failure as APIError where failure.code == "match_not_deletable" && !hide {
                deleteRefused = match
            } catch let failure as APIError {
                deleteError = failure.code == "forbidden"
                    ? (hide ? "你不是这张牌桌的成员，无法隐藏它。" : "只有房主可以删除这张牌桌。")
                    : APIErrorCopy.text(failure)
            } catch {
                deleteError = "操作失败，请稍后重试。"
            }
            deleting = false
        }
    }

    private func unhide(_ id: String) {
        Task {
            do {
                try await session.api.unhideMatch(id)
                hiddenUndoId = nil
                await refresh()
            } catch let failure as APIError {
                deleteError = APIErrorCopy.text(failure)
            } catch {
                deleteError = "操作失败，请稍后重试。"
            }
        }
    }

    private var ordered: [MatchSummary] {
        (matches ?? []).sorted { lhs, rhs in
            if lobby && isFinished(lhs.status) != isFinished(rhs.status) {
                return !isFinished(lhs.status)
            }
            return lhs.createdAt > rhs.createdAt
        }
    }

    private var liveMatches: [MatchSummary] { ordered.filter { !isFinished($0.status) } }
    private var recentMatches: [MatchSummary] { lobby ? ordered.filter { isFinished($0.status) } : ordered }

    private func row(_ match: MatchSummary) -> some View {
        TrailingSwipeDeleteRow(deleteIdentifier: "online.match.delete.\(match.id)") { pendingDelete = match } content: {
        NavigationLink(value: match.id) {
            HStack(alignment: .top, spacing: 14) {
                EastTile(size: 30)
                VStack(alignment: .leading, spacing: 6) {
                    Text(ruleDetails(snapshot: match.rulesSnapshot, template: templates.first { $0.versionId == match.rulesetVersionId }).title)
                        .font(Brand.font(.headline)).foregroundStyle(Brand.gold)
                    Text("\(statusLabel(match.status)) · \(match.playerCount) 麻")
                        .foregroundStyle(Brand.text)
                    Text(localDate(match.createdAt))
                        .font(Brand.font(.subheadline)).foregroundStyle(Brand.muted).monospacedDigit()
                    Text("牌桌 \(match.id)")
                        .font(Brand.font(.caption2)).foregroundStyle(Brand.muted).textSelection(.enabled)
                }
            }
            .padding(.vertical, 5)
            .padding(.horizontal, Brand.cardInnerPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .brandCard()
        .padding(.vertical, 4)
        .accessibilityIdentifier(!isFinished(match.status) ? "online.match.active" : "online.match.finished")
        }
        .listRowInsets(Brand.swipeRowInsets)
    }

    var body: some View {
        List {
            if lobby {
                Section {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(spacing: 10) {
                            EastTile(size: 38)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("一姬").font(Brand.display(29)).foregroundStyle(Brand.text)
                                Text("ICHIHIME").font(Brand.font(.caption2)).tracking(3).foregroundStyle(Brand.gold)
                            }
                            Spacer()
                            EastTile(size: 66).rotationEffect(.degrees(12))
                        }
                        Text("落座，即开局。").font(Brand.display(27)).foregroundStyle(Brand.text)
                        Text("从规则到结算，给同桌每一分一个清楚的去处。")
                            .font(Brand.font(.subheadline)).foregroundStyle(Brand.muted)
                        HStack(spacing: 12) {
                            Button {
                                showCreate = true
                            } label: {
                                Text("开桌 ↗").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Brand.gold)
                            .foregroundStyle(Brand.background)
                            .disabled(!session.canHost)
                            .accessibilityIdentifier("online.wizard.open")
                            Button {
                                onJoin()
                            } label: {
                                Text("加入牌桌").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .tint(Brand.gold)
                            .foregroundStyle(Brand.gold)
                            .accessibilityIdentifier("online.join.open")
                        }
                        Text(session.canHost ? "选择模板、调整规则、预览支付后创建；加入牌桌可用房间码或扫码" : "访客不能开桌，可用「加入牌桌」扫码或输房间码加入")
                            .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                    }
                    .padding(Brand.cardInnerPadding)
                    .background(LinearGradient(stops: [
                        .init(color: Brand.panel, location: 0),
                        .init(color: Color(red: 27 / 255, green: 56 / 255, blue: 68 / 255), location: 0.58),
                        .init(color: Color(red: 38 / 255, green: 78 / 255, blue: 66 / 255), location: 1)
                    ], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 18))
                    // iosfix9: strokeBorder keeps the 1pt gold stroke
                    // INSIDE the box (a centered stroke extends 0.5pt
                    // past it, which is how the hero measured 1pt wider
                    // per side than the rows on a real phone). Clip so
                    // the rotated 66pt tile cannot poke past a corner.
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Brand.gold.opacity(0.7), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    // iosfix8 item 1: hero shares the horizontal token
                    // with the rows (Brand.heroRowInsets).
                    .listRowInsets(Brand.heroRowInsets)
                    .listRowBackground(Brand.background)
                    .listRowSeparator(.hidden)
                }
            }
            if loading && matches == nil {
                ProgressView("读取对局中…").padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard().listRowInsets(Brand.rowInsets)
            }
            if let error {
                Section {
                    Text("加载失败：\(error)").foregroundStyle(Brand.loss).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard().listRowInsets(Brand.rowInsets)
                    Button("重试") { Task { await refresh() } }.padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard().listRowInsets(Brand.rowInsets)
                }
            }
            if lobby {
                Section {
                    if matches != nil && liveMatches.isEmpty { Text("暂无进行中的牌桌").foregroundStyle(Brand.muted).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard().listRowInsets(Brand.rowInsets) }
                    ForEach(liveMatches, id: \.id) { match in row(match) }
                } header: { BrandSectionHeader("正在进行的牌桌", leadingShift: BrandSectionHeader.plainLeadingShift) }
            }
            Section {
                if matches != nil && recentMatches.isEmpty {
                    Text("暂无对局记录，下拉刷新试试").foregroundStyle(Brand.muted).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard().listRowInsets(Brand.rowInsets)
                }
                ForEach(recentMatches, id: \.id) { match in row(match) }
            } header: { BrandSectionHeader(lobby ? "战绩 · 最近对局" : "战绩 · 对局记录", leadingShift: BrandSectionHeader.plainLeadingShift) }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle(lobby ? "大厅" : "战绩")
        .tabBarClearance()
        .refreshable { await refresh() }
        .task { await refresh() }
        .onChange(of: session.generationID) { _, _ in
            matches = nil
            templates = []
            createdMatchID = nil
            Task { await refresh() }
        }
        .sheet(isPresented: $showCreate) {
            NavigationStack {
                RulesWizard(api: session.api) { id in
                    createdMatchID = id
                    showCreate = false
                    Task { await refresh() }
                }
            }
        }
        .navigationDestination(isPresented: Binding(get: { createdMatchID != nil }, set: { if !$0 { createdMatchID = nil } })) {
            if let createdMatchID { TableScreen(session: session, matchId: createdMatchID, onRevoked: {
                self.createdMatchID = nil
                onRevoked()
            }) }
        }
        .safeAreaInset(edge: .bottom) {
            if let hiddenUndoId {
                HStack {
                    Text("已隐藏对局记录").foregroundStyle(Brand.text)
                    Spacer()
                    Button("撤销") { unhide(hiddenUndoId) }
                        .accessibilityIdentifier("online.match.unhideUndo")
                    Button("知道了") { self.hiddenUndoId = nil }
                }
                .padding()
                .background(Brand.panel)
            }
        }
        .alert("删除牌桌？", isPresented: Binding(get: { pendingDelete != nil && isDeletable(pendingDelete!) }, set: { if !$0 { pendingDelete = nil } })) {
            Button("取消", role: .cancel) { pendingDelete = nil }
            Button("删除", role: .destructive) { if let pendingDelete { performDelete(pendingDelete) }; self.pendingDelete = nil }
        } message: {
            Text("这张未开始的牌桌将被永久删除，所有成员都将看不到它。此操作无法撤销。")
        }
        .alert("隐藏牌桌？", isPresented: Binding(get: { pendingDelete != nil && !isDeletable(pendingDelete!) }, set: { if !$0 { pendingDelete = nil } })) {
            Button("取消", role: .cancel) { pendingDelete = nil }
            Button("隐藏", role: .destructive) { if let pendingDelete { performDelete(pendingDelete) }; self.pendingDelete = nil }
        } message: {
            Text("这张牌桌只会从你的列表中隐藏，牌桌本身和其他成员不受影响。隐藏后可通过下方的撤销恢复。")
        }
        .alert("无法彻底删除", isPresented: Binding(get: { deleteRefused != nil }, set: { if !$0 { deleteRefused = nil } })) {
            Button("取消", role: .cancel) { deleteRefused = nil }
            Button("改为隐藏") { if let deleteRefused { performDelete(deleteRefused, asHide: true) }; self.deleteRefused = nil }
        } message: {
            Text("这张牌桌已抽风定座或已开始，无法彻底删除；可以改为仅从你的列表中隐藏。")
        }
        .alert("删除失败", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) {
            Button("知道了", role: .cancel) { deleteError = nil }
        } message: {
            Text(deleteError ?? "操作失败，请稍后重试。")
        }
    }

    @MainActor private func refresh() async {
        guard !loading else { pendingRefresh = true; return }
        loading = true
        error = nil
        let generation = session.generationID
        defer {
            loading = false
            if pendingRefresh {
                pendingRefresh = false
                Task { await refresh() }
            }
        }
        do {
            let updated: [MatchSummary] = try await session.api.get("/api/matches?mine=1")
            guard generation == session.generationID else { return }
            matches = updated
        } catch {
            guard generation == session.generationID else { return }
            if let failure = error as? APIError, OnlineCommandPolicy.mustClearVisibleTable(failure) {
                matches = nil
                templates = []
            }
            self.error = error.localizedDescription
        }
        // Templates are optional metadata; the rule details still show their honest unknown values on failure.
        if let updated: [TemplateDTO] = try? await session.api.get("/api/rulesets/templates"),
           generation == session.generationID {
            templates = updated
        }
    }
}

@MainActor struct TableScreen: View {
    @ObservedObject var session: AppSession
    let matchId: String
    let onRevoked: @MainActor () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var live: LiveUpdates
    @State private var snapshot: TableSnapshot?
    @State private var hands: [HandDTO]?
    @State private var settlement: SettlementPreview?
    @State private var templates: [TemplateDTO] = []
    @State private var loading = false
    @State private var pendingRefresh = false
    @State private var error: String?
    @State private var visible = false
    @State private var requestGeneration = 0
    @State private var revoked = false

    init(session: AppSession, matchId: String, onRevoked: @escaping @MainActor () -> Void) {
        self.session = session
        self.matchId = matchId
        self.onRevoked = onRevoked
        _live = StateObject(wrappedValue: LiveUpdates(api: session.api))
    }

    var body: some View {
        List {
            Section {
                Label("连接状态：\(live.connection)", systemImage: live.connection == "实时同步中" ? "wifi" : "arrow.clockwise")
                    .foregroundStyle(live.connection == "实时同步中" ? Brand.gain : Brand.muted)
                    .accessibilityLabel("实时连接状态：\(live.connection)")
                if loading && snapshot == nil { ProgressView("读取对局中…") }
                if let error {
                    Text("加载失败：\(error)").foregroundStyle(Brand.loss)
                    Button("重试") { Task { await refresh() } }
                }
                if snapshot == nil && !loading && error == nil {
                    Text("暂无对局数据，下拉刷新试试")
                }
            }
            .listRowBackground(Brand.deep)
            .listRowSeparatorTint(Brand.hairline)
            if let currentSnapshot = snapshot {
                Section {
                    let details = ruleDetails(snapshot: currentSnapshot.match.rulesSnapshot, template: templates.first { $0.versionId == currentSnapshot.match.rulesetVersionId })
                    HStack(spacing: 12) {
                        EastTile(size: 40)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(details.title).font(Brand.display(24)).foregroundStyle(Brand.gold)
                            Text("\(statusLabel(currentSnapshot.match.status)) · \(currentSnapshot.match.playerCount) 麻")
                                .foregroundStyle(Brand.text)
                        }
                    }
                    Text("创建时间：\(localDate(currentSnapshot.match.createdAt))").monospacedDigit()
                    Text("牌桌 \(currentSnapshot.match.id)")
                        .font(Brand.font(.caption2)).foregroundStyle(Brand.muted).textSelection(.enabled)
                    RuleInfo(snapshot: currentSnapshot.match.rulesSnapshot, templates: templates, versionID: currentSnapshot.match.rulesetVersionId)
                } header: { BrandSectionHeader("对局信息") }
                .brandPanel()
                if currentSnapshot.match.status == "preparing",
                   let ownSeat = currentSnapshot.seats.first(where: { $0.principalId == session.principalID && $0.status == "checked_in" }),
                   // iosfix10 P4: the host is the one who starts the
                   // game, so "等待房主开局" must not show to the host
                   // themselves — only to non-owner members.
                   currentSnapshot.members.first(where: { $0.principalId == session.principalID })?.isOwner != true {
                    Section {
                        Text("你在 \(ownSeat.seatNo + 1) 号位，等待房主开局。")
                            .foregroundStyle(Brand.gold)
                    }
                    .brandPanel()
                }
                if currentSnapshot.match.status == "preparing" {
                    OnlineTableActions(session: session, snapshot: currentSnapshot) { await refresh() }
                }
                Section {
                    ForEach(currentSnapshot.seats.sorted { $0.seatNo < $1.seatNo }, id: \.seatNo) { seat in
                        let preparing = currentSnapshot.match.status == "preparing"
                        let drawn = currentSnapshot.match.seatingDrawnAt != nil
                        // iosfix10 M1: the drawn wind is the truth in
                        // every state, not just while preparing — the
                        // old `preparing && drawn` gate made seats fall
                        // back to seat-number order once the game
                        // started. The dealer marker likewise follows
                        // the current hand's dealer (falling back to
                        // the match dealer before the first hand).
                        let drawnWind = drawn
                            ? currentSnapshot.members.first { $0.seatNo == seat.seatNo }?.wind : nil
                        let dealerSeatNo = currentSnapshot.currentHand?.dealerSeatNo ?? currentSnapshot.match.dealerSeatNo
                        HStack(spacing: 12) {
                            Text(preparing && !drawn ? "·" : windLabel(drawnWind ?? ["E", "S", "W", "N"][seat.seatNo % 4]))
                                .font(Brand.font(.headline))
                                .foregroundStyle(Brand.ink)
                                .frame(width: 30, height: 30)
                                .background(Brand.cream, in: RoundedRectangle(cornerRadius: 6))
                            VStack(alignment: .leading, spacing: 5) {
                                // iosfix10 P3: the dealer suffix is its
                                // own fixed-size Text, so a long name
                                // wraps on the name while 庄家 never
                                // splits across lines.
                                HStack(alignment: .firstTextBaseline, spacing: 0) {
                                    Text("\(seat.seatNo + 1) 号位 · \(seat.displayName ?? "空座")")
                                    if drawn && seat.seatNo == dealerSeatNo {
                                        Text(" · 庄家").fixedSize(horizontal: true, vertical: false)
                                    }
                                }
                                .font(Brand.font(.headline)).foregroundStyle(Brand.text)
                                Text(seatLabel(seat.status))
                                    .font(Brand.font(.caption1)).foregroundStyle(Brand.muted)
                            }
                            Spacer(minLength: 4)
                            Text(seat.points.map { "\($0) 点" } ?? "点数未提供")
                                .font(Brand.font(.subheadline, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(Brand.ink)
                                .padding(.horizontal, 9).padding(.vertical, 7)
                                .background(Brand.cream, in: RoundedRectangle(cornerRadius: 6))
                        }
                        .padding(.vertical, 6)
                        .listRowBackground(RadialGradient(colors: [
                            Color(red: 43 / 255, green: 100 / 255, blue: 93 / 255),
                            Color(red: 36 / 255, green: 83 / 255, blue: 79 / 255),
                            Color(red: 23 / 255, green: 61 / 255, blue: 66 / 255)
                        ], center: .center, startRadius: 0, endRadius: 260))
                        .listRowSeparatorTint(Brand.gold.opacity(0.5))
                    }
                } header: { BrandSectionHeader("座位与点数") }
                Section {
                    if let hand = currentSnapshot.currentHand {
                        Text("\(windLabel(hand.roundWind)) \(hand.roundNumber.map { String($0) } ?? "?") 局 · 庄家 \(hand.dealerSeatNo.map { String($0 + 1) } ?? "?") 号位")
                            .monospacedDigit()
                        Text("本场棒：\(hand.honba.map { String($0) } ?? "未提供")")
                            .monospacedDigit()
                        Text("立直供托：\(hand.riichiPool.map { "\($0) 点 / \($0 / 1000) 根" } ?? "未提供")")
                            .monospacedDigit()
                        ForEach(hand.seats.sorted { $0.seatNo < $1.seatNo }, id: \.seatNo) { seat in
                            Text("\(seat.seatNo + 1) 号位 · \(seat.isRiichi ? "已立直" : "未立直") · 宣言 \(seat.riichiChangeUsage.declares)/2 取消 \(seat.riichiChangeUsage.cancels)/1")
                                .monospacedDigit()
                        }
                    } else {
                        Text("暂无进行中的牌局")
                    }
                } header: { BrandSectionHeader("当前局") }
                .listRowBackground(Brand.deep)
                .listRowSeparatorTint(Brand.hairline)
                if isFinished(currentSnapshot.match.status) {
                    Section {
                        if let currentSettlement = settlement, !currentSettlement.standings.isEmpty {
                            ForEach(currentSettlement.standings.sorted { $0.rank < $1.rank }, id: \.seatNo) { standing in
                                Text("第 \(standing.rank) 名 · \(standing.seatNo + 1) 号位 · \(standing.finalPoints) 点 · 总成绩 \(Double(standing.totalTenths) / 10)")
                                    .monospacedDigit()
                            }
                        } else {
                            Text("结算数据暂未提供")
                        }
                    } header: { BrandSectionHeader("最终排名") }
                    .brandPanel()
                }
                if currentSnapshot.match.status != "preparing" {
                    OnlineTableActions(session: session, snapshot: currentSnapshot) { await refresh() }
                }
            }
            Section {
                Text("显示最早的已结算局摘要（最多 100 局），非完整牌谱回放；无后续分页或原始输入。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                if let recordedHands = hands {
                    if recordedHands.isEmpty { Text("暂无牌局记录") }
                    ForEach(recordedHands.sorted { $0.handNo < $1.handNo }, id: \.handNo) { hand in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("第 \(hand.handNo) 局 · \(windLabel(hand.roundWind)) \(hand.roundNumber) 局 · \(handLabel(hand.kind))")
                                .font(Brand.font(.headline))
                                .monospacedDigit()
                            Text("庄家 \(hand.dealerSeatNo + 1) 号位 · 本场棒 \(hand.honba)")
                                .monospacedDigit()
                            ForEach(hand.perSeat.sorted { $0.seatNo < $1.seatNo }, id: \.seatNo) { delta in
                                Text("\(delta.seatNo + 1) 号位：\(delta.netPoints > 0 ? "+" : "")\(delta.netPoints) 点")
                                    .foregroundStyle(delta.netPoints > 0 ? Brand.gain : delta.netPoints < 0 ? Brand.loss : Brand.text)
                                    .monospacedDigit()
                            }
                        }
                        .brandPanel()
                    }
                } else {
                    Text("牌局记录暂未提供")
                }
            } header: { BrandSectionHeader("局历史") }
            .brandPanel()
        }
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle("牌桌")
        .tabBarClearance()
        .refreshable { await refresh() }
        .task(id: matchId) { await refresh() }
        .onAppear {
            visible = true
            if scenePhase == .active { connect() }
        }
        .onDisappear {
            requestGeneration += 1
            visible = false
            live.stop()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active && visible {
                connect()
                Task { await refresh() }
            } else {
                live.stop()
            }
        }
        .onChange(of: session.identity) { _, identity in
            if identity == .localOnly { clearPrivateState() }
        }
        .onChange(of: session.generationID) { _, _ in
            clearPrivateState()
            if session.authenticated && visible { Task { await refresh() } }
        }
    }

    private func clearPrivateState() {
        requestGeneration += 1
        snapshot = nil
        hands = nil
        settlement = nil
        templates = []
        live.stop()
    }
    private func handleRevocation(updated: TableSnapshot? = nil, status: Int? = nil) -> Bool {
        guard !revoked, OnlineCommandPolicy.wasRemoved(previous: snapshot, updated: updated,
            status: status, principal: session.principalID) else { return false }
        revoked = true
        visible = false
        pendingRefresh = false
        clearPrivateState()
        onRevoked()
        return true
    }

    private func connect() {
        live.start(matchID: matchId) { await refresh() }
    }

    @MainActor private func refresh() async {
        guard !Task.isCancelled else { return }
        guard !loading else {
            pendingRefresh = true
            return
        }
        loading = true
        error = nil
        defer {
            loading = false
            if pendingRefresh && visible && scenePhase == .active {
                pendingRefresh = false
                Task { await refresh() }
            }
        }
        let path = "/api/matches/\(matchId)"
        let current = requestGeneration
        let principalGeneration = session.generationID
        do {
            let updated: TableSnapshot = try await session.api.get(path)
            guard !Task.isCancelled, current == requestGeneration, principalGeneration == session.generationID else { return }
            if handleRevocation(updated: updated) { return }
            snapshot = updated
            settlement = nil
            hands = nil
            do {
                let updatedHands: [HandDTO] = try await session.api.get("\(path)/hands?limit=100")
                if current == requestGeneration, principalGeneration == session.generationID { hands = updatedHands }
            } catch {
                if current == requestGeneration, principalGeneration == session.generationID {
                    if let failure = error as? APIError {
                        if handleRevocation(status: failure.status) { return }
                        if OnlineCommandPolicy.mustClearVisibleTable(failure) { clearPrivateState() }
                    }
                    self.error = "读取局记录失败：\((error as? APIError).map(APIErrorCopy.text) ?? error.localizedDescription)"
                }
            }
            guard current == requestGeneration, principalGeneration == session.generationID else { return }
            if isFinished(updated.match.status) {
                do {
                    let updatedSettlement: SettlementPreview = try await session.api.get("\(path)/settlement/preview")
                    if current == requestGeneration, principalGeneration == session.generationID { settlement = updatedSettlement }
                } catch {
                    if current == requestGeneration, principalGeneration == session.generationID {
                        if let failure = error as? APIError {
                            if handleRevocation(status: failure.status) { return }
                            if OnlineCommandPolicy.mustClearVisibleTable(failure) { clearPrivateState() }
                        }
                        self.error = "读取终局成绩失败：\((error as? APIError).map(APIErrorCopy.text) ?? error.localizedDescription)"
                    }
                }
            }
            guard current == requestGeneration, principalGeneration == session.generationID else { return }
            if let updatedTemplates: [TemplateDTO] = try? await session.api.get("/api/rulesets/templates"),
               current == requestGeneration, principalGeneration == session.generationID {
                templates = updatedTemplates
            }
        } catch {
            guard current == requestGeneration, principalGeneration == session.generationID else { return }
            if let failure = error as? APIError {
                if handleRevocation(status: failure.status) { return }
                if OnlineCommandPolicy.mustClearVisibleTable(failure) { clearPrivateState() }
            }
            self.error = (error as? APIError).map(APIErrorCopy.text) ?? error.localizedDescription
        }
    }

    private func seatLabel(_ status: String?) -> String {
        switch status {
        case "empty": "空座"
        case "assigned": "已入座"
        case "checked_in": "已签到"
        default: "状态未提供"
        }
    }
}

struct ProfileScreen: View {
    @ObservedObject var session: AppSession
    let onCheckIn: () -> Void
    @State private var loading = false
    @State private var error: String?
    @State private var diagnostic: String?
    @State private var checking = false
    @State private var signingOut = false

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    EastTile(size: 38)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("一姬").font(Brand.display(29)).foregroundStyle(Brand.text)
                        Text("ICHIHIME").font(Brand.font(.caption2)).tracking(3).foregroundStyle(Brand.gold)
                    }
                }
                .padding(.vertical, 12)
            }
            .brandPanel()
            Section {
                if loading && session.profile == nil { ProgressView("读取账号中…") }
                if let error {
                    Text("加载失败：\(error)").foregroundStyle(Brand.loss)
                    Button("重试") { Task { await refresh() } }
                }
                if let principal = session.profile?.principal {
                    LabeledContent {
                        Text(principal.displayName).foregroundStyle(Brand.muted)
                    } label: { Text("昵称").foregroundStyle(Brand.text) }
                    LabeledContent {
                        Text(accountLabel(principal.type)).foregroundStyle(Brand.muted)
                    } label: { Text("账号类型").foregroundStyle(Brand.text) }
                    LabeledContent {
                        Text(localDate(principal.createdAt)).foregroundStyle(Brand.muted)
                    } label: { Text("创建时间").foregroundStyle(Brand.text) }
                    if session.identity == .onlineGuest {
                        Text("临时访客会话已安全保存；不能开桌，也不承诺升级账户后自动继承战绩。")
                            .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                    }
                }
            } header: { BrandSectionHeader("我的账号") }
            .brandPanel()
            Section {
                Button(checking ? "自检中…" : "引擎自检") {
                    Task {
                        checking = true
                        diagnostic = await EngineBridgeCheck.runSample()
                        checking = false
                    }
                }
                .disabled(checking)
                if let diagnostic { Text("诊断结果：\(diagnostic)") }
            } header: { BrandSectionHeader("关于 / 诊断") }
            .brandPanel()
            Section {
                Button("扫描二维码 / 粘贴签到链接 / 房间码", action: onCheckIn)
                Button("退出登录", role: .destructive) {
                    Task {
                        signingOut = true
                        await session.signOut()
                        signingOut = false
                    }
                }
                .disabled(signingOut)
            }
            .brandPanel()
        }
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle("我的")
        .tabBarClearance()
        .refreshable { await refresh() }
        .task { await refresh() }
    }

    @MainActor private func refresh() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            try await session.refreshProfile()
        } catch {
            self.error = error.localizedDescription
        }
    }
}


