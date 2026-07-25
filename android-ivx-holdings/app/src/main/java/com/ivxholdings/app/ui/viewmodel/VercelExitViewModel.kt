package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.model.VercelDependency
import com.ivxholdings.app.data.model.VercelExitDashboard
import com.ivxholdings.app.data.repository.IVXRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class VercelExitUiState {
    data object Loading : VercelExitUiState()
    data class Success(
        val dashboard: VercelExitDashboard,
        val dependencies: List<VercelDependency>
    ) : VercelExitUiState()
    data class Error(val message: String) : VercelExitUiState()
}

class VercelExitViewModel(private val repository: IVXRepository) : ViewModel() {

    private val _uiState = MutableStateFlow<VercelExitUiState>(VercelExitUiState.Loading)
    val uiState: StateFlow<VercelExitUiState> = _uiState.asStateFlow()

    fun load() {
        _uiState.value = VercelExitUiState.Loading
        viewModelScope.launch {
            val dashboardResult = repository.fetchDashboard()
            val inventoryResult = repository.fetchInventory()

            val dashboard = dashboardResult.getOrNull()
            val dependencies = inventoryResult.getOrNull()?.dependencies ?: emptyList()

            if (dashboard != null) {
                _uiState.value = VercelExitUiState.Success(dashboard, dependencies)
            } else {
                _uiState.value = VercelExitUiState.Error(
                    dashboardResult.exceptionOrNull()?.message ?: "Failed to load Vercel Exit data"
                )
            }
        }
    }
}
