package baran.android.mesh

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import baran.android.MainActivity

/**
 * Foreground service for mesh sync (BLE/Wi-Fi Direct via Ditto SDK).
 * Survives Doze with foreground service type "connectedDevice|location".
 *
 * Ditto Kotlin SDK integration point:
 * 1. Initialize Ditto SmallPeer with identity derived from Ed25519 key
 * 2. Set transport config (BLE, Wi-Fi Direct, LAN)
 * 3. Subscribe to record collections with class-gated filters
 * 4. Verify signatures before merge (per P0-2)
 */
class MeshService : Service() {

    companion object {
        const val CHANNEL_ID = "baran_mesh"
        const val NOTIFICATION_ID = 1
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        val pendingIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Baran — Red activa")
            .setContentText("Malla en funcionamiento. Buscando dispositivos cercanos...")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

        startForeground(NOTIFICATION_ID, notification)

        // Ditto/DittoTransport integration — deferred until license confirmed
        // initializeTransport()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        // stopTransport()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Malla Baran",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Estado de la red de rescate"
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }
}
