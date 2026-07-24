package com.rork.ivxholdings.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import coil3.compose.AsyncImage
import com.rork.ivxholdings.data.FeedSnapshot
import com.rork.ivxholdings.data.IVXReel
import com.rork.ivxholdings.ui.feed.FeedViewModel

/** Cache-first home: stable cards appear immediately from disk and revalidate quietly. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(navController: NavController, viewModel: FeedViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val reels = when (val snapshot = state) {
        is FeedSnapshot.Cached -> snapshot.reels
        is FeedSnapshot.Failed -> snapshot.previous
        is FeedSnapshot.Loading -> snapshot.previous
        FeedSnapshot.Empty -> emptyList()
    }
    Scaffold(topBar = { TopAppBar(title = { Text("IVX Holdings") }) }) { padding ->
        when {
            reels.isNotEmpty() -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item { Text("Latest project reels", style = MaterialTheme.typography.headlineSmall) }
                if (state is FeedSnapshot.Failed) item { InlineRefreshFailure((state as FeedSnapshot.Failed).traceId, viewModel::load) }
                items(reels, key = { it.id }) { reel -> ReelCard(reel) { navController.navigate("reels") } }
            }
            state is FeedSnapshot.Failed -> FailureScreen((state as FeedSnapshot.Failed).traceId, viewModel::load, padding)
            else -> SkeletonFeed(padding)
        }
    }
}

@Composable
private fun ReelCard(reel: IVXReel, onOpen: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
        Column {
            AsyncImage(model = reel.posterUrl, contentDescription = reel.title, modifier = Modifier.fillMaxWidth().height(220.dp))
            Column(modifier = Modifier.padding(16.dp)) {
                Text(reel.title, style = MaterialTheme.typography.titleMedium)
                Text(if (reel.status in setOf("ready", "published", "")) "Ready to play" else "Processing", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun SkeletonFeed(padding: PaddingValues) {
    LazyColumn(modifier = Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(4) {
            Card(modifier = Modifier.fillMaxWidth().height(280.dp)) {
                Column(modifier = Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.SpaceBetween) {
                    Text("", modifier = Modifier.fillMaxWidth().height(168.dp))
                    Text("Loading project details", style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

@Composable
private fun InlineRefreshFailure(traceId: String, retry: () -> Unit) {
    Text("Saved content is shown. Refresh failed • $traceId", modifier = Modifier.clickable(onClick = retry), color = MaterialTheme.colorScheme.error)
}

@Composable
private fun FailureScreen(traceId: String, retry: () -> Unit, padding: PaddingValues) {
    Column(modifier = Modifier.fillMaxSize().padding(padding), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("Could not load projects", style = MaterialTheme.typography.titleLarge)
        Text("Trace: $traceId")
        Text("Retry", modifier = Modifier.padding(16.dp).clickable(onClick = retry), color = MaterialTheme.colorScheme.primary)
    }
}
