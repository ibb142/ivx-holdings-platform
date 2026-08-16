package com.ivxholdings.app.data.remote

import com.ivxholdings.app.data.model.AgentsResponse
import com.ivxholdings.app.data.model.AnalyticsResponse
import com.ivxholdings.app.data.model.BuyersResponse
import com.ivxholdings.app.data.model.DealsResponse
import com.ivxholdings.app.data.model.FeedResponse
import com.ivxholdings.app.data.model.HealthResponse
import com.ivxholdings.app.data.model.InvestorsResponse
import com.ivxholdings.app.data.model.InventoryResponse
import com.ivxholdings.app.data.model.MemberLoginRequest
import com.ivxholdings.app.data.model.MemberLoginResponse
import com.ivxholdings.app.data.model.MembersResponse
import com.ivxholdings.app.data.model.OwnerAIRequestBody
import com.ivxholdings.app.data.model.OwnerAIRequestResponse
import com.ivxholdings.app.data.model.OwnerAIStatusResponse
import com.ivxholdings.app.data.model.PasswordlessLoginRequest
import com.ivxholdings.app.data.model.PasswordlessLoginResponse
import com.ivxholdings.app.data.model.PropertiesResponse
import com.ivxholdings.app.data.model.ReelsResponse
import com.ivxholdings.app.data.model.RevenueResponse
import com.ivxholdings.app.data.model.VercelExitDashboard
import com.ivxholdings.app.data.model.VersionResponse
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

class IVXApiService {

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

    private var authToken: String? = null

    fun setAuthToken(token: String?) {
        authToken = token
    }

    fun clearAuthToken() {
        authToken = null
    }

    suspend fun passwordlessLogin(email: String): Result<PasswordlessLoginResponse> = safeCall {
        client.post(AppConfig.OWNER_PASSWORDLESS_LOGIN_PATH) {
            setBody(PasswordlessLoginRequest(email))
        }.body()
    }

    suspend fun memberLogin(email: String, password: String): Result<MemberLoginResponse> = safeCall {
        client.post("/api/ivx/member-login") {
            setBody(MemberLoginRequest(email, password))
        }.body()
    }

    suspend fun fetchDashboard(): Result<VercelExitDashboard> = authorizedCall {
        client.get(AppConfig.VERCEL_EXIT_DASHBOARD_PATH) {
            authHeader()
        }.body()
    }

    suspend fun fetchAgents(): Result<AgentsResponse> = authorizedCall {
        client.get(AppConfig.VERCEL_EXIT_AGENTS_PATH) {
            authHeader()
        }.body()
    }

    suspend fun fetchInventory(): Result<InventoryResponse> = authorizedCall {
        client.get(AppConfig.VERCEL_EXIT_INVENTORY_PATH) {
            authHeader()
        }.body()
    }

    suspend fun requestOwnerAI(message: String): Result<OwnerAIRequestResponse> = authorizedCall {
        client.post(AppConfig.OWNER_AI_REQUEST_PATH) {
            authHeader()
            setBody(OwnerAIRequestBody(message = message))
        }.body()
    }

    suspend fun fetchOwnerAIStatus(traceId: String): Result<OwnerAIStatusResponse> = authorizedCall {
        client.get("${AppConfig.OWNER_AI_REQUEST_PATH}/$traceId/status") {
            authHeader()
        }.body()
    }

    suspend fun fetchFeed(): Result<FeedResponse> = safeCall {
        client.get(AppConfig.FEED_PATH).body()
    }

    suspend fun fetchProperties(): Result<PropertiesResponse> = safeCall {
        client.get(AppConfig.PROPERTIES_PATH).body()
    }

    suspend fun fetchDeals(): Result<DealsResponse> = safeCall {
        client.get(AppConfig.DEALS_PATH).body()
    }

    suspend fun fetchReels(): Result<ReelsResponse> = safeCall {
        client.get(AppConfig.REELS_PATH).body()
    }

    suspend fun fetchInvestors(): Result<InvestorsResponse> = authorizedCall {
        client.get(AppConfig.INVESTORS_PATH) {
            authHeader()
        }.body()
    }

    suspend fun fetchBuyers(): Result<BuyersResponse> = authorizedCall {
        client.get(AppConfig.BUYERS_PATH) {
            authHeader()
        }.body()
    }

    suspend fun fetchRevenue(): Result<RevenueResponse> = authorizedCall {
        client.get(AppConfig.REVENUE_PATH) {
            authHeader()
        }.body()
    }

    suspend fun fetchAnalytics(): Result<AnalyticsResponse> = authorizedCall {
        client.get(AppConfig.ANALYTICS_PATH) {
            authHeader()
        }.body()
    }

    suspend fun fetchMembers(): Result<MembersResponse> = authorizedCall {
        client.get(AppConfig.MEMBERS_PATH) {
            authHeader()
        }.body()
    }

    suspend fun fetchHealth(): Result<HealthResponse> = safeCall {
        client.get(AppConfig.HEALTH_PATH).body()
    }

    suspend fun fetchVersion(): Result<VersionResponse> = safeCall {
        client.get(AppConfig.VERSION_PATH).body()
    }

    private fun io.ktor.client.request.HttpRequestBuilder.authHeader() {
        authToken?.let { header("Authorization", "Bearer $it") }
    }

    private suspend inline fun <reified T> authorizedCall(call: suspend () -> T): Result<T> {
        if (authToken == null) return Result.failure(UnauthorizedException("No session token. Please log in."))
        return safeCall(call)
    }

    private suspend inline fun <reified T> safeCall(call: suspend () -> T): Result<T> {
        return try {
            Result.success(call())
        } catch (e: ClientRequestException) {
            val body = try { e.response.bodyAsText() } catch (_: Exception) { "" }
            Result.failure(ApiException(e.response.status.value, body, e))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    class UnauthorizedException(message: String) : Exception(message)
    class ApiException(val statusCode: Int, val body: String, cause: Throwable) : Exception("HTTP $statusCode: $body", cause)
}
