package com.ivxholdings.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import com.ivxholdings.app.data.remote.IAApiService
import com.ivxholdings.app.data.remote.IVXApiService
import com.ivxholdings.app.data.repository.IVXRepository
import com.ivxholdings.app.ui.navigation.AppNavigation
import com.ivxholdings.app.ui.theme.AppTheme
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.util.AppConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.koin.core.context.GlobalContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        window.decorView.setBackgroundColor(IVXDark.value.toInt())
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        // Auto-login owner on startup so all IA features (chat, voice, SMS) work immediately
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                val repository = IVXRepository(IVXApiService())
                val result = repository.ownerLogin(AppConfig.OWNER_EMAIL)
                result.onSuccess { response ->
                    response.accessToken?.let { token ->
                        // Propagate auth token to IAApiService via Koin
                        GlobalContext.getOrNull()?.let { koin ->
                            koin.get<IAApiService>().setAuthToken(token)
                        }
                    }
                }
            }
        }

        setContent {
            AppTheme(darkTheme = true) {
                AppNavigation()
            }
        }
    }
}
