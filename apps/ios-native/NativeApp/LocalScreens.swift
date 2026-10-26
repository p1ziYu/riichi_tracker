import SwiftUI

private extension View {
    func localBrandField() -> some View {
        foregroundStyle(Brand.text)
            .padding(10)
            .background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
    }
}

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
            // iosfix9: ONE inset card with a hairline divider (the
            // fix7-era treatment), not two thin strips whose text had
            // ~4pt of left padding and read as full-bleed bands. Text
            // sits at card edge + shared inner padding (32pt), the
            // same column as the local row titles below.
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Text("本机独立牌桌 · 无账户、签到或云端同步").foregroundStyle(Brand.muted)
                    Rectangle().fill(Brand.hairline).frame(height: 1)
                    Button("离线开桌") { creating = true }.disabled(store.failure != nil)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(Brand.cardInnerPadding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .brandCard(cornerRadius: 10)
                .listRowInsets(Brand.rowInsets)
            }
            Section {
                // iosfix10 M4: empty-state guidance cards, same style
                // as the online lobby's (never shown on load failure,
                // so a failed read is not mistaken for "no tables").
                if store.failure == nil && store.matches.filter({ $0.status == "active" }).isEmpty {
                    Text("暂无进行中的本地牌桌，点击“离线开桌”开始一局。").foregroundStyle(Brand.muted).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard(cornerRadius: 10).listRowInsets(Brand.rowInsets)
                }
                ForEach(store.matches.filter { $0.status == "active" }) { match in row(match) }
            } header: { BrandSectionHeader("进行中", leadingShift: BrandSectionHeader.plainLeadingShift) }
            Section {
                if store.failure == nil && store.matches.filter({ $0.status == "finished" }).isEmpty {
                    Text("暂无已结束的本地牌桌，结算完成后会在这里显示逐局明细。").foregroundStyle(Brand.muted).padding(Brand.cardInnerPadding).frame(maxWidth: .infinity, alignment: .leading).brandCard(cornerRadius: 10).listRowInsets(Brand.rowInsets)
                }
                ForEach(store.matches.filter { $0.status == "finished" }) { match in row(match) }
            } header: { BrandSectionHeader("已结束 · 逐局明细", leadingShift: BrandSectionHeader.plainLeadingShift) }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden).background(Brand.background).tint(Brand.gold).foregroundStyle(Brand.text)
        .navigationTitle("本地牌桌")
        .tabBarClearance()
        .navigationDestination(for: String.self) { id in LocalTableScreen(store: store, id: id) }
        .sheet(isPresented: $creating) {
            NavigationStack { LocalWizard(store: store) { id in creating = false; chosen = id } }
        }
        .navigationDestination(isPresented: Binding(get: { chosen != nil }, set: { if !$0 { chosen = nil } })) {
            if let chosen { LocalTableScreen(store: store, id: chosen) }
        }
        // iosfix10 P6: on iOS 27 this confirmationDialog renders as a
        // centered popover that DROPS the cancel-role button, leaving
        // only red 继续确认 (tap-outside was the only dismiss). An
        // alert always renders both buttons, so step 1 now has an
        // explicit 保留牌桌 cancel.
        .alert("删除整桌及全部历史？", isPresented: Binding(get: { deleteFirst != nil }, set: { if !$0 { deleteFirst = nil } })) {
            Button("保留牌桌", role: .cancel) { deleteFirst = nil }
            Button("继续确认", role: .destructive) { deleteFinal = deleteFirst; deleteFirst = nil }
        } message: { Text("已结算的逐局历史也将永久删除。") }
        .alert("最后确认：永久删除？", isPresented: Binding(get: { deleteFinal != nil }, set: { if !$0 { deleteFinal = nil } })) {
            Button("保留牌桌", role: .cancel) { deleteFinal = nil }
            Button("不可恢复地删除", role: .destructive) {
                if let deleteFinal { do { try store.delete(deleteFinal) } catch { issue = error.localizedDescription } }
                deleteFinal = nil
            }
        } message: { Text("无法恢复这张本机牌桌的全部记录。") }
    }
    private func row(_ match: LocalMatch) -> some View {
        TrailingSwipeDeleteRow(cornerRadius: 10, deleteIdentifier: "local.match.delete.\(match.id)") { deleteFirst = match.id } content: {
        HStack {
            NavigationLink(value: match.id) {
                VStack(alignment: .leading) {
                    Text(match.name).font(Brand.font(.headline))
                    Text("\(match.templateName) · \(match.reviewStatus) · \(match.seats.count) 麻")
                        .font(Brand.font(.footnote)).foregroundStyle(Brand.muted)
                    Text("\(match.status == "active" ? "继续对局" : "查看记录") · \(localDate(match.updatedAt))")
                        .font(Brand.font(.caption1)).foregroundStyle(Brand.muted)
                    Text("自定义规则 \(match.customizedKeys.count) 项").font(Brand.font(.caption1)).foregroundStyle(Brand.muted)
                }
            }
            Spacer()
            Button(role: .destructive) { deleteFirst = match.id } label: {
                Image(systemName: "trash").foregroundStyle(Brand.loss)
            }
                .buttonStyle(.borderless).accessibilityLabel("删除整桌 \(match.name)")
        }
        .padding(.horizontal, Brand.cardInnerPadding)
        .frame(maxWidth: .infinity)
        .brandCard(cornerRadius: 10)
        .padding(.vertical, 4)
        }
        .listRowInsets(Brand.swipeRowInsets)
    }
}

