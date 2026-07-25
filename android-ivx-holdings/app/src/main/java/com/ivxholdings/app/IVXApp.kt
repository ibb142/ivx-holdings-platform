package com.ivxholdings.app

import android.app.Application
import com.ivxholdings.app.di.appModule
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.context.startKoin

class IVXApp : Application() {
    override fun onCreate() {
        super.onCreate()
        startKoin {
            androidLogger()
            androidContext(this@IVXApp)
            modules(appModule)
        }
    }
}
