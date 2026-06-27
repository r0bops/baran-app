package baran.android

import android.app.Application
import baran.android.data.MeshStore

class BaranApplication : Application() {
    lateinit var store: MeshStore
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        store = MeshStore(this)
    }

    companion object {
        lateinit var instance: BaranApplication
            private set
    }
}
