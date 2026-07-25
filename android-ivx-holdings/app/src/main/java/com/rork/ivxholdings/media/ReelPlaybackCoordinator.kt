package com.ivxholdings.app.media

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.ivxholdings.app.data.IVXReel

/**
 * The single process-local Reel player. It deliberately never creates one player
 * per feed item: moving the active reel swaps the media item on this instance.
 */
class ReelPlaybackCoordinator(context: Context) {
    val player: ExoPlayer = ExoPlayer.Builder(context.applicationContext).build().apply {
        repeatMode = Player.REPEAT_MODE_ONE
        playWhenReady = false
        addListener(object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                activeReelId?.let { MediaDiagnostics.playbackFailed(it, error) }
            }
        })
    }

    var activeReelId: String? = null
        private set

    fun activate(reel: IVXReel, mayPlay: Boolean) {
        val source = reel.playbackUrl ?: run {
            pause()
            return
        }
        if (activeReelId != reel.id || player.currentMediaItem?.localConfiguration?.uri.toString() != source) {
            player.stop()
            player.clearMediaItems()
            player.setMediaItem(MediaItem.Builder().setMediaId(reel.id).setUri(source).build())
            player.prepare()
            activeReelId = reel.id
        }
        player.playWhenReady = mayPlay && reel.status in setOf("ready", "published", "")
        MediaDiagnostics.playing(if (player.playWhenReady) reel.id else null)
    }

    fun pause() {
        player.playWhenReady = false
        player.pause()
        MediaDiagnostics.stopped()
    }

    fun release() {
        activeReelId = null
        MediaDiagnostics.stopped()
        player.release()
    }
}
