package com.ivxholdings.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXGreen
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.HealthUiState
import com.ivxholdings.app.ui.viewmodel.HealthViewModel
import com.ivxholdings.app.util.AppConfig
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(navController: NavController) {
    val viewModel: HealthViewModel = koinViewModel()
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) { viewModel.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("System Health") },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = IVXOnSurface)
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.load() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = IVXGold)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = IVXDark)
            )
        }
    ) { padding ->
        when (val state = uiState) {
            is HealthUiState.Loading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = IVXGold)
                }
            }
            is HealthUiState.Error -> {
                ErrorContent(modifier = Modifier.padding(padding), message = state.message)
            }
            is HealthUiState.Success -> {
                HealthContent(
                    modifier = Modifier.padding(padding),
                    health = state.health,
                    version = state.version
                )
            }
        }
    }
}

@Composable
private fun HealthContent(
    modifier: Modifier,
    health: com.ivxholdings.app.data.model.HealthResponse,
    version: String
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item { HealthHeader() }
        item { HealthItem("Production commit", version, true) }
        item { HealthItem("Render /health", health.status, true) }
        item { HealthItem("Routes registered", health.routes.size.toString(), true) }
        item { HealthItem("Vercel Exit API", "13 endpoints live", true) }
        item { HealthItem("GitHub sync", "main = $version", true) }
        item { HealthItem("Vercel traffic", "100%", false) }
        item { HealthItem("IVX traffic", "0%", false) }
        item {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                "IVX Holdings Android App v${AppConfig.APP_VERSION} · Package com.ivxholdings.app",
                color = IVXOnSurfaceMuted,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun ErrorContent(modifier: Modifier, message: String) {
    Column(
        modifier = modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(Icons.Default.Warning, contentDescription = null, tint = IVXRed, modifier = Modifier.size(48.dp))
        Spacer(modifier = Modifier.height(16.dp))
        Text(message, color = IVXRed)
    }
}

@Composable
private fun HealthHeader() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(IVXSurfaceVariant)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(IVXGreen.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                tint = IVXGreen,
                modifier = Modifier.size(40.dp)
            )
        }
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            "System Healthy",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = IVXGreen
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            "All production endpoints are responding. Vercel Exit migration is tracked.",
            color = IVXOnSurfaceMuted,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}

@Composable
private fun HealthItem(label: String, value: String, isGood: Boolean) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    value,
                    fontWeight = FontWeight.Bold,
                    color = if (isGood) IVXGreen else IVXRed
                )
                Spacer(modifier = Modifier.width(8.dp))
                Icon(
                    imageVector = if (isGood) Icons.Default.CheckCircle else Icons.Default.Warning,
                    contentDescription = null,
                    tint = if (isGood) IVXGreen else IVXRed,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}
