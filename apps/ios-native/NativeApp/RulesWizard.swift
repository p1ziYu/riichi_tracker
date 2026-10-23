import SwiftUI

private struct RuleOption: Identifiable {
    let value: String
    let label: String
    var id: String { value }
}

private struct RuleField: Identifiable {
    let key: String
    let label: String
    let group: String
    let options: [RuleOption]
    var id: String { key }
}

@MainActor
struct RulesWizard: View {
    let api: APIClient
    let onCreated: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var templates: [TemplateDTO] = []
    @State private var selected: TemplateDTO?
    @State private var base: [String: Any] = [:]
    @State private var values: [String: Any] = [:]
    @State private var numberText: [String: String] = [:]
    @State private var umaText: [String] = []
    @State private var examples: [(String, String)] = []
    @State private var issue: String?
    @State private var busy = false
    @State private var creationUncertain = false
    @State private var step = 0
    @State private var confirmTemplate: TemplateDTO?
    @State private var showAdjustments = true

    private let pointKeys = ["startingPoints", "returnPoints", "targetPoints", "notenPenaltyTotal", "honbaRon", "honbaPerPayer"]
    private let pointLabels = ["起始点", "返还点", "终局目标点", "荒牌流局罚符总额", "本场荣和总额", "本场自摸每付款者"]
    private let groups = ["终局策略", "支付数值", "多荣与立直", "流满与三麻", "番数与役满"]
    private let fields: [RuleField] = [
        .init(key: "fixedSouth4EndPolicy", label: "末局结束条件", group: "终局策略", options: [.init(value: "completed_south_4", label: "打完南四局"), .init(value: "target_or_bust", label: "目标点或飞人（三麻南三）")]),
        .init(key: "automaticEndPolicy", label: "自动终局", group: "终局策略", options: [.init(value: "manual", label: "手动"), .init(value: "ranked_sanma", label: "三麻段位")]),
        .init(key: "terminalRiichiPoolPolicy", label: "终局供托", group: "终局策略", options: [.init(value: "first", label: "首位领取"), .init(value: "unallocated", label: "不分配")]),
        .init(key: "tiedUmaPolicy", label: "同点马点", group: "终局策略", options: [.init(value: "seat_order", label: "按起家座次"), .init(value: "split", label: "均分")]),
        .init(key: "bustEndsGame", label: "负分结束", group: "终局策略", options: []),
        .init(key: "multiRon", label: "多家荣和", group: "多荣与立直", options: [.init(value: "head_bump", label: "头跳"), .init(value: "double_ron", label: "双响"), .init(value: "allow_all", label: "允许全部")]),
        .init(key: "doubleRonHonbaPolicy", label: "双响本场", group: "多荣与立直", options: [.init(value: "nearest_only", label: "仅最近赢家"), .init(value: "each_winner", label: "每位赢家")]),
        .init(key: "allowLowPointRiichi", label: "不足 1,000 点可立直", group: "多荣与立直", options: []),
        .init(key: "nagashiManganEnabled", label: "流局满贯", group: "流满与三麻", options: []),
        .init(key: "nagashiCollectsRiichiPool", label: "流满收取供托", group: "流满与三麻", options: []),
        .init(key: "nagashiDealerRepeatRequiresTenpai", label: "流满庄家需听牌续庄", group: "流满与三麻", options: []),
        .init(key: "tsumoLoss", label: "三麻自摸损", group: "流满与三麻", options: []),
        .init(key: "kiriageMangan", label: "切上满贯", group: "番数与役满", options: []),
        .init(key: "kazoeYakuman", label: "累计役满", group: "番数与役满", options: []),
        .init(key: "compositeYakuman", label: "复合役满", group: "番数与役满", options: []),
        .init(key: "doubleYakuman", label: "特殊双倍役满", group: "番数与役满", options: [])
    ]

    private var count: Int { values["playerCount"] as? Int ?? 4 }
    private var changed: [String: Any] {
        let keys = pointKeys + ["uma"] + fields.map(\.key)
        return keys.reduce(into: [String: Any]()) { result, key in
            guard let value = values[key], let original = base[key] else { return }
            if key == "uma" {
                let current = (value as? [NSNumber])?.map(\.doubleValue) ?? []
                let initial = (original as? [NSNumber])?.map(\.doubleValue) ?? []
                if current != initial { result[key] = value }
            } else if String(describing: value) != String(describing: original) {
                result[key] = value
            }
        }
    }

