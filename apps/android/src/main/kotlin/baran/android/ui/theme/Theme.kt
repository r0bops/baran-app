package baran.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val BaranDarkColors = darkColorScheme(
    primary = Color(0xFF38BDF8),
    onPrimary = Color(0xFF0A0F1A),
    primaryContainer = Color(0xFF1E3A5F),
    secondary = Color(0xFF22C55E),
    tertiary = Color(0xFF8B5CF6),
    error = Color(0xFFEF4444),
    background = Color(0xFF0A0F1A),
    surface = Color(0xFF1A1A2E),
    onBackground = Color(0xFFE2E8F0),
    onSurface = Color(0xFFE2E8F0),
    outline = Color(0xFF334155),
)

@Composable
fun BaranTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = BaranDarkColors,
        content = content,
    )
}
