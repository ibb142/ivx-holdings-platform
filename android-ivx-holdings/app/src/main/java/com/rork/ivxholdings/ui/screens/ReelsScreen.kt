package com.rork.ivxholdings.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.media3.common.Player
import androidx.media3.ui.PlayerView
import coil3.compose.AsyncImage
import com.rork.ivxholdings.data.FeedSnapshot
import com.rork.ivxholdings.data.IVXReel
import com.rork.ivxholdings.media.ReelPlaybackCoordinator
import com.rork.ivxholdings.ui.feed.FeedViewModel

/** Full-screen feed with exactly one Media3 player and poster-only neighboring pages. */
@Composable
fun ReelsScreen(viewModel: FeedViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val reels = when (val snapshot = state) {
        is FeedSnapshot.Cached -> snapshot.reels
        is FeedSnapshot.Failed -> snapshot.previous
        is FeedSnapshot.Loading -> snapshot.previous
        FeedSnapshot.Empty -> emptyList()
    }
    if (reels.isEmpty()) {
        FeedPlaceholder(state = state, onRetry = viewModel::load)
        return
    }
    val pager = rememberPagerState(pageCount = { reels.size })
    val appContext = LocalContext.current.applicationContext
    val coordinator = remember(appContext) { ReelPlaybackCoordinator(appContext) }
    val lifecycleOwner = LocalLifecycleOwner.current
    var appActive by remember { mutableStateOf(lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }

    DisposableEffect(lifecycleOwner, coordinator) {
        val observer = LifecycleEventObserver { _, event ->
            appActive = event == Lifecycle.Event.ON_START || event == Lifecycle.Event.ON_RESUME
            if (event == Lifecycle.Event.ON_STOP || event == Lifecycle.Event.ON_PAUSE) coordinator.pause()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            coordinator.release()
        }
    }

    LaunchedEffect(pager.settledPage, appActive, reels) {
        reels.getOrNull(pager.settledPage)?.let { coordinator.activate(it, mayPlay = appActive) }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        VerticalPager(state = pager, modifier = Modifier.fillMaxSize(), beyondViewportPageCount = 1) { index ->
            ReelPage(reel = reels[index], isActive = index == pager.settledPage && appActive, coordinator = coordinator)
        }
        if (state is FeedSnapshot.Failed) {
            val failed = state as FeedSnapshot.Failed
            Text(
                text = "Showing saved reels. Refresh failed • ${failed.traceId}",
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 20.dp),
                color = Color.White,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun ReelPage(reel: IVXReel, isActive: Boolean, coordinator: ReelPlaybackCoordinator) {
    var failed by remember(reel.id) { mutableStateOf(false) }
    DisposableEffect(reel.id, coordinator.player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                if (coordinator.activeReelId == reel.id) failed = true
            }
        }
        coordinator.player.addListener(listener)
        onDispose { coordinator.player.removeListener(listener) }
    }
    Box(modifier = Modifier.fillMaxSize()) {
        AsyncImage(
            model = reel.posterUrl,
            contentDescription = reel.title,
            modifier = Modifier.fillMaxSize(),
        )
        if (isActive && !failed && reel.playbackUrl != null) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context -> PlayerView(context).apply { player = coordinator.player; useController = false } },
                update = { it.player = coordinator.player },
            )
        }
        if (failed || reel.playbackUrl == null) {
            Button(modifier = Modifier.align(Alignment.Center), onClick = { failed = false; coordinator.activate(reel, isActive) }) {
                Text(if (reel.playbackUrl == null) "Video unavailable" else "Retry video")
            }
        }
        Text(
            text = reel.title,
            modifier = Modifier.align(Alignment.BottomStart).padding(24.dp),
            color = Color.White,
            style = MaterialTheme.typography.titleLarge,
        )
    }
}

@Composable
private fun FeedPlaceholder(state: FeedSnapshot, onRetry: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().background(Color(0xFF08131D)), contentAlignment = Alignment.Center) {
        when (state) {
            is FeedSnapshot.Loading -> Text("Preparing your reels…", color = Color.White, style = MaterialTheme.typography.titleMedium)
            is FeedSnapshot.Failed -> Button(onClick = onRetry) { Text("Retry reels • ${state.traceId}") }
            else -> Text("No published reels yet", color = Color.White)
        }
    }
}
