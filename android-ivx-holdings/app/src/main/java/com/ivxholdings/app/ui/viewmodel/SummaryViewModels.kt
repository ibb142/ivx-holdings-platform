package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.model.AnalyticsResponse
import com.ivxholdings.app.data.model.RevenueResponse
import com.ivxholdings.app.data.model.UserProfile
import com.ivxholdings.app.data.repository.IVXRepository
import com.ivxholdings.app.util.AppConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class RevenueUiState {
    data object Loading : RevenueUiState()
    data class Success(val data: RevenueResponse) : RevenueUiState()
    data class Error(val message: String) : RevenueUiState()
}

class RevenueViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<RevenueUiState>(RevenueUiState.Loading)
    val state: StateFlow<RevenueUiState> = _state.asStateFlow()

    fun load() {
        _state.value = RevenueUiState.Loading
        viewModelScope.launch {
            _state.value = repository.fetchRevenue().fold(
                onSuccess = { RevenueUiState.Success(it) },
                onFailure = { RevenueUiState.Error(it.message ?: "Failed to load revenue") }
            )
        }
    }
}

sealed class AnalyticsUiState {
    data object Loading : AnalyticsUiState()
    data class Success(val data: AnalyticsResponse) : AnalyticsUiState()
    data class Error(val message: String) : AnalyticsUiState()
}

class AnalyticsViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<AnalyticsUiState>(AnalyticsUiState.Loading)
    val state: StateFlow<AnalyticsUiState> = _state.asStateFlow()

    fun load() {
        _state.value = AnalyticsUiState.Loading
        viewModelScope.launch {
            _state.value = repository.fetchAnalytics().fold(
                onSuccess = { AnalyticsUiState.Success(it) },
                onFailure = { AnalyticsUiState.Error(it.message ?: "Failed to load analytics") }
            )
        }
    }
}

sealed class ProfileUiState {
    data object Loading : ProfileUiState()
    data class Success(val profile: UserProfile) : ProfileUiState()
    data class Error(val message: String) : ProfileUiState()
}

class ProfileViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<ProfileUiState>(ProfileUiState.Loading)
    val state: StateFlow<ProfileUiState> = _state.asStateFlow()

    fun load() {
        _state.value = ProfileUiState.Loading
        viewModelScope.launch {
            _state.value = ProfileUiState.Success(
                repository.getCurrentUser().copy(email = AppConfig.OWNER_EMAIL, isOwner = true)
            )
        }
    }
}

class OwnerDashboardViewModel(
    private val repository: IVXRepository
) : ViewModel() {
    private val _state = MutableStateFlow<SummaryDashboardState>(SummaryDashboardState.Loading)
    val state: StateFlow<SummaryDashboardState> = _state.asStateFlow()

    fun load() {
        _state.value = SummaryDashboardState.Loading
        viewModelScope.launch {
            val revenue = repository.fetchRevenue().getOrNull()
            val analytics = repository.fetchAnalytics().getOrNull()
            val members = repository.fetchMembers().getOrNull()
            val investors = repository.fetchInvestors().getOrNull()
            val buyers = repository.fetchBuyers().getOrNull()
            val version = repository.fetchVersion().getOrNull() ?: "unknown"

            _state.value = SummaryDashboardState.Success(
                revenue = revenue,
                analytics = analytics,
                membersCount = members?.size ?: 0,
                investorsCount = investors?.size ?: 0,
                buyersCount = buyers?.size ?: 0,
                version = version
            )
        }
    }
}

sealed class SummaryDashboardState {
    data object Loading : SummaryDashboardState()
    data class Success(
        val revenue: RevenueResponse?,
        val analytics: AnalyticsResponse?,
        val membersCount: Int,
        val investorsCount: Int,
        val buyersCount: Int,
        val version: String
    ) : SummaryDashboardState()
    data class Error(val message: String) : SummaryDashboardState()
}

class AIEngineeringViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<ListUiState<com.ivxholdings.app.data.model.AgentState>>(ListUiState.Loading)
    val state: StateFlow<ListUiState<com.ivxholdings.app.data.model.AgentState>> = _state.asStateFlow()

    fun load() {
        _state.value = ListUiState.Loading
        viewModelScope.launch {
            _state.value = repository.fetchAgents().fold(
                onSuccess = { ListUiState.Success(it) },
                onFailure = { ListUiState.Error(it.message ?: "Failed to load AI engineering") }
            )
        }
    }
}
