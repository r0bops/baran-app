package venrescate.android.ui.screens

import android.annotation.SuppressLint
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.location.LocationComponentActivationOptions
import org.maplibre.android.location.modes.CameraMode
import org.maplibre.android.location.modes.RenderMode
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.FeatureCollection
import venrescate.android.data.MapFilters
import venrescate.android.data.MeshStore
import venrescate.android.net.EmscQuakes
import venrescate.android.net.GdacsAlert
import venrescate.android.net.PfifPersons
import venrescate.android.net.PublicReports
import venrescate.android.net.UsgsQuakes
import venrescate.android.ui.Labels
import venrescate.geo.PlusCode

/**
 * Real vector basemap (MapLibre Native) with two layers:
 *  - VenRescate's own SIGNED records (pins with a trust-tier ring), tappable;
 *  - the public SOS Venezuela 2026 dataset as a separate, unsigned overlay
 *    (small severity-coloured dots), drawn underneath — never mixed with signed trust.
 *
 * Basemap is pluggable, mirroring the web coordinator's `VITE_BASEMAP_PMTILES`.
 */
private const val ONLINE_STYLE = "https://tiles.openfreemap.org/styles/liberty"
private const val OFFLINE_STYLE_ASSET = "asset://basemap-style.json"
private const val PIN_SOURCE = "venrescate-pins"
private const val PIN_LAYER = "venrescate-pin-circles"
private const val OVERLAY_SOURCE = "sosve-overlay"
private const val OVERLAY_LAYER = "sosve-overlay-circles"
private const val OVERLAY_SYMBOL_LAYER = "sosve-overlay-icons"
private const val QUAKE_SOURCE = "usgs-quakes"
private const val QUAKE_LAYER = "usgs-quake-circles"
private const val QUAKE_LABEL_LAYER = "usgs-quake-labels"
private const val PERSONS_SOURCE = "persons-agg"
private const val PERSONS_LAYER = "persons-agg-circles"
private const val PERSONS_LABEL_LAYER = "persons-agg-labels"
private const val PERSONS_HEX = "#C4B5FD"

private fun personsIconName(total: Int) = "pcount$total"
private fun personsRadius(total: Int): Double = (9.0 + Math.sqrt(total.toDouble()) * 3.0).coerceAtMost(34.0)

/** Earthquake magnitude → colour ramp (yellow → dark red). */
private fun magHex(m: Double): String = when {
    m >= 7 -> "#7F1D1D"
    m >= 6 -> "#B91C1C"
    m >= 5 -> "#EF4444"
    m >= 4 -> "#F97316"
    else -> "#F59E0B"
}

/** Epicenter disc radius grows with magnitude (M2.5 ≈ 5px, M7.5 ≈ 21px). */
private fun magRadius(m: Double): Double = 5.0 + (m - 2.5).coerceAtLeast(0.0) * 3.2

/** A major quake close enough to the Caracas/La Guaira operational zone to frame on open. */
private fun isMajorNearby(q: UsgsQuakes.Quake): Boolean =
    q.mag >= 6.0 && kotlin.math.abs(q.lat - DEFAULT_CENTER.latitude) < 2.0 &&
        kotlin.math.abs(q.lng - DEFAULT_CENTER.longitude) < 2.8

/** A tapped earthquake epicenter, shown in the info card. */
private data class QuakeSelection(val mag: Double, val place: String, val depthKm: Double, val timeMs: Long, val url: String)

private fun quakeIconName(mag: Double) = "mag$mag"

private fun hasLocationPermission(ctx: android.content.Context): Boolean =
    androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED ||
        androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.ACCESS_COARSE_LOCATION) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED

/** Turn on the blue "you are here" dot. Camera is NOT tracked, so it won't yank the view. */
@SuppressLint("MissingPermission")
private fun enableMyLocation(map: MapLibreMap, style: Style, ctx: android.content.Context) {
    runCatching {
        val lc = map.locationComponent
        lc.activateLocationComponent(LocationComponentActivationOptions.builder(ctx, style).useDefaultLocationEngine(true).build())
        lc.isLocationComponentEnabled = true
        lc.cameraMode = CameraMode.NONE
        lc.renderMode = RenderMode.NORMAL
    }
}

/** A pill badge like "M7.5" rendered to a bitmap — independent of the style's glyph fonts. */
private fun magLabelBitmap(text: String, bgHex: String): android.graphics.Bitmap {
    val h = 60
    val tp = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    tp.textSize = 36f
    tp.color = android.graphics.Color.WHITE
    tp.typeface = android.graphics.Typeface.DEFAULT_BOLD
    val pad = 18f
    val w = (tp.measureText(text) + pad * 2).toInt()
    val bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bmp)
    val bg = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    bg.color = runCatching { android.graphics.Color.parseColor(bgHex) }.getOrDefault(android.graphics.Color.RED)
    canvas.drawRoundRect(android.graphics.RectF(0f, 0f, w.toFloat(), h.toFloat()), h / 2f, h / 2f, bg)
    val ring = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    ring.style = android.graphics.Paint.Style.STROKE
    ring.strokeWidth = 5f
    ring.color = android.graphics.Color.WHITE
    canvas.drawRoundRect(android.graphics.RectF(3f, 3f, w - 3f, h - 3f), h / 2f, h / 2f, ring)
    val y = h / 2f - (tp.descent() + tp.ascent()) / 2f
    canvas.drawText(text, pad, y, tp)
    return bmp
}

