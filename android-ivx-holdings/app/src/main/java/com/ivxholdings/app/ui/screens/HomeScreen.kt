package com.ivxholdings.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Feed
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.HealthAndSafety
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.ivxholdings.app.ui.navigation.Screen
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXGreen
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.HealthViewModel
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(navController: NavController) {
    val healthViewModel: HealthViewModel = koinViewModel()
    val healthState by healthViewModel.state.collectAsState()

    LaunchedEffect(Unit) { healthViewModel.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(IVXGold),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("IV", color = IVXDark, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                        }
                        Spacer(modifier = Modifier.width(10.dp))
                        Text("IVX Holdings", color = IVXOnSurface)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = IVXDark,
                    titleContentColor = IVXOnSurface
                )
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(IVXDark),
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
                    Text("Private markets, made legible.", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium, color = IVXOnSurface)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("Unified Command Center for IVX Holdings", style = MaterialTheme.typography.bodyMedium, color = IVXOnSurfaceMuted)
                    Spacer(modifier = Modifier.height(12.dp))
                    when (val state = healthState) {
                        is com.ivxholdings.app.ui.viewmodel.HealthUiState.Loading -> Text("Connecting...", color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodySmall)
                        is com.ivxholdings.app.ui.viewmodel.HealthUiState.Error -> Text("Offline mode", color = IVXRed, style = MaterialTheme.typography.bodySmall)
                        is com.ivxholdings.app.ui.viewmodel.HealthUiState.Success -> {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(IVXGreen))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Live · ${state.version}", color = IVXGreen, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }
            item {
                Text("Discover", fontWeight = FontWeight.Bold, color = IVXOnSurface, style = MaterialTheme.typography.titleMedium)
            }
            item {
                QuickActionGrid(
                    actions = listOf(
                        QuickAction("Feed", "Updates & news", Icons.AutoMirrored.Filled.Feed, IVXBlue, Screen.Feed.route),
                        QuickAction("Properties", "Real estate listings", Icons.Default.Business, IVXGreen, Screen.Properties.route),
                        QuickAction("Deals", "Active deal flow", Icons.Default.ShoppingCart, IVXGold, Screen.Deals.route),
                        QuickAction("Reels", "Video content", Icons.Default.Videocam, IVXRed, Screen.Reels.route),
                    ),
                    navController = navController
                )
            }
            item {
                Text("Owner Console", fontWeight = FontWeight.Bold, color = IVXOnSurface, style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(4.dp))
            }
            item {
                ActionCard("Owner Dashboard", "Members, investors, buyers, revenue", IVXGold, Screen.OwnerDashboard.route, navController, Icons.Default.Dashboard)
            }
            item {
                ActionCard("Investors", "Capital partners", IVXGreen, Screen.Investors.route, navController, Icons.Default.Groups)
            }
            item {
                ActionCard("Buyers", "Buyer prospects", IVXGold, Screen.Buyers.route, navController, Icons.Default.Person)
            }
            item {
                ActionCard("Revenue", "Treasury dashboard", IVXGreen, Screen.Revenue.route, navController, Icons.Default.TrendingUp)
            }
            item {
                ActionCard("Analytics", "Platform metrics", IVXBlue, Screen.Analytics.route, navController, Icons.Default.TrendingUp)
            }
            item {
                ActionCard("Members", "Registered users", IVXBlue, Screen.Members.route, navController, Icons.Default.Groups)
            }
            item {
                ActionCard("AI Engineering", "Agent monitoring", IVXBlue, Screen.AIEngineering.route, navController, Icons.Default.TrendingUp)
            }
            item {
                ActionCard("IVX Owner AI", "Chat with orchestrator", IVXGreen, Screen.Chat.route, navController, Icons.AutoMirrored.Filled.Chat)
            }
            item {
                ActionCard("Settings", "Notifications, security", IVXBlue, Screen.Settings.route, navController, Icons.Default.Settings)
            }
            item {
                ActionCard("System Health", "Backend status", IVXRed, Screen.About.route, navController, Icons.Default.HealthAndSafety)
            }
            item {
                Spacer(modifier = Modifier.height(8.dp))
            }
        }
    }
}

private data class QuickAction(val title: String, val subtitle: String, val icon: ImageVector, val color: Color, val route: String)

@Composable
private fun QuickActionGrid(actions: List<QuickAction>, navController: NavController) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        actions.forEach { action ->
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(14.dp))
                    .background(IVXSurfaceVariant)
                    .clickable { navController.navigate(action.route) }
                    .padding(14.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(action.color.copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(action.icon, contentDescription = action.title, tint = action.color, modifier = Modifier.size(22.dp))
                }
                Spacer(modifier = Modifier.height(8.dp))
                Text(action.title, fontWeight = FontWeight.SemiBold, color = IVXOnSurface, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                Text(action.subtitle, color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodySmall, maxLines = 1)
            }
        }
    }
}

@Composable
private fun ActionCard(title: String, subtitle: String, color: Color, route: String, navController: NavController, icon: ImageVector) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { navController.navigate(route) },
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(color.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = title, tint = color, modifier = Modifier.size(20.dp))
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, color = IVXOnSurface)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = IVXOnSurfaceMuted)
            }
        }
    }
}
