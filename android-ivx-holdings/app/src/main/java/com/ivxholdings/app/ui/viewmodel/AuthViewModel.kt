package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.repository.IVXRepository
import com.ivxholdings.app.util.AppConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class AuthState {
    data object Idle : AuthState()
    data object Loading : AuthState()
    data class Authenticated(val email: String, val role: String) : AuthState()
    data class Error(val message: String) : AuthState()
}

class AuthViewModel(private val repository: IVXRepository) : ViewModel() {

    private val _state = MutableStateFlow<AuthState>(AuthState.Idle)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    fun ownerLogin(email: String = AppConfig.OWNER_EMAIL) {
        _state.value = AuthState.Loading
        viewModelScope.launch {
            val result = repository.ownerLogin(email)
            result.fold(
                onSuccess = { response ->
                    if (response.success && response.accessToken != null) {
                        _state.value = AuthState.Authenticated(response.email ?: email, "owner")
                    } else {
                        _state.value = AuthState.Error(response.message ?: "Owner login failed")
                    }
                },
                onFailure = { error ->
                    _state.value = AuthState.Error(error.message ?: "Network error")
                }
            )
        }
    }

    fun memberLogin(email: String, password: String) {
        _state.value = AuthState.Loading
        viewModelScope.launch {
            val result = repository.memberLogin(email, password)
            result.fold(
                onSuccess = { response ->
                    if (response.success && response.accessToken != null) {
                        _state.value = AuthState.Authenticated(response.email ?: email, response.role ?: "member")
                    } else {
                        _state.value = AuthState.Error(response.message ?: "Member login failed")
                    }
                },
                onFailure = { error ->
                    _state.value = AuthState.Error(error.message ?: "Network error")
                }
            )
        }
    }

    fun login(email: String) {
        ownerLogin(email)
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            _state.value = AuthState.Idle
        }
    }

    fun resetError() {
        if (_state.value is AuthState.Error) {
            _state.value = AuthState.Idle
        }
    }
}
