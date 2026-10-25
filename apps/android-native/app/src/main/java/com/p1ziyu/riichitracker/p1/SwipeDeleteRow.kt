package com.p1ziyu.riichitracker.p1

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

// iosfix7 item 2: stock SwipeToDismissBox sizes its revealed action to the
// label, so the shipped 删除 was a narrow pill. This row is gesture-driven
// instead: a left drag slides the content off and the full row area
// underneath is one gold 删除 button. The drag never deletes by itself —
// tapping the revealed button calls onDeleteTap, which opens the existing
// Chinese confirm dialog. A right drag collapses the row again. `shape`
// must match the row card it wraps (online Card 12dp, local BrandPanel
// 10dp) so the revealed button shares the card's silhouette.
@Composable
fun FullWidthSwipeDeleteRow(
    onDeleteTap: () -> Unit,
    shape: Shape = RoundedCornerShape(12.dp),
    content: @Composable () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    var revealed by remember { mutableStateOf(false) }
    var rowWidth by remember { mutableStateOf(0) }
    val density = LocalDensity.current
    val thresholdPx = with(density) { 96.dp.toPx() }
    // Settle to a stable state on both end and cancel: if the
    // LazyColumn steals the gesture mid-drag, onDragEnd never fires
    // and the row would otherwise freeze mid-slide (same class of
    // bug as the iOS List competition, fixed there with
    // simultaneousGesture).
    val settle: () -> Unit = {
        val width = rowWidth.toFloat()
        val shouldReveal = if (revealed) {
            offset.value < -thresholdPx
        } else {
            offset.value < -thresholdPx || offset.value < -width * 0.3f
        }
        revealed = shouldReveal
        scope.launch {
            offset.animateTo(
                if (shouldReveal) -width else 0f,
                animationSpec = tween(durationMillis = 200),
            )
        }
    }
    Box(
        Modifier.fillMaxWidth()
            .onSizeChanged { rowWidth = it.width }
            .pointerInput(revealed, rowWidth) {
                detectHorizontalDragGestures(
                    onHorizontalDrag = { _, dragAmount ->
                        scope.launch {
                            val next = (offset.value + dragAmount)
                                .coerceIn(-rowWidth.toFloat(), 0f)
                            offset.snapTo(next)
                        }
                    },
                    onDragEnd = { settle() },
                    onDragCancel = { settle() },
                )
            },
    ) {
        Button(
            onClick = onDeleteTap,
            modifier = Modifier.fillMaxSize(),
            shape = shape,
            colors = ButtonDefaults.buttonColors(
                containerColor = Brand.gold,
                contentColor = Brand.background,
            ),
        ) {
            Text("删除")
        }
        Box(
            Modifier
                .fillMaxWidth()
                .offset { IntOffset(offset.value.roundToInt(), 0) },
        ) {
            content()
        }
    }
}
