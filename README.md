# Baran

**Offline, phone-only, peer-to-peer rescue-coordination mesh for disaster zones** — for when the power is out, the cell towers are down, and the internet is blacked out.

> *Named for Paul Baran, who invented the distributed, infrastructure-free, self-rerouting network. Companion to Faraday.*

## The problem

After a major disaster — like the 2026 Venezuela earthquake near Caracas / La Guaira — cell towers and power fail, and the only network left is the phones already in people's pockets. The people doing the rescuing (neighbors, volunteers, search teams) have no way to share who needs help, who has been found, and what has already been searched.

## What Baran does

People rescuing people create tiny, signed records — **SOS, victim-found, need, hazard, missing-person** — that:

- **Sync phone-to-phone** over Bluetooth / Wi-Fi, with no infrastructure;
- **Bridge to the internet automatically** through whoever momentarily catches a signal, and carry replies back into the dead zone;
- Build a **shared, eventually-consistent rescue picture** (map + list) so teams don't duplicate effort.

Trust is **computed, never asserted**: a report starts unverified and is raised only by the original reporter or by firsthand **proximity proof** — so a false "all clear" can't be faked.

## How it works

- **Three planes** — an on-device mesh (always works offline) → an opportunistic human gateway (whoever has a signal) → an optional cloud spine.
- **Append-only, Ed25519-signed CRDT records** that merge conflict-free across devices, even after long partitions.
- **Proximity-based verification tiers** (reported → corroborated → on-site → device-confirmed → self-confirmed), with disputes surfaced rather than hidden.
- **Honest by design** — the UI always shows *trust level* and *internet reach* as two separate things, and never fakes delivery.

## Stack

- Android-first (Kotlin + Jetpack Compose)
- **Ditto** — offline-first CRDT mesh sync + opportunistic cloud bridge
- **MapLibre** + offline OpenStreetMap
- **Ed25519 / X25519** signing & encryption · **Plus Codes** for locations

## Repository layout

```
packages/
  baran-core/         Kotlin reference: schema, Ed25519 crypto, verification fold, HLC,
                      SignalEngine + Plus Code codec (field-app authoring logic)
  baran-core-ts/      TypeScript port — byte-identical, locked by cross-language vectors
  baran-api-contract/ OpenAPI 3.1 spec for the cloud API seam
  baran-api-stub/     Phase-1 zero-dep mock API (serves real signed records over REST + WS)
  baran-api-server/   Phase-2 real backend — durable store, Ed25519 auth/RBAC, signed
                      bridge receipts, same vector-locked fold
apps/
  android/            Field APK — Jetpack Compose (Mapa/Señales/Crear/Detalle/Yo/Ajustes)
  coordinator-web/    React coordinator console (responsive 2-pane / 3-column desktop)
  coordinator-desktop/Tauri 2 wrapper — OS-keychain key store, signed installers
test-vectors/         The frozen oracle: keys, crypto, fold, clock vectors
docs/                 Implementation plan, field spec, multi-platform/API, P0 security,
                      and the frozen v1 record contract (docs/contract/)
```

Trust is **computed, never asserted** (5 tiers via the fold), and internet **reach**
(`in_mesh → bridged → anchored`) is a **separate axis** — the UI never conflates them.

## Build & test

```bash
# Shared core (TypeScript) — must reproduce all vectors
cd packages/baran-core-ts && npm install && npm run build && npm test

# Shared core (Kotlin) — same vectors, cross-language convergence gate
./gradlew :baran-core:test

# API seam + coordinator console (run together)
node packages/baran-api-server/src/server.mjs        # real backend on :3002 (or :3001)
cd apps/coordinator-web && npm install && npm run dev # console on :5173, proxies /v1

# Tests
node test/integration-test.mjs                        # API seam (stub)
node packages/baran-api-server/test/server-test.mjs   # auth/RBAC/persistence/bridge
```

The Android APK needs the Android SDK; the Tauri desktop app needs the platform
toolchain (webkit2gtk on Linux). See each app's `README.md`.

## Status

In active development — Phase 0 (convergence) and the Phase 2 coordinator surfaces
are implemented and tested; the offline mesh transport (Ditto) and field hardware
gates remain. Not yet released.