/** Emoji marker per category — rendered to bitmaps and registered with the style. */
private val CATEGORY_ICON = mapOf(
    "trapped_people" to "🆘",
    "medical_need" to "🏥",
    "gas_leak" to "⛽",
    "collapsed_building" to "🏚️",
    "damaged_building" to "🏢",
    "shelter" to "🏠",
    "aid_point" to "🤝",
    "water_point" to "💧",
    "road" to "🚧",
)
// Damage severities the colour badge can take (last "" = unknown → grey).
private val SEVERITIES = listOf("rojo", "naranja", "amarillo", "verde", "")

/** Which filter group a public report belongs to. */
private fun reportGroup(r: PublicReports.Report): String = when {
    r.isTrapped -> MapFilters.TRAPPED
    r.isResource -> MapFilters.AID
    else -> MapFilters.DAMAGE
}

/** Resources/trapped have a fixed badge colour; damage takes its severity colour. */
private fun categoryFixedColor(cat: String): String? = when (cat) {
    "aid_point" -> "#16A34A"
    "shelter" -> "#0D9488"
    "water_point" -> "#2563EB"
    "trapped_people" -> "#DC2626"
    else -> null
}

/** Badge image name — damage carries its severity so red vs yellow buildings differ. */
private fun iconNameFor(cat: String, severity: String): String = when {
    !CATEGORY_ICON.containsKey(cat) -> "ic_default|$severity"
    categoryFixedColor(cat) != null -> cat
    else -> "$cat|$severity"
}

/** The full fixed set of badge images to register with the style (data-independent). */
private fun iconRegistry(): List<Triple<String, String, String>> {
    val out = ArrayList<Triple<String, String, String>>()
    for ((cat, emoji) in CATEGORY_ICON) {
        val fixed = categoryFixedColor(cat)
        if (fixed != null) out.add(Triple(cat, emoji, fixed))
        else for (sev in SEVERITIES) out.add(Triple("$cat|$sev", emoji, severityHex(sev)))
    }
    for (sev in SEVERITIES) out.add(Triple("ic_default|$sev", "📍", severityHex(sev)))
    return out
}

// Lower key = placed first when icons collide, so life-critical markers win the declutter.
private fun categorySortKey(cat: String): Float = when (cat) {
    "trapped_people" -> 0f
    "medical_need" -> 1f
    "gas_leak" -> 2f
    "collapsed_building" -> 3f
    "damaged_building" -> 4f
    "shelter" -> 5f
    "aid_point" -> 6f
    "water_point" -> 7f
    else -> 9f
}

/** A round badge: a severity/category-coloured disc with a white ring and the emoji on top. */
private fun badgeBitmap(emoji: String, bgHex: String, size: Int = 120): android.graphics.Bitmap {
    val bmp = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bmp)
    val cx = size / 2f
    val r = size * 0.46f

    val disc = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    disc.color = runCatching { android.graphics.Color.parseColor(bgHex) }.getOrDefault(android.graphics.Color.GRAY)
    canvas.drawCircle(cx, cx, r, disc)

    val ring = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    ring.style = android.graphics.Paint.Style.STROKE
    ring.strokeWidth = size * 0.06f
    ring.color = android.graphics.Color.WHITE
    canvas.drawCircle(cx, cx, r, ring)

    val text = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    text.textAlign = android.graphics.Paint.Align.CENTER
    text.textSize = size * 0.5f
    val y = cx - (text.descent() + text.ascent()) / 2f
    canvas.drawText(emoji, cx, y, text)
    return bmp
}

// Caracas / La Guaira — default view when there are no pins to fit.
private val DEFAULT_CENTER = LatLng(10.555, -66.917)

private fun Int.hex() = String.format("#%06X", 0xFFFFFF and this)

private fun severityHex(sev: String): String = when (sev) {
    "rojo" -> "#EF4444"
    "naranja" -> "#F97316"
    "amarillo" -> "#EAB308"
    "verde" -> "#22C55E"
    else -> "#94A3B8"
}

private fun severityColor(sev: String) = androidx.compose.ui.graphics.Color(
    ("FF" + severityHex(sev).removePrefix("#")).toLong(16),
)

