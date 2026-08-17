package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.model.VoiceChatResponse
import com.ivxholdings.app.data.remote.IAApiService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class VoiceChatUiState(
    val isRecording: Boolean = false,
    val isProcessing: Boolean = false,
    val transcript: String = "",
    val aiResponse: String = "",
    val audioBase64: String? = null,
    val error: String? = null,
    val conversations: List<VoiceChatEntry> = emptyList()
)

data class VoiceChatEntry(
    val role: String,
    val text: String,
    val timestamp: Long = System.currentTimeMillis()
)

class VoiceChatViewModel(private val apiService: IAApiService) : ViewModel() {

    private val _state = MutableStateFlow(VoiceChatUiState())
    val state: StateFlow<VoiceChatUiState> = _state.asStateFlow()

    fun setRecording(recording: Boolean) {
        _state.value = _state.value.copy(isRecording = recording)
    }

    fun processAudio(audioBase64: String, mimeType: String = "audio/wav") {
        _state.value = _state.value.copy(isProcessing = true, isRecording = false, error = null)
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                apiService.voiceChat(audioBase64, mimeType)
            }
            result.fold(
                onSuccess = { response ->
                    if (response.ok) {
                        val newConversations = _state.value.conversations + listOf(
                            VoiceChatEntry("owner", response.transcript),
                            VoiceChatEntry("ai", response.response)
                        )
                        _state.value = _state.value.copy(
                            isProcessing = false,
                            transcript = response.transcript,
                            aiResponse = response.response,
                            audioBase64 = response.audioBase64,
                            conversations = newConversations
                        )
                    } else {
                        _state.value = _state.value.copy(
                            isProcessing = false,
                            error = response.error ?: "Voice chat failed"
                        )
                    }
                },
                onFailure = { error ->
                    _state.value = _state.value.copy(
                        isProcessing = false,
                        error = error.message ?: "Network error"
                    )
                }
            )
        }
    }

    fun sendTextAsVoice(text: String) {
        if (text.isBlank()) return
        _state.value = _state.value.copy(isProcessing = true, error = null)
        viewModelScope.launch {
            val conversations = _state.value.conversations + VoiceChatEntry("owner", text)
            _state.value = _state.value.copy(conversations = conversations)

            // Use TTS endpoint to get audio response, then process as voice chat
            val result = withContext(Dispatchers.IO) {
                apiService.textToSpeech(text)
            }
            result.fold(
                onSuccess = { ttsResponse ->
                    if (ttsResponse.ok && ttsResponse.audioBase64 != null) {
                        val newConversations = _state.value.conversations + VoiceChatEntry("ai", "[Audio response generated]")
                        _state.value = _state.value.copy(
                            isProcessing = false,
                            aiResponse = "Audio response generated (${ttsResponse.audioFormat})",
                            audioBase64 = ttsResponse.audioBase64,
                            conversations = newConversations
                        )
                    } else {
                        _state.value = _state.value.copy(
                            isProcessing = false,
                            error = ttsResponse.error ?: "TTS failed"
                        )
                    }
                },
                onFailure = { error ->
                    _state.value = _state.value.copy(
                        isProcessing = false,
                        error = error.message ?: "Network error"
                    )
                }
            )
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    fun resetConversation() {
        _state.value = VoiceChatUiState()
    }
}
