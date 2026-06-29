package venrescate.android.data

import android.content.Context
import androidx.compose.runtime.mutableStateMapOf

/**
 * Shared, persisted on/off toggles for every map layer / data source.
 * Backed by Compose snapshot state so both the Map filter row and the Ajustes
 * "Fuentes de datos" card react live. Keys are the logical source/layer ids.
 */
object MapFilters {
    // source/layer keys
    const val SIGNED = "signed"      // VenRescate signed mesh records
    const val AID = "aid"            // SOS-VE aid_point / shelter / water_point
    const val DAMAGE = "damage"      // SOS-VE damaged/collapsed/gas/medical/road
    const val TRAPPED = "trapped"    // SOS-VE trapped_people
    const val USGS = "usgs"          // USGS epicenters
    const val EMSC = "emsc"          // EMSC epicenters
    const val GDACS = "gdacs"        // GDACS alert banner
    const val PERSONS = "persons"    // PFIF persons aggregate
    const val NEWS = "news"          // press feed (Personas tab)

    val ALL = listOf(SIGNED, AID, DAMAGE, TRAPPED, USGS, EMSC, GDACS, PERSONS, NEWS)

    private const val PREFS = "venrescate.filters"
    private val on = mutableStateMapOf<String, Boolean>()
    private var loaded = false

    fun ensureLoaded(ctx: Context) {
        if (loaded) return
        val off = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet("off", emptySet()) ?: emptySet()
        ALL.forEach { on[it] = it !in off }
        loaded = true
    }

    /** Reading this in a composable subscribes it to changes. Defaults to on. */
    fun isOn(key: String): Boolean = on[key] ?: true

    fun set(ctx: Context, key: String, value: Boolean) {
        on[key] = value
        val off = ALL.filter { on[it] == false }.toSet()
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet("off", off).apply()
    }

    fun toggle(ctx: Context, key: String) = set(ctx, key, !isOn(key))
}
