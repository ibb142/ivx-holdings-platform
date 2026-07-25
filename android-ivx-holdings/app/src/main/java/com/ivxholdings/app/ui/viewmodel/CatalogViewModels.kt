package com.ivxholdings.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.ivxholdings.app.data.model.Buyer
import com.ivxholdings.app.data.model.Deal
import com.ivxholdings.app.data.model.FeedItem
import com.ivxholdings.app.data.model.Investor
import com.ivxholdings.app.data.model.Member
import com.ivxholdings.app.data.model.Property
import com.ivxholdings.app.data.model.Reel
import com.ivxholdings.app.data.repository.IVXRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed class ListUiState<out T> {
    data object Loading : ListUiState<Nothing>()
    data class Success<T>(val items: List<T>) : ListUiState<T>()
    data class Error(val message: String) : ListUiState<Nothing>()
}

class FeedViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<ListUiState<FeedItem>>(ListUiState.Loading)
    val state: StateFlow<ListUiState<FeedItem>> = _state.asStateFlow()

    fun load() {
        _state.value = ListUiState.Loading
        viewModelScope.launch {
            _state.value = repository.fetchFeed().fold(
                onSuccess = { ListUiState.Success(it) },
                onFailure = { ListUiState.Error(it.message ?: "Failed to load feed") }
            )
        }
    }
}

class PropertiesViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<ListUiState<Property>>(ListUiState.Loading)
    val state: StateFlow<ListUiState<Property>> = _state.asStateFlow()

    fun load() {
        _state.value = ListUiState.Loading
        viewModelScope.launch {
            _state.value = repository.fetchProperties().fold(
                onSuccess = { ListUiState.Success(it) },
                onFailure = { ListUiState.Error(it.message ?: "Failed to load properties") }
            )
        }
    }
}

class DealsViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<ListUiState<Deal>>(ListUiState.Loading)
    val state: StateFlow<ListUiState<Deal>> = _state.asStateFlow()

    fun load() {
        _state.value = ListUiState.Loading
        viewModelScope.launch {
            _state.value = repository.fetchDeals().fold(
                onSuccess = { ListUiState.Success(it) },
                onFailure = { ListUiState.Error(it.message ?: "Failed to load deals") }
            )
        }
    }
}

class ReelsViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<ListUiState<Reel>>(ListUiState.Loading)
    val state: StateFlow<ListUiState<Reel>> = _state.asStateFlow()

    fun load() {
        _state.value = ListUiState.Loading
        viewModelScope.launch {
            _state.value = repository.fetchReels().fold(
                onSuccess = { ListUiState.Success(it) },
                onFailure = { ListUiState.Error(it.message ?: "Failed to load reels") }
            )
        }
    }
}

class InvestorsViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<ListUiState<Investor>>(ListUiState.Loading)
    val state: StateFlow<ListUiState<Investor>> = _state.asStateFlow()

    fun load() {
        _state.value = ListUiState.Loading
        viewModelScope.launch {
            _state.value = repository.fetchInvestors().fold(
                onSuccess = { ListUiState.Success(it) },
                onFailure = { ListUiState.Error(it.message ?: "Failed to load investors") }
            )
        }
    }
}

class BuyersViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<ListUiState<Buyer>>(ListUiState.Loading)
    val state: StateFlow<ListUiState<Buyer>> = _state.asStateFlow()

    fun load() {
        _state.value = ListUiState.Loading
        viewModelScope.launch {
            _state.value = repository.fetchBuyers().fold(
                onSuccess = { ListUiState.Success(it) },
                onFailure = { ListUiState.Error(it.message ?: "Failed to load buyers") }
            )
        }
    }
}

class MembersViewModel(private val repository: IVXRepository) : ViewModel() {
    private val _state = MutableStateFlow<ListUiState<Member>>(ListUiState.Loading)
    val state: StateFlow<ListUiState<Member>> = _state.asStateFlow()

    fun load() {
        _state.value = ListUiState.Loading
        viewModelScope.launch {
            _state.value = repository.fetchMembers().fold(
                onSuccess = { ListUiState.Success(it) },
                onFailure = { ListUiState.Error(it.message ?: "Failed to load members") }
            )
        }
    }
}
