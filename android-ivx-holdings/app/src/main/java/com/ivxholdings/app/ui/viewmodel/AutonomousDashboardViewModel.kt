package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.model.CertResultResponse
import com.ivxholdings.app.data.model.ExecutorStatusResponse
import com.ivxholdings.app.data.model.HealthCheckResponse
import com.ivxholdings.app.data.model.IAAgent
import com.ivxholdings.app.data.model.PipelineStatusResponse
import com.ivxholdings.app.data.repository.AutonomousRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AutonomousDashboardState(
    val isLoading: Boolean = true,
    val agents: List<IAAgent> = emptyList(),
    val executorStatus: ExecutorStatusResponse? = null,
    val pipelineStatus: PipelineStatusResponse? = null,
    val health: HealthCheckResponse? = null,
    val certResult: CertResultResponse? = null,
    val isCertifying: Boolean = false,
    val error: String? = null
)

class AutonomousDashboardViewModel(
    private val repository: AutonomousRepository = AutonomousRepository()
) : ViewModel() {

    private val _state = MutableStateFlow(AutonomousDashboardState())
    val state: StateFlow<AutonomousDashboardState> = _state.asStateFlow()

    fun load() {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            val agents = repository.fetch112Agents().getOrNull()
            val executor = repository.fetchExecutorStatus().getOrNull()
            val pipeline = repository.fetchPipelineStatus().getOrNull()
            val health = repository.fetchHealth().getOrNull()

            _state.value = AutonomousDashboardState(
                isLoading = false,
                agents = agents ?: emptyList(),
                executorStatus = executor,
                pipelineStatus = pipeline,
                health = health,
                certResult = _state.value.certResult,
                isCertifying = false,
                error = if (agents == null) "Failed to load agents from production" else null
            )
        }
    }

    fun runCertification() {
        _state.value = _state.value.copy(isCertifying = true, error = null)
        viewModelScope.launch {
            val result = repository.trigger112Cert(skipDeploy = true)
            result.fold(
                onSuccess = { cert ->
                    _state.value = _state.value.copy(
                        certResult = cert,
                        isCertifying = false
                    )
                },
                onFailure = { error ->
                    _state.value = _state.value.copy(
                        isCertifying = false,
                        error = error.message ?: "Certification failed"
                    )
                }
            )
        }
    }
}
