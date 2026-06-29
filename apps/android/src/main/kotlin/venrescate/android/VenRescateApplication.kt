package venrescate.android

import android.app.Application
import venrescate.android.data.MeshStore

class VenRescateApplication : Application() {
    lateinit var store: MeshStore
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        store = MeshStore(this)
    }

    companion object {
        lateinit var instance: VenRescateApplication
            private set
    }
}
