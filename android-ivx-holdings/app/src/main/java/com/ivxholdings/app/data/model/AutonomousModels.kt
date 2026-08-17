package com.ivxholdings.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class IAAgent(
    val agentId: String,
    val agentNumber: Int,
    val name: String,
    val role: String,
    val company: String = "",
    val division: String = "",
    val health: String = "unknown",
    val available: Boolean = true,
    val model: String = "openai/gpt-4o",
    val source: String = "remote_api"
)

@Serializable
data class IAAgentsResponse(
    val totalAgents: Int = 0,
    val agents: List<IAAgent> = emptyList()
)

@Serializable
data class ExecutorCapabilities(
    val fileWriting: Boolean = false,
    val buildLoop: Boolean = false,
    val deployStep: Boolean = false,
    val aiErrorFeedback: Boolean = false,
    val maxBuildIterations: Int = 5,
    val maxFilesPerWrite: Int = 50,
    val commandTimeoutMs: Long = 120000
)

@Serializable
data class ExecutorStatusResponse(
    val ok: Boolean = false,
    val marker: String = "",
    val version: String = "",
    val capabilities: ExecutorCapabilities = ExecutorCapabilities(),
    val aiConfigured: Boolean = false,
    val aiModel: String = "",
    val aiEndpoint: String = "",
    val githubConfigured: Boolean = false,
    val productionUrl: String = "",
    val timestamp: String = ""
)

@Serializable
data class PipelineStatusResponse(
    val ok: Boolean = false,
    val marker: String = "",
    val pipeline: String = "",
    val agentRange: String = "",
    val totalAgents: Int = 0,
    val aiConfigured: Boolean = false,
    val model: String = "",
    val endpoint: String = "",
    val githubSha: String = ""
)

@Serializable
data class CertResultResponse(
    val ok: Boolean = false,
    val certified: Boolean = false,
    val certId: String = "",
    val marker: String = "",
    val aiSource: String = "",
    val aiModel: String = "",
    val llmCallCount: Int = 0,
    val proofHash: String = "",
    val totalDurationMs: Long = 0,
    val summary: String = "",
    val proofDefinition: String = ""
)

@Serializable
data class HealthCheckResponse(
    val status: String = "",
    val commitShort: String = "",
    val commitSha: String? = null,
    val bootTime: String? = null,
    val routes: List<String> = emptyList()
)
