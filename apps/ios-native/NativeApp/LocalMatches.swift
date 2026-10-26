import Foundation
import Combine

// 最后一版原生本地模式：离线完整可用，不用引擎、不连网、不设加入/分享/管理。
// 本机建桌（输 3/4 个名字 + 选模式）→ 直接随机分座 → 进行中 →
// 本机房主填终局分 → 合计校验 → 本地历史 + 纠正（座次锁定只改分数）。

struct LocalSeatEntry: Codable, Equatable, Hashable {
    let wind: String
    let name: String
}

struct LocalFinalMatch: Codable, Identifiable, Equatable {
    let id: String
    var mode: FinalMode
    var status: String // in_progress | finished
    var names: [String]
    var seats: [LocalSeatEntry]
    var finalScores: [FinalScoreEntry]?
    var createdAt: Date
    var finishedAt: Date?
    var correctedAt: Date?

    var isFinished: Bool { status == "finished" }
}

struct LocalFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor final class LocalMatchStore: ObservableObject {
    @Published private(set) var matches: [LocalFinalMatch] = []
    @Published private(set) var failure: String?
    private let location: URL

    init(location: URL? = nil) {
        if let location {
            self.location = location
        } else {
            let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            self.location = dir.appendingPathComponent("LocalFinalMatches.json")
        }
        reload()
    }

    private func reload() {
        guard FileManager.default.fileExists(atPath: location.path) else { matches = []; return }
        do {
            let data = try Data(contentsOf: location)
            matches = try JSONDecoder().decode([LocalFinalMatch].self, from: data)
        } catch {
            failure = "本地记录读取失败：\(error.localizedDescription)"
            matches = []
        }
    }

    private func persist() throws {
        let data = try JSONEncoder().encode(matches)
        try data.write(to: location, options: .atomic)
    }

    func create(names: [String], mode: FinalMode) throws -> LocalFinalMatch {
        let trimmed = names.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard trimmed.count == mode.playerCount else {
            throw LocalFailure(message: "\(mode.label)需要 \(mode.playerCount) 个名字。")
        }
        guard !trimmed.contains(where: { $0.isEmpty }) else {
            throw LocalFailure(message: "名字不能为空。")
        }
        var rng = SystemRandomNumberGenerator()
        let seats = FinalScoreLogic.shuffledSeats(names: trimmed, mode: mode, using: &rng)
            .map { LocalSeatEntry(wind: $0.wind, name: $0.displayName ?? "") }
        let match = LocalFinalMatch(
            id: UUID().uuidString, mode: mode, status: "in_progress",
            names: trimmed, seats: seats, finalScores: nil,
            createdAt: Date(), finishedAt: nil, correctedAt: nil)
        matches.insert(match, at: 0)
        do { try persist() } catch { failure = error.localizedDescription }
        return match
    }

    func match(_ id: String) -> LocalFinalMatch? { matches.first { $0.id == id } }

    /// 保存终局分；correction=true 时只允许已结束对局，且座次锁定（只改分数）。
    func saveFinalScores(id: String, scores: [FinalScoreEntry], correction: Bool) throws -> LocalFinalMatch {
        guard let index = matches.firstIndex(where: { $0.id == id }) else {
            throw LocalFailure(message: "本地牌桌不存在。")
        }
        var match = matches[index]
        if correction {
            guard match.isFinished else { throw LocalFailure(message: "牌局尚未结束，无法纠正。") }
        } else {
            guard !match.isFinished else { throw LocalFailure(message: "牌局已结束，请用纠正修改。") }
        }
        let pairs = scores.map { (wind: $0.wind, score: Optional($0.score)) }
        if let error = FinalScoreLogic.validationError(scores: pairs, mode: match.mode) {
            throw LocalFailure(message: error)
        }
        let ranked = FinalScoreLogic.entriesWithRanks(scores.map { (wind: $0.wind, score: $0.score) }, mode: match.mode)
        match.finalScores = ranked
        if correction {
            match.correctedAt = Date()
        } else {
            match.status = "finished"
            match.finishedAt = Date()
        }
        matches[index] = match
        do { try persist() } catch { failure = error.localizedDescription }
        return match
    }

    func delete(_ id: String) throws {
        matches.removeAll { $0.id == id }
        do { try persist() } catch { failure = error.localizedDescription }
    }

    var ordered: [LocalFinalMatch] {
        matches.sorted {
            if $0.isFinished != $1.isFinished { return !$0.isFinished }
            return $0.createdAt > $1.createdAt
        }
    }
}
