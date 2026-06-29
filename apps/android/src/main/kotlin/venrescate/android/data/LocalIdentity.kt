package venrescate.android.data

import android.content.Context
import venrescate.crypto.VenRescateIdentity
import venrescate.crypto.Crypto
import java.security.SecureRandom

/**
 * The device's signing identity.
 *
 * NOTE: production stores the Ed25519 private key in the Android Keystore
 * (StrongBox where available) per the handoff spec. This dev placeholder persists
 * the 32-byte seed in SharedPreferences so the identity is stable across restarts;
 * swap [loadOrCreate] for a Keystore-backed implementation before field use.
 */
object LocalIdentity {
    private const val PREFS = "venrescate.identity"
    private const val KEY_SEED = "seed_hex"
    private const val KEY_SEQ = "author_seq"
    private const val KEY_BRIDGE_BASE = "bridge_base"

    /** Coordinator base URL for the internet bridge. Defaults to localhost so a
     *  USB `adb reverse tcp:3001 tcp:3001` tunnel works with no LAN setup. */
    const val DEFAULT_BRIDGE_BASE = "http://localhost:3001"

    fun loadBridgeBase(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_BRIDGE_BASE, DEFAULT_BRIDGE_BASE)!!

    fun saveBridgeBase(ctx: Context, base: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_BRIDGE_BASE, base).apply()
    }

    fun loadOrCreate(ctx: Context): VenRescateIdentity {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var seed = prefs.getString(KEY_SEED, null)
        if (seed == null) {
            seed = randomSeedHex()
            prefs.edit().putString(KEY_SEED, seed).apply()
        }
        return Crypto.keyFromSeed(seed)
    }

    fun loadSeq(ctx: Context): Int =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_SEQ, 0)

    fun saveSeq(ctx: Context, seq: Int) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_SEQ, seq).apply()
    }

    private fun randomSeedHex(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
