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

    /// Regression (Phase 1 font residuals): the previous bundled WenKai file
    /// was a 291-character display subset. Characters used by the local lobby,
    /// local per-hand detail and check-in surfaces were missing from it and
    /// fell back per-glyph to the system font. Every character below must now
    /// resolve to WenKai through the composite.
    func testSurfaceCharactersResolveToWenKai() {
        let font = BrandFont.uiFont(size: 17)
        let surfaces = "机逐细扫码描选换维房调付览保输史原历项快剪贴线端离独云结设终录"
        for ch in surfaces {
            let resolved = resolvedFontName(font, for: String(ch))
            XCTAssertEqual(resolved.postScript, BrandFont.cjkPostScriptName,
                           "'\(ch)' resolved to \(resolved.postScript), expected WenKai")
        }
    }

    /// Sentence punctuation must resolve to WenKai, not the system fallback
    /// (STHeiti/PingFang): 、；：！（） were absent from the old subset font.
    func testPunctuationResolvesToWenKai() {
        let font = BrandFont.uiFont(size: 17)
        for ch in "，。、；：？！（）" {
            let resolved = resolvedFontName(font, for: String(ch))
            XCTAssertEqual(resolved.postScript, BrandFont.cjkPostScriptName,
                           "'\(ch)' resolved to \(resolved.postScript), expected WenKai")
        }
    }

    /// The bundled WenKai build trims sentence-punctuation advances
    /// (see scripts/build_brand_font.py): a fullwidth comma must take well
    /// under a full em, so "落座，即开局。" no longer shows a wide gap.
    func testPunctuationAdvanceIsTrimmed() {
        let font = BrandFont.uiFont(size: 17)
        for ch in ["，", "。"] {
            let resolved = CTFontCreateForString(font as CTFont, ch as CFString, CFRange(location: 0, length: 1))
            var chars = Array(ch.utf16)
            var glyph: CGGlyph = 0
            XCTAssertTrue(CTFontGetGlyphsForCharacters(resolved, &chars, &glyph, 1))
            var advance = CGSize.zero
            CTFontGetAdvancesForGlyphs(resolved, .horizontal, &glyph, &advance, 1)
            XCTAssertGreaterThan(advance.width, 0)
            XCTAssertLessThan(advance.width, 17 * 0.75,
                              "'\(ch)' advance \(advance.width) at 17pt is not trimmed")
        }
        // Whole-line check: hero line must be narrower than 7 full ems.
        let text = "落座，即开局。"
        let astr = CFAttributedStringCreate(nil, text as CFString, [kCTFontAttributeName: font as CTFont] as CFDictionary)!
        let line = CTLineCreateWithAttributedString(astr)
        let width = CTLineGetTypographicBounds(line, nil, nil, nil)
        XCTAssertLessThan(width, 17 * 6.8, "Hero line width \(width) suggests an untrimmed punctuation advance")
    }
}
