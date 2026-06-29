package venrescate.android.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Cool-grey dark theme for a field rescue tool: calm navy surfaces that elevate
 * with light, one signal-cyan accent, and semantic red/green/amber reserved for
 * trust + severity. Surfaces step lighter as they stack (background → card →
 * popover) so depth reads without heavy borders or shadows.
 */
private val VenRescateDarkColors = darkColorScheme(
    primary = Color(0xFF38BDF8),            // signal cyan — the single accent
    onPrimary = Color(0xFF06283D),
    primaryContainer = Color(0xFF0E3A57),
    onPrimaryContainer = Color(0xFFBAE6FD),

    secondary = Color(0xFF34D399),          // reached-internet / success green
    onSecondary = Color(0xFF052E22),
    secondaryContainer = Color(0xFF0F3D30),
    onSecondaryContainer = Color(0xFFA7F3D0),

    tertiary = Color(0xFFA78BFA),
    onTertiary = Color(0xFF2A1A4A),

    error = Color(0xFFF87171),
    onError = Color(0xFF450A0A),
    errorContainer = Color(0xFF7F1D1D),
    onErrorContainer = Color(0xFFFEE2E2),

    background = Color(0xFF0A0F1A),         // darkest — app canvas
    onBackground = Color(0xFFE6EDF6),       // soft white, not pure (avoids glare)

    surface = Color(0xFF141C2E),            // cards/nav sit one step above the canvas
    onSurface = Color(0xFFE6EDF6),
    surfaceVariant = Color(0xFF1E2942),     // chips / nested fills
    onSurfaceVariant = Color(0xFF9FB0C7),   // readable secondary text — passes AA

    outline = Color(0xFF3A4761),            // borders
    outlineVariant = Color(0xFF22304A),
    scrim = Color(0xFF000000),
)

private val VenRescateShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),     // cards
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

private val VenRescateType = Typography().run {
    copy(
        headlineSmall = headlineSmall.copy(fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = (-0.4).sp),
        titleLarge = titleLarge.copy(fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = (-0.2).sp),
        titleMedium = titleMedium.copy(fontWeight = FontWeight.SemiBold),
        bodyMedium = bodyMedium.copy(lineHeight = 20.sp),
        labelLarge = labelLarge.copy(fontWeight = FontWeight.SemiBold),
        labelSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 11.sp, letterSpacing = 0.2.sp),
    )
}

@Composable
fun VenRescateTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = VenRescateDarkColors,
        typography = VenRescateType,
        shapes = VenRescateShapes,
        content = content,
    )
}
