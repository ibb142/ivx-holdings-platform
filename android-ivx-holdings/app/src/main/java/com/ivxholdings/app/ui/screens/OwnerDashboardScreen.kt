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
import com.ivxholdings.app.ui.components.IVXScreenShell
import com.ivxholdings.app.ui.navigation.Screen
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXGreen
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.SummaryDashboardState
import com.ivxholdings.app.ui.viewmodel.OwnerDashboardViewModel
import org.koin.androidx.compose.koinViewModel

@Composable
fun OwnerDashboardScreen(navController: NavController) {
    val viewModel: OwnerDashboardViewModel = koinViewModel()
    val state by viewModel.state.collectAsState()

    IVXScreenShell(title = "Owner Dashboard", navController = navController, onRefresh = { viewModel.load() }) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(IVXDark),
            contentAlignment = Alignment.Center
        ) {
            when (state) {
                is SummaryDashboardState.Loading -> CircularProgressIndicator(color = IVXGold)
                is SummaryDashboardState.Error -> {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text((state as SummaryDashboardState.Error).message, color = IVXOnSurfaceMuted)
                    }
                }
                is SummaryDashboardState.Success -> {
                    val data = (state as SummaryDashboardState.Success)
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
                                Text("Platform Overview", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                                Spacer(modifier = Modifier.height(8.dp))
                                Text("Version: ${data.version}", color = IVXGold, fontWeight = FontWeight.SemiBold)
                            }
                        }
                        item { CountGrid(data) }
                        item {
                            Text("Financials", fontWeight = FontWeight.Bold, color = IVXOnSurface, style = MaterialTheme.typography.titleMedium)
                        }
                        item {
                            BigMetricCard(
                                "Total Revenue",
                                "$${String.format("%,.0f", data.revenue?.totalRevenue ?: 0.0)}",
                                IVXGreen
                            )
                        }
                        item {
                            BigMetricCard(
                                "Distributions",
                                "$${String.format("%,.0f", data.revenue?.totalDistributions ?: 0.0)}",
                                IVXBlue
                            )
                        }
                        item {
                            Text("Modules", fontWeight = FontWeight.Bold, color = IVXOnSurface, style = MaterialTheme.typography.titleMedium)
                        }
                        item { ActionCard("Members", "Registered users", IVXBlue) { navController.navigate(Screen.Members.route) } }
                        item { ActionCard("Investors", "Capital partners", IVXGreen) { navController.navigate(Screen.Investors.route) } }
                        item { ActionCard("Buyers", "Buyer prospects", IVXGold) { navController.navigate(Screen.Buyers.route) } }
                        item { ActionCard("Revenue", "Treasury dashboard", IVXGreen) { navController.navigate(Screen.Revenue.route) } }
                        item { ActionCard("Analytics", "Platform metrics", IVXBlue) { navController.navigate(Screen.Analytics.route) } }
                        item { ActionCard("Vercel Exit", "Migration command center", IVXRed) { navController.navigate(Screen.VercelExit.route) } }
                        item { ActionCard("AI Engineering", "9 AI agents", IVXBlue) { navController.navigate(Screen.AIEngineering.route) } }
                    }
                }
            }
        }
    }

    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.load() }
}

@Composable
private fun CountGrid(data: SummaryDashboardState.Success) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        CountTile("Members", data.membersCount.toString(), Modifier.weight(1f), IVXBlue)
        CountTile("Investors", data.investorsCount.toString(), Modifier.weight(1f), IVXGreen)
        CountTile("Buyers", data.buyersCount.toString(), Modifier.weight(1f), IVXGold)
    }
}

@Composable
private fun CountTile(label: String, value: String, modifier: Modifier = Modifier, color: androidx.compose.ui.graphics.Color) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(IVXSurfaceVariant)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(value, color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
        Text(label, color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun BigMetricCard(label: String, value: String, color: androidx.compose.ui.graphics.Color) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(IVXSurfaceVariant)
            .padding(16.dp)
    ) {
        Text(label, color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodyMedium)
        Spacer(modifier = Modifier.height(4.dp))
        Text(value, color = color, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
    }
}
