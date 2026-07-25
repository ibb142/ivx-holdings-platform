package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.model.AgentState
import com.ivxholdings.app.data.repository.IVXRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class AgentsUiState {
    data object Loading : AgentsUiState()
    data class Success(val agents: List<AgentState>) : AgentsUiState()
    data class Error(val message: String) : AgentsUiState()
}

class AgentsViewModel(private val repository: IVXRepository) : ViewModel() {

    private val _uiState = MutableStateFlow<AgentsUiState>(AgentsUiState.Loading)
    val uiState: StateFlow<AgentsUiState> = _uiState.asStateFlow()

    fun load() {
        _uiState.value = AgentsUiState.Loading
        viewModelScope.launch {
            val result = repository.fetchAgents()
            result.fold(
                onSuccess = { agents ->
                    _uiState.value = AgentsUiState.Success(agents)
                },
                onFailure = { error ->
                    _uiState.value = AgentsUiState.Error(error.message ?: "Failed to load agents")
                }
            )
        }
    }
}
