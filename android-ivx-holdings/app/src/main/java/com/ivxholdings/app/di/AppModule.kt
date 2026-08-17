package com.ivxholdings.app.di

import com.ivxholdings.app.data.remote.IAApiService
import com.ivxholdings.app.data.remote.IVXApiService
import com.ivxholdings.app.data.repository.IVXRepository
import com.ivxholdings.app.ui.viewmodel.AIEngineeringViewModel
import com.ivxholdings.app.ui.viewmodel.AgentsViewModel
import com.ivxholdings.app.ui.viewmodel.AnalyticsViewModel
import com.ivxholdings.app.ui.viewmodel.AutonomousDashboardViewModel
import com.ivxholdings.app.ui.viewmodel.AuthViewModel
import com.ivxholdings.app.ui.viewmodel.BuyersViewModel
import com.ivxholdings.app.ui.viewmodel.ChatViewModel
import com.ivxholdings.app.ui.viewmodel.DealsViewModel
import com.ivxholdings.app.ui.viewmodel.FeedViewModel
import com.ivxholdings.app.ui.viewmodel.HealthViewModel
import com.ivxholdings.app.ui.viewmodel.HomeViewModel
import com.ivxholdings.app.ui.viewmodel.InvestorsViewModel
import com.ivxholdings.app.ui.viewmodel.MembersViewModel
import com.ivxholdings.app.ui.viewmodel.OwnerDashboardViewModel
import com.ivxholdings.app.ui.viewmodel.ProfileViewModel
import com.ivxholdings.app.ui.viewmodel.PropertiesViewModel
import com.ivxholdings.app.ui.viewmodel.ReelsViewModel
import com.ivxholdings.app.ui.viewmodel.RevenueViewModel
import com.ivxholdings.app.ui.viewmodel.SignalWireViewModel
import com.ivxholdings.app.ui.viewmodel.VercelExitViewModel
import com.ivxholdings.app.ui.viewmodel.VoiceChatViewModel
import org.koin.androidx.viewmodel.dsl.viewModel
import org.koin.dsl.module

val appModule = module {
    single { IVXApiService() }
    single { IAApiService() }
    single { IVXRepository(get()) }
    single { com.ivxholdings.app.data.repository.AutonomousRepository() }
    viewModel { AuthViewModel(get()) }
    viewModel { VercelExitViewModel(get()) }
    viewModel { AgentsViewModel(get()) }
    viewModel { ChatViewModel(get()) }
    viewModel { HealthViewModel(get()) }
    viewModel { FeedViewModel(get()) }
    viewModel { PropertiesViewModel(get()) }
    viewModel { DealsViewModel(get()) }
    viewModel { ReelsViewModel(get()) }
    viewModel { InvestorsViewModel(get()) }
    viewModel { BuyersViewModel(get()) }
    viewModel { RevenueViewModel(get()) }
    viewModel { AnalyticsViewModel(get()) }
    viewModel { MembersViewModel(get()) }
    viewModel { ProfileViewModel(get()) }
    viewModel { OwnerDashboardViewModel(get()) }
    viewModel { AIEngineeringViewModel(get()) }
    viewModel { HomeViewModel(get(), get()) }
    viewModel { AutonomousDashboardViewModel() }
    viewModel { VoiceChatViewModel(get()) }
    viewModel { SignalWireViewModel(get()) }
}
