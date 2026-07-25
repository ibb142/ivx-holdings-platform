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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.ivxholdings.app.data.model.UserProfile
import com.ivxholdings.app.ui.navigation.Screen
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXGreen
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.AuthViewModel
import com.ivxholdings.app.ui.viewmodel.ProfileUiState
import com.ivxholdings.app.ui.viewmodel.ProfileViewModel
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(navController: NavController) {
    val authViewModel: AuthViewModel = koinViewModel()
    val profileViewModel: ProfileViewModel = koinViewModel()
    val state by profileViewModel.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Profile", color = IVXOnSurface) },
                actions = {
                    IconButton(onClick = { authViewModel.logout() }) {
                        Icon(Icons.Default.ExitToApp, contentDescription = "Logout", tint = IVXRed)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = IVXDark,
                    titleContentColor = IVXOnSurface
                )
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(IVXDark),
            contentAlignment = Alignment.Center
        ) {
            when (state) {
                is ProfileUiState.Loading -> CircularProgressIndicator(color = IVXGold)
                is ProfileUiState.Error -> Text((state as ProfileUiState.Error).message, color = IVXOnSurfaceMuted)
                is ProfileUiState.Success -> {
                    val profile = (state as ProfileUiState.Success).profile
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        item { ProfileHeader(profile) }
                        item {
                            Text("Account", fontWeight = FontWeight.Bold, color = IVXOnSurface, style = MaterialTheme.typography.titleMedium)
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                        item { ProfileMenuItem("Settings", "Notifications, appearance, security", IVXBlue) { navController.navigate(Screen.Settings.route) } }
                        if (profile.isOwner) {
                            item {
                                Text("Owner Console", fontWeight = FontWeight.Bold, color = IVXOnSurface, style = MaterialTheme.typography.titleMedium)
                                Spacer(modifier = Modifier.height(8.dp))
                            }
                            item { ProfileMenuItem("Owner Dashboard", "Members, investors, buyers, revenue", IVXGold) { navController.navigate(Screen.OwnerDashboard.route) } }
                            item { ProfileMenuItem("Members", "Registered platform members", IVXGreen) { navController.navigate(Screen.Members.route) } }
                            item { ProfileMenuItem("Investors", "Investor CRM and capital", IVXGreen) { navController.navigate(Screen.Investors.route) } }
                            item { ProfileMenuItem("Buyers", "Buyer prospects and matching", IVXGreen) { navController.navigate(Screen.Buyers.route) } }
                            item { ProfileMenuItem("Revenue", "Treasury and distributions", IVXGold) { navController.navigate(Screen.Revenue.route) } }
                            item { ProfileMenuItem("Analytics", "Platform metrics and growth", IVXBlue) { navController.navigate(Screen.Analytics.route) } }
                            item { ProfileMenuItem("AI Engineering", "9 AI agents and live work", IVXBlue) { navController.navigate(Screen.AIEngineering.route) } }
                            item { ProfileMenuItem("Vercel Exit", "Migration command center", IVXRed) { navController.navigate(Screen.VercelExit.route) } }
                            item { ProfileMenuItem("IVX Owner AI", "Chat with the orchestrator", IVXGreen) { navController.navigate(Screen.Chat.route) } }
                        }
                        item {
                            Spacer(modifier = Modifier.height(8.dp))
                            Button(
                                onClick = { authViewModel.logout() },
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(containerColor = IVXRed)
                            ) {
                                Text("Logout")
                            }
                        }
                    }
                }
            }
        }
    }

    androidx.compose.runtime.LaunchedEffect(Unit) { profileViewModel.load() }
}

@Composable
private fun ProfileHeader(profile: UserProfile) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(IVXSurfaceVariant)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(IVXGold),
            contentAlignment = Alignment.Center
        ) {
            Text(
                "${profile.firstName.firstOrNull() ?: 'I'}${profile.lastName.firstOrNull() ?: 'V'}",
                color = IVXDark,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.headlineSmall
            )
        }
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            "${profile.firstName} ${profile.lastName}".ifBlank { "IVX Owner" },
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.titleLarge
        )
        Text(profile.email, color = IVXOnSurfaceMuted)
        Spacer(modifier = Modifier.height(8.dp))
        Text("Role: ${if (profile.isOwner) "Owner" else profile.role}", color = IVXGold, fontWeight = FontWeight.SemiBold)
        Spacer(modifier = Modifier.height(12.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            StatText("Wallet", "$${String.format("%,.0f", profile.walletBalance)}")
            StatText("Invested", "$${String.format("%,.0f", profile.totalInvested)}")
            StatText("Returns", "$${String.format("%,.0f", profile.totalReturns)}")
        }
    }
}

@Composable
private fun StatText(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = IVXGold, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
        Text(label, color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun ProfileMenuItem(title: String, subtitle: String, color: androidx.compose.ui.graphics.Color, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
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
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, color = IVXOnSurface)
                Text(subtitle, color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodySmall)
            }
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = "Open",
                tint = color
            )
        }
    }
}