    var body: some View {
        Form {
            if let issue { Section { Text(issue).foregroundStyle(Brand.loss).brandPanel() } }
            if step == 0 {
                Section {
                    if templates.isEmpty { ProgressView("读取模板中…").brandPanel() }
                    ForEach(templates.filter { $0.scope != "mine" }) { template in
                        Button {
                            if selected != nil && !changed.isEmpty { confirmTemplate = template }
                            else { choose(template) }
                        } label: {
                            VStack(alignment: .leading) {
                                Text(template.name)
                                Text("\(template.scope == "system" ? "系统" : "参考") · \(template.reviewStatus == "pending" ? "待审核" : template.reviewStatus)")
                                    .font(.footnote).foregroundStyle(Brand.muted)
                            }
                        }
                        .brandPanel()
                        .accessibilityIdentifier("rulesWizard.template.\(template.versionId)")
                    }
                } header: { BrandSectionHeader("选择系统规则模板") }
                if selected != nil { Button("下一步：调整规则") { step = 1 }.brandPanel() }
            } else if step == 1 {
                Section {
                    Text(selected?.name ?? "").font(.headline).brandPanel()
                    Text("人数随模板固定，立直棒固定 1,000 点；只调整本桌。")
                        .foregroundStyle(Brand.muted).brandPanel()
                    Button("重选模板") { step = 0 }.brandPanel()
                    DisclosureGroup("规则调整 · 已自定义 \(changed.count) 项", isExpanded: $showAdjustments) {
                        Button("恢复模板") { values = base; syncText(); recalculate() }.disabled(changed.isEmpty)
                    }
                    .brandPanel()
                }
                if showAdjustments {
                Section {
                    ForEach(0..<3, id: \.self) { index in
                        let key = pointKeys[index]
                        pointInput(key, label: pointLabels[index])
                        HStack {
                            ForEach(key == "startingPoints" ? [25_000, 30_000, 35_000] : [30_000, 40_000], id: \.self) { preset in
                                Button(preset.formatted()) { setPoint(key, preset) }.font(.footnote)
                            }
                        }
                        .brandPanel()
                    }
                    Text("头名赏（只读）：\(Double(((values["returnPoints"] as? Int ?? 0) - (values["startingPoints"] as? Int ?? 0)) * count) / 1000) 竞技分")
                        .foregroundStyle(Brand.muted).brandPanel()
                    ForEach(0..<umaText.count, id: \.self) { index in
                        TextField("第 \(index + 1) 位马点", text: Binding(get: { umaText[index] }, set: { umaText[index] = $0; recalculate() }),
                                  prompt: Text("第 \(index + 1) 位马点").foregroundColor(Brand.muted))
                            .keyboardType(.decimalPad)
                            .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
                            .brandPanel()
                    }
                    ForEach(umaPresets(), id: \.self) { preset in
                        Button(preset.map { String($0) }.joined(separator: " / ")) {
                            umaText = preset.map { String($0) }; recalculate()
                        }
                        .brandPanel()
                    }
                } header: { BrandSectionHeader("起点与成绩") }
                ForEach(groups, id: \.self) { group in
                    Section {
                        if group == "支付数值" {
                            ForEach(3..<6, id: \.self) { index in
                                pointInput(pointKeys[index], label: pointLabels[index])
                            }
                            Text("罚符 1,500 点无法按所有听牌人数以整百分摊，不支持。")
                                .font(.footnote).foregroundStyle(Brand.muted).brandPanel()
                            ForEach(count == 3 ? [0, 2000, 3000] : [0, 3000], id: \.self) { value in
                                Button("罚符 \(value)") { setPoint("notenPenaltyTotal", value) }.brandPanel()
                            }
                            ForEach([100, 200], id: \.self) { value in
                                Button("本场自摸每人 \(value) / 荣和 \(value * (count - 1))") { setPoint("honbaPerPayer", value) }.brandPanel()
                            }
                        }
                        ForEach(fields.filter { $0.group == group && visible($0.key) }) { field in
                            if field.options.isEmpty {
                                Toggle(field.label, isOn: Binding(get: { values[field.key] as? Bool ?? false }, set: { values[field.key] = $0; recalculate() }))
                                    .brandPanel()
                            } else {
                                Picker(field.label, selection: Binding(get: { values[field.key] as? String ?? "" }, set: { values[field.key] = $0; recalculate() })) {
                                    ForEach(field.options.filter { option in
                                        if option.value == "ranked_sanma" { return count == 3 }
                                        if field.key == "fixedSouth4EndPolicy", option.value == "completed_south_4" { return count == 4 }
                                        return true
                                    }) { option in Text(option.label).tag(option.value) }
                                }
                                .brandPanel()
                            }
                        }
                    } header: { BrandSectionHeader(group) }
                }
                }
                Section {
                    if examples.isEmpty {
                        Text(issue == nil ? "输入有效后计算" : "规则无效，预览已清除")
                            .foregroundStyle(Brand.muted).brandPanel()
                    }
                    ForEach(0..<examples.count, id: \.self) { index in
                        VStack(alignment: .leading) {
                            Text(examples[index].0).font(.headline)
                            Text(examples[index].1).font(.footnote).foregroundStyle(Brand.muted).monospacedDigit()
                        }
                        .brandPanel()
                    }
                    Button("下一步：创建在线桌") { step = 2 }.disabled(issue != nil).brandPanel()
                } header: { BrandSectionHeader("本机支付预览 · 仅用于规则示例") }
            } else {
                Section {
                    Text("\(selected?.name ?? "") · \(count) 麻 · 自定义 \(changed.count) 项").brandPanel()
                    Text("创建后需房主自行选座，所有座位签到并确认起家方可开始。")
                        .foregroundStyle(Brand.muted).brandPanel()
                    Button(busy ? "创建中…" : "创建并进入牌桌") { Task { await create() } }
                        .disabled(busy || issue != nil || creationUncertain)
                        .accessibilityIdentifier("rulesWizard.createTable").brandPanel()
                    Button("返回调整") { step = 1 }.brandPanel()
                } header: { BrandSectionHeader("确认创建") }
            }
        }
        .scrollContentBackground(.hidden)
        .foregroundStyle(Brand.text)
        .background(Brand.background)
        .tint(Brand.gold)
        .navigationTitle("开桌")
        .task { await load() }
        .alert("切换模板将丢弃当前调整", isPresented: Binding(get: { confirmTemplate != nil }, set: { if !$0 { confirmTemplate = nil } })) {
            Button("丢弃并切换", role: .destructive) { if let confirmTemplate { choose(confirmTemplate) }; confirmTemplate = nil }
            Button("保留调整", role: .cancel) { confirmTemplate = nil }
        }
    }