@MainActor struct LocalWizard: View {
    @ObservedObject var store: LocalMatchStore
    let onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var selected: LocalTemplate?
    @State private var base: [String: JSONValue] = [:]
    @State private var values: [String: JSONValue] = [:]
    @State private var numbers: [String: String] = [:]
    @State private var uma: [String] = []
    @State private var examples: [(String, String)] = []
    @State private var issue: String?
    @State private var step = 0
    @State private var confirming: LocalTemplate?
    @State private var adjustments = true
    @State private var name = ""
    @State private var names: [String] = []
    @State private var dealer = 0
    private let pointKeys = ["startingPoints", "returnPoints", "targetPoints", "notenPenaltyTotal", "honbaRon", "honbaPerPayer"]
    private let pointLabels = ["起始点", "返还点", "终局目标点", "荒牌罚符", "本场荣和总额", "本场自摸每人"]
    private let groups = ["终局策略", "支付数值", "多荣与立直", "流满与三麻", "番数与役满"]
    private let options: [(String, String, String, [(String, String)])] = [
        ("fixedSouth4EndPolicy", "末局结束条件", "终局策略", [("completed_south_4", "打完南四局"), ("target_or_bust", "目标点或飞人")]),
        ("automaticEndPolicy", "自动终局", "终局策略", [("manual", "手动"), ("ranked_sanma", "三麻段位")]),
        ("terminalRiichiPoolPolicy", "终局供托", "终局策略", [("first", "首位领取"), ("unallocated", "不分配")]),
        ("tiedUmaPolicy", "同点马点", "终局策略", [("seat_order", "按起家座次"), ("split", "均分")]),
        ("bustEndsGame", "负分结束", "终局策略", []),
        ("multiRon", "多家荣和", "多荣与立直", [("head_bump", "头跳"), ("double_ron", "双响"), ("allow_all", "允许全部")]),
        ("doubleRonHonbaPolicy", "双响本场", "多荣与立直", [("nearest_only", "最近赢家"), ("each_winner", "每位赢家")]),
        ("allowLowPointRiichi", "低点可立直", "多荣与立直", []),
        ("nagashiManganEnabled", "流局满贯", "流满与三麻", []),
        ("nagashiCollectsRiichiPool", "流满收供托", "流满与三麻", []),
        ("nagashiDealerRepeatRequiresTenpai", "流满庄家需听牌续庄", "流满与三麻", []),
        ("tsumoLoss", "三麻自摸损", "流满与三麻", []),
        ("kiriageMangan", "切上满贯", "番数与役满", []),
        ("kazoeYakuman", "累计役满", "番数与役满", []),
        ("compositeYakuman", "复合役满", "番数与役满", []),
        ("doubleYakuman", "特殊双倍役满", "番数与役满", [])
    ]
    private var count: Int {
        guard case .number(let value)? = values["playerCount"] else { return 4 }
        return Int(value)
    }
    private var changes: Int { Set(base.keys).union(values.keys).filter { base[$0] != values[$0] && $0 != "oka" }.count }
    var body: some View {
        Form {
            if let issue { Section { Text(issue).foregroundStyle(Brand.loss).brandPanel() } }
            if step == 0 {
                Section {
                    ForEach(LocalTemplate.all) { template in
                        let isSelected = selected?.id == template.id
                        Button {
                            if selected != nil && changes > 0 { confirming = template }
                            else { select(template) }
                        } label: {
                            HStack {
                                Text("\(template.name) · \(template.reviewStatus)")
                                Spacer()
                                if isSelected {
                                    VStack(spacing: 2) {
                                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Brand.gold)
                                        Text("已选").font(Brand.font(.footnote)).foregroundStyle(Brand.gold)
                                    }
                                }
                            }
                            .padding(10)
                            .background(isSelected ? Brand.gold.opacity(0.18) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(isSelected ? Brand.gold : Color.clear, lineWidth: 1.5))
                        }.brandPanel().accessibilityIdentifier("local.template.\(template.id)")
                            .accessibilityAddTraits(isSelected ? .isSelected : [])
                    }
                } header: { BrandSectionHeader("随包分发的四份模板") }
                if selected != nil { Button("下一步：调整规则") { step = 1 }.brandPanel().accessibilityIdentifier("local.wizard.nextRules") }
            } else if step == 1 {
                Section {
                    Text("\(selected?.name ?? "") · \(count) 麻 · 立直棒固定 1,000 点").foregroundStyle(Brand.muted).brandPanel()
                    Button("重选模板") { step = 0 }.brandPanel()
                    DisclosureGroup("规则调整 · 已自定义 \(changes) 项", isExpanded: $adjustments) {
                        Button("恢复模板") { values = base; sync(); recalculate() }.disabled(changes == 0)
                            .brandPanel()
                    }.brandPanel()
                }
                if adjustments {
                    Section {
                        ForEach(0..<3, id: \.self) { index in
                            point(pointKeys[index], pointLabels[index])
                            HStack {
                                ForEach(index == 0 ? [25_000, 30_000, 35_000] : [30_000, 40_000], id: \.self) { value in
                                    // iosfix6 item 3: same Form-row collapse
                                    // as the online wizard — borderless
                                    // restores per-chip dispatch.
                                    Button(value.formatted()) { setPoint(pointKeys[index], value) }
                                        .font(Brand.font(.footnote))
                                        .buttonStyle(.borderless)
                                        .padding(.vertical, 6)
                                        .padding(.horizontal, 4)
                                        .contentShape(Rectangle())
                                        .accessibilityIdentifier("local.wizard.preset.\(pointKeys[index]).\(value)")
                                }
                            }.brandPanel()
                        }
                        if case .number(let start)? = values["startingPoints"], case .number(let returned)? = values["returnPoints"] {
                            Text("头名赏（只读） \(scoreText((returned - start) * Double(count) / 1000)) 竞技分").foregroundStyle(Brand.muted).brandPanel()
                        }
                        ForEach(0..<uma.count, id: \.self) { index in
                            TextField("", text: Binding(get: { uma[index] }, set: { uma[index] = $0; recalculate() }),
                                prompt: Text("第 \(index + 1) 位马点").foregroundColor(Brand.muted))
                                .keyboardType(.decimalPad).localBrandField().brandPanel()
                        }
                        ForEach(count == 3 ? [[20, 0, -20], [30, 0, -30], [10, 0, -10], [0, 0, 0]] :
                                    [[20, 10, -10, -20], [15, 5, -5, -15], [30, 10, -10, -30], [10, 5, -5, -10], [0, 0, 0, 0]], id: \.self) { preset in
                            Button(preset.map(String.init).joined(separator: " / ")) { uma = preset.map(String.init); recalculate() }
                                .buttonStyle(.borderless)
                                .brandPanel()
                                .accessibilityIdentifier("local.wizard.umaPreset.\(preset.map(String.init).joined(separator: "_"))")
                        }
                    } header: { BrandSectionHeader("起点与成绩") }
                    ForEach(groups, id: \.self) { group in
                        Section {
                            if group == "支付数值" {
                                ForEach(3..<6, id: \.self) { index in point(pointKeys[index], pointLabels[index]) }
                                Text("罚符 1,500 点不可整百分摊，不支持。").foregroundStyle(Brand.muted).brandPanel()
                                ForEach(count == 3 ? [0, 2000, 3000] : [0, 3000], id: \.self) { value in
                                    Button("罚符 \(value)") { setPoint("notenPenaltyTotal", value) }
                                        .buttonStyle(.borderless).brandPanel()
                                        .accessibilityIdentifier("local.wizard.preset.notenPenaltyTotal.\(value)")
                                }
                                ForEach([100, 200], id: \.self) { value in
                                    Button("本场自摸每人 \(value) / 荣和 \(value * (count - 1))") { setPoint("honbaPerPayer", value) }
                                        .buttonStyle(.borderless).brandPanel()
                                        .accessibilityIdentifier("local.wizard.preset.honbaPerPayer.\(value)")
                                }
                            }
                            ForEach(options.indices.filter { index in
                                let item = options[index]
                                return item.2 == group && (item.0 != "tsumoLoss" || count == 3) &&
                                    (item.0 != "doubleRonHonbaPolicy" || values["multiRon"] != .string("head_bump"))
                            }, id: \.self) { itemIndex in
                                let item = options[itemIndex]
                                if item.3.isEmpty {
                                    Toggle(item.1, isOn: Binding(get: { values[item.0] == .bool(true) },
                                        set: { values[item.0] = .bool($0); recalculate() })).brandPanel()
                                } else {
                                    Picker(item.1, selection: Binding(get: { values[item.0]?.string ?? "" },
                                        set: { values[item.0] = .string($0); recalculate() })) {
                                        ForEach(item.3.indices.filter { index in
                                            let candidate = item.3[index]
                                            return (candidate.0 != "ranked_sanma" || count == 3) &&
                                                (item.0 != "fixedSouth4EndPolicy" || candidate.0 != "completed_south_4" || count == 4)
                                        }, id: \.self) { candidateIndex in
                                            Text(item.3[candidateIndex].1).tag(item.3[candidateIndex].0)
                                        }
                                    }.brandPanel()
                                }
                            }
                        } header: { BrandSectionHeader(group) }
                    }
                }
                Section {
                    if examples.isEmpty { Text("规则无效时不会展示过期金额").foregroundStyle(Brand.muted).brandPanel() }
                    ForEach(0..<examples.count, id: \.self) { index in
                        VStack(alignment: .leading) {
                            Text(examples[index].0).font(Brand.font(.headline))
                            Text(examples[index].1).font(Brand.font(.footnote)).monospacedDigit().foregroundStyle(Brand.muted)
                        }.brandPanel().accessibilityIdentifier("local.wizard.example.\(index)")
                    }
                    Button("下一步：设置姓名与起家") { step = 2 }.disabled(issue != nil).brandPanel().accessibilityIdentifier("local.wizard.nextNames")
                } header: { BrandSectionHeader("本机引擎四例预览") }
            } else {
                Section {
                    TextField("", text: $name, prompt: Text("牌桌名称").foregroundColor(Brand.muted))
                        .localBrandField().brandPanel()
                    ForEach(0..<names.count, id: \.self) { index in
                        TextField("", text: $names[index], prompt: Text("\(index + 1) 号位 · 玩家姓名（最多 40 字）").foregroundColor(Brand.muted))
                            .localBrandField().brandPanel()
                    }
                    Picker("指定起家", selection: $dealer) {
                        ForEach(0..<count, id: \.self) { index in Text("\(index + 1) 号位").tag(index) }
                    }.brandPanel()
                    Text("创建后立即打开东一局；本桌与登录账户完全无关。").foregroundStyle(Brand.muted).brandPanel()
                    Button("创建并进入首局") { create() }.disabled(issue != nil || names.contains { $0.count > 40 }).brandPanel().accessibilityIdentifier("local.wizard.create")
                    Button("返回规则调整") { step = 1 }.brandPanel()
                } header: { BrandSectionHeader("设置本地牌桌") }
            }
        }
        .scrollContentBackground(.hidden).background(Brand.background).tint(Brand.gold).foregroundStyle(Brand.text)
        .navigationTitle("离线开桌")
        .keyboardDismissal()
        .accessibilityIdentifier("local.wizard.step.\(step)")
        .alert("切换模板将丢弃当前调整", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } })) {
            Button("保留调整", role: .cancel) { confirming = nil }
            Button("丢弃并切换", role: .destructive) { if let confirming { select(confirming) }; confirming = nil }
        }
    }
    private func select(_ template: LocalTemplate) {
        do {
            let config = try LocalMatchStore.templateRules(template.id)
            selected = template; values = config; base = config; name = template.name
            names = (0..<count).map { "玩家 \($0 + 1)" }; dealer = 0
            sync(); recalculate()
        } catch { issue = error.localizedDescription }
    }
    private func sync() {
        numbers = pointKeys.reduce(into: [:]) { result, key in
            if case .number(let value)? = values[key] { result[key] = String(Int(value)) }
        }
        uma = values["uma"]?.arrayValue?.map { value in
            if case .number(let number) = value { return String(number) }
            return ""
        } ?? []
    }
    private func point(_ key: String, _ label: String) -> some View {
        VStack(alignment: .leading) {
            Text(label)
            // iosfix10 P9: same shared format as the online wizard —
            // the getter groups the digits (25,000, like the chips),
            // parsing strips separators.
            TextField("", text: Binding(get: {
                if let raw = numbers[key], let value = parsePoints(raw) { return formatPoints(value) }
                return numbers[key] ?? ""
            }, set: { text in
                numbers[key] = text
                if let value = parsePoints(text) { setPoint(key, value, keepText: true) }
                else { issue = "\(label)需填写整数"; examples = [] }
            }), prompt: Text(label).foregroundColor(Brand.muted)).keyboardType(.numberPad).localBrandField()
        }.brandPanel()
    }
    private func setPoint(_ key: String, _ value: Int, keepText: Bool = false) {
        guard value >= 0 && value <= 2_147_483_647 && (key != "honbaPerPayer" || value <= 2_147_483_647 / (count - 1)) else {
            issue = "点数超出合法整数范围"; examples = []; return
        }
        values[key] = .number(Double(value))
        if !keepText { numbers[key] = String(value) }
        if key == "honbaPerPayer" {
            let other = value * (count - 1)
            values["honbaRon"] = .number(Double(other)); numbers["honbaRon"] = String(other)
        } else if key == "honbaRon" && value % (count - 1) == 0 {
            let other = value / (count - 1)
            values["honbaPerPayer"] = .number(Double(other)); numbers["honbaPerPayer"] = String(other)
        }
        recalculate()
    }
    private func recalculate() {
        examples = []
        for (index, key) in pointKeys.enumerated() {
            guard let text = numbers[key], let number = parsePoints(text), number >= 0, number <= 2_147_483_647,
                  number % 100 == 0, (index != 0 || number >= 1000), (index != 1 && index != 2 || number > 0) else {
                issue = "\(pointLabels[index])需为有效整百点数"; return
            }
            values[key] = .number(Double(number))
        }
        let umaNumbers = uma.compactMap(Double.init)
        guard uma.count == count && umaNumbers.count == count,
              umaNumbers.allSatisfy({ $0.isFinite && ($0 * 10).rounded() == $0 * 10 }),
              abs(umaNumbers.reduce(0, +)) < 0.00001 else { issue = "马点须每座为十分位且总和为零"; return }
        values["uma"] = .array(umaNumbers.map(JSONValue.number))
        guard let penalty = parsePoints(numbers["notenPenaltyTotal"] ?? ""), penalty % (count == 3 ? 200 : 600) == 0 else {
            issue = "荒牌罚符不可整百分摊"; return
        }
        guard let ron = parsePoints(numbers["honbaRon"] ?? ""), let perPayer = parsePoints(numbers["honbaPerPayer"] ?? ""),
              ron == perPayer * (count - 1) else { issue = "本场荣和与自摸支付需联动"; return }
        do {
            let data = try JSONEncoder().encode(values)
            var config = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            config.removeValue(forKey: "oka")
            let normalized = try EngineBridgeCheck.normalizedRules(config)
            let cases: [(String, [String: Any])] = [
                ("子家 2 番 30 符荣和", ["kind": "ron", "winners": [["seatNo": 1, "han": 2, "fu": 30, "dealInSeatNo": 2]]]),
                ("子家 2 番 30 符自摸", ["kind": "tsumo", "winners": [["seatNo": 1, "han": 2, "fu": 30]]]),
                ("荒牌流局 · 一人听牌", ["kind": "ryuukyoku", "winners": [], "tenpai": (0..<count).map { $0 == 0 }]),
                ("荒牌流局 · 两人听牌", ["kind": "ryuukyoku", "winners": [], "tenpai": (0..<count).map { $0 < 2 }])
            ]
            examples = try cases.map { title, input in
                let output = try EngineBridgeCheck.samplePayment(config: normalized, input: input)
                guard let seats = output["perSeat"] as? [[String: Any]], seats.count == count else {
                    throw LocalFailure(message: "引擎预览缺少座位支付")
                }
                return (title, seats.map { "\(($0["seatNo"] as? Int ?? -1) + 1) 号位 \($0["netPoints"] as? Int ?? 0) 点" }.joined(separator: " · "))
            }
            issue = nil
        } catch { issue = error.localizedDescription }
    }
    private func create() {
        guard let selected, issue == nil else { return }
        do {
            let match = try store.create(template: selected, rules: values, name: name, names: names, dealer: dealer)
            dismiss(); onCreated(match.id)
        } catch { issue = error.localizedDescription }
    }
}

