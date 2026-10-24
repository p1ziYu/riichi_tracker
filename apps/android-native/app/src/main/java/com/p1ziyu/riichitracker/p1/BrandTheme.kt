package com.p1ziyu.riichitracker.p1

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

internal object Brand {
    val background = Color(0xFF101C28)
    val panel = Color(0xFF1C2942)
    val deepPanel = Color(0xFF152B3B)
    val gold = Color(0xFFC4A66A)
    val goldText = Color(0xFFE4D3A9)
    val text = Color(0xFFF5F5EF)
    val muted = Color(0xFFAEBDC1)
    val gain = Color(0xFFA9DCAC)
    val loss = Color(0xFFF3A9A7)
    val cream = Color(0xFFEAE5D7)
    val tileInk = Color(0xFF184F46)
    val hairline = Color(0x65A79D7B)
    // One FontFamily mirroring the Web root stack: Nunito faces first
    // (Latin + digits), LXGW WenKai Screen after them, so CJK glyphs fall
    // through to WenKai. WenKai ships a single weight; it is listed at every
    // weight and the platform synthesizes the rest — the Web does the same
    // via font-synthesis: weight.
    val body = FontFamily(
        Font(R.font.nunito_regular, FontWeight.Normal),
        Font(R.font.nunito_semibold, FontWeight.SemiBold),
        Font(R.font.nunito_bold, FontWeight.Bold),
        Font(R.font.nunito_extrabold, FontWeight.ExtraBold),
        Font(R.font.wenkai_screen_display, FontWeight.Normal),
        Font(R.font.wenkai_screen_display, FontWeight.SemiBold),
        Font(R.font.wenkai_screen_display, FontWeight.Bold),
        Font(R.font.wenkai_screen_display, FontWeight.ExtraBold),
    )
    /** Display face: the same stack (per-glyph Latin -> Nunito, CJK -> WenKai). */
    val display = body
    val hero = Brush.horizontalGradient(0f to panel, 0.58f to Color(0xFF1B3844), 1f to Color(0xFF264E42))
    val felt = Brush.radialGradient(listOf(Color(0xFF2B645D), Color(0xFF24534F), Color(0xFF173D42)))
}

private val scheme = darkColorScheme(
    primary = Brand.gold,
    onPrimary = Color(0xFF1B2836),
    background = Brand.background,
    onBackground = Brand.text,
    surface = Brand.panel,
    onSurface = Brand.text,
    surfaceVariant = Brand.deepPanel,
    onSurfaceVariant = Brand.muted,
    secondary = Brand.goldText,
    error = Brand.loss,
)

private val brandTypography: Typography
    get() {
        val base = Typography()
        fun TextStyle.brand() = copy(fontFamily = Brand.body, fontFeatureSettings = "tnum, lnum")
        return Typography(
            displayLarge = base.displayLarge.brand(),
            displayMedium = base.displayMedium.brand(),
            displaySmall = base.displaySmall.brand(),
            headlineLarge = base.headlineLarge.brand(),
            headlineMedium = base.headlineMedium.brand(),
            headlineSmall = base.headlineSmall.brand(),
            titleLarge = base.titleLarge.brand(),
            titleMedium = base.titleMedium.brand(),
            titleSmall = base.titleSmall.brand(),
            bodyLarge = base.bodyLarge.brand(),
            bodyMedium = base.bodyMedium.brand(),
            bodySmall = base.bodySmall.brand(),
            labelLarge = base.labelLarge.brand(),
            labelMedium = base.labelMedium.brand(),
            labelSmall = base.labelSmall.brand(),
        )
    }

@Composable
internal fun BrandTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = brandTypography, content = content)
}

@Composable
internal fun BrandPanel(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(modifier = modifier, color = Brand.panel, border = BorderStroke(1.dp, Brand.hairline),
        shape = RoundedCornerShape(10.dp), content = content)
}

@Composable
internal fun EastTile(modifier: Modifier = Modifier) {
    Box(modifier.size(46.dp, 52.dp).background(Brand.cream, RoundedCornerShape(6.dp))
        .border(2.dp, Color(0xFFBBA987), RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
        Text("東", color = Brand.tileInk, style = MaterialTheme.typography.headlineMedium.copy(fontFamily = Brand.display))
    }
}
