package com.ivxholdings.app

import android.os.Bundle
import android.view.Window
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import com.ivxholdings.app.ui.navigation.AppNavigation
import com.ivxholdings.app.ui.theme.AppTheme
import com.ivxholdings.app.ui.theme.IVXDark

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        window.decorView.setBackgroundColor(IVXDark.value.toInt())
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        setContent {
            AppTheme(darkTheme = true) {
                AppNavigation()
            }
        }
    }
}