@MainActor struct LocalTableScreen: View {
    @ObservedObject var store: LocalMatchStore
    let id: String
    @State private var issue: String?
    @State private var entering = false
    @State private var terminalPreview: [String: JSONValue]?
    @State private var abandonFirst = false
    @State private var abandonFinal = false
    @State private var editSeat: Int?
    @State private var newName = ""
    private var match: LocalMatch? { store.matches.first { $0.id == id } }
    var body: some View {
        List {
            if let issue { Section { Text(issue).foregroundStyle(Brand.loss).brandPanel() } }
            if let currentMatch = match {
                Section {
                    Text("\(currentMatch.name) · \(currentMatch.status == "active" ? "进行中" : "已结束")").brandPanel()
                    Text("引擎 \(currentMatch.engineVersion) · 规则与已结算局不可修改").font(Brand.font(.footnote)).foregroundStyle(Brand.muted).brandPanel()
                    DisclosureGroup("本桌规则快照 · 自定义 \(currentMatch.customizedKeys.count) 项") {
                        Text("调整字段：\(currentMatch.customizedKeys.isEmpty ? "无" : currentMatch.customizedKeys.joined(separator: "、"))")
                            .foregroundStyle(Brand.muted).brandPanel()
                        Text(jsonText(currentMatch.rules)).font(Brand.font(.caption1)).foregroundStyle(Brand.muted).textSelection(.enabled).brandPanel()
                    }.brandPanel()
                    if currentMatch.engineVersion != EngineBridgeCheck.version {
                        Text("引擎版本不同，此牌桌只能读取历史，不能继续计算").foregroundStyle(Brand.loss).brandPanel()
                    }
                } header: { BrandSectionHeader("\(currentMatch.templateName) · \(currentMatch.reviewStatus)") }
                Section {
                    ForEach(currentMatch.seats) { seat in
                        HStack {
                            VStack(alignment: .leading) {
                                Text("\(seat.seatNo + 1) 号位 · \(seat.displayName)")
                                Text("\(currentMatch.points[seat.seatNo]) 点").monospacedDigit().foregroundStyle(Brand.muted)
                            }
                            Spacer()
                            Button("改名") { editSeat = seat.seatNo; newName = seat.displayName }
                                .disabled(currentMatch.status != "active")
                        }.brandPanel().accessibilityIdentifier("local.table.seat.\(seat.seatNo)")
                    }
                } header: { BrandSectionHeader("座位与点数") }
                if let hand = currentMatch.currentHand {
                    Section {
                        ForEach(hand.seats, id: \.seatNo) { seat in
                            HStack {
                                Text("\(seat.seatNo + 1) 号位 · \(seat.points) 点 · \(seat.isRiichi ? "立直" : "未立直")")
                                Spacer()
                                Button(seat.isRiichi ? "取消" : "立直") { action { try store.mark(id, seat: seat.seatNo) } }
                                    .disabled(currentMatch.engineVersion != EngineBridgeCheck.version)
                            }.brandPanel().accessibilityIdentifier("local.table.hand.seat.\(seat.seatNo)")
                            Text("声明 \(seat.declares)/2 · 取消 \(seat.cancels)/1").font(Brand.font(.caption1)).foregroundStyle(Brand.muted).brandPanel()
                        }
                        Button("录入本局结果") { entering = true }.disabled(currentMatch.engineVersion != EngineBridgeCheck.version)
                            .brandPanel().accessibilityIdentifier("local.table.enterResult")
                    } header: { BrandSectionHeader("\(windLabel(hand.roundWind)) \(hand.roundNumber) · 庄 \(hand.dealerSeatNo + 1) · 本场 \(hand.honba) · 供托 \(hand.riichiPool) 点（\(hand.riichiPool / 1000) 根）") }
                } else if currentMatch.status == "active" {
                    Section { Button("新开一局") { action { try store.openHand(id) } }.disabled(currentMatch.engineVersion != EngineBridgeCheck.version).brandPanel() }
                }
                if currentMatch.status == "active" {
                    Section {
                        Button(currentMatch.currentHand == nil ? "手动终局" : "放弃未结算当前局并终局", role: .destructive) {
                            abandonFirst = true
                        }.disabled(currentMatch.engineVersion != EngineBridgeCheck.version).brandPanel()
                        Text("放弃只丢弃当前未结算手及立直标记；已结算记录、供托及点数不撤回。")
                            .font(Brand.font(.footnote)).foregroundStyle(Brand.muted).brandPanel()
                    }
                } else {
                    Section {
                        if let saved = currentMatch.terminal {
                            terminalRows(saved)
                        } else if let currentTerminalPreview = terminalPreview {
                            terminalRows(currentTerminalPreview)
                            if currentTerminalPreview["isGameEnd"] == .bool(true) {
                                Button("确认并保存最终成绩") { action { try store.confirmTerminal(id); self.terminalPreview = nil } }
                                    .brandPanel().accessibilityIdentifier("local.table.confirmTerminal")
                            } else {
                                Text("终局条件未满足，成绩尚不可确认。").foregroundStyle(Brand.loss).brandPanel()
                            }
                        } else {
                            Button("预览最终成绩") { action { terminalPreview = try store.previewTerminal(id) } }
                                .disabled(currentMatch.engineVersion != EngineBridgeCheck.version)
                                .brandPanel().accessibilityIdentifier("local.table.previewTerminal")
                        }
                    } header: { BrandSectionHeader("终局") }
                }
                Section {
                    if currentMatch.results.isEmpty { Text("暂无已结算局").foregroundStyle(Brand.muted).brandPanel() }
                    ForEach(currentMatch.results) { result in
                        DisclosureGroup("\(windLabel(result.hand.roundWind)) \(result.hand.roundNumber) · \(handLabel(result.input["kind"]?.string ?? "")) · \(localDate(result.settledAt))") {
                            Text("庄 \(result.hand.dealerSeatNo + 1) · 本场 \(result.hand.honba) · 原供托 \(result.hand.riichiPool) 点")
                                .foregroundStyle(Brand.muted).brandPanel()
                            if let seats = result.output["perSeat"]?.arrayValue {
                                ForEach(0..<seats.count, id: \.self) { index in
                                    let fields = seats[index].object ?? [:]
                                    Text("\(number(fields["seatNo"]).map { $0 + 1 } ?? 0) 号位：\(number(fields["netPoints"]) ?? 0) 点").brandPanel()
                                    if let parts = fields["breakdown"]?.arrayValue {
                                        ForEach(0..<parts.count, id: \.self) { part in
                                            Text("\(breakdownLabel(parts[part].object?["reason"]?.string))：\(number(parts[part].object?["amount"]) ?? 0)")
                                                .font(Brand.font(.footnote)).foregroundStyle(Brand.muted).brandPanel()
                                        }
                                    }
                                }
                            }
                            Text("输入：\(jsonText(result.input))").font(Brand.font(.caption1)).foregroundStyle(Brand.muted).textSelection(.enabled).brandPanel()
                            Text("完整输出：\(jsonText(result.output))").font(Brand.font(.caption1)).foregroundStyle(Brand.muted).textSelection(.enabled).brandPanel()
                        }.brandPanel().accessibilityIdentifier("local.table.history.\(result.id)")
                    }
                } header: { BrandSectionHeader("已结算逐局历史 · 保存的原始输入及引擎输出") }
            } else { Text("本地牌桌不存在或已删除").foregroundStyle(Brand.muted).brandPanel() }
        }
        .scrollContentBackground(.hidden).background(Brand.background).tint(Brand.gold).foregroundStyle(Brand.text)
        .navigationTitle(match?.name ?? "本地牌桌")
        .tabBarClearance()
        .sheet(isPresented: $entering) {
            resultEntrySheet
        }
        // iosfix10 P6, same mechanism as the delete dialog above:
        // the iOS 27 popover drops the cancel-role button, so this
        // first step is an alert with an explicit 保留当前局 cancel.
        .alert("放弃未结算局并终局？", isPresented: $abandonFirst) {
            Button("保留当前局", role: .cancel) {}
            Button("继续确认", role: .destructive) { abandonFinal = true }
        } message: { Text("尚未结算的结果及立直标记会丢弃；已结算历史不会删除。") }
        .alert("最后确认：终局不可撤回", isPresented: $abandonFinal) {
            Button("取消", role: .cancel) {}
            Button("放弃当前局并终局", role: .destructive) { action { try store.finish(id) } }
        } message: { Text("牌桌结束后只能读取及确认终局成绩。") }
        .alert("修改本地玩家姓名", isPresented: Binding(get: { editSeat != nil }, set: { if !$0 { editSeat = nil } })) {
            TextField("", text: $newName, prompt: Text("姓名（最多 40 字）").foregroundColor(Brand.muted))
                .foregroundStyle(Brand.text)
            Button("取消", role: .cancel) { editSeat = nil }
            Button("保存") { if let editSeat { action { try store.rename(id, seat: editSeat, name: newName) } }; editSeat = nil }
        }
    }
    @ViewBuilder private var resultEntrySheet: some View {
        if let match = match, let hand = match.currentHand {
            NavigationStack { LocalResultEntry(store: store, match: match, hand: hand) }
        }
    }
    private func action(_ block: () throws -> Void) {
        do { try block(); issue = nil } catch { issue = error.localizedDescription }
    }
    private func number(_ value: JSONValue?) -> Int? {
        guard case .number(let amount)? = value else { return nil }
        return Int(exactly: amount)
    }
    private func jsonText(_ value: [String: JSONValue]) -> String {
        guard let data = try? JSONEncoder().encode(value) else { return "无法显示" }
        return String(data: data, encoding: .utf8) ?? "无法显示"
    }
    @ViewBuilder private func terminalRows(_ terminal: [String: JSONValue]) -> some View {
        if let standings = terminal["standings"]?.arrayValue {
            ForEach(0..<standings.count, id: \.self) { index in
                let fields = standings[index].object ?? [:]
                Text("座位 \((number(fields["seatNo"]) ?? 0) + 1) · 排名 \(number(fields["rank"]) ?? 0) · 最终点数 \(number(fields["finalPoints"]) ?? 0) · 成绩十分位 \(number(fields["totalTenths"]) ?? 0)")
                    .brandPanel().accessibilityIdentifier("local.table.standing.\(index)")
            }
        }
        Text("完整终局输出：\(jsonText(terminal))").font(Brand.font(.caption1)).foregroundStyle(Brand.muted).textSelection(.enabled).brandPanel()
    }
}

