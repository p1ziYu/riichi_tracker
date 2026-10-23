import Foundation
import Combine

private final class SocketOpenDelegate: NSObject, URLSessionWebSocketDelegate {
    let onOpen: () -> Void

    init(onOpen: @escaping () -> Void) {
        self.onOpen = onOpen
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol negotiatedProtocol: String?) {
        onOpen()
    }
}

/// The visible, foreground table owns this object and must stop it on disappearance/backgrounding.
@MainActor
final class LiveUpdates: ObservableObject {
    @Published private(set) var connection = "手动刷新"

    private let api: APIClient
    private var worker: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var generation = 0
    private var connectedAt: Date?

    init(api: APIClient) { self.api = api }

    func start(matchID: String, onRefresh: @escaping @MainActor () async -> Void) {
        stop()
        generation += 1
        let current = generation
        connection = "连接中"
        worker = Task { [weak self] in
            await self?.run(matchID: matchID, generation: current, onRefresh: onRefresh)
        }
    }

    func stop() {
        generation += 1
        worker?.cancel()
        worker = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        connectedAt = nil
        connection = "手动刷新"
    }

    private func run(matchID: String, generation current: Int,
                     onRefresh: @escaping @MainActor () async -> Void) async {
        var failures = 0
        while !Task.isCancelled && generation == current {
            do {
                let ticket: TicketDTO = try await api.post("/api/matches/\(matchID)/ws-tickets")
                try Task.checkCancellation()
                guard !ticket.ticket.isEmpty else {
                    throw APIError(status: nil, message: "实时连接凭据缺失")
                }
                let url = try api.webSocketURL(matchID: matchID, ticket: ticket.ticket)
                let delegate = SocketOpenDelegate { [weak self] in
                    Task { @MainActor [weak self] in
                        guard let self, self.generation == current else { return }
                        self.connectedAt = Date()
                        self.connection = "实时同步中"
                        await onRefresh()
                    }
                }
                let activeSession = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
                let activeSocket = activeSession.webSocketTask(with: url)
                socket = activeSocket
                defer {
                    activeSocket.cancel(with: .goingAway, reason: nil)
                    if generation == current { socket = nil }
                    activeSession.invalidateAndCancel()
                }
                activeSocket.resume()
                while !Task.isCancelled && generation == current {
                    // Events are invalidation signals; the HTTP snapshot is authoritative.
                    _ = try await activeSocket.receive()
                    if generation == current { await onRefresh() }
                }
            } catch {
                if Task.isCancelled || generation != current { break }
                if !api.hasStoredToken { break }
            }
            if Task.isCancelled || generation != current { break }
            if let connectedAt, Date().timeIntervalSince(connectedAt) >= 10 {
                failures = 0
            }
            connectedAt = nil
            failures = min(failures + 1, 6)
            connection = "正在重连"
            let seconds = min(30, 1 << (failures - 1))
            do { try await Task.sleep(nanoseconds: UInt64(seconds) * 1_000_000_000) }
            catch { break }
        }
        if generation == current {
            socket = nil
            worker = nil
            connection = "手动刷新"
        }
    }
}
