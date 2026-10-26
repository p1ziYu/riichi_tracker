import XCTest
@testable import IchihimeShell

final class ShellURLTests: XCTestCase {
    func testDefaultURL() {
        XCTAssertEqual(ShellURL.defaultURL.absoluteString, "https://riichi.p1ziyu.com/")
    }

    func testExactHost() {
        XCTAssertTrue(ShellURL.isShellHost("riichi.p1ziyu.com"))
        XCTAssertFalse(ShellURL.isShellHost("evil-riichi.p1ziyu.com"))
        XCTAssertFalse(ShellURL.isShellHost("riichi.p1ziyu.com.evil.com"))
        XCTAssertFalse(ShellURL.isShellHost(nil))
    }

    func testCheckinPaths() {
        XCTAssertTrue(ShellURL.isCheckinURL(URL(string: "https://riichi.p1ziyu.com/checkin/abc?token=xyz")!))
        XCTAssertTrue(ShellURL.isCheckinURL(URL(string: "https://riichi.p1ziyu.com/checkin/abc/extra")!))
        XCTAssertFalse(ShellURL.isCheckinURL(URL(string: "https://riichi.p1ziyu.com/")!))
        XCTAssertFalse(ShellURL.isCheckinURL(URL(string: "https://evil.example/checkin/abc")!))
        XCTAssertFalse(ShellURL.isCheckinURL(URL(string: "http://riichi.p1ziyu.com/checkin/abc")!))
    }
}
