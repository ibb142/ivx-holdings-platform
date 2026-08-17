package com.ivxholdings.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = IVXGold,
    onPrimary = IVXDark,
    primaryContainer = IVXGold.copy(alpha = 0.2f),
    onPrimaryContainer = IVXGold,
    secondary = IVXBlue,
    onSecondary = Color.White,
    secondaryContainer = IVXBlue.copy(alpha = 0.2f),
    onSecondaryContainer = IVXBlue,
    tertiary = Color(0xFF9C6ADE),
    onTertiary = Color.White,
    background = IVXDark,
    onBackground = IVXOnSurface,
    surface = IVXSurface,
    onSurface = IVXOnSurface,
    surfaceVariant = IVXSurfaceVariant,
    onSurfaceVariant = IVXOnSurfaceMuted,
    error = IVXRed,
    onError = Color.White,
    outline = IVXOnSurfaceMuted.copy(alpha = 0.3f)
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFFB8860B),
    onPrimary = Color.White,
    background = Color(0xFFF5F5F7),
    onBackground = Color(0xFF1A1A1A),
    surface = Color.White,
    onSurface = Color(0xFF1A1A1A),
    surfaceVariant = Color(0xFFE8E8EC),
    onSurfaceVariant = Color(0xFF6E6E78),
    error = IVXRed,
    onError = Color.White
)

@Composable
fun AppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
