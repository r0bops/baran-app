package venrescate.android.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.FeatureCollection
import venrescate.android.data.MeshStore
import venrescate.android.net.PublicReports
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
fun MapScreen(signals: List<MeshStore.Signal>, onOpen: (String) -> Unit) {
    data class Pin(val id: String, val lat: Double, val lng: Double, val type: String, val tier: String)

    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    val pins = remember(signals) {
        signals.mapNotNull { s ->
            val code = (s.report.payload["plus_code"] ?: s.report.payload["plus_code8"])?.toString()
            PlusCode.decode(code)?.let { Pin(s.report.id, it.lat, it.lng, s.report.type, s.fold.tierName) }
        }
    }

    // Public SOS Venezuela 2026 overlay — fetched once, empty if offline.
    var publicReports by remember { mutableStateOf<List<PublicReports.Report>>(emptyList()) }
    LaunchedEffect(Unit) { publicReports = PublicReports.fetch() }

    // Non-delegated state so the (once-registered) map click listener can mutate it.
    val selectedPublic = remember { mutableStateOf<PublicSelection?>(null) }

    val styleUri = remember {
        runCatching {
            context.assets.open("basemap-style.json").close()
            OFFLINE_STYLE_ASSET
        }.getOrDefault(ONLINE_STYLE)
    }

    val pinJson = remember(pins) {
        val features = JSONArray()
        for (p in pins) {
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

    val overlayJson = remember(publicReports) {
        val features = JSONArray()
        // Draw order: aid first (bottom), then damage, then trapped (top) so the
        // life-critical markers are never hidden under the dense damage cloud.
        val ordered = publicReports.sortedBy { if (it.isTrapped) 2 else if (it.isResource) 0 else 1 }
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

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Text("Mapa", fontSize = 22.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
        Text(
            "Pines firmados + reportes públicos (ayuda · daño · atrapados)",
            fontSize = 11.sp, color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.padding(bottom = 8.dp),
        )

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

                            if (pins.size >= 2) {
                                val bounds = LatLngBounds.Builder().includes(pins.map { LatLng(it.lat, it.lng) }).build()
                                map.easeCamera(CameraUpdateFactory.newLatLngBounds(bounds, 140), 600)
                            } else {
                                val center = pins.firstOrNull()?.let { LatLng(it.lat, it.lng) } ?: DEFAULT_CENTER
                                map.easeCamera(CameraUpdateFactory.newLatLngZoom(center, 13.0), 600)
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
                                onOpen(signed)
                                return@addOnMapClickListener true
                            }
                            val pub = map.queryRenderedFeatures(box, OVERLAY_LAYER).firstOrNull()
                            if (pub != null) {
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
                                false
                            }
                        }
                    } else {
                        // Style already loaded — just refresh the data on each layer.
                        map.style?.getSourceAs<GeoJsonSource>(PIN_SOURCE)?.setGeoJson(FeatureCollection.fromJson(pinJson))
                        map.style?.getSourceAs<GeoJsonSource>(OVERLAY_SOURCE)?.setGeoJson(FeatureCollection.fromJson(overlayJson))
                    }
                }
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
        }

        Spacer(Modifier.height(8.dp))
        Text(
            buildString {
                append("Toca un pin firmado para ver el detalle")
                if (publicReports.isNotEmpty()) append(" · ${publicReports.size} reportes públicos (SOS Venezuela 2026)")
                append(if (styleUri == ONLINE_STYLE) " · base en línea" else " · base sin conexión")
            },
            fontSize = 11.sp, color = MaterialTheme.colorScheme.outline,
        )
    }
}
