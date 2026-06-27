# Baran — Android field app (Phase 1)

The offline mesh node. Native **Kotlin + Jetpack Compose**, reusing the
vector-locked `baran-core` for schema, crypto, and the trust fold. Spanish-first
(es-VE), large touch targets, works fully offline with **zero account**.

## What's implemented

**6 rescuer screens** (`ui/screens/`):

| Screen | File | What it does |
|---|---|---|
| **Señales** | `SignalsScreen.kt` | Live list sorted by priority; honest tier + reach badges per signal |
| **Mapa** | `MapScreen.kt` | Offline schematic map — pins positioned by decoding Plus Codes, tap to open. (Production: MapLibre + bundled PMTiles) |
| **Crear** | `CreateScreen.kt` | 3-step create flow (tipo → ubicación + "disminuir precisión" → detalles) → **signs locally** |
| **Detalle** | `DetailScreen.kt` | Full provenance, attestation timeline w/ proof details, action bar (corroborar / en sitio / a salvo / disputar) |
| **Yo** | `ProfileScreen.kt` | Pseudonymous Ed25519 identity, role, local data controls |
| **Ajustes** | `SettingsScreen.kt` | Idioma, modo de batería, accesibilidad, **modo puente**, estado de la malla |

**Flows**: create-SOS (signs a real `report`); proximity attestation (the *En sitio*
dialog builds an `on_site` proof and signs a real `device-near` attestation).

**Honest UI**: trust **tier** and internet **reach** are two separate axes
(`ui/components/Badges.kt`), never conflated; a verified record can still be only
`en la red`.

## Shared core (JVM-verified)

The authoring logic lives in `baran-core` so it is testable without the Android SDK:

- `baran.app.SignalEngine` — builds + **signs** real `report`/`attestation` records and
  folds trust via the same `VerificationFold` every Baran target uses.
- `baran.app.Reach` — the `in_mesh → bridged → anchored` axis.
- `baran.geo.PlusCode` — offline Open Location Code encode/decode.

These are covered by `baran-core` `SignalEngineTest` (signs verifying records, folds
through all tiers + dispute, Plus Code round-trip) — run with the rest of the core
vectors via the convergence gate.

## What is deferred / needs hardware

- **Ditto mesh transport** (`mesh/MeshService.kt` is the foreground-service shell):
  wired behind `SyncTransport`/`SignedRecordStore`; pending the offline-license answer.
  `MeshStore` is an in-memory stand-in so the **real UI drives real signed records and
  the real fold** — only the radio is deferred.
- **Android Keystore / StrongBox** for the private key (`data/LocalIdentity.kt` uses
  SharedPreferences as a dev placeholder; see the in-file note).
- **MapLibre + PMTiles** offline basemap (the schematic map renders the same pin model).
- Building the APK and the 4-phone field demo require the **Android SDK + physical
  devices** (BLE/Doze/clock-skew); emulators don't count for the exit gate.

## Build (on a machine with the Android SDK)

```bash
./gradlew :android:assembleDebug   # app-debug.apk
```
