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
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.HealthAndSafety
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.RealEstateAgent
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.ivxholdings.app.ui.navigation.Screen
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXGreen
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurface
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.HomeUiState
import com.ivxholdings.app.ui.viewmodel.HomeViewModel
import org.koin.androidx.compose.koinViewModel

@Composable
fun HomeScreen(navController: NavController) {
    val viewModel: HomeViewModel = koinViewModel()
    val state by viewModel.state.collectAsState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        IVXDark,
                        Color(0xFF0D0D14),
                        IVXDark
                    )
                )
            )
    ) {
        when (state) {
            is HomeUiState.Loading -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = IVXGold, strokeWidth = 3.dp, modifier = Modifier.size(48.dp))
                        Spacer(modifier = Modifier.height(16.dp))
                        Text("Loading IVX Command Center...", color = IVXOnSurfaceMuted, fontSize = 14.sp)
                    }
                }
            }

            is HomeUiState.Error -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            (state as HomeUiState.Error).message,
                            color = IVXRed,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Card(
                            onClick = { viewModel.load() },
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(containerColor = IVXGold)
                        ) {
                            Text(
                                "Retry",
                                color = IVXDark,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp)
                            )
                        }
                    }
                }
            }

            is HomeUiState.Success -> {
                val data = (state as HomeUiState.Success).data
                HomeContent(
                    data = data,
                    onNavigate = { route -> navController.navigate(route) }
                )
            }
        }
    }

    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.load() }
}

@Composable
private fun HomeContent(
    data: HomeData,
    onNavigate: (String) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 48.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item { HomeHeader(data) }
        item { StatusBanner(data) }
        item { QuickStatsRow(data) }
        item { SectionTitle("Command Modules") }
        item {
            NavigationGrid(
                items = listOf(
                    NavItem("Autonomous", "112 IA Agents", Icons.Default.AutoAwesome, Screen.AutonomousDashboard.route, IVXGold),
                    NavItem("Deals", "Active deals", Icons.Default.ShoppingCart, Screen.Deals.route, IVXBlue),
                    NavItem("Properties", "Real estate", Icons.Default.Business, Screen.Properties.route, IVXGreen),
                    NavItem("Investors", "Investor CRM", Icons.Default.RealEstateAgent, Screen.Investors.route, Color(0xFF9C6ADE)),
                    NavItem("Feed", "Updates", Icons.AutoMirrored.Filled.Feed, Screen.Feed.route, IVXGold),
                    NavItem("Reels", "Video content", Icons.Default.Videocam, Screen.Reels.route, IVXRed)
                ),
                onNavigate = onNavigate
            )
        }
        item { SectionTitle("IA Live Features") }
        item {
            NavigationGrid(
                items = listOf(
                    NavItem("Voice Chat", "AI voice + TTS", Icons.Default.Mic, Screen.VoiceChat.route, IVXGold),
                    NavItem("Comms", "SMS + Voice calls", Icons.Default.Phone, Screen.SignalWire.route, IVXGreen)
                ),
                onNavigate = onNavigate
            )
        }
        item { SectionTitle("Operations") }
        item {
            NavigationGrid(
                items = listOf(
                    NavItem("Agents", "Vercel exit agents", Icons.Default.Groups, Screen.Agents.route, IVXBlue),
                    NavItem("AI Engineering", "Code execution", Icons.Default.TrendingUp, Screen.AIEngineering.route, IVXGreen),
                    NavItem("Revenue", "Treasury", Icons.Default.Analytics, Screen.Revenue.route, IVXGold),
                    NavItem("Analytics", "Metrics", Icons.Default.Dashboard, Screen.Analytics.route, Color(0xFF9C6ADE))
                ),
                onNavigate = onNavigate
            )
        }
        item { SectionTitle("Account") }
        item {
            NavigationGrid(
                items = listOf(
                    NavItem("Profile", "Owner profile", Icons.Default.Person, Screen.Profile.route, IVXBlue),
                    NavItem("Settings", "App settings", Icons.Default.Settings, Screen.Settings.route, IVXOnSurfaceMuted),
                    NavItem("Health", "System health", Icons.Default.HealthAndSafety, Screen.About.route, IVXGreen)
                ),
                onNavigate = onNavigate
            )
        }
        item { Spacer(modifier = Modifier.height(8.dp)) }
        item {
            Text(
                "IVX Holdings · v${data.version} · ${data.commitShort}",
                color = IVXOnSurfaceMuted.copy(alpha = 0.6f),
                fontSize = 11.sp,
                modifier = Modifier.fillMaxWidth(),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
        }
    }
}

