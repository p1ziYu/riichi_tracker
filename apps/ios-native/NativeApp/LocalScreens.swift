import SwiftUI

private extension View {
    func localBrandField() -> some View {
        foregroundStyle(Brand.text)
            .padding(10)
            .background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
    }
}

// 最后一版原生本地模式：本机建桌（名字 + 模式）→ 直接随机分座 →
// 进行中 → 本机房主填终局分 → 合计校验 → 本地历史 + 纠正。
// 不设加入/分享/管理；滑动删除保留 fix10 的右侧金色整高块 + 两步中文确认。

@MainActor struct LocalMatchListScreen: View {
    @ObservedObject var store: LocalMatchStore
    @State private var creating = false
    @State private var chosen: String?
    @State private var deleteFirst: String?
    @State private var deleteFinal: String?
    @State private var issue: String?

    var body: some View {
        List {
            if let failure = store.failure { Section { Text(failure).foregroundStyle(Brand.loss).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard(cornerRadius: 10).listRowInsets(Brand.rowInsets) } }
            if let issue { Section { Text(issue).foregroundStyle(Brand.loss).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard(cornerRadius: 10).listRowInsets(Brand.rowInsets) } }
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Text("本机独立牌桌 · 无账户、无加入、无云端同步").foregroundStyle(Brand.muted)
                    Rectangle().fill(Brand.hairline).frame(height: 1)
                    Button("本地开桌") { creating = true }.disabled(store.failure != nil)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("local.create.open")
                }
                .padding(Brand.cardInnerPadding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .brandCard(cornerRadius: 10)
                .listRowInsets(Brand.rowInsets)
            }
            Section {
                let active = store.ordered.filter { !$0.isFinished }
                if store.failure == nil && active.isEmpty {
                    Text("暂无进行中的本地牌桌，点击“本地开桌”开始一局。").foregroundStyle(Brand.muted).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard(cornerRadius: 10).listRowInsets(Brand.rowInsets)
                }
                ForEach(active) { match in row(match) }
            } header: { BrandSectionHeader("进行中", leadingShift: BrandSectionHeader.plainLeadingShift) }
            Section {
                let done = store.ordered.filter { $0.isFinished }
                if store.failure == nil && done.isEmpty {
                    Text("暂无已结束的本地牌桌，终局记分保存后会在这里显示。").foregroundStyle(Brand.muted).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard(cornerRadius: 10).listRowInsets(Brand.rowInsets)
                }
                ForEach(done) { match in row(match) }
            } header: { BrandSectionHeader("历史 · 已结束", leadingShift: BrandSectionHeader.plainLeadingShift) }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden).background(Brand.background).tint(Brand.gold).foregroundStyle(Brand.text)
        .navigationTitle("本地")
        .tabBarClearance()
        .navigationDestination(for: String.self) { id in LocalTableScreen(store: store, id: id) }
        .sheet(isPresented: $creating) {
            NavigationStack { LocalCreateSheet(store: store) { id in creating = false; chosen = id } }
        }
        .navigationDestination(isPresented: Binding(get: { chosen != nil }, set: { if !$0 { chosen = nil } })) {
            if let chosen { LocalTableScreen(store: store, id: chosen) }
        }
        .alert("删除整桌及全部历史？", isPresented: Binding(get: { deleteFirst != nil }, set: { if !$0 { deleteFirst = nil } })) {
            Button("保留牌桌", role: .cancel) { deleteFirst = nil }
            Button("继续确认", role: .destructive) { deleteFinal = deleteFirst; deleteFirst = nil }
        } message: { Text("已保存的终局记录也将永久删除。") }
        .alert("最后确认：永久删除？", isPresented: Binding(get: { deleteFinal != nil }, set: { if !$0 { deleteFinal = nil } })) {
            Button("保留牌桌", role: .cancel) { deleteFinal = nil }
            Button("不可恢复地删除", role: .destructive) {
                if let deleteFinal { do { try store.delete(deleteFinal) } catch { issue = error.localizedDescription } }
                deleteFinal = nil
            }
        } message: { Text("无法恢复这张本机牌桌的全部记录。") }
    }

    private func row(_ match: LocalFinalMatch) -> some View {
        TrailingSwipeDeleteRow(cornerRadius: 10, deleteIdentifier: "local.match.delete.\(match.id)") { deleteFirst = match.id } content: {
            HStack {
                NavigationLink(value: match.id) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(match.mode.label) · \(match.isFinished ? "已结束" : "进行中")")
                            .font(Brand.font(.headline)).foregroundStyle(Brand.gold)
                        Text(match.seats.map { "\($0.name)" }.joined(separator: "、"))
                            .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                        Text("\(match.isFinished ? "查看记录" : "继续对局") · \(localDateOnly(match.createdAt))")
                            .font(Brand.font(.caption1)).foregroundStyle(Brand.muted)
                    }
                }
                Spacer()
                Button(role: .destructive) { deleteFirst = match.id } label: {
                    Image(systemName: "trash").foregroundStyle(Brand.loss)
                }
                .buttonStyle(.borderless).accessibilityLabel("删除整桌")
            }
            .padding(.horizontal, Brand.cardInnerPadding)
            .frame(maxWidth: .infinity)
            .brandCard(cornerRadius: 10)
            .padding(.vertical, 4)
        }
        .listRowInsets(Brand.swipeRowInsets)
        .accessibilityIdentifier(match.isFinished ? "local.match.finished" : "local.match.active")
    }
}

