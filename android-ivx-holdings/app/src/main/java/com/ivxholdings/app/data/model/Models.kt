package com.ivxholdings.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class PasswordlessLoginRequest(val email: String)

@Serializable
data class PasswordlessLoginResponse(
    val success: Boolean,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val expiresAt: Long? = null,
    val userId: String? = null,
    val email: String? = null,
    val message: String? = null,
    val rootCause: String? = null
)

@Serializable
data class MemberLoginRequest(val email: String, val password: String)

@Serializable
data class MemberLoginResponse(
    val success: Boolean,
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val userId: String? = null,
    val email: String? = null,
    val role: String? = null,
    val message: String? = null
)

@Serializable
data class OwnerAIRequestBody(
    val message: String,
    val conversationId: String? = null,
    val messageId: String? = null,
    val senderLabel: String = "owner-android"
)

@Serializable
data class OwnerAIRequestResponse(
    val traceId: String,
    val requestId: String,
    val status: String,
    val idempotencyKey: String,
    val duplicate: Boolean,
    val message: String,
    val result: OwnerAIResult? = null
)

@Serializable
data class OwnerAIResult(
    val answer: String? = null,
    val error: String? = null,
    val httpStatus: Int? = null
)

@Serializable
data class OwnerAIStatusResponse(
    val traceId: String,
    val requestId: String,
    val status: String,
    val idempotencyKey: String,
    val retryCount: Int,
    val terminalResult: OwnerAIResult? = null,
    val structuredError: StructuredError? = null
)

@Serializable
data class StructuredError(
    val code: String,
    val message: String,
    val checkpoint: String? = null
)

@Serializable
data class VercelExitDashboard(
    val migrationStatus: String,
    val dependenciesDiscovered: Int,
    val dependenciesRemoved: Int,
    val dependenciesRemaining: Int,
    val overallCompletion: Double,
    val currentPhase: String,
    val vercelTraffic: String,
    val ivxTraffic: String,
    val costBefore: String,
    val costAfter: String,
    val monthlySavings: String,
    val annualSavings: String,
    val ownerControls: OwnerControls? = null
)

@Serializable
data class OwnerControls(
    val migrationPaused: Boolean,
    val deploymentsFrozen: Boolean,
    val cutoverApproved: Boolean,
    val rollbackTriggered: Boolean,
    val lastOwnerAction: String,
    val lastOwnerActionTime: String
)

@Serializable
data class AgentState(
    val agentNumber: Int,
    val agentName: String,
    val role: String,
    val currentTask: String,
    val status: String,
    val progress: Double,
    val filesReserved: List<String> = emptyList(),
    val filesChanged: List<String> = emptyList(),
    val testsExecuted: Int = 0,
    val testResult: String = "pending",
    val lastCommitSha: String? = null,
    val pullRequest: String? = null,
    val productionVerification: Boolean = false,
    val currentBlocker: String? = null,
    val nextAction: String = "",
    val timeWorking: String = "",
    val tasksCompletedToday: Int = 0,
    val tasksFailedToday: Int = 0
)

@Serializable
data class AgentsResponse(
    val agents: List<AgentState>,
    val activeAgents: Int,
    val blockedAgents: Int,
    val completedAgents: Int
)

@Serializable
data class VercelDependency(
    val dependencyId: String,
    val vercelService: String,
    val dependencyType: String,
    val sourceFile: String,
    val lineReference: String,
    val runtimeEnvironment: String,
    val currentPurpose: String,
    val replacementService: String,
    val assignedAI: Int,
    val risk: String,
    val migrationStatus: String,
    val testStatus: String
)

@Serializable
data class InventoryResponse(
    val dependencies: List<VercelDependency>,
    val totalCount: Int,
    val criticalCount: Int,
    val highCount: Int,
    val mediumCount: Int,
    val lowCount: Int
)

@Serializable
data class HealthResponse(
    val status: String,
    val commitShort: String,
    val commitSha: String? = null,
    val routes: List<String> = emptyList()
)

@Serializable
data class VersionResponse(
    val commitShort: String,
    val commitSha: String? = null,
    val bootTime: String? = null
)

@Serializable
data class ApiError(
    val error: String? = null,
    val message: String? = null
)

