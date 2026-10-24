import CoreText
import UIKit
import XCTest
@testable import IchihimeNative

/// Guards the brand type stack: both families must be registered, and glyph
/// resolution through BrandFont's composite font must land Latin/digits on
/// Nunito and CJK on LXGW WenKai Screen — never on the system font.
final class FontStackTests: XCTestCase {
    private func resolvedFontName(_ font: UIFont, for string: String) -> (family: String, postScript: String) {
        let resolved = CTFontCreateForString(
            font as CTFont, string as CFString,
            CFRange(location: 0, length: (string as NSString).length)
        )
        return (CTFontCopyFamilyName(resolved) as String, CTFontCopyPostScriptName(resolved) as String)
    }

    func testBothBrandFamiliesAreRegistered() {
        XCTAssertTrue(UIFont.familyNames.contains(BrandFont.latinFamily),
                      "Nunito family missing; registered: \(UIFont.familyNames)")
        XCTAssertGreaterThanOrEqual(UIFont.fontNames(forFamilyName: BrandFont.latinFamily).count, 4,
                                    "Expected the four bundled Nunito faces")
        XCTAssertNotNil(UIFont(name: BrandFont.cjkPostScriptName, size: 17),
                        "LXGW WenKai Screen face missing")
    }

    func testLatinAndDigitsResolveToNunito() {
        let font = BrandFont.uiFont(size: 17)
        for sample in ["A", "5"] {
            let resolved = resolvedFontName(font, for: sample)
            XCTAssertEqual(resolved.family, BrandFont.latinFamily,
                           "'\(sample)' resolved to \(resolved.postScript), expected a Nunito face")
        }
    }

    func testCJKResolvesToWenKai() {
        let font = BrandFont.uiFont(size: 17)
        let resolved = resolvedFontName(font, for: "東")
        XCTAssertEqual(resolved.postScript, BrandFont.cjkPostScriptName,
                       "CJK resolved to \(resolved.postScript), expected WenKai")
    }

    func testWeightsResolveToDistinctNunitoFaces() {
        let regular = resolvedFontName(BrandFont.uiFont(size: 17, weight: .regular), for: "A")
        let bold = resolvedFontName(BrandFont.uiFont(size: 17, weight: .bold), for: "A")
        XCTAssertEqual(regular.postScript, "Nunito-Regular")
        XCTAssertEqual(bold.postScript, "Nunito-Bold")
    }

    func testTextStyleHelperKeepsStack() {
        let font = BrandFont.uiFont(.body)
        XCTAssertEqual(resolvedFontName(font, for: "姬").postScript, BrandFont.cjkPostScriptName)
        XCTAssertEqual(resolvedFontName(font, for: "7").family, BrandFont.latinFamily)
    }
}
