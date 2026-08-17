package com.ivxholdings.app.data.remote

import com.ivxholdings.app.data.model.CertResultResponse
import com.ivxholdings.app.data.model.ExecutorStatusResponse
import com.ivxholdings.app.data.model.HealthCheckResponse
import com.ivxholdings.app.data.model.IAAgentsResponse
import com.ivxholdings.app.data.model.PipelineStatusResponse
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
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

class AutonomousApiService {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
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

    suspend fun fetch112Agents(): Result<IAAgentsResponse> = safeCall {
        client.get("/api/ivx/agents").body()
    }

    suspend fun fetchExecutorStatus(): Result<ExecutorStatusResponse> = safeCall {
        client.get("/api/ivx/agent-code-executor/status").body()
    }

    suspend fun fetchPipelineStatus(): Result<PipelineStatusResponse> = safeCall {
        client.get("/api/ivx/app-creation-pipeline/status").body()
    }

    suspend fun fetchHealth(): Result<HealthCheckResponse> = safeCall {
        client.get("/health").body()
    }

    suspend fun trigger112Cert(skipDeploy: Boolean = true): Result<CertResultResponse> = safeCall {
        val requestBody = if (skipDeploy) """{"skipDeploy":true}""" else "{}"
        val response = client.post("/api/ivx/agent-code-executor/112-cert") {
            setBody(requestBody)
        }
        json.decodeFromString(response.bodyAsText())
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
