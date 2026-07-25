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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lock
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
import com.ivxholdings.app.data.model.VercelDependency
import com.ivxholdings.app.data.model.VercelExitDashboard
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXGreen
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.VercelExitUiState
import com.ivxholdings.app.ui.viewmodel.VercelExitViewModel
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VercelExitScreen(navController: NavController) {
    val viewModel: VercelExitViewModel = koinViewModel()
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) { viewModel.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Vercel Exit Command Center") },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = IVXOnSurface)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = IVXDark)
            )
        }
    ) { padding ->
        when (val state = uiState) {
            is VercelExitUiState.Loading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = IVXGold)
                }
            }
            is VercelExitUiState.Error -> {
                ErrorContent(
                    modifier = Modifier.padding(padding),
                    message = state.message
                )
            }
            is VercelExitUiState.Success -> {
                VercelExitContent(
                    modifier = Modifier.padding(padding),
                    dashboard = state.dashboard,
                    dependencies = state.dependencies
                )
            }
        }
    }
}

@Composable
private fun VercelExitContent(
    modifier: Modifier,
    dashboard: VercelExitDashboard,
    dependencies: List<VercelDependency>
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item { SummaryCard(dashboard) }
        item { CostCard(dashboard) }
        item {
            Text(
                "Dependency Inventory (${dependencies.size})",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 8.dp)
            )
        }
        items(dependencies) { dep ->
            DependencyRow(dep)
        }
        if (dependencies.isEmpty()) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
                ) {
                    Text(
                        "No dependencies loaded. Backend may require authentication or be unavailable.",
                        modifier = Modifier.padding(16.dp),
                        color = IVXOnSurfaceMuted
                    )
                }
            }
        }
        item {
            Spacer(modifier = Modifier.height(24.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(IVXRed.copy(alpha = 0.15f))
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.Lock, contentDescription = null, tint = IVXRed, modifier = Modifier.size(24.dp))
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text("Owner-only controls", fontWeight = FontWeight.SemiBold)
                    Text("Dangerous operations require server-side MFA confirmation.", style = MaterialTheme.typography.bodySmall, color = IVXOnSurfaceMuted)
                }
            }
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
        Text(message, color = IVXRed, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(modifier = Modifier.height(8.dp))
        Text("Showing local fallback data.", color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun SummaryCard(dashboard: VercelExitDashboard) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Migration Status", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(modifier = Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Metric("Deps", dashboard.dependenciesDiscovered.toString())
                Metric("Removed", dashboard.dependenciesRemoved.toString())
                Metric("Complete", "${(dashboard.overallCompletion * 100).toInt()}%")
                Metric("Phase", dashboard.currentPhase.filter { it.isDigit() }.take(1).ifEmpty { "2" })
            }
            Spacer(modifier = Modifier.height(12.dp))
            Text("Traffic: ${dashboard.vercelTraffic} Vercel → ${dashboard.ivxTraffic} IVX", color = IVXRed, fontWeight = FontWeight.SemiBold)
            Text("Status: ${dashboard.migrationStatus}", color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleLarge, color = IVXGold, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.bodySmall, color = IVXOnSurfaceMuted)
    }
}

@Composable
private fun CostCard(dashboard: VercelExitDashboard) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Cost Comparison", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(modifier = Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Before:", color = IVXOnSurfaceMuted)
                Text(dashboard.costBefore, color = IVXRed, fontWeight = FontWeight.Bold)
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("After:", color = IVXOnSurfaceMuted)
                Text(dashboard.costAfter, color = IVXGreen, fontWeight = FontWeight.Bold)
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Savings:", color = IVXOnSurfaceMuted)
                Text(dashboard.monthlySavings, color = IVXGold, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun DependencyRow(dep: VercelDependency) {
    val riskColor = when (dep.risk.lowercase()) {
        "critical" -> IVXRed
        "high" -> IVXGold
        "medium" -> IVXBlue
        else -> IVXGreen
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (dep.risk.lowercase() == "critical") Icons.Default.Warning else Icons.Default.CheckCircle,
                contentDescription = null,
                tint = riskColor,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("${dep.dependencyId} · ${dep.vercelService}", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                Text("Type: ${dep.dependencyType} · Risk: ${dep.risk}", style = MaterialTheme.typography.bodySmall, color = IVXOnSurfaceMuted)
                Text("Replacement: ${dep.replacementService}", style = MaterialTheme.typography.bodySmall, color = IVXGreen)
                Text("Status: ${dep.migrationStatus}", style = MaterialTheme.typography.bodySmall, color = IVXGold)
            }
        }
    }
}
