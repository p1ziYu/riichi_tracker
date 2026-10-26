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

struct EastTile: View {
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


// MARK: - 新模型共享文案（spec §1/§3，全中文；接口英文原文不进 UI）

func accountLabel(_ type: String) -> String {
    switch type.lowercased() {
    case "anonymous", "guest": "访客"
    case "account", "user", "email", "registered": "注册用户"
    case "admin": "管理员"
    default: "账号类型未提供"
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

/// fix10 数字格式保留：显示分组；解析走 FinalScoreLogic（支持负数与 0）。
func formatPoints(_ value: Int) -> String { value.formatted() }
func parsePoints(_ text: String) -> Int? { FinalScoreLogic.parse(text) }

func localDateOnly(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.dateFormat = "yyyy-MM-dd HH:mm"
    return formatter.string(from: date)
}

struct SeatDisplay: Hashable {
    let wind: String
    let name: String
}

extension FinalMatch {
    func seatDisplays() -> [SeatDisplay] {
        if seatsDrawn {
            // API 实测：seat 不带显示名，按 userId 查 members；查不到才用座位自带名/空座。
            let namesByUser = Dictionary(uniqueKeysWithValues: members.map { ($0.userId, $0.displayName) })
            return seats.sorted { (["E": 0, "S": 1, "W": 2, "N": 3][$0.wind] ?? 99) < (["E": 0, "S": 1, "W": 2, "N": 3][$1.wind] ?? 99) }
                .map { seat in
                    let name = seat.userId.flatMap { namesByUser[$0] } ?? seat.displayName ?? "空座"
                    return SeatDisplay(wind: seat.wind, name: name)
                }
        }
        return members.map { SeatDisplay(wind: "?", name: $0.displayName) }
    }
    func shareLink() -> String {
        if let code = joinCode, !code.isEmpty {
            return "https://riichi.p1ziyu.com/checkin/\(id)?token=\(code)"
        }
        return "https://riichi.p1ziyu.com/checkin/\(id)"
    }
}

// MARK: - 终局记分编辑器（在线与本地共用）

/// 每座一行：风 / 名 / 得点输入 / 顺位自动显示。
/// 单位：实际点数 ÷ 100（25000 记 250）；支持负数和 0；范围 -9999~9999。
/// 合计不对时保存禁用并中文提示；非房主只读（editable=false 时无保存键）。
@MainActor
struct FinalScoreEditor: View {
    let seats: [SeatDisplay]
    let mode: FinalMode
    let editable: Bool
    let initial: [String: Int]?
    let title: String
    let onSave: ([FinalScoreEntry]) async throws -> Void
    let onSaved: () -> Void
    @State private var texts: [String: String] = [:]
    @State private var saving = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    private var parsed: [(wind: String, score: Int?)] {
        seats.map { (wind: $0.wind, score: $0.wind == "?" ? nil : FinalScoreLogic.parse(texts[$0.wind] ?? "")) }
    }
    private var validation: String? {
        FinalScoreLogic.validationError(scores: parsed, mode: mode)
    }
    private var sumText: String {
        let sum = parsed.compactMap { $0.score }.reduce(0, +)
        return "当前合计 \(sum) / \(mode.total)"
    }
    private var ranks: [String: Int] {
        let complete = parsed.compactMap { entry -> (wind: String, score: Int)? in
            guard let score = entry.score else { return nil }
            return (wind: entry.wind, score: score)
        }
        guard complete.count == seats.count else { return [:] }
        return FinalScoreLogic.ranks(for: complete, mode: mode)
    }

    var body: some View {
        List {
            Section {
                Text("单位：实际点数 ÷ 100（例如 25000 记 250），支持负数和 0。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                Text(sumText)
                    .font(Brand.font(.headline)).foregroundStyle(validation == nil ? Brand.gain : Brand.loss)
                    .accessibilityIdentifier("final.sum")
                if let validation, editable {
                    Text(validation).foregroundStyle(Brand.loss)
                        .accessibilityIdentifier("final.sum.hint")
                }
                if !editable {
                    Text("仅房主可以填写与纠正终局得点，你当前为只读查看。")
                        .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                }
            }
            .brandPanel()
            Section {
                ForEach(seats, id: \.wind) { seat in
                    HStack(spacing: 12) {
                        Text(windLabel(seat.wind))
                            .font(Brand.font(.headline))
                            .foregroundStyle(Brand.ink)
                            .frame(width: 30, height: 30)
                            .background(Brand.cream, in: RoundedRectangle(cornerRadius: 6))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(seat.name).font(Brand.font(.headline)).foregroundStyle(Brand.text)
                            Text(ranks[seat.wind].map { "第 \($0) 名" } ?? "顺位待定")
                                .font(Brand.font(.caption1)).foregroundStyle(Brand.muted)
                        }
                        Spacer()
                        if editable {
                            TextField("得点", text: Binding(
                                get: { texts[seat.wind] ?? "" },
                                set: { texts[seat.wind] = $0 }))
                                .keyboardType(.numbersAndPunctuation)
                                .multilineTextAlignment(.trailing)
                                .monospacedDigit()
                                .padding(8)
                                .background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                                .frame(width: 110)
                                .accessibilityIdentifier("final.score.\(seat.wind)")
                        } else {
                            Text(initial?[seat.wind].map { formatPoints($0) } ?? "—")
                                .font(Brand.font(.headline)).monospacedDigit()
                                .accessibilityIdentifier("final.score.\(seat.wind)")
                        }
                    }
                    .padding(.vertical, 4)
                }
            } header: { BrandSectionHeader("终局得点") }
            .brandPanel()
            if let error {
                Section { Text(error).foregroundStyle(Brand.loss) }.brandPanel()
            }
            if editable {
                Section {
                    Button(saving ? "保存中…" : "保存终局得点") {
                        Task {
                            guard !saving, validation == nil else { return }
                            saving = true
                            error = nil
                            defer { saving = false }
                            do {
                                let entries = FinalScoreLogic.entriesWithRanks(
                                    parsed.map { (wind: $0.wind, score: $0.score ?? 0) }, mode: mode)
                                try await onSave(entries)
                                onSaved()
                                dismiss()
                            } catch let failure as APIError {
                                self.error = APIErrorCopy.text(failure)
                            } catch {
                                self.error = error.localizedDescription
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Brand.gold)
                    .foregroundStyle(Brand.background)
                    .disabled(saving || validation != nil)
                    .accessibilityIdentifier("final.save")
                }
                .brandPanel()
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle(title)
        .keyboardDismissal()
        .onAppear {
            if texts.isEmpty {
                for seat in seats {
                    texts[seat.wind] = initial?[seat.wind].map { String($0) } ?? ""
                }
            }
        }
    }
}

// MARK: - 登录（保留 fix10 英文映射：失败只显示中文）

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
                        catch let failure as APIError { self.error = APIErrorCopy.text(failure) }
                        catch { self.error = "网络异常，请稍后重试。" }
                    }
                }
                .disabled(busy)
                Text("访客扫码或输入房间码即可加入牌桌，人齐后自动分座；不能开桌。本地模式不使用此身份。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                Text("本地无身份模式在“本地”标签中开桌；不登录、不创建访客、不上传。")
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
            self.error = APIErrorCopy.text(failure)
        } catch {
            self.error = "网络异常，请稍后重试。"
        }
    }
}

// MARK: - 大厅 / 首页（在线）

@MainActor
struct LobbyScreen: View {
    @ObservedObject var session: AppSession
    let service: any FinalMatchService
    let isAdmin: Bool
    let navigateToTable: (String) -> Void
    @State private var matches: [FinalMatch] = []
    @State private var loading = false
    @State private var error: String?
    @State private var showCreate = false
    @State private var showJoin = false
    @State private var showAdmin = false
    @State private var createdMatch: FinalMatch?

    private var inProgress: [FinalMatch] {
        matches.filter { $0.isInProgress || $0.isWaiting }.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
    }
    private var finished: [FinalMatch] {
        matches.filter { $0.isFinished || $0.isCancelled }.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
    }

    private func row(_ match: FinalMatch) -> some View {
        Button { navigateToTable(match.id) } label: {
            HStack(alignment: .top, spacing: 14) {
                EastTile(size: 30)
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(match.mode.label) · \(match.statusLabel())")
                        .font(Brand.font(.headline)).foregroundStyle(Brand.gold)
                    Text("成员 \(match.members.count)/\(match.mode.playerCount) · \(match.joinCode.map { "房间码 \($0)" } ?? "无房间码")")
                        .foregroundStyle(Brand.text)
                    Text(match.createdAt.map(localDate) ?? "时间未提供")
                        .font(Brand.font(.subheadline)).foregroundStyle(Brand.muted).monospacedDigit()
                }
            }
            .padding(.vertical, 5)
            .padding(.horizontal, Brand.cardInnerPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .brandCard()
        .padding(.vertical, 4)
        .accessibilityIdentifier(match.isFinished ? "online.match.finished" : (match.isWaiting ? "online.match.waiting" : "online.match.in_progress"))
        .listRowInsets(Brand.rowInsets)
    }

    var body: some View {
        List {
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
                    Text("只记终局得点：人齐自动分座，房主填终局分，合计对上才能保存。")
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
                        .disabled(!session.canHost && !(service is StubFinalService))
                        .accessibilityIdentifier("online.create.open")
                        Button {
                            showJoin = true
                        } label: {
                            Text("加入牌桌").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .tint(Brand.gold)
                        .foregroundStyle(Brand.gold)
                        .accessibilityIdentifier("online.join.open")
                    }
                    if isAdmin {
                        Button("管理入口（管理员）") { showAdmin = true }
                            .accessibilityIdentifier("online.admin.open")
                    }
                    Text(session.canHost || service is StubFinalService ? "开桌选择三麻或四麻；加入牌桌可用房间码、扫码或粘贴链接" : "访客不能开桌，可用「加入牌桌」扫码或输房间码加入")
                        .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                }
                .padding(Brand.cardInnerPadding)
                .background(LinearGradient(stops: [
                    .init(color: Brand.panel, location: 0),
                    .init(color: Color(red: 27 / 255, green: 56 / 255, blue: 68 / 255), location: 0.58),
                    .init(color: Color(red: 38 / 255, green: 78 / 255, blue: 66 / 255), location: 1)
                ], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Brand.gold.opacity(0.7), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .listRowInsets(Brand.heroRowInsets)
                .listRowBackground(Brand.background)
                .listRowSeparator(.hidden)
            }
            if loading && matches.isEmpty {
                ProgressView("读取对局中…").padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard().listRowInsets(Brand.rowInsets)
            }
            if let error {
                Section {
                    Text("加载失败：\(error)").foregroundStyle(Brand.loss).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard().listRowInsets(Brand.rowInsets)
                    Button("重试") { Task { await refresh() } }.padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard().listRowInsets(Brand.rowInsets)
                }
            }
            Section {
                if matches.isEmpty && !loading { Text("暂无进行中的牌桌").foregroundStyle(Brand.muted).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard().listRowInsets(Brand.rowInsets) }
                ForEach(inProgress, id: \.id) { match in row(match) }
            } header: { BrandSectionHeader("我的对局 · 进行中", leadingShift: BrandSectionHeader.plainLeadingShift) }
            Section {
                if matches.isEmpty && !loading {
                    Text("暂无对局记录，下拉刷新试试").foregroundStyle(Brand.muted).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard().listRowInsets(Brand.rowInsets)
                }
                ForEach(finished, id: \.id) { match in row(match) }
            } header: { BrandSectionHeader("历史 · 最近已结束", leadingShift: BrandSectionHeader.plainLeadingShift) }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle("大厅")
        .tabBarClearance()
        .refreshable { await refresh() }
        .task { await refresh() }
        .onChange(of: session.generationID) { _, _ in Task { await refresh() } }
        .sheet(isPresented: $showCreate) {
            // 单 sheet 内换内容：开桌成功后同一 sheet 切到分享页。
            // 旧的双 sheet 链（关开桌 sheet + 弹分享 sheet）在同一更新里
            // 会丢第二个呈现，导致分享页永远出不来（UI 巡游实测）。
            NavigationStack {
                if let createdMatch {
                    ShareWaitingScreen(service: service, match: createdMatch) {
                        let id = createdMatch.id
                        showCreate = false
                        self.createdMatch = nil
                        navigateToTable(id)
                        Task { await refresh() }
                    }
                } else {
                    CreateMatchSheet(service: service) { match in
                        createdMatch = match
                        Task { await refresh() }
                    }
                }
            }
        }
        .onChange(of: showCreate) { _, shown in
            if !shown { createdMatch = nil }
        }
        .sheet(isPresented: $showJoin) {
            NavigationStack {
                JoinScreen(service: service) { match in
                    showJoin = false
                    navigateToTable(match.id)
                    Task { await refresh() }
                }
            }
        }
        .sheet(isPresented: $showAdmin) {
            NavigationStack { AdminScreen(service: service) }
        }
    }

    @MainActor private func refresh() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            matches = try await service.mine()
        } catch let failure as APIError {
            self.error = APIErrorCopy.text(failure)
        } catch {
            self.error = "网络异常，请稍后重试。"
        }
    }
}

// MARK: - 开桌（三麻/四麻选择，无模板）

@MainActor
struct CreateMatchSheet: View {
    let service: any FinalMatchService
    let onCreated: (FinalMatch) -> Void
    @State private var mode: FinalMode = .four
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                Text("开桌后进入分享页：把链接、二维码或房间码发给同桌，人齐后自动分座。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
            }.brandPanel()
            Section {
                HStack(spacing: 12) {
                    ForEach(FinalMode.allCases, id: \.self) { candidate in
                        Button(candidate.label) { mode = candidate }
                            .font(Brand.font(.headline, weight: .semibold))
                            .foregroundStyle(mode == candidate ? Brand.background : Brand.cream)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(mode == candidate ? Brand.gold : Brand.deep, in: RoundedRectangle(cornerRadius: 10))
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("online.create.mode.\(candidate.rawValue)")
                    }
                }
                Text("\(mode.label) · \(mode.playerCount) 人 · 终局合计 \(mode.total)（单位：实际点数 ÷ 100）")
                    .font(Brand.font(.subheadline)).foregroundStyle(Brand.muted)
            } header: { BrandSectionHeader("选择模式") }
            .brandPanel()
            if let error {
                Section { Text(error).foregroundStyle(Brand.loss) }.brandPanel()
            }
            Section {
                Button(busy ? "开桌中…" : "开桌") {
                    Task {
                        guard !busy else { return }
                        busy = true
                        error = nil
                        defer { busy = false }
                        do {
                            let match = try await service.create(mode: mode)
                            onCreated(match)
                        } catch let failure as APIError {
                            self.error = APIErrorCopy.text(failure)
                        } catch {
                            self.error = "网络异常，请稍后重试。"
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Brand.gold)
                .foregroundStyle(Brand.background)
                .disabled(busy)
                .accessibilityIdentifier("online.create.confirm")
            }.brandPanel()
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle("开桌")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
    }
}

// MARK: - 分享页 / 等待人齐

@MainActor
struct ShareWaitingScreen: View {
    let service: any FinalMatchService
    var match: FinalMatch
    let onEnterTable: () -> Void
    @State private var current: FinalMatch
    @State private var copied = false
    @State private var refreshing = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    init(service: any FinalMatchService, match: FinalMatch, onEnterTable: @escaping () -> Void) {
        self.service = service
        self.match = match
        self.onEnterTable = onEnterTable
        _current = State(initialValue: match)
    }

    var body: some View {
        List {
            Section {
                Text("把房间码发给同桌即可加入；带凭证的分享链接也可直接加入。进来即成员，不再单独签到。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                if let code = current.joinCode {
                    Text("房间码").font(Brand.font(.caption1)).foregroundStyle(Brand.muted)
                    Text(code).font(Brand.display(36)).foregroundStyle(Brand.gold)
                        .accessibilityIdentifier("share.joinCode")
                    Button("复制房间码") {
                        UIPasteboard.general.string = code
                        copied = true
                    }
                    .accessibilityIdentifier("share.copyCode")
                }
                Text("链接").font(Brand.font(.caption1)).foregroundStyle(Brand.muted)
                Text(current.shareLink()).font(Brand.font(.subheadline)).foregroundStyle(Brand.text).textSelection(.enabled)
                    .accessibilityIdentifier("share.link")
                Button("复制链接") {
                    UIPasteboard.general.string = current.shareLink()
                    copied = true
                }
                .accessibilityIdentifier("share.copyLink")
                InvitationQR(link: current.shareLink())
                    .frame(maxWidth: 240, maxHeight: 240)
                    .frame(maxWidth: .infinity)
                if copied { Text("已复制").foregroundStyle(Brand.gain) }
            } header: { BrandSectionHeader("分享") }
            .brandPanel()
            Section {
                Text("成员 \(current.members.count)/\(current.mode.playerCount) · \(current.statusLabel())")
                    .font(Brand.font(.headline)).foregroundStyle(Brand.text)
                ForEach(current.members, id: \.userId) { member in
                    Text(member.displayName).foregroundStyle(Brand.text)
                }
                if current.isWaiting {
                    Text("等待人齐，人齐后自动分座（东座即庄家），无需抽风、无需调座。")
                        .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                }
                if let error { Text(error).foregroundStyle(Brand.loss) }
                Button(refreshing ? "刷新中…" : "刷新成员") {
                    Task {
                        refreshing = true
                        defer { refreshing = false }
                        do {
                            let mine = try await service.mine()
                            if let updated = mine.first(where: { $0.id == current.id }) { current = updated }
                        } catch let failure as APIError { self.error = APIErrorCopy.text(failure) }
                        catch { self.error = "网络异常，请稍后重试。" }
                    }
                }
                .accessibilityIdentifier("share.refresh")
                Button("查看牌桌") { onEnterTable() }
                    .accessibilityIdentifier("share.viewTable")
            } header: { BrandSectionHeader("成员") }
            .brandPanel()
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle("分享牌桌")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
    }
}

// MARK: - 进行中桌 / 已结束桌（在线）

@MainActor
struct OnlineTableScreen: View {
    let service: any FinalMatchService
    let matchId: String
    @State private var match: FinalMatch?
    @State private var loading = false
    @State private var error: String?
    @State private var showFinal = false
    @State private var showCancelConfirm = false
    @State private var cancelling = false

    private var isHost: Bool {
        guard let match, let userId = service.currentUserId else { return false }
        if let hostId = match.hostId { return hostId == userId }
        // hostId 缺失时的兜底：members 的 isHost（API 实测视图字段）。
        return match.members.first { $0.userId == userId }?.isHost ?? false
    }

    var body: some View {
        List {
            if loading && match == nil { ProgressView("读取对局中…") }
            if let error {
                Section {
                    Text("加载失败：\(error)").foregroundStyle(Brand.loss)
                    Button("重试") { Task { await refresh() } }
                }.brandPanel()
            }
            if let match {
                Section {
                    HStack(spacing: 12) {
                        EastTile(size: 40)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(match.mode.label) · \(match.statusLabel())").font(Brand.display(24)).foregroundStyle(Brand.gold)
                            Text("成员 \(match.members.count)/\(match.mode.playerCount)")
                                .foregroundStyle(Brand.text)
                        }
                    }
                    if let code = match.joinCode {
                        Text("房间码：\(code)").font(Brand.font(.headline)).foregroundStyle(Brand.text)
                            .accessibilityIdentifier("table.joinCode")
                    }
                    Text("牌桌 \(match.id)")
                        .font(Brand.font(.caption2)).foregroundStyle(Brand.muted).textSelection(.enabled)
                    Text("创建时间：\(match.createdAt.map(localDate) ?? "未提供")").monospacedDigit()
                } header: { BrandSectionHeader("对局信息") }
                .brandPanel()
                Section {
                    if match.seatsDrawn {
                        ForEach(match.seatDisplays(), id: \.wind) { seat in
                            HStack(spacing: 12) {
                                Text(windLabel(seat.wind))
                                    .font(Brand.font(.headline))
                                    .foregroundStyle(Brand.ink)
                                    .frame(width: 30, height: 30)
                                    .background(Brand.cream, in: RoundedRectangle(cornerRadius: 6))
                                Text(seat.name).font(Brand.font(.headline)).foregroundStyle(Brand.text)
                                if seat.wind == "E" { Text("· 庄家").foregroundStyle(Brand.gold) }
                                Spacer()
                                if let score = match.finalScores?.first(where: { $0.wind == seat.wind }) {
                                    Text("第 \(score.rank) 名 · \(formatPoints(score.score))")
                                        .font(Brand.font(.subheadline, weight: .semibold)).monospacedDigit()
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    } else {
                        ForEach(match.members, id: \.userId) { member in
                            Text(member.displayName).foregroundStyle(Brand.text)
                        }
                        Text("等待人齐，人齐后自动分座。")
                            .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                    }
                } header: { BrandSectionHeader("座次") }
                .brandPanel()
                if match.isInProgress {
                    Section {
                        if isHost {
                            Button("进入终局记分") { showFinal = true }
                                .buttonStyle(.borderedProminent)
                                .tint(Brand.gold)
                                .foregroundStyle(Brand.background)
                                .accessibilityIdentifier("online.final.open")
                        } else {
                            Text("终局记分由房主填写，你当前为只读。")
                                .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                        }
                        if isHost {
                            Button("取消本场", role: .destructive) { showCancelConfirm = true }
                                .disabled(cancelling)
                                .accessibilityIdentifier("online.cancel.open")
                        }
                    }.brandPanel()
                }
                if match.isFinished {
                    Section {
                        if let scores = match.finalScores {
                            ForEach(scores.sorted { $0.rank < $1.rank }, id: \.wind) { score in
                                Text("第 \(score.rank) 名 · \(windLabel(score.wind)) · \(formatPoints(score.score))")
                                    .monospacedDigit()
                            }
                        } else {
                            Text("终局得点暂未提供")
                        }
                        if let corrected = match.correctedAt {
                            Text("已纠正：\(localDate(corrected))").font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                        }
                        if isHost {
                            Button("纠正终局得点") { showFinal = true }
                                .accessibilityIdentifier("online.final.correct")
                        }
                    } header: { BrandSectionHeader("终局得点") }
                    .brandPanel()
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle("牌桌")
        .tabBarClearance()
        .refreshable { await refresh() }
        .task { await refresh() }
        .alert("取消本场？", isPresented: $showCancelConfirm) {
            Button("保留牌桌", role: .cancel) {}
            Button("确认取消", role: .destructive) {
                Task {
                    cancelling = true
                    defer { cancelling = false }
                    do {
                        match = try await service.cancel(matchId: matchId)
                    } catch let failure as APIError {
                        self.error = APIErrorCopy.text(failure)
                    } catch {
                        self.error = "网络异常，请稍后重试。"
                    }
                }
            }
        } message: {
            Text("取消后本场不再进行，此操作无法撤销。")
        }
        .sheet(isPresented: $showFinal) {
            if let match {
                NavigationStack {
                    FinalScoreEditor(
                        seats: match.seatDisplays(),
                        mode: match.mode,
                        editable: isHost,
                        initial: Dictionary(uniqueKeysWithValues: (match.finalScores ?? []).map { ($0.wind, $0.score) }),
                        title: match.isFinished ? "纠正终局得点" : "终局记分",
                        onSave: { entries in
                            self.match = try await service.submitFinalScores(
                                matchId: match.id, scores: entries, correction: match.isFinished)
                        },
                        onSaved: { Task { await refresh() } })
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { showFinal = false } } }
                }
            }
        }
    }

    @MainActor private func refresh() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let mine = try await service.mine()
            match = mine.first { $0.id == matchId }
            if match == nil { self.error = "对局不在我的列表中。" }
        } catch let failure as APIError {
            self.error = APIErrorCopy.text(failure)
        } catch {
            self.error = "网络异常，请稍后重试。"
        }
    }
}

// MARK: - 管理（仅 isAdmin 见入口）

@MainActor
struct AdminScreen: View {
    let service: any FinalMatchService
    @State private var players: [AdminPlayer] = []
    @State private var matches: [FinalMatch] = []
    @State private var error: String?
    @State private var pendingDelete: FinalMatch?
    @State private var correcting: FinalMatch?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            if let error {
                Section { Text(error).foregroundStyle(Brand.loss) }.brandPanel()
            }
            Section {
                if players.isEmpty { Text("暂无玩家").foregroundStyle(Brand.muted) }
                ForEach(players, id: \.id) { player in
                    HStack {
                        Text(player.name).foregroundStyle(Brand.text)
                        Spacer()
                        Text("参与 \(player.matchCount) 局").font(Brand.font(.subheadline)).foregroundStyle(Brand.muted)
                    }
                }
            } header: { BrandSectionHeader("玩家管理") }
            .brandPanel()
            Section {
                if matches.isEmpty { Text("暂无对局").foregroundStyle(Brand.muted) }
                ForEach(matches, id: \.id) { match in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(match.mode.label) · \(match.statusLabel())")
                            .font(Brand.font(.headline)).foregroundStyle(Brand.gold)
                        Text("成员 \(match.members.count)/\(match.mode.playerCount) · \(match.joinCode.map { "房间码 \($0)" } ?? "")")
                            .font(Brand.font(.subheadline)).foregroundStyle(Brand.muted)
                        HStack(spacing: 12) {
                            if match.isFinished {
                                Button("纠正") { correcting = match }
                                    .accessibilityIdentifier("admin.match.correct.\(match.id)")
                            }
                            Button("删除", role: .destructive) { pendingDelete = match }
                                .accessibilityIdentifier("admin.match.delete.\(match.id)")
                        }
                    }
                    .padding(.vertical, 4)
                }
            } header: { BrandSectionHeader("数据管理 · 全部对局") }
            .brandPanel()
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle("管理")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
        .task { await refresh() }
        .refreshable { await refresh() }
        .alert("删除对局？", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })) {
            Button("取消", role: .cancel) { pendingDelete = nil }
            Button("删除", role: .destructive) {
                if let pendingDelete {
                    Task {
                        do {
                            try await service.deleteAdmin(matchId: pendingDelete.id)
                            await refresh()
                        } catch let failure as APIError { self.error = APIErrorCopy.text(failure) }
                        catch { self.error = "网络异常，请稍后重试。" }
                    }
                }
                self.pendingDelete = nil
            }
        } message: {
            Text("这张对局将被永久删除，此操作无法撤销。")
        }
        .sheet(item: $correcting) { match in
            NavigationStack {
                FinalScoreEditor(
                    seats: match.seatDisplays(),
                    mode: match.mode,
                    editable: true,
                    initial: Dictionary(uniqueKeysWithValues: (match.finalScores ?? []).map { ($0.wind, $0.score) }),
                    title: "纠正终局得点",
                    onSave: { entries in
                        _ = try await service.correctAdmin(matchId: match.id, scores: entries)
                    },
                    onSaved: { Task { await refresh() } })
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { correcting = nil } } }
            }
        }
    }

