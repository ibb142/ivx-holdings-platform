package com.ivxholdings.app.data.repository

import com.ivxholdings.app.data.model.AgentState
import com.ivxholdings.app.data.model.AnalyticsResponse
import com.ivxholdings.app.data.model.Buyer
import com.ivxholdings.app.data.model.BuyersResponse
import com.ivxholdings.app.data.model.Deal
import com.ivxholdings.app.data.model.DealsResponse
import com.ivxholdings.app.data.model.FeedItem
import com.ivxholdings.app.data.model.FeedResponse
import com.ivxholdings.app.data.model.HealthResponse
import com.ivxholdings.app.data.model.Investor
import com.ivxholdings.app.data.model.InvestorsResponse
import com.ivxholdings.app.data.model.InventoryResponse
import com.ivxholdings.app.data.model.Member
import com.ivxholdings.app.data.model.MemberLoginResponse
import com.ivxholdings.app.data.model.MembersResponse
import com.ivxholdings.app.data.model.OwnerAIRequestResponse
import com.ivxholdings.app.data.model.PasswordlessLoginResponse
import com.ivxholdings.app.data.model.Property
import com.ivxholdings.app.data.model.PropertiesResponse
import com.ivxholdings.app.data.model.Reel
import com.ivxholdings.app.data.model.ReelsResponse
import com.ivxholdings.app.data.model.RevenueResponse
import com.ivxholdings.app.data.model.UserProfile
import com.ivxholdings.app.data.model.VercelDependency
import com.ivxholdings.app.data.model.VercelExitDashboard
import com.ivxholdings.app.data.remote.IVXApiService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class IVXRepository(private val apiService: IVXApiService) {

    fun setAuthToken(token: String?) = apiService.setAuthToken(token)

    suspend fun ownerLogin(email: String) = withContext(Dispatchers.IO) {
        apiService.passwordlessLogin(email).onSuccess { response ->
            response.accessToken?.let { apiService.setAuthToken(it) }
        }
    }

    suspend fun memberLogin(email: String, password: String): Result<MemberLoginResponse> = withContext(Dispatchers.IO) {
        apiService.memberLogin(email, password).onSuccess { response ->
            response.accessToken?.let { apiService.setAuthToken(it) }
        }
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        apiService.clearAuthToken()
    }

    suspend fun fetchDashboard(): Result<VercelExitDashboard> = withContext(Dispatchers.IO) {
        apiService.fetchDashboard()
    }

    suspend fun fetchAgents(): Result<List<AgentState>> = withContext(Dispatchers.IO) {
        apiService.fetchAgents().map { it.agents }
    }

    suspend fun fetchInventory(): Result<InventoryResponse> = withContext(Dispatchers.IO) {
        apiService.fetchInventory()
    }

    suspend fun sendOwnerMessage(message: String): Result<String> = withContext(Dispatchers.IO) {
        apiService.requestOwnerAI(message).map { response ->
            if (response.status == "completed" && response.result != null) {
                response.result.answer ?: "No answer returned."
            } else {
                "Request accepted (traceId: ${response.traceId}). Polling for result..."
            }
        }
    }

    suspend fun fetchFeed(): Result<List<FeedItem>> = withContext(Dispatchers.IO) {
        apiService.fetchFeed().map { it.items }
    }

    suspend fun fetchProperties(): Result<List<Property>> = withContext(Dispatchers.IO) {
        apiService.fetchProperties().map { it.properties }
    }

    suspend fun fetchDeals(): Result<List<Deal>> = withContext(Dispatchers.IO) {
        apiService.fetchDeals().map { it.deals }
    }

    suspend fun fetchReels(): Result<List<Reel>> = withContext(Dispatchers.IO) {
        apiService.fetchReels().map { it.videos }
    }

    suspend fun fetchInvestors(): Result<List<Investor>> = withContext(Dispatchers.IO) {
        apiService.fetchInvestors().map { it.investors }
    }

    suspend fun fetchBuyers(): Result<List<Buyer>> = withContext(Dispatchers.IO) {
        apiService.fetchBuyers().map { it.buyers }
    }

    suspend fun fetchRevenue(): Result<RevenueResponse> = withContext(Dispatchers.IO) {
        apiService.fetchRevenue()
    }

    suspend fun fetchAnalytics(): Result<AnalyticsResponse> = withContext(Dispatchers.IO) {
        apiService.fetchAnalytics()
    }

    suspend fun fetchMembers(): Result<List<Member>> = withContext(Dispatchers.IO) {
        apiService.fetchMembers().map { it.members }
    }

    suspend fun fetchHealth(): Result<HealthResponse> = withContext(Dispatchers.IO) {
        apiService.fetchHealth()
    }

    suspend fun fetchVersion(): Result<String> = withContext(Dispatchers.IO) {
        apiService.fetchVersion().map { it.commitShort }
    }

    fun getCurrentUser(): UserProfile {
        return UserProfile(
            id = "local",
            email = "owner@ivxholding.com",
            role = "owner",
            isOwner = true
        )
    }
}
