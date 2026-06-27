package baran.geo

import kotlin.math.floor

/**
 * Minimal Open Location Code (Plus Code) codec — pair precision only.
 * 10-digit codes resolve to ~14 m, 8-digit (coarse / sensitive) to ~275 m.
 * Used for SOS location capture and the offline map. No network, no dependencies.
 */
object PlusCode {
    private const val ALPHABET = "23456789CFGHJMPQRVWX"

    data class LatLng(val lat: Double, val lng: Double, val cell: Double)

    /** Encode to a full plus code (e.g. "77GR2J4C+9P"). codeLen must be even, 2..10. */
    fun encode(lat: Double, lng: Double, codeLen: Int = 10): String {
        require(codeLen in 2..10 && codeLen % 2 == 0) { "codeLen must be even 2..10" }
        var aLat = (lat.coerceIn(-90.0, 89.9999999) + 90.0)
        var aLng = (normalizeLng(lng) + 180.0)
        var res = 20.0
        val sb = StringBuilder()
        repeat(codeLen / 2) {
            val latIdx = floor(aLat / res).toInt().coerceIn(0, 19)
            val lngIdx = floor(aLng / res).toInt().coerceIn(0, 19)
            sb.append(ALPHABET[latIdx]); sb.append(ALPHABET[lngIdx])
            aLat -= latIdx * res
            aLng -= lngIdx * res
            res /= 20.0
            if (sb.length == 8) sb.append('+')
        }
        if (!sb.contains('+')) sb.append('+') // short codes still carry the separator
        return sb.toString()
    }

    /** Coarsen to the 8-char (sensitive) cell, mirroring contract `plus_code8`. */
    fun coarse(code: String): String {
        val noPlus = code.replace("+", "")
        return if (noPlus.length >= 8) noPlus.substring(0, 8) else noPlus
    }

    /** Decode a full or coarse code to its cell CENTER. Returns null if invalid. */
    fun decode(raw: String?): LatLng? {
        if (raw == null) return null
        val code = raw.replace("+", "").trimEnd('0').uppercase()
        if (code.length < 2) return null
        var lat = -90.0
        var lng = -180.0
        var res = 20.0
        var lastRes = 20.0
        var i = 0
        while (i + 1 <= code.length && i < 10) {
            val a = ALPHABET.indexOf(code[i])
            val b = ALPHABET.indexOf(code[i + 1])
            if (a < 0 || b < 0) return null
            lat += a * res
            lng += b * res
            lastRes = res
            res /= 20.0
            i += 2
        }
        return LatLng(lat + lastRes / 2, lng + lastRes / 2, lastRes)
    }

    private fun normalizeLng(lng: Double): Double {
        var v = lng
        while (v < -180.0) v += 360.0
        while (v >= 180.0) v -= 360.0
        return v
    }
}
