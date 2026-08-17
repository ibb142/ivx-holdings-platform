package com.ivxholdings.app.data.remote

import com.ivxholdings.app.data.model.SMSRequest
import com.ivxholdings.app.data.model.SMSResponse
import com.ivxholdings.app.data.model.TTSRequest
import com.ivxholdings.app.data.model.TTSResponse
import com.ivxholdings.app.data.model.VoiceCallRequest
import com.ivxholdings.app.data.model.VoiceCallResponse
import com.ivxholdings.app.data.model.VoiceChatRequest
import com.ivxholdings.app.data.model.VoiceChatResponse
import com.ivxholdings.app.util.AppConfig
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.ClientRequestException
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.plugins.logging.ANDROID
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logger
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

class IAApiService {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private var authToken: String? = null

    fun setAuthToken(token: String?) {
        authToken = token
    }

    private val client = HttpClient(Android) {
        install(ContentNegotiation) { json(json) }
        install(Logging) {
            logger = Logger.ANDROID
            level = LogLevel.INFO
        }
        defaultRequest {
            url(AppConfig.API_BASE_URL)
            contentType(ContentType.Application.Json)
        }
        expectSuccess = false
    }

    suspend fun voiceChat(audioBase64: String, mimeType: String = "audio/wav"): Result<VoiceChatResponse> = safeCall {
        client.post("/api/ivx/voice-chat") {
            authHeader()
            setBody(VoiceChatRequest(audioBase64 = audioBase64, mimeType = mimeType))
        }.body()
    }

    suspend fun textToSpeech(text: String, voice: String = "coral"): Result<TTSResponse> = safeCall {
        client.post("/api/ivx/tts") {
            authHeader()
            setBody(TTSRequest(text = text, voice = voice))
        }.body()
    }

    suspend fun sendSMS(to: String, body: String): Result<SMSResponse> = safeCall {
        client.post("/api/ivx/signalwire/sms") {
            authHeader()
            setBody(SMSRequest(to = to, body = body))
        }.body()
    }

    suspend fun makeVoiceCall(to: String, message: String? = null): Result<VoiceCallResponse> = safeCall {
        client.post("/api/ivx/signalwire/voice") {
            authHeader()
            setBody(VoiceCallRequest(to = to, message = message))
        }.body()
    }

    suspend fun fetchBrainStatus(): Result<String> = safeCall {
        val resp = client.get("/api/ivx/signalwire/voice/brain") {
            authHeader()
        }
        resp.bodyAsText()
    }

    private fun io.ktor.client.request.HttpRequestBuilder.authHeader() {
        authToken?.let { header("Authorization", "Bearer $it") }
    }

    private suspend inline fun <reified T> safeCall(call: suspend () -> T): Result<T> {
        return try {
            Result.success(call())
        } catch (e: ClientRequestException) {
            val body = try { e.response.bodyAsText() } catch (_: Exception) { "" }
            Result.failure(IVXApiService.ApiException(e.response.status.value, body, e))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
