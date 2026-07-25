package com.ivxholdings.app.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.ivxholdings.app.data.model.Investor
import com.ivxholdings.app.ui.components.ListScreen
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.InvestorsViewModel
import org.koin.androidx.compose.koinViewModel

@Composable
fun InvestorsScreen(navController: NavController) {
    val viewModel: InvestorsViewModel = koinViewModel()
    val state by viewModel.state.collectAsState()

    ListScreen(
        title = "Investors",
        navController = navController,
        state = state,
        onRefresh = { viewModel.load() },
        emptyText = "No investors found."
    ) { investor ->
        InvestorCard(investor)
    }

    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.load() }
}

@Composable
private fun InvestorCard(investor: Investor) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                investor.name,
                fontWeight = FontWeight.SemiBold,
                color = IVXOnSurface,
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(investor.email, color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodySmall)
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                "Invested: $${String.format("%,.0f", investor.invested)} · Returns: $${String.format("%,.0f", investor.returns)}",
                color = IVXGold,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                "Status: ${investor.status} · Tier: ${investor.tier} · Joined: ${investor.joinDate ?: "N/A"}",
                color = IVXOnSurfaceMuted,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}
