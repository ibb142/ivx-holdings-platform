package com.rork.ivxholdings.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/** Network and disk-cache contract for the canonical IVX reel feed. */
data class IVXReel(
    val id: String,
    val title: String,
    val playbackUrl: String?,
    val posterUrl: String?,
    val status: String,
    val durationSeconds: Int,
)

sealed interface FeedSnapshot {
    data object Empty : FeedSnapshot
    data class Cached(val reels: List<IVXReel>, val isRefreshing: Boolean) : FeedSnapshot
    data class Loading(val previous: List<IVXReel>) : FeedSnapshot
    data class Failed(val previous: List<IVXReel>, val message: String, val traceId: String) : FeedSnapshot
}

class IVXFeedRepository(context: Context) {
    private val preferences = context.getSharedPreferences("ivx_feed_cache", Context.MODE_PRIVATE)
    private val apiBaseUrl = "https://api.ivxholding.com"

    fun readCachedReels(): List<IVXReel> = decode(preferences.getString(CACHE_KEY, null))

    fun refreshReels(): Result<List<IVXReel>> = runCatching {
        val connection = (URL("$apiBaseUrl/api/ivx/video-platform/feed?limit=12&type=reel").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 12_000
            readTimeout = 12_000
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (connection.responseCode !in 200..299) error("Feed request failed (${connection.responseCode})")
            val body = BufferedReader(InputStreamReader(connection.inputStream)).use { it.readText() }
            val reels = decode(body)
            preferences.edit().putString(CACHE_KEY, body).apply()
            reels
        } finally {
            connection.disconnect()
        }
    }

    private fun decode(raw: String?): List<IVXReel> = runCatching {
        val videos = JSONObject(raw.orEmpty()).optJSONArray("videos") ?: JSONArray()
        buildList {
            for (index in 0 until videos.length()) {
                val item = videos.optJSONObject(index) ?: continue
                val id = item.optString("id").trim()
                if (id.isBlank()) continue
                val status = item.optString("playback_status", item.optString("status", "")).lowercase()
                val hls = item.optString("hls_url").takeIf { it.isNotBlank() }
                val progressive = item.optString("video_url").takeIf { it.isNotBlank() }
                add(
                    IVXReel(
                        id = id,
                        title = item.optString("title", "Untitled reel"),
                        playbackUrl = hls ?: progressive,
                        posterUrl = item.optString("poster_url").takeIf { it.isNotBlank() }
                            ?: item.optString("thumbnail_url").takeIf { it.isNotBlank() },
                        status = status,
                        durationSeconds = item.optInt("duration_sec", 0),
                    ),
                )
            }
        }.distinctBy { it.id }
    }.getOrDefault(emptyList())

    private companion object {
        const val CACHE_KEY = "reels_v1"
    }
}
