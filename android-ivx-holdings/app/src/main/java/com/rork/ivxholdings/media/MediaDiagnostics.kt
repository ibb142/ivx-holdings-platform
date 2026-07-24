package com.rork.ivxholdings.media

import androidx.media3.common.PlaybackException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

data class MediaDiagnosticSnapshot(
    val activePlayers: Int = 0,
    val activeReelId: String? = null,
    val failedReels: Int = 0,
    val lastTraceId: String? = null,
    val lastError: String? = null,
)

/** Process-local, PII-free diagnostic feed for the media surface. */
object MediaDiagnostics {
    private val mutableState = MutableStateFlow(MediaDiagnosticSnapshot())
    val state: StateFlow<MediaDiagnosticSnapshot> = mutableState.asStateFlow()

    fun playing(reelId: String?) { mutableState.value = mutableState.value.copy(activePlayers = if (reelId == null) 0 else 1, activeReelId = reelId) }
    fun stopped() { mutableState.value = mutableState.value.copy(activePlayers = 0, activeReelId = null) }
    fun playbackFailed(reelId: String, error: PlaybackException) {
        val trace = "media-${UUID.randomUUID().toString().take(8)}"
        mutableState.value = mutableState.value.copy(failedReels = mutableState.value.failedReels + 1, lastTraceId = trace, lastError = "${error.errorCodeName} for $reelId")
    }
}