@MainActor struct LocalCreateSheet: View {
    @ObservedObject var store: LocalMatchStore
    let onCreated: (String) -> Void
    @State private var mode: FinalMode = .four
    @State private var names: [String] = ["", "", "", ""]
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    private func resize(for mode: FinalMode) {
        if names.count < mode.playerCount {
            names += Array(repeating: "", count: mode.playerCount - names.count)
        } else if names.count > mode.playerCount {
            names = Array(names.prefix(mode.playerCount))
        }
    }

    var body: some View {
        List {
            Section {
                Text("输入每位玩家的名字并选模式，建桌即直接随机分座（东座即庄家）。")
                    .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
            }.brandPanel()
            Section {
                HStack(spacing: 12) {
                    ForEach(FinalMode.allCases, id: \.self) { candidate in
                        Button(candidate.label) {
                            mode = candidate
                            resize(for: candidate)
                        }
                        .font(Brand.font(.headline, weight: .semibold))
                        .foregroundStyle(mode == candidate ? Brand.background : Brand.cream)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(mode == candidate ? Brand.gold : Brand.deep, in: RoundedRectangle(cornerRadius: 10))
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("local.mode.\(candidate.rawValue)")
                    }
                }
                Text("\(mode.label) · \(mode.playerCount) 人 · 终局合计 \(mode.total)")
                    .font(Brand.font(.subheadline)).foregroundStyle(Brand.muted)
            } header: { BrandSectionHeader("选择模式") }
            .brandPanel()
            Section {
                ForEach(0..<mode.playerCount, id: \.self) { index in
                    TextField("玩家 \(index + 1)", text: Binding(
                        get: { index < names.count ? names[index] : "" },
                        set: { if index < names.count { names[index] = $0 } }))
                        .localBrandField()
                        .accessibilityIdentifier("local.name.\(index)")
                }
            } header: { BrandSectionHeader("玩家名字") }
            .brandPanel()
            if let error {
                Section { Text(error).foregroundStyle(Brand.loss) }.brandPanel()
            }
            Section {
                Button("建桌并随机分座") {
                    do {
                        let match = try store.create(names: Array(names.prefix(mode.playerCount)), mode: mode)
                        onCreated(match.id)
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Brand.gold)
                .foregroundStyle(Brand.background)
                .disabled(names.prefix(mode.playerCount).contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
                .accessibilityIdentifier("local.create.confirm")
            }.brandPanel()
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle("本地开桌")
        .keyboardDismissal()
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { dismiss() } } }
    }
}

@MainActor struct LocalTableScreen: View {
    @ObservedObject var store: LocalMatchStore
    let id: String
    @State private var showFinal = false

    private var match: LocalFinalMatch? { store.match(id) }

    var body: some View {
        List {
            if let match {
            Section {
                HStack(spacing: 12) {
                    EastTile(size: 40)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(match.mode.label) · \(match.isFinished ? "已结束" : "进行中")").font(Brand.display(24)).foregroundStyle(Brand.gold)
                        Text("终局合计 \(match.mode.total)（单位：实际点数 ÷ 100）").foregroundStyle(Brand.text)
                    }
                }
                Text("创建：\(localDateOnly(match.createdAt))").monospacedDigit()
            } header: { BrandSectionHeader("对局信息") }
            .brandPanel()
            Section {
                ForEach(match.seats, id: \.wind) { seat in
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
            } header: { BrandSectionHeader("座位") }
            .brandPanel()
            Section {
                if match.isFinished {
                    if let corrected = match.correctedAt {
                        Text("已纠正：\(localDateOnly(corrected))").font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                    }
                    Button("纠正终局得点") { showFinal = true }
                        .accessibilityIdentifier("local.final.open")
                } else {
                    Button("填写终局得点") { showFinal = true }
                        .buttonStyle(.borderedProminent)
                        .tint(Brand.gold)
                        .foregroundStyle(Brand.background)
                        .accessibilityIdentifier("local.final.open")
                }
            }.brandPanel()
            } else {
                Section { Text("本地牌桌不存在，可能已被删除。").foregroundStyle(Brand.loss) }.brandPanel()
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Brand.background)
        .tint(Brand.gold)
        .foregroundStyle(Brand.text)
        .navigationTitle("本地牌桌")
        .tabBarClearance()
        .sheet(isPresented: $showFinal) {
            if let match {
                NavigationStack {
                    FinalScoreEditor(
                        seats: match.seats.map { SeatDisplay(wind: $0.wind, name: $0.name) },
                        mode: match.mode,
                        editable: true,
                        initial: Dictionary(uniqueKeysWithValues: (match.finalScores ?? []).map { ($0.wind, $0.score) }),
                        title: match.isFinished ? "纠正终局得点" : "终局记分",
                        onSave: { entries in
                            _ = try store.saveFinalScores(id: match.id, scores: entries, correction: match.isFinished)
                        },
                        onSaved: {})
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("关闭") { showFinal = false } } }
                }
            }
        }
    }
}
