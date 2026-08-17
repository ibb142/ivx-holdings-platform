package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.repository.AutonomousRepository
import com.ivxholdings.app.data.repository.IVXRepository
import com.ivxholdings.app.ui.screens.HomeData
import com.ivxholdings.app.util.AppConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed class HomeUiState {
    data object Loading : HomeUiState()
    data class Success(val data: HomeData) : HomeUiState()
    data class Error(val message: String) : HomeUiState()
}

class HomeViewModel(
    private val ivxRepository: IVXRepository,
    private val autonomousRepository: AutonomousRepository = AutonomousRepository()
) : ViewModel() {

    private val _state = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    fun load() {
        _state.value = HomeUiState.Loading
        viewModelScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    val healthDeferred = async { autonomousRepository.fetchHealth() }
                    val agentsDeferred = async { autonomousRepository.fetch112Agents() }
                    val dealsDeferred = async { ivxRepository.fetchDeals() }
                    val propertiesDeferred = async { ivxRepository.fetchProperties() }
                    val investorsDeferred = async { ivxRepository.fetchInvestors() }
                    val versionDeferred = async { ivxRepository.fetchVersion() }

                    val health = healthDeferred.await().getOrNull()
                    val agents = agentsDeferred.await().getOrNull()

                    // These data endpoints may return 404 until backend deploys;
                    // getOrNull() ensures the home dashboard still renders.
                    val deals = dealsDeferred.await().getOrNull() ?: emptyList()
                    val properties = propertiesDeferred.await().getOrNull() ?: emptyList()
                    val investors = investorsDeferred.await().getOrNull() ?: emptyList()
                    val version = versionDeferred.await().getOrNull() ?: AppConfig.APP_VERSION

                    HomeData(
                        status = health?.status ?: "unknown",
                        commitShort = health?.commitShort ?: AppConfig.GIT_SHA,
                        agentsCount = agents?.size ?: 0,
                        dealsCount = deals.size,
                        propertiesCount = properties.size,
                        investorsCount = investors.size,
                        version = version
                    )
                }
            }

            _state.value = result.fold(
                onSuccess = { HomeUiState.Success(it) },
                onFailure = {
                    HomeUiState.Error(
                        it.message ?: "Failed to load home dashboard"
                    )
                }
            )
        }
    }
}
