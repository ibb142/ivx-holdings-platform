package com.ivxholdings.app.ui.navigation

import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Feed
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.HealthAndSafety
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.RealEstateAgent
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Videocam

sealed class Screen(val route: String, val label: String, val icon: ImageVector) {
    data object Login : Screen("login", "Login", Icons.Default.Person)
    data object Home : Screen("home", "Home", Icons.Default.Home)
    data object Feed : Screen("feed", "Feed", Icons.AutoMirrored.Filled.Feed)
    data object Properties : Screen("properties", "Properties", Icons.Default.Business)
    data object Deals : Screen("deals", "Deals", Icons.Default.ShoppingCart)
    data object Reels : Screen("reels", "Reels", Icons.Default.Videocam)
    data object Chat : Screen("chat", "AI", Icons.AutoMirrored.Filled.Chat)
    data object Profile : Screen("profile", "Profile", Icons.Default.Person)
    data object Settings : Screen("settings", "Settings", Icons.Default.Settings)
    data object VercelExit : Screen("vercel_exit", "Vercel Exit", Icons.Default.Dashboard)
    data object Agents : Screen("agents", "Agents", Icons.Default.Groups)
    data object AIEngineering : Screen("ai_engineering", "AI Engineering", Icons.Default.TrendingUp)
    data object AutonomousDashboard : Screen("autonomous_dashboard", "Autonomous", Icons.Default.AutoAwesome)
    data object OwnerDashboard : Screen("owner_dashboard", "Owner Dashboard", Icons.Default.Dashboard)
    data object Investors : Screen("investors", "Investors", Icons.Default.RealEstateAgent)
    data object Buyers : Screen("buyers", "Buyers", Icons.Default.Groups)
    data object Revenue : Screen("revenue", "Revenue", Icons.Default.Analytics)
    data object Analytics : Screen("analytics", "Analytics", Icons.Default.Analytics)
    data object Members : Screen("members", "Members", Icons.Default.Groups)
    data object About : Screen("about", "Health", Icons.Default.HealthAndSafety)
}
