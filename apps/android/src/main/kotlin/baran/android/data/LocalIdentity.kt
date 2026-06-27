package baran.android.data

import android.content.Context
import baran.crypto.BaranIdentity
import baran.crypto.Crypto
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
    private const val PREFS = "baran.identity"
    private const val KEY_SEED = "seed_hex"
    private const val KEY_SEQ = "author_seq"

    fun loadOrCreate(ctx: Context): BaranIdentity {
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