private fun categoryLabel(cat: String): String = when (cat) {
    "collapsed_building" -> "Edificio colapsado"
    "damaged_building" -> "Edificio dañado"
    "gas_leak" -> "Fuga de gas"
    "trapped_people" -> "Personas atrapadas"
    "aid_point" -> "Punto de ayuda"
    "shelter" -> "Refugio"
    "water_point" -> "Punto de agua"
    "medical_need" -> "Necesidad médica"
    "road" -> "Vía / acceso"
    else -> cat.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

private fun verificationLabel(v: String): String = when (v) {
    "official_verified" -> "verificado oficial"
    "community_confirmed" -> "confirmado por la comunidad"
    "unverified" -> "sin verificar"
    else -> v.replace('_', ' ')
}

/** Marker fill colour by semantic kind: aid = green/teal/blue, trapped = strong red, damage = severity. */
private fun markerHex(r: PublicReports.Report): String = when {
    r.isTrapped -> "#DC2626"
    r.category == "aid_point" -> "#16A34A"
    r.category == "shelter" -> "#0D9488"
    r.category == "water_point" -> "#2563EB"
    else -> severityHex(r.severity)
}

private fun markerRadius(r: PublicReports.Report): Double = when {
    r.isTrapped -> 9.0
    r.category == "collapsed_building" -> 6.5
    r.isResource -> 6.0
    else -> 5.0
}

/** A tapped public (unsigned) report, shown in the info card. */
private data class PublicSelection(
    val title: String,
    val category: String,
    val severity: String,
    val verification: String,
    val municipio: String,
    val resourceStatus: String,
    val peopleTrapped: Int,
    val siteClass: String,
    val siteVs30: Int,
)

@Composable
fun MapScreen(signals: List<MeshStore.Signal>, onOpen: (String) -> Unit, onOpenPersons: (String) -> Unit = {}) {
    data class Pin(val id: String, val lat: Double, val lng: Double, val type: String, val tier: String)

    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // Layer filters (shared with Ajustes). Reading these subscribes to live toggles.
    MapFilters.ensureLoaded(context)
    val showSigned = MapFilters.isOn(MapFilters.SIGNED)
    val showAid = MapFilters.isOn(MapFilters.AID)
    val showDamage = MapFilters.isOn(MapFilters.DAMAGE)
    val showTrapped = MapFilters.isOn(MapFilters.TRAPPED)
    val showUsgs = MapFilters.isOn(MapFilters.USGS)
    val showEmsc = MapFilters.isOn(MapFilters.EMSC)
    val showPersons = MapFilters.isOn(MapFilters.PERSONS)
    val showGdacs = MapFilters.isOn(MapFilters.GDACS)

    val pins = remember(signals) {
        signals.mapNotNull { s ->
            val code = (s.report.payload["plus_code"] ?: s.report.payload["plus_code8"])?.toString()
            PlusCode.decode(code)?.let { Pin(s.report.id, it.lat, it.lng, s.report.type, s.fold.tierName) }
        }
    }

    // Public SOS Venezuela 2026 overlay — fetched once, empty if offline.
    var publicReports by remember { mutableStateOf<List<PublicReports.Report>>(emptyList()) }
    LaunchedEffect(Unit) { publicReports = PublicReports.fetch() }

    // Earthquake epicenters: USGS + EMSC merged (EMSC is denser regionally), deduped.
    var quakes by remember { mutableStateOf<List<UsgsQuakes.Quake>>(emptyList()) }
    LaunchedEffect(Unit) {
        val merged = ArrayList<UsgsQuakes.Quake>()
        val seen = HashSet<String>()
        for (q in UsgsQuakes.fetch() + EmscQuakes.fetch()) {
            // ~0.1° + 0.5-magnitude bucket → the same quake reported by both feeds collapses.
            val key = "%.1f|%.1f|%.0f".format(q.lat, q.lng, q.mag * 2)
            if (seen.add(key)) merged.add(q)
        }
        quakes = merged
    }

    // GDACS official alert level for the Venezuela earthquake (status banner).
    var gdacs by remember { mutableStateOf<GdacsAlert.Alert?>(null) }
    LaunchedEffect(Unit) { gdacs = GdacsAlert.fetchVenezuela() }

    // Reported persons (centralized PFIF) aggregated to neighborhood centroids — privacy-safe.
    var personsAgg by remember { mutableStateOf<List<PfifPersons.LocalityCount>>(emptyList()) }
    LaunchedEffect(Unit) { personsAgg = PfifPersons.localityCounts() }
    val personIconsDone = remember { mutableStateOf(false) }

    // "You are here" — runtime location permission + a hoisted map ref for the recenter button.
    var hasLocation by remember { mutableStateOf(hasLocationPermission(context)) }
    val locationDone = remember { mutableStateOf(false) }
    val mapRef = remember { mutableStateOf<MapLibreMap?>(null) }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        hasLocation = result.values.any { it }
    }
    LaunchedEffect(Unit) {
        if (!hasLocation) {
            permLauncher.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION))
        }
    }

    // Non-delegated state so the (once-registered) map click listener can mutate it.
    val selectedPublic = remember { mutableStateOf<PublicSelection?>(null) }
    val selectedQuake = remember { mutableStateOf<QuakeSelection?>(null) }
    // One-time re-fit once the (async) quakes arrive, to bring the M6+ epicenters into view.
    val didFitQuakes = remember { mutableStateOf(false) }
    val quakeIconsDone = remember { mutableStateOf(false) }

    val styleUri = remember {
        runCatching {
            context.assets.open("basemap-style.json").close()
            OFFLINE_STYLE_ASSET
        }.getOrDefault(ONLINE_STYLE)
    }

    val pinJson = remember(pins, showSigned) {
        val features = JSONArray()
        for (p in if (showSigned) pins else emptyList()) {
            features.put(
                JSONObject()
                    .put("type", "Feature")
                    .put("geometry", JSONObject().put("type", "Point").put("coordinates", JSONArray().put(p.lng).put(p.lat)))
                    .put(
                        "properties",
                        JSONObject()
                            .put("id", p.id)
                            .put("color", Labels.typeColor(p.type).toArgb().hex())
                            .put("ring", (Labels.tierColor[p.tier]?.toArgb() ?: 0xFF64748B.toInt()).hex())
                            .put("radius", if (p.type == "sos") 11.0 else 8.0),
                    ),
            )
        }
        JSONObject().put("type", "FeatureCollection").put("features", features).toString()
    }

    val overlayJson = remember(publicReports, showAid, showDamage, showTrapped) {
        val features = JSONArray()
        // Draw order: aid first (bottom), then damage, then trapped (top) so the
        // life-critical markers are never hidden under the dense damage cloud.
        val groupOn = mapOf(MapFilters.AID to showAid, MapFilters.DAMAGE to showDamage, MapFilters.TRAPPED to showTrapped)
        val ordered = publicReports
            .filter { groupOn[reportGroup(it)] != false }
            .sortedBy { if (it.isTrapped) 2 else if (it.isResource) 0 else 1 }
        for (r in ordered) {
            // Verification drives ring + opacity, mirroring the app's own trust tiers.
            val (strokeColor, strokeWidth, opacity) = when (r.verification) {
                "official_verified" -> Triple("#FFFFFF", 1.8, 0.95)
                "community_confirmed" -> Triple("#FFFFFF", 0.6, 0.78)
                else -> Triple("#94A3B8", 0.0, 0.42) // unverified: faint, no ring
            }
            features.put(
                JSONObject()
                    .put("type", "Feature")
                    .put("geometry", JSONObject().put("type", "Point").put("coordinates", JSONArray().put(r.lng).put(r.lat)))
                    .put(
                        "properties",
                        JSONObject()
                            .put("color", markerHex(r))
                            .put("radius", markerRadius(r))
                            .put("strokeColor", strokeColor)
                            .put("strokeWidth", strokeWidth)
                            .put("opacity", opacity)
                            .put("icon", iconNameFor(r.category, r.severity))
                            .put("sortKey", categorySortKey(r.category))
                            .put("title", r.title)
                            .put("category", r.category)
                            .put("severity", r.severity)
                            .put("verification", r.verification)
                            .put("municipio", r.municipio)
                            .put("resourceStatus", r.resourceStatus)
                            .put("peopleTrapped", r.peopleTrapped)
                            .put("siteClass", r.siteClass)
                            .put("siteVs30", r.siteVs30),
                    ),
            )
        }
        JSONObject().put("type", "FeatureCollection").put("features", features).toString()
    }

    val quakeJson = remember(quakes, showUsgs, showEmsc) {
        val features = JSONArray()
        for (q in quakes.filter { if (it.source == "EMSC") showEmsc else showUsgs }) {
            features.put(
                JSONObject()
                    .put("type", "Feature")
                    .put("geometry", JSONObject().put("type", "Point").put("coordinates", JSONArray().put(q.lng).put(q.lat)))
                    .put(
                        "properties",
                        JSONObject()
                            .put("color", magHex(q.mag))
                            .put("radius", magRadius(q.mag))
                            .put("magicon", quakeIconName(q.mag))
                            .put("mag", q.mag)
                            .put("place", q.place)
                            .put("depth", q.depthKm)
                            .put("time", q.timeMs)
                            .put("url", q.url),
                    ),
            )
        }
        JSONObject().put("type", "FeatureCollection").put("features", features).toString()
    }

    val personsJson = remember(personsAgg, showPersons) {
        val features = JSONArray()
        for (l in if (showPersons) personsAgg else emptyList()) {
            features.put(
                JSONObject()
                    .put("type", "Feature")
                    .put("geometry", JSONObject().put("type", "Point").put("coordinates", JSONArray().put(l.lng).put(l.lat)))
                    .put(
                        "properties",
                        JSONObject()
                            .put("radius", personsRadius(l.total))
                            .put("countIcon", personsIconName(l.total))
                            .put("name", l.name)
                            .put("missing", l.missing)
                            .put("found", l.found),
                    ),
            )
        }
        JSONObject().put("type", "FeatureCollection").put("features", features).toString()
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp).padding(top = 12.dp)) {
        Text("Mapa", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Pines firmados + reportes públicos (ayuda · daño · atrapados)",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
        )

        if (showGdacs) gdacs?.let { GdacsBanner(it, context) }

        MapFilterRow(context)

        remember { MapLibre.getInstance(context) }
        val mapView = remember { MapView(context) }

        DisposableEffect(lifecycleOwner) {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_CREATE -> mapView.onCreate(null)
                    Lifecycle.Event.ON_START -> mapView.onStart()
                    Lifecycle.Event.ON_RESUME -> mapView.onResume()
                    Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                    Lifecycle.Event.ON_STOP -> mapView.onStop()
                    Lifecycle.Event.ON_DESTROY -> mapView.onDestroy()
                    else -> {}
                }
            }
            lifecycleOwner.lifecycle.addObserver(observer)
            onDispose {
                lifecycleOwner.lifecycle.removeObserver(observer)
                mapView.onDestroy()
            }
        }

        Box(Modifier.fillMaxWidth().weight(1f)) {
            AndroidView(factory = { mapView }) { view ->
                view.getMapAsync { map ->
                    mapRef.value = map
                    if (map.style == null) {
                        map.setStyle(Style.Builder().fromUri(styleUri)) { style ->
                            // Overlay first → it draws UNDER the signed pins.
                            style.addSource(GeoJsonSource(OVERLAY_SOURCE, FeatureCollection.fromJson(overlayJson)))
                            style.addLayer(
                                CircleLayer(OVERLAY_LAYER, OVERLAY_SOURCE).withProperties(
                                    PropertyFactory.circleColor(Expression.get("color")),
                                    PropertyFactory.circleRadius(Expression.get("radius")),
                                    PropertyFactory.circleOpacity(Expression.get("opacity")),
                                    PropertyFactory.circleStrokeColor(Expression.get("strokeColor")),
                                    PropertyFactory.circleStrokeWidth(Expression.get("strokeWidth")),
                                    PropertyFactory.circleStrokeOpacity(0.9f),
                                ),
                            )
                            // Category emoji icons on top of the dots; they declutter
                            // automatically (allow-overlap off) so dense areas stay legible.
                            iconRegistry().forEach { (name, e, hex) -> style.addImage(name, badgeBitmap(e, hex)) }
                            style.addLayer(
                                SymbolLayer(OVERLAY_SYMBOL_LAYER, OVERLAY_SOURCE).withProperties(
                                    PropertyFactory.iconImage(Expression.get("icon")),
                                    // Scale with zoom so icons are readable wide-out and don't
                                    // swamp the map when zoomed in.
                                    PropertyFactory.iconSize(
                                        Expression.interpolate(
                                            Expression.linear(), Expression.zoom(),
                                            Expression.stop(9, 0.5f),
                                            Expression.stop(13, 0.72f),
                                            Expression.stop(16, 0.95f),
                                        ),
                                    ),
                                    PropertyFactory.iconAllowOverlap(false),
                                    PropertyFactory.iconIgnorePlacement(false),
                                    PropertyFactory.iconOpacity(Expression.get("opacity")),
                                    PropertyFactory.symbolSortKey(Expression.get("sortKey")),
                                ),
                            )
                            // Reported-persons aggregate: hollow violet neighborhood bubbles + count.
                            style.addSource(GeoJsonSource(PERSONS_SOURCE, FeatureCollection.fromJson(personsJson)))
                            style.addLayer(
                                CircleLayer(PERSONS_LAYER, PERSONS_SOURCE).withProperties(
                                    PropertyFactory.circleColor(PERSONS_HEX),
                                    PropertyFactory.circleRadius(Expression.get("radius")),
                                    PropertyFactory.circleOpacity(0.18f),
                                    PropertyFactory.circleStrokeColor(PERSONS_HEX),
                                    PropertyFactory.circleStrokeWidth(1.6f),
                                    PropertyFactory.circleStrokeOpacity(0.9f),
                                ),
                            )
                            style.addLayer(
                                SymbolLayer(PERSONS_LABEL_LAYER, PERSONS_SOURCE).withProperties(
                                    PropertyFactory.iconImage(Expression.get("countIcon")),
                                    PropertyFactory.iconSize(0.5f),
                                    PropertyFactory.iconAllowOverlap(true),
                                    PropertyFactory.iconIgnorePlacement(true),
                                ),
                            )

                            // USGS earthquake epicenters: translucent magnitude disc + label.
                            style.addSource(GeoJsonSource(QUAKE_SOURCE, FeatureCollection.fromJson(quakeJson)))
                            style.addLayer(
                                CircleLayer(QUAKE_LAYER, QUAKE_SOURCE).withProperties(
                                    PropertyFactory.circleColor(Expression.get("color")),
                                    PropertyFactory.circleRadius(Expression.get("radius")),
                                    PropertyFactory.circleOpacity(0.35f),
                                    PropertyFactory.circleStrokeColor(Expression.get("color")),
                                    PropertyFactory.circleStrokeWidth(2.0f),
                                    PropertyFactory.circleStrokeOpacity(0.95f),
                                ),
                            )
                            style.addLayer(
                                SymbolLayer(QUAKE_LABEL_LAYER, QUAKE_SOURCE).withProperties(
                                    PropertyFactory.iconImage(Expression.get("magicon")),
                                    PropertyFactory.iconSize(0.55f),
                                    PropertyFactory.iconAllowOverlap(true),
                                    PropertyFactory.iconIgnorePlacement(true),
                                    PropertyFactory.iconOffset(arrayOf(0f, -26f)),
                                ),
                            )
                            if (quakes.isNotEmpty()) {
                                quakes.distinctBy { it.mag }.forEach { q ->
                                    style.addImage(quakeIconName(q.mag), magLabelBitmap("M${q.mag}", magHex(q.mag)))
                                }
                                quakeIconsDone.value = true
                            }
                            if (personsAgg.isNotEmpty()) {
                                personsAgg.distinctBy { it.total }.forEach { l ->
                                    style.addImage(personsIconName(l.total), magLabelBitmap("${l.total}", "#7C3AED"))
                                }
                                personIconsDone.value = true
                            }

                            // Signed pins on top.
                            style.addSource(GeoJsonSource(PIN_SOURCE, FeatureCollection.fromJson(pinJson)))
                            style.addLayer(
                                CircleLayer(PIN_LAYER, PIN_SOURCE).withProperties(
                                    PropertyFactory.circleColor(Expression.get("color")),
                                    PropertyFactory.circleRadius(Expression.get("radius")),
                                    PropertyFactory.circleStrokeColor(Expression.get("ring")),
                                    PropertyFactory.circleStrokeWidth(3.5f),
                                    PropertyFactory.circleStrokeOpacity(0.95f),
                                    PropertyFactory.circleOpacity(0.95f),
                                ),
                            )

                            // Fit to the signed rescue pins plus any major (M6+) epicenters,
                            // so the headline earthquake context is visible on open.
                            val fitPoints = pins.map { LatLng(it.lat, it.lng) } +
                                quakes.filter { isMajorNearby(it) }.map { LatLng(it.lat, it.lng) }
                            if (fitPoints.size >= 2) {
                                val bounds = LatLngBounds.Builder().includes(fitPoints).build()
                                map.easeCamera(CameraUpdateFactory.newLatLngBounds(bounds, 150), 700)
                            } else {
                                val center = fitPoints.firstOrNull() ?: DEFAULT_CENTER
                                map.easeCamera(CameraUpdateFactory.newLatLngZoom(center, 13.0), 600)
                            }

                            if (hasLocation && !locationDone.value) {
                                enableMyLocation(map, style, context)
                                locationDone.value = true
                            }
                        }

                        map.addOnMapClickListener { point ->
                            val screen = map.projection.toScreenLocation(point)
                            // Tolerance box around the tap — tiny dots are hard to hit dead-on.
                            val t = 28f
                            val box = android.graphics.RectF(screen.x - t, screen.y - t, screen.x + t, screen.y + t)
                            // Signed pins win over the public overlay.
                            val signed = map.queryRenderedFeatures(box, PIN_LAYER).firstOrNull()?.getStringProperty("id")
                            if (signed != null) {
                                selectedPublic.value = null
                                selectedQuake.value = null
                                onOpen(signed)
                                return@addOnMapClickListener true
                            }
                            val quake = map.queryRenderedFeatures(box, QUAKE_LAYER).firstOrNull()
                            if (quake != null) {
                                selectedPublic.value = null
                                selectedQuake.value = QuakeSelection(
                                    mag = quake.getNumberProperty("mag")?.toDouble() ?: 0.0,
                                    place = quake.getStringProperty("place") ?: "",
                                    depthKm = quake.getNumberProperty("depth")?.toDouble() ?: 0.0,
                                    timeMs = quake.getNumberProperty("time")?.toLong() ?: 0L,
                                    url = quake.getStringProperty("url") ?: "",
                                )
                                return@addOnMapClickListener true
                            }
                            val loc = map.queryRenderedFeatures(box, PERSONS_LAYER).firstOrNull()
                            if (loc != null) {
                                // Bubbles are aggregate centroids — open the filtered directory
                                // for the real per-person detail rather than a fake point.
                                loc.getStringProperty("name")?.let { onOpenPersons(it) }
                                return@addOnMapClickListener true
                            }
                            val pub = map.queryRenderedFeatures(box, OVERLAY_LAYER).firstOrNull()
                            if (pub != null) {
                                selectedQuake.value = null
                                selectedPublic.value = PublicSelection(
                                    title = pub.getStringProperty("title") ?: "Reporte público",
                                    category = pub.getStringProperty("category") ?: "",
                                    severity = pub.getStringProperty("severity") ?: "",
                                    verification = pub.getStringProperty("verification") ?: "",
                                    municipio = pub.getStringProperty("municipio") ?: "",
                                    resourceStatus = pub.getStringProperty("resourceStatus") ?: "",
                                    peopleTrapped = pub.getNumberProperty("peopleTrapped")?.toInt() ?: 0,
                                    siteClass = pub.getStringProperty("siteClass") ?: "",
                                    siteVs30 = pub.getNumberProperty("siteVs30")?.toInt() ?: 0,
                                )
                                true
                            } else {
                                selectedPublic.value = null
                                selectedQuake.value = null
                                false
                            }
                        }
                    } else {
                        // Style already loaded — just refresh the data on each layer.
                        map.style?.getSourceAs<GeoJsonSource>(PIN_SOURCE)?.setGeoJson(FeatureCollection.fromJson(pinJson))
                        map.style?.getSourceAs<GeoJsonSource>(OVERLAY_SOURCE)?.setGeoJson(FeatureCollection.fromJson(overlayJson))
                        map.style?.getSourceAs<GeoJsonSource>(QUAKE_SOURCE)?.setGeoJson(FeatureCollection.fromJson(quakeJson))
                        map.style?.getSourceAs<GeoJsonSource>(PERSONS_SOURCE)?.setGeoJson(FeatureCollection.fromJson(personsJson))

                        // Register the per-magnitude pill badges once the quakes arrive.
                        val st = map.style
                        if (st != null && !quakeIconsDone.value && quakes.isNotEmpty()) {
                            quakes.distinctBy { it.mag }.forEach { q ->
                                st.addImage(quakeIconName(q.mag), magLabelBitmap("M${q.mag}", magHex(q.mag)))
                            }
                            quakeIconsDone.value = true
                        }
                        if (st != null && !personIconsDone.value && personsAgg.isNotEmpty()) {
                            personsAgg.distinctBy { it.total }.forEach { l ->
                                st.addImage(personsIconName(l.total), magLabelBitmap("${l.total}", "#7C3AED"))
                            }
                            personIconsDone.value = true
                        }
                        // Permission may have been granted after the style loaded — enable now.
                        if (st != null && hasLocation && !locationDone.value) {
                            enableMyLocation(map, st, context)
                            locationDone.value = true
                        }

                        // Re-fit once when the major epicenters first arrive.
                        if (!didFitQuakes.value && quakes.any { isMajorNearby(it) }) {
                            val fitPoints = pins.map { LatLng(it.lat, it.lng) } +
                                quakes.filter { isMajorNearby(it) }.map { LatLng(it.lat, it.lng) }
                            if (fitPoints.size >= 2) {
                                val bounds = LatLngBounds.Builder().includes(fitPoints).build()
                                map.easeCamera(CameraUpdateFactory.newLatLngBounds(bounds, 150), 700)
                                didFitQuakes.value = true
                            }
                        }
                    }
                }
            }

            // Recenter-on-me button (top-right of the map).
            androidx.compose.material3.Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = androidx.compose.foundation.shape.CircleShape,
                shadowElevation = 3.dp,
                modifier = Modifier
                    .align(androidx.compose.ui.Alignment.TopEnd)
                    .padding(10.dp)
                    .size(44.dp)
                    .clickable {
                        if (!hasLocation) {
                            permLauncher.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION))
                        } else {
                            @SuppressLint("MissingPermission")
                            val loc = mapRef.value?.locationComponent?.let { if (it.isLocationComponentActivated) it.lastKnownLocation else null }
                            if (loc != null) {
                                mapRef.value?.easeCamera(CameraUpdateFactory.newLatLngZoom(LatLng(loc.latitude, loc.longitude), 14.0), 700)
                            }
                        }
                    },
            ) {
                Box(contentAlignment = androidx.compose.ui.Alignment.Center) { Text("📍", fontSize = 20.sp) }
            }

            selectedPublic.value?.let { sel ->
                androidx.compose.material3.Card(
                    modifier = Modifier
                        .align(androidx.compose.ui.Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(8.dp),
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            androidx.compose.foundation.Canvas(Modifier.size(12.dp)) {
                                drawCircle(severityColor(sel.severity))
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(
                                sel.title.ifBlank { "Reporte público" },
                                fontSize = 15.sp,
                                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "✕",
                                fontSize = 16.sp,
                                color = MaterialTheme.colorScheme.outline,
                                modifier = Modifier
                                    .padding(start = 8.dp)
                                    .clickable { selectedPublic.value = null },
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            listOf(categoryLabel(sel.category), sel.municipio, sel.severity)
                                .filter { it.isNotBlank() }
                                .joinToString(" · "),
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (sel.peopleTrapped > 0) {
                            Spacer(Modifier.height(2.dp))
                            Text(
                                "🆘 ${sel.peopleTrapped} persona(s) atrapada(s)",
                                fontSize = 12.sp,
                                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                                color = androidx.compose.ui.graphics.Color(0xFFEF4444),
                            )
                        }
                        if (sel.resourceStatus.isNotBlank()) {
                            Spacer(Modifier.height(2.dp))
                            Text(
                                if (sel.resourceStatus == "open") "🟢 Abierto" else sel.resourceStatus,
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (sel.siteClass.isNotBlank()) {
                            Spacer(Modifier.height(2.dp))
                            val amp = when (sel.siteClass) { "D", "E" -> " · amplificación alta"; "C" -> " · amplificación media"; else -> "" }
                            Text(
                                "Suelo NEHRP clase ${sel.siteClass}" +
                                    (if (sel.siteVs30 > 0) " · Vs30 ${sel.siteVs30} m/s" else "") + amp,
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.outline,
                            )
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Verificación: ${verificationLabel(sel.verification)} · Fuente: SOS Venezuela 2026 (sin firmar)",
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
                }
            }

            selectedQuake.value?.let { q ->
                androidx.compose.material3.Card(
                    modifier = Modifier
                        .align(androidx.compose.ui.Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(8.dp)
                        .clickable {
                            if (q.url.isNotBlank()) {
                                runCatching {
                                    context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(q.url)))
                                }
                            }
                        },
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            androidx.compose.foundation.Canvas(Modifier.size(14.dp)) {
                                drawCircle(androidx.compose.ui.graphics.Color(("FF" + magHex(q.mag).removePrefix("#")).toLong(16)))
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "Sismo M${q.mag}",
                                fontSize = 15.sp,
                                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "✕",
                                fontSize = 16.sp,
                                color = MaterialTheme.colorScheme.outline,
                                modifier = Modifier.padding(start = 8.dp).clickable { selectedQuake.value = null },
                            )
                        }
                        if (q.place.isNotBlank()) {
                            Spacer(Modifier.height(6.dp))
                            Text(q.place, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "Profundidad ${"%.0f".format(q.depthKm)} km · " +
                                android.text.format.DateUtils.getRelativeTimeSpanString(q.timeMs),
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.outline,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Fuente: USGS · toca para ver el detalle oficial",
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
                }
            }

        }

        Spacer(Modifier.height(8.dp))
        Text(
            buildString {
                append("Toca un pin firmado para ver el detalle")
                if (publicReports.isNotEmpty()) append(" · ${publicReports.size} reportes públicos (SOS Venezuela 2026)")
                if (quakes.isNotEmpty()) append(" · ${quakes.size} sismos (USGS+EMSC)")
                if (personsAgg.isNotEmpty()) append(" · personas por parroquia (${personsAgg.size})")
                append(if (styleUri == ONLINE_STYLE) " · base en línea" else " · base sin conexión")
            },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Top-of-map status banner from GDACS, coloured by official alert level. */
@Composable
private fun GdacsBanner(alert: GdacsAlert.Alert, context: android.content.Context) {
    val (bg, fg, dot) = when (alert.level.lowercase()) {
        "red" -> Triple(MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer, androidx.compose.ui.graphics.Color(0xFFEF4444))
        "orange" -> Triple(androidx.compose.ui.graphics.Color(0xFF7C3A0E), androidx.compose.ui.graphics.Color(0xFFFFE7CC), androidx.compose.ui.graphics.Color(0xFFF97316))
        else -> Triple(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, androidx.compose.ui.graphics.Color(0xFF22C55E))
    }
    val levelEs = when (alert.level.lowercase()) { "red" -> "Roja"; "orange" -> "Naranja"; "green" -> "Verde"; else -> alert.level }
    androidx.compose.material3.Surface(
        color = bg,
        shape = MaterialTheme.shapes.small,
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .clickable {
                if (alert.reportUrl.isNotBlank()) {
                    runCatching {
                        context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(alert.reportUrl)))
                    }
                }
            },
    ) {
        Row(
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            androidx.compose.foundation.Canvas(Modifier.size(10.dp)) { drawCircle(dot) }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "GDACS · Alerta $levelEs",
                    style = MaterialTheme.typography.labelLarge,
                    color = fg,
                )
                Text(
                    listOf(alert.title, alert.dateText).filter { it.isNotBlank() }.joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = fg.copy(alpha = 0.85f),
                )
            }
            Text("Ver informe ↗", style = MaterialTheme.typography.labelSmall, color = fg.copy(alpha = 0.9f))
        }
    }
}

/** Horizontally-scrollable layer filter chips, shown under the title on the map. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun MapFilterRow(context: android.content.Context) {
    val scroll = rememberScrollState()
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(scroll).padding(bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        androidx.compose.material3.FilterChip(
            selected = MapFilters.isOn(MapFilters.SIGNED),
            onClick = { MapFilters.toggle(context, MapFilters.SIGNED) },
            label = { Text("Firmadas") },
        )
        androidx.compose.material3.FilterChip(
            selected = MapFilters.isOn(MapFilters.AID),
            onClick = { MapFilters.toggle(context, MapFilters.AID) },
            label = { Text("Ayuda") },
        )
        androidx.compose.material3.FilterChip(
            selected = MapFilters.isOn(MapFilters.DAMAGE),
            onClick = { MapFilters.toggle(context, MapFilters.DAMAGE) },
            label = { Text("Daño") },
        )
        androidx.compose.material3.FilterChip(
            selected = MapFilters.isOn(MapFilters.TRAPPED),
            onClick = { MapFilters.toggle(context, MapFilters.TRAPPED) },
            label = { Text("Atrapados") },
        )
        // Sismos = USGS + EMSC combined (toggled together on the map).
        val sismos = MapFilters.isOn(MapFilters.USGS) || MapFilters.isOn(MapFilters.EMSC)
        androidx.compose.material3.FilterChip(
            selected = sismos,
            onClick = {
                val v = !sismos
                MapFilters.set(context, MapFilters.USGS, v)
                MapFilters.set(context, MapFilters.EMSC, v)
            },
            label = { Text("Sismos") },
        )
        androidx.compose.material3.FilterChip(
            selected = MapFilters.isOn(MapFilters.PERSONS),
            onClick = { MapFilters.toggle(context, MapFilters.PERSONS) },
            label = { Text("Personas") },
        )
    }
}
