package com.ivxholdings.app.ui.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Feed
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
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
import androidx.compose.ui.graphics.Color
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.ivxholdings.app.ui.screens.AIEngineeringScreen
import com.ivxholdings.app.ui.screens.AboutScreen
import com.ivxholdings.app.ui.screens.AgentsScreen
import com.ivxholdings.app.ui.screens.AnalyticsScreen
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
import com.ivxholdings.app.ui.screens.VercelExitScreen
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.viewmodel.AuthViewModel
import org.koin.androidx.compose.koinViewModel

private data class BottomTab(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val bottomTabs = listOf(
    BottomTab(Screen.Home.route, "Home", Icons.Default.Home),
    BottomTab(Screen.Feed.route, "Feed", Icons.AutoMirrored.Filled.Feed),
    BottomTab(Screen.Chat.route, "AI", Icons.AutoMirrored.Filled.Chat),
    BottomTab(Screen.OwnerDashboard.route, "Dashboard", Icons.Default.Dashboard),
    BottomTab(Screen.Profile.route, "Profile", Icons.Default.Person),
)

@Composable
fun AppNavigation() {
    val navController = rememberNavController()
    val authViewModel: AuthViewModel = koinViewModel()
    val authState by authViewModel.state.collectAsState()

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route

    val startDestination = if (authState is com.ivxholdings.app.ui.viewmodel.AuthState.Authenticated) {
        Screen.Home.route
    } else {
        Screen.Login.route
    }

    val showBottomBar = currentRoute in bottomTabs.map { it.route }

    Scaffold(
        bottomBar = {
            if (showBottomBar) {
                NavigationBar(
                    containerColor = IVXDark,
                    contentColor = IVXOnSurface
                ) {
                    bottomTabs.forEach { tab ->
                        val selected = navBackStackEntry?.destination?.hierarchy?.any { it.route == tab.route } == true
                        NavigationBarItem(
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label, style = MaterialTheme.typography.labelSmall) },
                            selected = selected,
                            onClick = {
                                navController.navigate(tab.route) {
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
                                indicatorColor = IVXDark
                            )
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(IVXDark)
        ) {
            NavHost(
                navController = navController,
                startDestination = startDestination,
                modifier = Modifier.fillMaxSize()
            ) {
                composable(Screen.Login.route) {
                    LoginScreen(
                        onLoginSuccess = {
                            navController.navigate(Screen.Home.route) {
                                popUpTo(Screen.Login.route) { inclusive = true }
                            }
                        }
                    )
                }
                composable(Screen.Home.route) {
                    HomeScreen(navController = navController)
                }
                composable(Screen.Feed.route) {
                    FeedScreen(navController = navController)
                }
                composable(Screen.Properties.route) {
                    PropertiesScreen(navController = navController)
                }
                composable(Screen.Deals.route) {
                    DealsScreen(navController = navController)
                }
                composable(Screen.Reels.route) {
                    ReelsScreen(navController = navController)
                }
                composable(Screen.Chat.route) {
                    ChatScreen(navController = navController)
                }
                composable(Screen.Profile.route) {
                    ProfileScreen(navController = navController)
                }
                composable(Screen.Settings.route) {
                    SettingsScreen(navController = navController)
                }
                composable(Screen.OwnerDashboard.route) {
                    OwnerDashboardScreen(navController = navController)
                }
                composable(Screen.Investors.route) {
                    InvestorsScreen(navController = navController)
                }
                composable(Screen.Buyers.route) {
                    BuyersScreen(navController = navController)
                }
                composable(Screen.Revenue.route) {
                    com.ivxholdings.app.ui.screens.RevenueScreen(navController = navController)
                }
                composable(Screen.Analytics.route) {
                    AnalyticsScreen(navController = navController)
                }
                composable(Screen.Members.route) {
                    MembersScreen(navController = navController)
                }
                composable(Screen.Agents.route) {
                    AgentsScreen(navController = navController)
                }
                composable(Screen.AIEngineering.route) {
                    AIEngineeringScreen(navController = navController)
                }
                composable(Screen.VercelExit.route) {
                    VercelExitScreen(navController = navController)
                }
                composable(Screen.About.route) {
                    AboutScreen(navController = navController)
                }
            }
        }
    }
}
