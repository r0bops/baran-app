package baran.android.mesh

import android.content.Context
import android.util.Log
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Phone-to-phone mesh over Google Nearby Connections (BLE + Wi-Fi, no internet, no
 * vendor license). P2P_CLUSTER gives an m-to-n mesh; on connect we auto-accept and
 * push our snapshot, and inbound payloads are handed to the store, which verifies and
 * re-gossips them. Signature verification happens in the store, BEFORE merge.
 */
class NearbyTransport(
    context: Context,
    private val localName: String,
    private val delegate: MeshDelegate,
) : SyncTransport {

    private val client: ConnectionsClient = Nearby.getConnectionsClient(context.applicationContext)
    private val connected = LinkedHashSet<String>()
    private val _peerCount = MutableStateFlow(0)
    override val peerCount = _peerCount.asStateFlow()

    override fun start() {
        startAdvertising()
        startDiscovery()
    }

    override fun stop() {
        client.stopAllEndpoints()
        client.stopAdvertising()
        client.stopDiscovery()
        connected.clear()
        _peerCount.value = 0
    }

    override fun broadcast(payload: ByteArray) {
        if (connected.isNotEmpty()) {
            client.sendPayload(connected.toList(), Payload.fromBytes(payload))
        }
    }

    private fun startAdvertising() {
        val options = AdvertisingOptions.Builder().setStrategy(STRATEGY).build()
        client.startAdvertising(localName, SERVICE_ID, lifecycle, options)
            .addOnFailureListener { Log.w(TAG, "advertising failed", it) }
    }

    private fun startDiscovery() {
        val options = DiscoveryOptions.Builder().setStrategy(STRATEGY).build()
        client.startDiscovery(SERVICE_ID, discovery, options)
            .addOnFailureListener { Log.w(TAG, "discovery failed", it) }
    }

    private val discovery = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            client.requestConnection(localName, endpointId, lifecycle)
                .addOnFailureListener { Log.w(TAG, "requestConnection failed", it) }
        }

        override fun onEndpointLost(endpointId: String) {}
    }

    private val lifecycle = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            // Open mesh: auto-accept. (A shared join code would gate this in the field.)
            client.acceptConnection(endpointId, payloads)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            if (result.status.isSuccess) {
                connected.add(endpointId)
                _peerCount.value = connected.size
                // Initial sync: hand the new peer everything we know.
                delegate.snapshot().forEach { client.sendPayload(endpointId, Payload.fromBytes(it)) }
            }
        }

        override fun onDisconnected(endpointId: String) {
            connected.remove(endpointId)
            _peerCount.value = connected.size
        }
    }

    private val payloads = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            payload.asBytes()?.let { delegate.onPayload(it) }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
    }

    companion object {
        private const val TAG = "BaranNearby"
        private const val SERVICE_ID = "org.baran.rescue.mesh"
        private val STRATEGY = Strategy.P2P_CLUSTER
    }
}
