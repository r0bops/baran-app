package baran.crypto

import baran.schema.CanonicalJson
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.security.*
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec

class BaranIdentity(
    val seedHex: String,
    val publicKeyRaw: ByteArray,
    val publicKeyB64u: String,
    val deviceId: String,
    private val javaPrivateKey: PrivateKey,
    private val bcPrivateKey: Ed25519PrivateKeyParameters
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is BaranIdentity) return false
        return seedHex == other.seedHex && publicKeyRaw.contentEquals(other.publicKeyRaw)
    }
    override fun hashCode(): Int = seedHex.hashCode()

    fun signMessage(msg: ByteArray): ByteArray {
        val signer = Ed25519Signer()
        signer.init(true, bcPrivateKey)
        signer.update(msg, 0, msg.size)
        return signer.generateSignature()
    }
}

object Crypto {
    private val SPKI_ED25519_PREFIX = hexToBytes("302a300506032b6570032100")

    fun keyFromSeed(seedHex: String): BaranIdentity {
        val seed = hexToBytes(seedHex)
        require(seed.size == 32) { "seed must be 32 bytes: got ${seed.size}" }

        // Bouncy Castle: Ed25519PrivateKeyParameters directly from seed
        val bcPriv = Ed25519PrivateKeyParameters(seed, 0)
        val bcPub = bcPriv.generatePublicKey()
        val rawPub = bcPub.encoded // 32-byte raw public key

        // Also create Java PrivateKey for Signature API (used by verify)
        val pkcs8Der = hexToBytes("302e020100300506032b657004220420") + seed
        val javaPriv = KeyFactory.getInstance("Ed25519").generatePrivate(
            PKCS8EncodedKeySpec(pkcs8Der)
        )

        val pubB64u = base64urlEncode(rawPub)
        val deviceId = fingerprint(rawPub)

        return BaranIdentity(seedHex, rawPub, pubB64u, deviceId, javaPriv, bcPriv)
    }

    fun publicKeyFromRaw(rawPub: ByteArray): PublicKey {
        val der = SPKI_ED25519_PREFIX + rawPub
        return KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(der))
    }

    fun publicKeyFromRawBC(rawPub: ByteArray): Ed25519PublicKeyParameters {
        return Ed25519PublicKeyParameters(rawPub, 0)
    }

    fun fingerprint(pubRaw: ByteArray): String {
        val hash = MessageDigest.getInstance("SHA-256").digest(pubRaw)
        return base64urlEncode(hash.copyOf(12))
    }

    fun sign(recordNoSig: Map<String, Any?>, signer: BaranIdentity): SignResult {
        val canonical = CanonicalJson.encode(recordNoSig)
        val msg = canonical.toByteArray(Charsets.UTF_8)
        val sigBytes = signer.signMessage(msg)
        val contentHash = MessageDigest.getInstance("SHA-256").digest(msg).toHexString()
        return SignResult(canonical, contentHash, base64urlEncode(sigBytes))
    }

    fun verify(record: Map<String, Any?>, pubRaw: ByteArray): Boolean {
        val recordNoSig = record.filterKeys { it != "sig" && it != "content_hash" }
        val msg = CanonicalJson.bytes(recordNoSig)
        val sigBytes = base64urlDecode(record["sig"] as String)

        // Use BouncyCastle for verification
        val signer = Ed25519Signer()
        signer.init(false, publicKeyFromRawBC(pubRaw))
        signer.update(msg, 0, msg.size)
        return signer.verifySignature(sigBytes)
    }

    fun signPayload(payload: Map<String, Any?>, signer: BaranIdentity): String {
        val msg = CanonicalJson.bytes(payload)
        return base64urlEncode(signer.signMessage(msg))
    }

    fun verifyPayload(payload: Map<String, Any?>, sigB64u: String, pubRaw: ByteArray): Boolean {
        val msg = CanonicalJson.bytes(payload)
        val sigBytes = base64urlDecode(sigB64u)
        val signer = Ed25519Signer()
        signer.init(false, publicKeyFromRawBC(pubRaw))
        signer.update(msg, 0, msg.size)
        return signer.verifySignature(sigBytes)
    }

    data class SignResult(val canonical: String, val contentHash: String, val sig: String)

    fun base64urlEncode(bytes: ByteArray): String =
        java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    fun base64urlDecode(s: String): ByteArray =
        java.util.Base64.getUrlDecoder().decode(s)

    val IDS = mapOf(
        "alice"   to "1111111111111111111111111111111111111111111111111111111111111111",
        "bob"     to "2222222222222222222222222222222222222222222222222222222222222222",
        "carol"   to "3333333333333333333333333333333333333333333333333333333333333333",
        "dora"    to "4444444444444444444444444444444444444444444444444444444444444444",
        "mallory" to "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    )

    fun hexToBytes(s: String): ByteArray {
        val len = s.length
        val data = ByteArray(len / 2)
        for (i in 0 until len step 2) {
            data[i / 2] = ((Character.digit(s[i], 16) shl 4) + Character.digit(s[i + 1], 16)).toByte()
        }
        return data
    }

    fun ByteArray.toHexString(): String =
        joinToString("") { "%02x".format(it) }
}
