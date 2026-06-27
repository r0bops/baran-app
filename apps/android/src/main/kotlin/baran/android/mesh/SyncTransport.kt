package baran.android.mesh

import kotlinx.coroutines.flow.StateFlow

/**
 * The radio-transport seam. Records move as opaque signed payloads, so the mesh
 * implementation (Nearby Connections today, Ditto later) is interchangeable and the
 * store never depends on a specific SDK.
 */
interface SyncTransport {
    val peerCount: StateFlow<Int>
    fun start()
    fun stop()
    /** Send one signed-record envelope to every connected peer. */
    fun broadcast(payload: ByteArray)
}

/** What the transport needs from the store: deliver inbound payloads, and provide a
 *  full snapshot to send to a peer that just connected (initial gossip sync). */
interface MeshDelegate {
    fun onPayload(payload: ByteArray)
    fun snapshot(): List<ByteArray>
}
