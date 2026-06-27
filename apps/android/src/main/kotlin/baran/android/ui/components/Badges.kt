package baran.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import baran.app.ReachLevel
import baran.domain.FoldResult
import baran.android.ui.Labels

@Composable
fun Pill(text: String, color: Color, modifier: Modifier = Modifier) {
    Text(
        text = text,
        color = color,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = modifier
            .background(color.copy(alpha = 0.13f), RoundedCornerShape(12.dp))
            .border(1.dp, color.copy(alpha = 0.30f), RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 2.dp),
    )
}

@Composable
fun TierBadge(fold: FoldResult) {
    val color = Labels.tierColor[fold.tierName] ?: Color(0xFF94A3B8)
    Pill("confianza: ${Labels.tierName[fold.tierName] ?: fold.tierName}", color)
}

@Composable
fun ReachBadge(reach: ReachLevel) {
    Pill("alcance: ${Labels.reachLabel(reach)}", Labels.reachColor(reach))
}

/** The honest two-axis badge row. Tier and reach are NEVER conflated. */
@Composable
fun BadgeRow(fold: FoldResult, reach: ReachLevel) {
    FlowRowCompat {
        TierBadge(fold)
        ReachBadge(reach)
        if (fold.disputed) Pill("⚠ disputado", Color(0xFFDC2626))
        if (fold.verified) Pill("✓ afirmado", Color(0xFF22C55E))
        if (fold.locationVerified) Pill("📍 ubicación", Color(0xFF06B6D4))
    }
}

/** Simple wrap layout (avoids depending on the experimental FlowRow). */
@Composable
fun FlowRowCompat(content: @Composable () -> Unit) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth(),
    ) { content() }
}
