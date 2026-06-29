package venrescate.android.mesh

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import venrescate.android.VenRescateApplication
import venrescate.android.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach

/**
 * Foreground service that owns the mesh transport (Nearby Connections), so sync keeps
 * running while the app is backgrounded. The transport is held behind [SyncTransport],
 * so swapping in Ditto is a one-line change here.
 */
class MeshService : Service() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var transport: SyncTransport? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())

        val store = VenRescateApplication.instance.store
        val t = NearbyTransport(this, "VenRescate-" + store.deviceId().take(6), store)
        store.transport = t
        t.peerCount.onEach { store.setPeerCount(it) }.launchIn(scope)
        t.start()
        transport = t
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        transport?.stop()
        VenRescateApplication.instance.store.transport = null
        scope.cancel()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("VenRescate — Red activa")
            .setContentText("Malla en funcionamiento. Buscando dispositivos cercanos...")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(CHANNEL_ID, "Malla VenRescate", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Estado de la red de rescate"
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "venrescate_mesh"
        const val NOTIFICATION_ID = 1
    }
}
