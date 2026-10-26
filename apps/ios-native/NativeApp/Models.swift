import Foundation

// 最后一版原生：旧的逐局/结算/模板 DTO 已随旧模型删除。
// 本文件只保留新流程仍需的基础类型：通用 JSON、账号、实时票据。
// 新对局模型见 FinalModels.swift；新在线服务见 FinalAPI.swift。

indirect enum JSONValue: Codable, Equatable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let object = try? value.decode([String: JSONValue].self) { self = .object(object) }
        else if let array = try? value.decode([JSONValue].self) { self = .array(array) }
        else if let bool = try? value.decode(Bool.self) { self = .bool(bool) }
        else if let number = try? value.decode(Double.self) { self = .number(number) }
        else { self = .string(try value.decode(String.self)) }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let object): try value.encode(object)
        case .array(let array): try value.encode(array)
        case .string(let string): try value.encode(string)
        case .number(let number): try value.encode(number)
        case .bool(let bool): try value.encode(bool)
        case .null: try value.encodeNil()
        }
    }

    var object: [String: JSONValue]? {
        guard case .object(let object) = self else { return nil }
        return object
    }
    var arrayValue: [JSONValue]? {
        guard case .array(let values) = self else { return nil }
        return values
    }
    var string: String? {
        guard case .string(let string) = self else { return nil }
        return string
    }
}

struct PrincipalDTO: Codable {
    let id: String
    let displayName: String
    let type: String
    let createdAt: String?
}

/// GET /api/me：spec 第 2 节新增 isAdmin 布尔（未登录仍 401）。
/// 老服务端不返回该字段时默认 false；同时容忍 is_admin 蛇形键。
struct MeResponse: Codable {
    let principal: PrincipalDTO
    var isAdmin: Bool = false

    private enum CodingKeys: String, CodingKey { case principal, isAdmin, is_admin }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        principal = try fields.decode(PrincipalDTO.self, forKey: .principal)
        isAdmin = try fields.decodeIfPresent(Bool.self, forKey: .isAdmin)
            ?? fields.decodeIfPresent(Bool.self, forKey: .is_admin)
            ?? false
    }

    func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: CodingKeys.self)
        try fields.encode(principal, forKey: .principal)
        try fields.encode(isAdmin, forKey: .isAdmin)
    }
}

struct TicketDTO: Decodable {
    let ticket: String
}
