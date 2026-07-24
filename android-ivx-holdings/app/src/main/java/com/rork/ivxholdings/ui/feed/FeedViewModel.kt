package com.rork.ivxholdings.ui.feed

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.rork.ivxholdings.data.FeedSnapshot
import com.rork.ivxholdings.data.IVXFeedRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

/** One owner for feed state: disk cache first, then cancellable network refresh. */
class FeedViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = IVXFeedRepository(application.applicationContext)
    private val _state = MutableStateFlow<FeedSnapshot>(FeedSnapshot.Empty)
    val state: StateFlow<FeedSnapshot> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        val cached = repository.readCachedReels()
        _state.value = if (cached.isEmpty()) FeedSnapshot.Loading(emptyList()) else FeedSnapshot.Cached(cached, isRefreshing = true)
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { repository.refreshReels() }
            result.fold(
                onSuccess = { reels -> _state.value = FeedSnapshot.Cached(reels, isRefreshing = false) },
                onFailure = { error ->
                    _state.value = FeedSnapshot.Failed(
                        previous = cached,
                        message = error.message ?: "Could not refresh the feed.",
                        traceId = "feed-${UUID.randomUUID().toString().take(8)}",
                    )
                },
            )
        }
    }
}
