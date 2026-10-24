import CoreText
import SwiftUI
import UIKit

/// Brand type stack for the native app, mirroring the Web root stack
/// ("Nunito Variable", "LXGW WenKai Screen", "Noto Sans CJK SC", sans-serif;
/// font-synthesis: weight; tabular/lining numerals).
///
/// A single composite font carries the whole stack: the primary descriptor is
/// a Nunito face (Latin letters + score digits, tabular figures baked in) and
/// the LXGW WenKai Screen font rides along as the CoreText cascade fallback,
/// so any glyph Nunito lacks (CJK) resolves to WenKai instead of the system
/// font — the same per-glyph resolution CSS performs with the family list.
/// Weights Nunito does not ship resolve to the nearest bundled face; WenKai
/// has a single weight, so heavier CJK runs rely on CoreText weight synthesis,
/// exactly like the Web's font-synthesis: weight.
enum BrandFont {
    static let latinFamily = "Nunito"
    static let cjkPostScriptName = "LXGWWenKaiScreenR"

    /// Composite UIFont at an absolute point size.
    static func uiFont(size: CGFloat, weight: UIFont.Weight = .regular) -> UIFont {
        let nunito = UIFontDescriptor(fontAttributes: [
            .family: latinFamily,
            .traits: [UIFontDescriptor.TraitKey.weight: weight],
        ])
        let wenKai = CTFontDescriptorCreateWithAttributes(
            [kCTFontNameAttribute: cjkPostScriptName as CFString] as CFDictionary
        )
        let features: [[CFString: Any]] = [[
            kCTFontFeatureTypeIdentifierKey: kNumberSpacingType,
            kCTFontFeatureSelectorIdentifierKey: kMonospacedNumbersSelector,
        ]]
        let descriptor = CTFontDescriptorCreateCopyWithAttributes(
            nunito as CTFontDescriptor,
            [
                kCTFontCascadeListAttribute: [wenKai],
                kCTFontFeatureSettingsAttribute: features,
            ] as CFDictionary
        )
        return CTFontCreateWithFontDescriptor(descriptor, size, nil) as UIFont
    }

    /// Composite UIFont for a Dynamic Type text style (scaled via UIFontMetrics).
    /// A nil weight uses the style's semantic default (headline = semibold).
    static func uiFont(_ style: UIFont.TextStyle, weight: UIFont.Weight? = nil) -> UIFont {
        let resolved = weight ?? (style == .headline ? .semibold : .regular)
        let base = uiFont(size: defaultSize(style), weight: resolved)
        return UIFontMetrics(forTextStyle: style).scaledFont(for: base)
    }

    static func font(_ style: UIFont.TextStyle, weight: UIFont.Weight? = nil) -> Font {
        Font(uiFont(style, weight: weight))
    }

    /// Display face for brand titles and the 東 tile. Per-glyph resolution is
    /// the same stack as everywhere else: CJK lands on WenKai, Latin on Nunito.
    static func display(_ size: CGFloat) -> Font {
        Font(UIFontMetrics(forTextStyle: .title1).scaledFont(for: uiFont(size: size)))
    }

    private static func defaultSize(_ style: UIFont.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: return 34
        case .title1: return 28
        case .title2: return 22
        case .title3: return 20
        case .headline, .body: return 17
        case .callout: return 16
        case .subheadline: return 15
        case .footnote: return 13
        case .caption1: return 12
        case .caption2: return 11
        default: return 17
        }
    }
}
