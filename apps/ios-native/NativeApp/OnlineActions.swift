import Foundation
import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

// 最后一版原生：旧的逐局/抽风/调座/签到动作已全部删除。
// 本文件只保留分享页的二维码（复用 fix10 的 CoreImage 生成）。

struct InvitationQR: View {
    let link: String
    @State private var image: UIImage?
    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                    .frame(maxWidth: 240, maxHeight: 240)
                    .accessibilityLabel("加入链接二维码")
            } else { Text("正在生成二维码；也可复制链接") }
        }
        .task(id: link) { image = makeQR() }
    }
    private func makeQR() -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(link.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage,
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}
