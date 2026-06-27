package baran.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contracts.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import baran.android.mesh.MeshService
import baran.android.ui.screens.MainNavHost
import baran.android.ui.theme.BaranTheme

class MainActivity : ComponentActivity() {

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            // Start the mesh either way; Nearby degrades gracefully if some are denied.
            startMesh()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BaranTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    MainNavHost()
                }
            }
        }
        ensurePermissionsThenStartMesh()
    }

    private fun ensurePermissionsThenStartMesh() {
        val needed = requiredPermissions().filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isEmpty()) startMesh() else permissionLauncher.launch(needed.toTypedArray())
    }

    private fun startMesh() {
        ContextCompat.startForegroundService(this, Intent(this, MeshService::class.java))
    }

    /** Runtime permissions Nearby Connections needs, gated by API level. */
    private fun requiredPermissions(): Array<String> {
        val perms = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            perms += listOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
            )
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms += listOf(
                Manifest.permission.NEARBY_WIFI_DEVICES,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }
        return perms.toTypedArray()
    }
}
