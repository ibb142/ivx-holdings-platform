package com.ivxholdings.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.ivxholdings.app.ui.screens.AgentsScreen
import com.ivxholdings.app.ui.screens.AutonomousDashboardScreen
import com.ivxholdings.app.ui.screens.HomeScreen

@Composable
fun AppNavigation() {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = "autonomous_dashboard"
    ) {
        composable("autonomous_dashboard") {
            AutonomousDashboardScreen(navController = navController)
        }
        composable("home") {
            HomeScreen(navController = navController)
        }
        composable("agents") {
            AgentsScreen(navController = navController)
        }
    }
}
