package com.ivxholdings.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import com.ivxholdings.app.data.model.Reel
import com.ivxholdings.app.ui.components.ListScreen
import com.ivxholdings.app.ui.theme.IVXGold
import com.ivxholdings.app.ui.theme.IVXOnSurface
import com.ivxholdings.app.ui.theme.IVXOnSurfaceMuted
import com.ivxholdings.app.ui.theme.IVXSurfaceVariant
import com.ivxholdings.app.ui.viewmodel.ReelsViewModel
import org.koin.androidx.compose.koinViewModel

@Composable
fun ReelsScreen(navController: NavController) {
    val viewModel: ReelsViewModel = koinViewModel()
    val state by viewModel.state.collectAsState()

    ListScreen(
        title = "Reels",
        navController = navController,
        state = state,
        onRefresh = { viewModel.load() },
        emptyText = "No reels available yet."
    ) { reel ->
        ReelCard(reel)
    }

    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.load() }
}

@Composable
private fun ReelCard(reel: Reel) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = IVXSurfaceVariant),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(160.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(IVXOnSurfaceMuted.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.PlayCircle,
                    contentDescription = "Play",
                    tint = IVXGold,
                    modifier = Modifier.size(48.dp)
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                reel.title,
                fontWeight = FontWeight.SemiBold,
                color = IVXOnSurface,
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                "${reel.creatorName} · ${reel.views} views · ${reel.likes} likes · ${reel.durationSeconds}s",
                color = IVXOnSurfaceMuted,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}
