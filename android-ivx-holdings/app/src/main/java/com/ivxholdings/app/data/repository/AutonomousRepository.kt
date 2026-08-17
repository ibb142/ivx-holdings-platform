package com.ivxholdings.app.data.repository

import com.ivxholdings.app.data.model.CertResultResponse
import com.ivxholdings.app.data.model.ExecutorStatusResponse
import com.ivxholdings.app.data.model.HealthCheckResponse
import com.ivxholdings.app.data.model.IAAgent
import com.ivxholdings.app.data.model.IAAgentsResponse
import com.ivxholdings.app.data.model.PipelineStatusResponse
import com.ivxholdings.app.data.remote.AutonomousApiService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AutonomousRepository(private val apiService: AutonomousApiService = AutonomousApiService()) {

    suspend fun fetch112Agents(): Result<List<IAAgent>> = withContext(Dispatchers.IO) {
        apiService.fetch112Agents().map { it.agents }
    }

    suspend fun fetchExecutorStatus(): Result<ExecutorStatusResponse> = withContext(Dispatchers.IO) {
        apiService.fetchExecutorStatus()
    }

    suspend fun fetchPipelineStatus(): Result<PipelineStatusResponse> = withContext(Dispatchers.IO) {
        apiService.fetchPipelineStatus()
    }

    suspend fun fetchHealth(): Result<HealthCheckResponse> = withContext(Dispatchers.IO) {
        apiService.fetchHealth()
    }

    suspend fun trigger112Cert(skipDeploy: Boolean = true): Result<CertResultResponse> = withContext(Dispatchers.IO) {
        apiService.trigger112Cert(skipDeploy)
    }
}
