package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.model.HealthResponse
import com.ivxholdings.app.data.repository.IVXRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class HealthUiState {
    data object Loading : HealthUiState()
    data class Success(
        val health: HealthResponse,
        val version: String
    ) : HealthUiState()
    data class Error(val message: String) : HealthUiState()
}

class HealthViewModel(private val repository: IVXRepository) : ViewModel() {

    private val _uiState = MutableStateFlow<HealthUiState>(HealthUiState.Loading)
    val uiState: StateFlow<HealthUiState> = _uiState.asStateFlow()

    fun load() {
        _uiState.value = HealthUiState.Loading
        viewModelScope.launch {
            val healthResult = repository.fetchHealth()
            val versionResult = repository.fetchVersion()

            val health = healthResult.getOrNull()
            val version = versionResult.getOrNull() ?: "unknown"

            if (health != null) {
                _uiState.value = HealthUiState.Success(health, version)
            } else {
                _uiState.value = HealthUiState.Error(
                    healthResult.exceptionOrNull()?.message ?: "Failed to load health"
                )
            }
        }
    }
}