    @MainActor private func refresh() async {
        do {
            async let fetchedPlayers = service.adminPlayers()
            async let fetchedMatches = service.adminMatches()
            players = try await fetchedPlayers
            matches = try await fetchedMatches
            error = nil
        } catch let failure as APIError {
            self.error = APIErrorCopy.text(failure)
        } catch {
            self.error = "网络异常，请稍后重试。"
        }
    }
}

// MARK: - 我的

@MainActor
struct ProfileScreen: View {
    @ObservedObject var session: AppSession
    let service: (any FinalMatchService)?
    let isAdmin: Bool
    let isStub: Bool
    let onJoin: () -> Void
    @State private var loading = false
    @State private var error: String?
    @State private var showAdmin = false
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
                if loading && session.profile == nil && !isStub { ProgressView("读取账号中…") }
                if let error {
                    Text("加载失败：\(error)").foregroundStyle(Brand.loss)
                    Button("重试") { Task { await refresh() } }
                }
                if isStub {
                    LabeledContent {
                        Text("演示账号").foregroundStyle(Brand.muted)
                    } label: { Text("昵称").foregroundStyle(Brand.text) }
                    Text("演示模式：在线流程为内存演练，不连接真实服务。")
                        .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                } else if let principal = session.profile?.principal {
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
                        Text("临时访客会话已安全保存；不能开桌。")
                            .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                    }
                }
            } header: { BrandSectionHeader("我的账号") }
            .brandPanel()
            Section {
                Button("加入牌桌（房间码 / 扫码 / 链接）", action: onJoin)
                    .accessibilityIdentifier("profile.join.open")
                if isAdmin {
                    Button("管理入口（管理员）") { showAdmin = true }
                        .accessibilityIdentifier("profile.admin.open")
                }
                if !isStub {
                    Button("退出登录", role: .destructive) {
                        Task {
                            signingOut = true
                            await session.signOut()
                            signingOut = false
                        }
                    }
                    .disabled(signingOut)
                }
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
        .sheet(isPresented: $showAdmin) {
            if let service {
                NavigationStack { AdminScreen(service: service) }
            }
        }
    }

    @MainActor private func refresh() async {
        guard !loading, !isStub else { return }
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

