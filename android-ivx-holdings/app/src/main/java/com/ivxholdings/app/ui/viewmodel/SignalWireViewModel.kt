package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.model.SMSResponse
import com.ivxholdings.app.data.model.VoiceCallResponse
import com.ivxholdings.app.data.remote.IAApiService
import com.ivxholdings.app.util.AppConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class SignalWireUiState(
    val isSendingSMS: Boolean = false,
    val isMakingCall: Boolean = false,
    val smsResult: SMSResponse? = null,
    val callResult: VoiceCallResponse? = null,
    val smsHistory: List<SMSHistoryEntry> = emptyList(),
    val callHistory: List<CallHistoryEntry> = emptyList(),
    val error: String? = null,
    val ownerPhone: String = AppConfig.OWNER_PHONE
)

data class SMSHistoryEntry(
    val to: String,
    val body: String,
    val sid: String,
    val timestamp: Long = System.currentTimeMillis()
)

data class CallHistoryEntry(
    val to: String,
    val sid: String,
    val timestamp: Long = System.currentTimeMillis()
)

class SignalWireViewModel(private val apiService: IAApiService) : ViewModel() {

    private val _state = MutableStateFlow(SignalWireUiState())
    val state: StateFlow<SignalWireUiState> = _state.asStateFlow()

    fun sendSMS(to: String, body: String) {
        if (to.isBlank() || body.isBlank()) return
        _state.value = _state.value.copy(isSendingSMS = true, error = null)
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                apiService.sendSMS(to, body)
            }
            result.fold(
                onSuccess = { response ->
                    if (response.ok) {
                        val history = _state.value.smsHistory + SMSHistoryEntry(to, body, response.sid)
                        _state.value = _state.value.copy(
                            isSendingSMS = false,
                            smsResult = response,
                            smsHistory = history
                        )
                    } else {
                        _state.value = _state.value.copy(
                            isSendingSMS = false,
                            error = response.error ?: "SMS failed"
                        )
                    }
                },
                onFailure = { error ->
                    _state.value = _state.value.copy(
                        isSendingSMS = false,
                        error = error.message ?: "Network error"
                    )
                }
            )
        }
    }

    fun makeVoiceCall(to: String, message: String? = null) {
        if (to.isBlank()) return
        _state.value = _state.value.copy(isMakingCall = true, error = null)
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                apiService.makeVoiceCall(to, message)
            }
            result.fold(
                onSuccess = { response ->
                    if (response.ok) {
                        val history = _state.value.callHistory + CallHistoryEntry(to, response.sid)
                        _state.value = _state.value.copy(
                            isMakingCall = false,
                            callResult = response,
                            callHistory = history
                        )
                    } else {
                        _state.value = _state.value.copy(
                            isMakingCall = false,
                            error = response.error ?: "Voice call failed"
                        )
                    }
                },
                onFailure = { error ->
                    _state.value = _state.value.copy(
                        isMakingCall = false,
                        error = error.message ?: "Network error"
                    )
                }
            )
        }
    }

    fun quickNotifyOwner(message: String) {
        sendSMS(_state.value.ownerPhone, message)
    }

    fun quickCallOwner() {
        makeVoiceCall(_state.value.ownerPhone)
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }
}
