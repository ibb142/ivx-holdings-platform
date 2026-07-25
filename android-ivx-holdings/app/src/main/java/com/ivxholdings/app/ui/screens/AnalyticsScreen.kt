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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.ivxholdings.app.data.model.AnalyticsMetric
import com.ivxholdings.app.ui.components.IVXScreenShell
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXGreen
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.AnalyticsUiState
import com.ivxholdings.app.ui.viewmodel.AnalyticsViewModel
import org.koin.androidx.compose.koinViewModel

@Composable
fun AnalyticsScreen(navController: NavController) {
    val viewModel: AnalyticsViewModel = koinViewModel()
    val state by viewModel.state.collectAsState()

    IVXScreenShell(title = "Analytics", navController = navController, onRefresh = { viewModel.load() }) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(IVXDark),
            contentAlignment = Alignment.Center
        ) {
            when (state) {
                is AnalyticsUiState.Loading -> CircularProgressIndicator(color = IVXGold)
                is AnalyticsUiState.Error -> {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text((state as AnalyticsUiState.Error).message, color = IVXOnSurfaceMuted)
                    }
                }
                is AnalyticsUiState.Success -> {
                    val data = (state as AnalyticsUiState.Success).data
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        item {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(IVXSurfaceVariant)
                                    .padding(20.dp)
                            ) {
                                Text("Period", color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodyMedium)
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(data.period, color = IVXGold, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            }
                        }
                        items(data.metrics.size) { index ->
                            AnalyticsMetricCard(data.metrics[index])
                        }
                    }
                }
            }
        }
    }

    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.load() }
}

@Composable
private fun AnalyticsMetricCard(metric: AnalyticsMetric) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text(metric.label, color = IVXOnSurface, fontWeight = FontWeight.SemiBold)
                Text(metric.value, color = IVXBlue, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            val trendColor = when (metric.trend) {
                "up" -> IVXGreen
                "down" -> IVXRed
                else -> IVXOnSurfaceMuted
            }
            Text(metric.change, color = trendColor, fontWeight = FontWeight.Bold)
        }
    }
}