    private func visible(_ key: String) -> Bool {
        if key == "tsumoLoss" { return count == 3 }
        if key == "doubleRonHonbaPolicy" { return values["multiRon"] as? String != "head_bump" }
        return true
    }
    private func umaPresets() -> [[Double]] {
        count == 3 ? [[20, 0, -20], [30, 0, -30], [10, 0, -10], [0, 0, 0]] :
            [[20, 10, -10, -20], [15, 5, -5, -15], [30, 10, -10, -30], [10, 5, -5, -10], [0, 0, 0, 0]]
    }
    private func pointInput(_ key: String, label: String) -> some View {
        VStack(alignment: .leading) {
            Text(label)
            TextField(label, text: Binding(get: { numberText[key] ?? "" }, set: { text in
                numberText[key] = text
                if let amount = Int(text) { setPoint(key, amount, preserveText: true) }
                else { issue = "\(label)需填写整数"; examples = [] }
            }), prompt: Text(label).foregroundColor(Brand.muted))
            .keyboardType(.numberPad)
            .padding(10).background(Brand.deep, in: RoundedRectangle(cornerRadius: 8))
            if numberText[key]?.isEmpty == true { Text("此项不能为空").font(.footnote).foregroundStyle(Brand.loss) }
        }
        .brandPanel()
    }
    private func setPoint(_ key: String, _ amount: Int, preserveText: Bool = false) {
        guard amount >= 0, amount <= 2_147_483_647,
              key != "honbaPerPayer" || amount <= 2_147_483_647 / (count - 1) else {
            issue = "点数超过服务器支持的整数范围"
            examples = []
            return
        }
        values[key] = amount
        if !preserveText { numberText[key] = String(amount) }
        if key == "honbaRon", amount % (count - 1) == 0 {
            values["honbaPerPayer"] = amount / (count - 1)
            numberText["honbaPerPayer"] = String(amount / (count - 1))
        } else if key == "honbaPerPayer" {
            values["honbaRon"] = amount * (count - 1)
            numberText["honbaRon"] = String(amount * (count - 1))
        }
        recalculate()
    }
    private func choose(_ template: TemplateDTO) {
        do {
            guard let config = template.config else { throw APIError(status: nil, message: "模板没有配置") }
            let data = try JSONEncoder().encode(config)
            let dictionary = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            base = try EngineBridgeCheck.normalizedRules(dictionary)
            values = base
            selected = template
            syncText()
            recalculate()
        } catch { issue = error.localizedDescription }
    }
    private func syncText() {
        numberText = Dictionary(uniqueKeysWithValues: pointKeys.map { ($0, String(values[$0] as? Int ?? 0)) })
        umaText = (values["uma"] as? [Any] ?? []).map { ($0 as? NSNumber)?.stringValue ?? String(describing: $0) }
    }
    private func recalculate() {
        examples = []
        for (index, key) in pointKeys.enumerated() {
            guard let text = numberText[key], let number = Int(text), number >= 0, number <= 2_147_483_647,
                  number % 100 == 0, (index != 0 || number >= 1000), (index != 1 && index != 2 || number > 0) else {
                issue = "\(pointLabels[index])需为有效的整百点数"; return
            }
            values[key] = number
        }
        let uma = umaText.compactMap { Double($0) }
        guard umaText.count == count, uma.count == count,
              uma.allSatisfy({ $0.isFinite && ($0 * 10).rounded() == $0 * 10 }), abs(uma.reduce(0, +)) < 0.00001 else {
            issue = "马点需每座填写十分位，且总和为零"; return
        }
        values["uma"] = uma
        let total = values["notenPenaltyTotal"] as? Int ?? 0
        guard total % (count == 3 ? 200 : 600) == 0 else { issue = "流局罚符需可按听牌人数整百分摊"; return }
        guard (values["honbaRon"] as? Int) == (values["honbaPerPayer"] as? Int ?? -1) * (count - 1) else {
            issue = "本场荣和与每人自摸支付需联动"; return
        }
        do {
            let normalized = try EngineBridgeCheck.normalizedRules(values)
            let inputs: [(String, [String: Any])] = [
                ("子家 2 番 30 符荣和", ["kind": "ron", "winners": [["seatNo": 1, "han": 2, "fu": 30, "dealInSeatNo": 2]]]),
                ("子家 2 番 30 符自摸", ["kind": "tsumo", "winners": [["seatNo": 1, "han": 2, "fu": 30]]]),
                ("荒牌流局 · 一人听牌", ["kind": "ryuukyoku", "winners": [], "tenpai": (0..<count).map { $0 == 0 }]),
                ("荒牌流局 · 两人听牌", ["kind": "ryuukyoku", "winners": [], "tenpai": (0..<count).map { $0 < 2 }])
            ]
            examples = try inputs.map { title, input in
                let payment = try EngineBridgeCheck.samplePayment(config: normalized, input: input)
                guard let perSeat = payment["perSeat"] as? [[String: Any]], perSeat.count == count else {
                    throw APIError(status: nil, message: "引擎未返回完整逐座预览")
                }
                let rows = try perSeat.map { entry -> String in
                    guard let seat = entry["seatNo"] as? Int, let points = entry["netPoints"] as? Int else {
                        throw APIError(status: nil, message: "引擎逐座预览字段缺失")
                    }
                    return "\(seat + 1) 号位 \(points) 点"
                }
                return (title, rows.joined(separator: " · "))
            }
            issue = nil
        } catch { issue = error.localizedDescription }
    }
    private func load() async {
        guard templates.isEmpty else { return }
        do { templates = try await api.get("/api/rulesets/templates") }
        catch { issue = error.localizedDescription }
    }
    private func create() async {
        guard !busy, !creationUncertain, issue == nil, let selected else { return }
        busy = true
        defer { busy = false }
        let payload: [String: JSONValue]
        do {
            var fields: [String: JSONValue] = ["rulesetVersionId": .string(selected.versionId)]
            if !changed.isEmpty {
                let data = try JSONSerialization.data(withJSONObject: changed)
                fields["rulesOverride"] = .object(try JSONDecoder().decode([String: JSONValue].self, from: data))
            }
            payload = fields
        } catch {
            issue = "规则调整无法编码，未发起创建：\(error.localizedDescription)"
            return
        }
        do {
            let created: CreatedMatchDTO = try await api.post("/api/matches", body: payload)
            dismiss()
            onCreated(created.match.id)
        } catch let failure as APIError where failure.status.map({ (400..<500).contains($0) }) == true {
            issue = failure.localizedDescription
            step = 1
        } catch {
            creationUncertain = true
            issue = "创建结果未确认；请查看大厅避免重复建桌。\(error.localizedDescription)"
        }
    }
}
