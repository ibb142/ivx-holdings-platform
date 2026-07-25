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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.ivxholdings.app.data.model.AgentState
import com.ivxholdings.app.ui.components.IVXScreenShell
import com.ivxholdings.app.ui.theme.IVXBlue
import com.ivxholdings.app.ui.theme.IVXDark
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXGreen
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXRed
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.AIEngineeringViewModel
import com.ivxholdings.app.ui.viewmodel.ListUiState
import org.koin.androidx.compose.koinViewModel

@Composable
fun AIEngineeringScreen(navController: NavController) {
    val viewModel: AIEngineeringViewModel = koinViewModel()
    val state by viewModel.state.collectAsState()

    IVXScreenShell(title = "AI Engineering Command Center", navController = navController, onRefresh = { viewModel.load() }) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(IVXDark),
            contentAlignment = Alignment.Center
        ) {
            when (state) {
                is ListUiState.Loading -> CircularProgressIndicator(color = IVXGold)
                is ListUiState.Error -> {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text((state as ListUiState.Error).message, color = IVXOnSurfaceMuted)
                    }
                }
                is ListUiState.Success -> {
                    val agents = (state as ListUiState.Success<AgentState>).items
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
                                Text("9 AI Developer Agents", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                                Spacer(modifier = Modifier.height(8.dp))
                                Text("Live work on Vercel exit, backend replacement, and platform engineering.", color = IVXOnSurfaceMuted)
                            }
                        }
                        items(agents.size) { index ->
                            AgentCard(agents[index])
                        }
                    }
                }
            }
        }
    }

    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.load() }
}

@Composable
private fun AgentCard(agent: AgentState) {
    val statusColor = when (agent.status.lowercase()) {
        "active", "working" -> IVXGreen
        "blocked" -> IVXRed
        "completed" -> IVXGold
        else -> IVXBlue
    }
    Card(
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
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(statusColor.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = if (agent.status == "blocked") Icons.Default.Warning else Icons.Default.CheckCircle,
                    contentDescription = agent.status,
                    tint = statusColor,
                    modifier = Modifier.size(24.dp)
                )
            }
            Spacer(modifier = Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "${agent.agentNumber}. ${agent.agentName}",
                    fontWeight = FontWeight.SemiBold,
                    color = IVXOnSurface,
                    style = MaterialTheme.typography.titleMedium
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(agent.role, color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodySmall)
                Spacer(modifier = Modifier.height(4.dp))
                Text(agent.currentTask, color = IVXGold, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(4.dp))
                Text("Progress: ${(agent.progress * 100).toInt()}% · ${agent.status}", color = IVXOnSurfaceMuted, style = MaterialTheme.typography.bodySmall)
                if (!agent.currentBlocker.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("Blocker: ${agent.currentBlocker}", color = IVXRed, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
