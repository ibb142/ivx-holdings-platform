package com.ivxholdings.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class VoiceChatRequest(
    val audioBase64: String? = null,
    val audioUrl: String? = null,
    val mimeType: String = "audio/wav",
    val language: String = "en",
    val voice: String = "coral",
    val model: String = "openai/gpt-4o"
)

@Serializable
data class VoiceChatResponse(
    val ok: Boolean = false,
    val transcript: String = "",
    val response: String = "",
    val audioBase64: String? = null,
    val audioFormat: String = "mp3",
    val durationMs: Long = 0,
    val marker: String = "",
    val error: String? = null
)

@Serializable
data class TTSRequest(
    val text: String,
    val voice: String = "coral",
    val model: String = "openai/gpt-4o"
)

@Serializable
data class TTSResponse(
    val ok: Boolean = false,
    val audioBase64: String? = null,
    val audioFormat: String = "mp3",
    val durationMs: Long = 0,
    val marker: String = "",
    val error: String? = null
)

@Serializable
data class SMSRequest(
    val to: String,
    val body: String
)

@Serializable
data class SMSResponse(
    val ok: Boolean = false,
    val sid: String = "",
    val status: String = "",
    val to: String = "",
    val from: String = "",
    val body: String = "",
    val marker: String = "",
    val error: String? = null
)

@Serializable
data class VoiceCallRequest(
    val to: String,
    val message: String? = null
)

@Serializable
data class VoiceCallResponse(
    val ok: Boolean = false,
    val sid: String = "",
    val status: String = "",
    val to: String = "",
    val from: String = "",
    val marker: String = "",
    val error: String? = null
)