@MainActor private struct LocalResultEntry: View {
    @ObservedObject var store: LocalMatchStore
    let match: LocalMatch
    let hand: LocalHand
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ResultDraft()
    @State private var preview: [String: JSONValue]?
    @State private var previewInput: [String: JSONValue]?
    @State private var issue: String?
    @State private var draftSaved = true
    private var liveMatch: LocalMatch? { store.matches.first { $0.id == match.id } }
    private var currentHand: CurrentHandDTO {
        CurrentHandDTO(id: hand.handId, state: "open", markRevision: Int64(hand.markRevision),
            roundWind: hand.roundWind, roundNumber: hand.roundNumber, dealerSeatNo: hand.dealerSeatNo,
            honba: hand.honba, riichiPool: hand.riichiPool,
            seats: hand.seats.map { HandSeatDTO(seatNo: $0.seatNo, isRiichi: $0.isRiichi,
                riichiChangeUsage: RiichiUsageDTO(declares: $0.declares, cancels: $0.cancels)) })
    }
    private var snapshot: TableSnapshot {
        TableSnapshot(match: MatchDTO(id: match.id, status: match.status, ownerPrincipalId: nil,
            joinCode: nil, settlementConfirmed: match.settlementConfirmed, version: nil,
            playerCount: match.seats.count, rulesSnapshot: match.rules, rulesetVersionId: nil, createdAt: match.createdAt),
            seats: match.seats.map { SeatDTO(principalId: nil, seatNo: $0.seatNo, displayName: $0.displayName,
                points: match.points[$0.seatNo], status: "checked_in") }, currentHand: currentHand)
    }
    private var input: [String: JSONValue]? {
        ResultInputBuilder.build(draft, hand: currentHand, seats: snapshot.seats, rules: match.rules)
    }
    private struct ValidPreview {
        let output: [String: JSONValue]
        let input: [String: JSONValue]
    }
    private var validPreview: ValidPreview? {
        guard let preview, let previewInput, previewInput == input,
              liveMatch?.currentHand?.handId == hand.handId,
              liveMatch?.currentHand?.markRevision == hand.markRevision, draftSaved else { return nil }
        return ValidPreview(output: preview, input: previewInput)
    }
    var body: some View {
        Form {
            ResultInputFields(draft: $draft, snapshot: snapshot, hand: currentHand)
            if let issue { Section { Text(issue).foregroundStyle(Brand.loss).brandPanel() } }
            Section {
                Button("计算逐座支付") { calculate() }.disabled(input == nil || !draftSaved)
                    .brandPanel().accessibilityIdentifier("local.result.preview")
                if let valid = validPreview {
                    if let rows = valid.output["perSeat"]?.arrayValue {
                        ForEach(0..<rows.count, id: \.self) { index in
                            let row = rows[index].object ?? [:]
                            Text("\((number(row["seatNo"]) ?? 0) + 1) 号位 · \(number(row["netPoints"]) ?? 0) 点")
                                .brandPanel().accessibilityIdentifier("local.result.payment.\(index)")
                            if let parts = row["breakdown"]?.arrayValue {
                                ForEach(0..<parts.count, id: \.self) { part in
                                    Text("\(breakdownLabel(parts[part].object?["reason"]?.string))：\(number(parts[part].object?["amount"]) ?? 0)")
                                        .font(Brand.font(.footnote)).foregroundStyle(Brand.muted).brandPanel()
                                }
                            }
                        }
                    }
                    if let next = valid.output["nextHand"]?.object {
                        Text("下局：\(windLabel(next["roundWind"]?.string)) \(number(next["roundNumber"]) ?? 0) · 本场 \(number(next["honba"]) ?? 0) · 供托 \(number(next["riichiPool"]) ?? 0) 点")
                            .foregroundStyle(Brand.muted).brandPanel()
                    }
                    Button("确认并原子结算") {
                        do { try store.settle(match.id, handID: hand.handId, revision: hand.markRevision, input: valid.input); dismiss() }
                        catch { issue = error.localizedDescription; self.preview = nil }
                    }.brandPanel().accessibilityIdentifier("local.result.settle")
                } else { Text("输入或标记变化后须重新预览").foregroundStyle(Brand.muted).brandPanel() }
            } header: { BrandSectionHeader("本机引擎支付预览") }
        }
        .scrollContentBackground(.hidden).background(Brand.background).tint(Brand.gold).foregroundStyle(Brand.text)
        .navigationTitle("本地本局结算")
        .keyboardDismissal()
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
        .onAppear {
            if match.draft?.handId == hand.handId, let saved = match.draft?.value { draft = saved }
        }
        .onChange(of: draft) { _, value in
            preview = nil; previewInput = nil
            do { try store.saveDraft(match.id, handID: hand.handId, value: value); draftSaved = true; issue = nil }
            catch { draftSaved = false; issue = "结果草稿保存失败，已阻止结算：\(error.localizedDescription)" }
        }
    }
    private func number(_ value: JSONValue?) -> Int? {
        guard case .number(let amount)? = value else { return nil }
        return Int(exactly: amount)
    }
    private func calculate() {
        guard let input else { return }
        do { preview = try store.preview(match.id, input: input); previewInput = input; issue = nil }
        catch { issue = error.localizedDescription; preview = nil; previewInput = nil }
    }
}

/// 竞技分显示：整数不带小数尾巴（20，而非 20.0 / 20.000000），小数用最短形式（如 20.5）。
private func scoreText(_ value: Double) -> String {
    value == value.rounded() ? String(Int(value)) : String(value)
}

/// 结算明细标签：引擎 breakdown 的 reason 键 → 界面文案（术语与 Web 端一致），未知键回退原始键名。
private func breakdownLabel(_ reason: String?) -> String {
    switch reason {
    case "ron_win": return "荣和"
    case "ron_payment": return "放铳"
    case "tsumo_win": return "自摸"
    case "tsumo_payment": return "自摸支付"
    case "honba_win", "honba_payment": return "本场费"
    case "riichi_pool": return "供托"
    case "riichi": return "立直棒"
    case "tenpai_receipt": return "听牌收入"
    case "noten_penalty": return "未听罚符"
    case "nagashi_mangan_win": return "流局满贯"
    case "nagashi_mangan_payment": return "流局满贯支付"
    case "manual_adjudication": return "人工裁定"
    case "chombo_replay": return "错和重赛"
    default: return reason ?? "支付"
    }
}
