package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.repository.IVXRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ChatMessage(
    val role: String,
    val text: String
)

sealed class ChatUiState {
    data object Idle : ChatUiState()
    data object Loading : ChatUiState()
    data class Error(val message: String) : ChatUiState()
}

class ChatViewModel(private val repository: IVXRepository) : ViewModel() {

    private val _messages = MutableStateFlow<List<ChatMessage>>(
        listOf(
            ChatMessage("ai", "Welcome to IVX Owner AI. I am the orchestrator. State your request.")
        )
    )
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _uiState = MutableStateFlow<ChatUiState>(ChatUiState.Idle)
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    fun send(message: String) {
        if (message.isBlank()) return
        _messages.value = _messages.value + ChatMessage("owner", message)
        _uiState.value = ChatUiState.Loading
        viewModelScope.launch {
            val result = repository.sendOwnerMessage(message)
            result.fold(
                onSuccess = { answer ->
                    _messages.value = _messages.value + ChatMessage("ai", answer)
                    _uiState.value = ChatUiState.Idle
                },
                onFailure = { error ->
                    _messages.value = _messages.value + ChatMessage(
                        "ai",
                        "Error: ${error.message ?: "Request failed"}. Falling back to local mode."
                    )
                    _uiState.value = ChatUiState.Error(error.message ?: "Request failed")
                }
            )
        }
    }
}
