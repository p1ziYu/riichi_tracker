package com.p1ziyu.riichitracker.p1

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.common.InputImage
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.MultiFormatWriter

@Composable fun InvitationQr(link: String, description: String = "加入二维码") {
    val bitmap = remember(link) { runCatching {
        val matrix = MultiFormatWriter().encode(link, BarcodeFormat.QR_CODE, 512, 512,
            mapOf(EncodeHintType.MARGIN to 2, EncodeHintType.ERROR_CORRECTION to com.google.zxing.qrcode.decoder.ErrorCorrectionLevel.M))
        Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888).apply {
            for (y in 0 until 512) for (x in 0 until 512)
                setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }
    }.getOrNull() }
    if (bitmap == null) Text("二维码不可用，请复制链接", color = Brand.text)
    else Image(bitmap.asImageBitmap(), contentDescription = description,
        modifier = Modifier.size(256.dp))
}

@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
@Composable fun CheckInScanner(accept: (String) -> Boolean = { parseJoinLink(it) != null }, onFound: (String) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var permission by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permission = it }
    if (!permission) {
        Text("扫码需要相机权限；拒绝后仍可粘贴完整链接。永久拒绝请前往系统设置开启。", color = Brand.text)
        Button(onClick = { request.launch(Manifest.permission.CAMERA) }) { Text("允许扫码") }
        return
    }
    val scanner = remember { BarcodeScanning.getClient(BarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
    val provider = remember { ProcessCameraProvider.getInstance(context) }
    val delivered = remember { java.util.concurrent.atomic.AtomicBoolean() }
    val active = remember { java.util.concurrent.atomic.AtomicBoolean(true) }
    DisposableEffect(scanner, provider) {
        onDispose {
            active.set(false)
            if (provider.isDone) runCatching { provider.get().unbindAll() }
            scanner.close()
        }
    }
    AndroidView(factory = { ctx -> PreviewView(ctx) }, modifier = Modifier.fillMaxWidth().height(280.dp)) { previewView ->
        provider.addListener({
            if (!active.get()) return@addListener
            val cameraProvider = provider.get()
            cameraProvider.unbindAll()
            val preview = Preview.Builder().build().apply { surfaceProvider = previewView.surfaceProvider }
            val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analysis.setAnalyzer(ContextCompat.getMainExecutor(context)) { imageProxy ->
                val image = imageProxy.image
                if (image == null) { imageProxy.close(); return@setAnalyzer }
                scanner.process(InputImage.fromMediaImage(image, imageProxy.imageInfo.rotationDegrees))
                    .addOnSuccessListener { barcodes ->
                        barcodes.firstOrNull { accept(it.rawValue.orEmpty()) }
                            ?.rawValue?.let { if (delivered.compareAndSet(false, true)) onFound(it) }
                    }.addOnCompleteListener { imageProxy.close() }
            }
            cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(context))
    }
}