@Serializable
data class FeedItem(
    val id: String,
    val title: String,
    val body: String,
    val imageUrl: String? = null,
    val timestamp: String,
    val category: String,
    val authorName: String,
    val likes: Int = 0,
    val comments: Int = 0
)

@Serializable
data class FeedResponse(
    val items: List<FeedItem> = emptyList(),
    val totalCount: Int = 0
)

@Serializable
data class Property(
    val id: String,
    val name: String,
    val location: String,
    val description: String,
    val imageUrl: String? = null,
    val price: Double,
    val tokenPrice: Double,
    val totalTokens: Int,
    val availableTokens: Int,
    val projectedReturn: Double,
    val status: String,
    val tags: List<String> = emptyList()
)

@Serializable
data class PropertiesResponse(
    val properties: List<Property> = emptyList(),
    val totalCount: Int = 0
)

@Serializable
data class Deal(
    val id: String,
    val name: String,
    val type: String,
    val stage: String,
    val value: Double,
    val projectedReturn: Double,
    val location: String,
    val description: String,
    val status: String,
    val participants: Int = 0
)

@Serializable
data class DealsResponse(
    val deals: List<Deal> = emptyList(),
    val totalCount: Int = 0
)

@Serializable
data class Reel(
    val id: String,
    val title: String? = null,
    @SerialName("thumbnail_url") val thumbnailUrl: String? = null,
    @SerialName("poster_url") val posterUrl: String? = null,
    @SerialName("cover_url") val coverUrl: String? = null,
    @SerialName("video_url") val videoUrl: String? = null,
    @SerialName("duration_sec") val durationSeconds: Int = 0,
    @SerialName("like_count") val likeCount: Int = 0,
    @SerialName("comment_count") val commentCount: Int = 0,
    @SerialName("share_count") val shareCount: Int = 0
)

@Serializable
data class ReelsResponse(
    val videos: List<Reel> = emptyList(),
    val count: Int = 0
)

@Serializable
data class Investor(
    val id: String,
    val name: String,
    val email: String,
    val phone: String? = null,
    val status: String,
    val tier: String = "standard",
    val invested: Double = 0.0,
    val returns: Double = 0.0,
    val joinDate: String? = null
)

@Serializable
data class InvestorsResponse(
    val investors: List<Investor> = emptyList(),
    val totalCount: Int = 0,
    val totalInvested: Double = 0.0
)

@Serializable
data class Buyer(
    val id: String,
    val name: String,
    val email: String,
    val phone: String? = null,
    val status: String,
    val budget: Double = 0.0,
    val preferredLocations: List<String> = emptyList(),
    val dealsClosed: Int = 0,
    val joinDate: String? = null
)

@Serializable
data class BuyersResponse(
    val buyers: List<Buyer> = emptyList(),
    val totalCount: Int = 0,
    val totalBudget: Double = 0.0
)

@Serializable
data class RevenueMetric(
    val label: String,
    val value: String,
    val change: String,
    val trend: String
)

@Serializable
data class RevenueResponse(
    val metrics: List<RevenueMetric> = emptyList(),
    val totalRevenue: Double = 0.0,
    val totalDistributions: Double = 0.0,
    val pendingApprovals: Int = 0
)

@Serializable
data class AnalyticsMetric(
    val label: String,
    val value: String,
    val change: String,
    val trend: String
)

@Serializable
data class AnalyticsResponse(
    val metrics: List<AnalyticsMetric> = emptyList(),
    val period: String = "30d"
)

@Serializable
data class Member(
    val id: String,
    val name: String,
    val email: String,
    val status: String,
    val role: String = "member",
    val joinDate: String? = null
)

@Serializable
data class MembersResponse(
    val members: List<Member> = emptyList(),
    val totalCount: Int = 0
)

@Serializable
data class UserProfile(
    val id: String,
    val email: String,
    val firstName: String = "",
    val lastName: String = "",
    val role: String = "member",
    val walletBalance: Double = 0.0,
    val totalInvested: Double = 0.0,
    val totalReturns: Double = 0.0,
    val kycStatus: String = "pending",
    val isOwner: Boolean = false
)

@Serializable
data class AppSettings(
    val notificationsEnabled: Boolean = true,
    val darkMode: Boolean = true,
    val language: String = "en",
    val biometricEnabled: Boolean = false
)
