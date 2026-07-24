package com.rork.ivxholdings.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.rork.ivxholdings.ui.screens.HomeScreen
import com.rork.ivxholdings.ui.screens.ReelsScreen
import com.rork.ivxholdings.ui.screens.UploadScreen

@Composable
fun AppNavigation() {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = "home"
    ) {
        composable("home") { HomeScreen(navController = navController) }
        composable("reels") { ReelsScreen() }
        composable("upload") { UploadScreen() }
    }
}