@Composable
private fun HomeHeader(data: HomeData) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(Brush.radialGradient(listOf(IVXGold, Color(0xFFB8860B)))),
                contentAlignment = Alignment.Center
            ) {
                Text("IV", color = IVXDark, fontWeight = FontWeight.Black, fontSize = 18.sp)
            }
            Spacer(modifier = Modifier.width(14.dp))
            Column {
                Text(
                    "IVX Holdings",
                    color = IVXOnSurface,
                    fontWeight = FontWeight.Bold,
                    fontSize = 22.sp
                )
                Text(
                    "AI-Powered Real Estate Platform",
                    color = IVXGold,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

@Composable
private fun StatusBanner(data: HomeData) {
    val isHealthy = data.status == "healthy" || data.status == "ok"
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isHealthy) IVXGreen.copy(alpha = 0.12f) else IVXRed.copy(alpha = 0.12f)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(if (isHealthy) IVXGreen else IVXRed)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    if (isHealthy) "Production Online" else "Production Issue",
                    color = if (isHealthy) IVXGreen else IVXRed,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp
                )
                Text(
                    "${data.agentsCount} IA agents · ${data.status}",
                    color = IVXOnSurfaceMuted,
                    fontSize = 12.sp
                )
            }
            Text(
                data.commitShort,
                color = IVXOnSurfaceMuted,
                fontSize = 11.sp,
                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
            )
        }
    }
}

@Composable
private fun QuickStatsRow(data: HomeData) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        StatCard(modifier = Modifier.weight(1f), value = data.dealsCount.toString(), label = "Deals", color = IVXBlue)
        StatCard(modifier = Modifier.weight(1f), value = data.propertiesCount.toString(), label = "Properties", color = IVXGreen)
        StatCard(modifier = Modifier.weight(1f), value = data.investorsCount.toString(), label = "Investors", color = Color(0xFF9C6ADE))
    }
}

@Composable
private fun StatCard(modifier: Modifier = Modifier, value: String, label: String, color: Color) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(value, color = color, fontWeight = FontWeight.Black, fontSize = 22.sp)
            Text(label, color = IVXOnSurfaceMuted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(
        title,
        color = IVXOnSurface,
        fontWeight = FontWeight.Bold,
        fontSize = 16.sp,
        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
    )
}

private data class NavItem(
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
    val route: String,
    val color: Color
)

@Composable
private fun NavigationGrid(items: List<NavItem>, onNavigate: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items.chunked(2).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                rowItems.forEach { item ->
                    NavigationTile(
                        item = item,
                        onClick = { onNavigate(item.route) },
                        modifier = Modifier.weight(1f)
                    )
                }
                if (rowItems.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun NavigationTile(item: NavItem, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier
            .height(84.dp)
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(item.color.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(item.icon, contentDescription = item.title, tint = item.color, modifier = Modifier.size(22.dp))
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(item.title, color = IVXOnSurface, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(item.subtitle, color = IVXOnSurfaceMuted, fontSize = 11.sp)
            }
        }
    }
}

data class HomeData(
    val status: String = "unknown",
    val commitShort: String = "",
    val agentsCount: Int = 0,
    val dealsCount: Int = 0,
    val propertiesCount: Int = 0,
    val investorsCount: Int = 0,
    val version: String = "1.0.0"
)
