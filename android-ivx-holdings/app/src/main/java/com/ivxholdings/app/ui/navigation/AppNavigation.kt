package com.ivxholdings.app.ui.navigation

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.ivxholdings.app.ui.screens.AIEngineeringScreen
import com.ivxholdings.app.ui.screens.AboutScreen
import com.ivxholdings.app.ui.screens.AgentsScreen
import com.ivxholdings.app.ui.screens.AnalyticsScreen
import com.ivxholdings.app.ui.screens.AutonomousDashboardScreen
import com.ivxholdings.app.ui.screens.BuyersScreen
import com.ivxholdings.app.ui.screens.ChatScreen
import com.ivxholdings.app.ui.screens.DealsScreen
import com.ivxholdings.app.ui.screens.FeedScreen
import com.ivxholdings.app.ui.screens.HomeScreen
import com.ivxholdings.app.ui.screens.InvestorsScreen
import com.ivxholdings.app.ui.screens.LoginScreen
import com.ivxholdings.app.ui.screens.MembersScreen
import com.ivxholdings.app.ui.screens.OwnerDashboardScreen
import com.ivxholdings.app.ui.screens.ProfileScreen
import com.ivxholdings.app.ui.screens.PropertiesScreen
import com.ivxholdings.app.ui.screens.ReelsScreen
import com.ivxholdings.app.ui.screens.RevenueScreen
import com.ivxholdings.app.ui.screens.SettingsScreen
import com.ivxholdings.app.ui.screens.SignalWireScreen
import com.ivxholdings.app.ui.screens.VoiceChatScreen
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXSurface

private val bottomNavItems = listOf(
    Screen.Home,
    Screen.AutonomousDashboard,
    Screen.Chat,
    Screen.Profile
)

@Composable
fun AppNavigation() {
    val navController = rememberNavController()

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = IVXDark,
        bottomBar = {
            val navBackStackEntry by navController.currentBackStackEntryAsState()
            val currentDestination = navBackStackEntry?.destination
            val currentRoute = currentDestination?.route

            val showBottomBar = currentRoute != null && bottomNavItems.any { it.route == currentRoute }
            if (showBottomBar) {
                NavigationBar(
                    containerColor = IVXSurface,
                    tonalElevation = 0.dp
                ) {
                    bottomNavItems.forEach { screen ->
                        val selected = currentDestination?.hierarchy?.any { it.route == screen.route } ?: false
                        NavigationBarItem(
                            icon = {
                                Icon(
                                    imageVector = screen.icon,
                                    contentDescription = screen.label
                                )
                            },
                            label = { Text(screen.label) },
                            selected = selected,
                            onClick = {
                                navController.navigate(screen.route) {
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = IVXGold,
                                selectedTextColor = IVXGold,
                                unselectedIconColor = IVXOnSurfaceMuted,
                                unselectedTextColor = IVXOnSurfaceMuted,
                                indicatorColor = IVXGold.copy(alpha = 0.12f)
                            )
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Home.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Screen.Home.route) { HomeScreen(navController = navController) }
            composable(Screen.AutonomousDashboard.route) { AutonomousDashboardScreen(navController = navController) }
            composable(Screen.Agents.route) { AgentsScreen(navController = navController) }
            composable(Screen.AIEngineering.route) { AIEngineeringScreen(navController = navController) }
            composable(Screen.Chat.route) { ChatScreen(navController = navController) }
            composable(Screen.Feed.route) { FeedScreen(navController = navController) }
            composable(Screen.Properties.route) { PropertiesScreen(navController = navController) }
            composable(Screen.Deals.route) { DealsScreen(navController = navController) }
            composable(Screen.Reels.route) { ReelsScreen(navController = navController) }
            composable(Screen.Investors.route) { InvestorsScreen(navController = navController) }
            composable(Screen.Buyers.route) { BuyersScreen(navController = navController) }
            composable(Screen.Revenue.route) { RevenueScreen(navController = navController) }
            composable(Screen.Analytics.route) { AnalyticsScreen(navController = navController) }
            composable(Screen.Members.route) { MembersScreen(navController = navController) }
            composable(Screen.OwnerDashboard.route) { OwnerDashboardScreen(navController = navController) }
            composable(Screen.Profile.route) { ProfileScreen(navController = navController) }
            composable(Screen.Settings.route) { SettingsScreen(navController = navController) }
            composable(Screen.About.route) { AboutScreen(navController = navController) }
            composable(Screen.VoiceChat.route) { VoiceChatScreen(navController = navController) }
            composable(Screen.SignalWire.route) { SignalWireScreen(navController = navController) }
            composable(Screen.Login.route) { LoginScreen(onLoginSuccess = { navController.navigate(Screen.Home.route) { popUpTo(Screen.Login.route) { inclusive = true } } }) }
            composable(Screen.VercelExit.route) { com.ivxholdings.app.ui.screens.VercelExitScreen(navController = navController) }
        }
    }
}
