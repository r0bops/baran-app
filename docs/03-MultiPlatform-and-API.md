Verification confirms the decisive fact: Ditto's BLE/Wi-Fi Aware/Wi-Fi Direct mesh transports live in the **native** SDKs; the JavaScript SDK running in a browser/WebView "cannot operate peer-to-peer transports natively due to browser limitations" and must connect to **Big Peer (cloud)" over WebSocket. This resolves the three-way framework conflict across the input sections (the "Ditto JS Wasm + Capacitor = full mesh node" premise does not hold). Here is the assembled addendum.

---

# Baran — Multi-Platform Delivery & API Seam

*(Spec addendum. Extends the Baran field spec at `/root/Hackathons/qvac/venezuela-build/planning/App1-Baran-spec.md`. Where this addendum and the base spec disagree, this addendum governs the multi-platform surface only; the field record model, trust fold, and crypto remain authoritative as written in §2–§5 of the base spec.)*

Baran ships to three operationally distinct targets that share **one signed-record data model** but **not one runtime**. The Android APK is a full peer in the offline phone-to-phone mesh — the only target that can be, because BLE / Wi-Fi Aware / Wi-Fi Direct / Nearby / Ditto P2P are native-mobile-only capabilities no browser or desktop can join. Desktop (Windows/macOS/Linux, Tauri) and Mobile Web/PWA (React) are **online coordinator surfaces** that reach the field *indirectly* through a future cloud Data API (Ditto Big Peer or a thin HTTPS bridge), never through the mesh. We deliberately do **not** force a single shared runtime: the APK stays native Kotlin + Jetpack Compose + the Ditto Kotlin SDK to own every radio; desktop and web share a React/TypeScript codebase that is a thin, read-mostly cloud client. The only thing genuinely shared across all three is the **canonical record schema, the deterministic verification fold, the reach ladder, and the crypto envelope** — specified once and locked by cross-language test vectors so every device computes identical trust from identical records.

> **The honest split:** **APK = the offline mesh node (works with zero signal, zero infrastructure). Desktop + Web = online-only coordinator consoles that see the field through the cloud API and can never join the mesh.** A record that is still `in_mesh` (local-only, not yet bridged to the internet) is invisible to desktop/web *by design* — they only ever see records that have reached `bridged` or higher.

---

## Part 1 — Platform-Capability Matrix & Target Roles

### Three operational planes

- **Plane A — On-device mesh (APK only).** Android phones gossip signed CRDT records over BLE / Wi-Fi Aware / Wi-Fi Direct / LAN + QR/NFC sneakernet. Store-carry-forward. Works with **zero infrastructure**. No desktop or browser participates.
- **Plane B — Gateway bridge (Android only).** Any field phone that momentarily gets signal auto-elects as a transient, stateless gateway: it batches its outbox to the cloud and pulls replies/tasking back into the mesh. Desktops/browsers can **read from** what the gateway produced but never act as a gateway.
- **Plane C — Cloud spine (Ditto Big Peer or HTTPS bridge).** Holds the union of bridged records. Desktop + web are **purely synchronous clients of Plane C**. There is **no direct Plane A ↔ desktop/web link**.

### Target roles at a glance

| Target | Primary personas | Role | Mesh? | Offline? |
|---|---|---|---|---|
| **Android APK** | On-site rescuer, SAR operator, family in-zone | **Field mesh node** — create/sign/verify/relay, opportunistic gateway | **Full peer** | **Full (0 signal, 0 peers)** |
| **Desktop** | NGO coordinator, SAR command post, ops center | **Online coordinator console** — global picture, tasking, audit | No (cloud client) | Cache-only read |
| **Mobile Web / PWA** | Diaspora/family abroad, remote reporter, public viewer | **Remote reporter & viewer** — author SOS/missing-person, corroborate, view | No (cloud client) | Cache-only read |

### Capability matrix

| Dimension | Android APK | Desktop | Mobile Web/PWA |
|---|---|---|---|
| **Mesh participation** | ✅ Full peer, gossip, replication, carry-forward | ❌ Cloud only | ❌ Cloud only |
| **Offline operation** | ✅ Full (SOS, map, sign, verify with 0 connectivity) | ⚠️ Last-synced cache read only | ⚠️ Service-worker cache read only |
| **Transports** | BLE, Wi-Fi Aware, Wi-Fi Direct, LAN, QR/NFC + opportunistic cloud bridge | WebSocket/HTTPS to cloud | HTTPS/WebSocket to cloud |
| **Ed25519 signing** | ✅ On-device, hardware keystore (StrongBox) | ✅ Coordinator key in OS-encrypted store (passphrase) | ⚠️ Browser SubtleCrypto/IndexedDB (XSS-exposed) or server-side signing |
| **Proximity proofs** | ✅ GPS, Plus Code, BLE rolling beacon, QR/NFC, subject cosign | ❌ None (not in field) | ❌ None (manual geo + QR scan only) |
| **Trust tiers it can originate** | Reported → Corroborated → On-site → Device-confirmed → Self-confirmed | Coordinator `status`/tasking + `corroborate`/`resolve` only | Author SOS/missing-person/need/hazard + `corroborate`/`dispute` only |
| **Map & tiles** | ✅ Pre-bundled offline OSM/PMTiles, full native render | ⚠️ Server tiles + local cache | ⚠️ Server tiles + service-worker cache |
| **Reach visibility** | `in_mesh` → `bridged` → `anchored` | `bridged` / `anchored` only | `bridged` / `anchored` only |
| **Background sync** | ✅ Foreground service + Doze-exempt duty cycle | N/A (foreground app) | ⚠️ Service Worker best-effort |
| **Gateway role** | ✅ Elective, transient | ❌ Client only | ❌ Client only |
| **Power management** | 4-bucket duty cycle (Normal/Conserve/Frugal/Lifeline) | N/A (mains) | Browser battery saver only |
| **Reliability tier** | **Critical path** | Support / amplification | Public participation |

### Web Bluetooth — explicitly out of scope for mesh

The Web Bluetooth API (Chrome/Edge only; absent in Firefox/Safari; HTTPS + per-device user gesture required) can connect to **one** manually-selected device. It **cannot** scan for many peers, gossip, multi-hop relay, or run a mesh. It is **not** a path to mesh participation and is not used by Baran. Browsers are cloud clients, full stop.

### Critical honesty rule

Desktop and web **must never render an `in_mesh`-only record as reachable or actionable.** If a field SOS has not yet hit a gateway, it does not exist on a remote coordinator's map. This prevents remote responders from chasing a signal that has not propagated, and keeps every surface honest about its own reach.

---

## Part 2 — Cross-Platform Stack Decision (the crux)

### Decision

| Plane | Target | Stack | Ditto role |
|---|---|---|---|
| **A** | **Android APK** | **Native Kotlin + Jetpack Compose** + Ditto **Kotlin** SDK v5 | Full mesh node (native BLE/Wi-Fi Aware/Wi-Fi Direct + opportunistic cloud bridge) |
| **B** | **Desktop** (Win/macOS/Linux) | **Tauri v2** (Rust shell) + **React 19 + TypeScript** | Ditto **JavaScript** SDK as a **Big Peer cloud client** (WebSocket), or custom HTTPS bridge client |
| **B** | **Mobile Web / PWA** | **React 19 + TypeScript** (same codebase as desktop, split at routing) + Workbox SW | Ditto **JavaScript** SDK as a **Big Peer cloud client**, or custom HTTPS bridge client |
| **C** | Cloud spine | Ditto Big Peer **or** thin HTTPS+WS bridge | Holds union of bridged records |

**Shared layer (all three):** canonical CBOR/COSE record schema, the deterministic **trust fold**, the **reach ladder**, proof-validation predicates, and the Ed25519/X25519 crypto envelope — authored once, implemented natively per language, and **locked by cross-language test vectors**. The *coupling point that matters* is the **Data API contract + the test vectors**, not a single shared binary.

### Why the APK must be native (and why we reject "one Wasm runtime everywhere")

One input proposal was React/TS + Capacitor + Ditto **JavaScript/Wasm** on *all three*, claiming the Capacitor-wrapped APK becomes a full mesh node via a JS BLE plugin. **We reject this**, because it does not match how Ditto's transport stack works:

- Ditto's BLE / Wi-Fi Aware / Wi-Fi Direct / AWDL mesh transports are implemented in the **native** SDKs (Kotlin/Swift). Per Ditto's own docs, "web browsers have very limited peer-to-peer capabilities" and the JavaScript SDK in a browser context **must connect to a Big Peer (cloud) and sync over WebSocket** — it does **not** drive the BLE/Wi-Fi mesh. A Capacitor app runs its JS inside a system **WebView**, i.e. exactly that browser context, so Ditto-JS there falls back to cloud/WebSocket, not mesh.
- A `@capacitor-community/bluetooth-le` plugin gives raw GATT from JS, but Ditto's mesh protocol (neighbor discovery, multi-transport duty-cycling, redundant-connection management, CRDT delta sync) is **not** designed to run over an arbitrary third-party JS BLE plugin. Wiring one up would be a from-scratch reimplementation of Ditto's transport layer — the opposite of "no hand-waving."

Therefore: **the life-safety-critical mesh path is native Kotlin + Ditto Kotlin SDK.** This is non-negotiable. The base spec's native-Kotlin choice for the APK **stands**.

### Why desktop + web are React/TypeScript, not Flutter or KMP-everywhere

- **Flutter** (full-stack) — Ditto's Flutter SDK is production-grade and Flutter desktop/web work, but Flutter desktop has thin enterprise traction and Flutter Web's Wasm path is still maturing; harder to guarantee multi-year stability for a crisis tool, and it would force rewriting the *native* APK too. Rejected.
- **Kotlin Multiplatform + Compose Multiplatform everywhere** — keeps Android native, but **Ditto integration is not multiplatform**: the Kotlin SDK is Android-only; desktop/web would need the Java or JavaScript SDK anyway. Compose Web is Beta. So KMP buys you a shared *UI* you don't want (rescuer vs coordinator UX are deliberately different) at the cost of *still* needing per-platform Ditto. Rejected as the *delivery* framework. **However** — see below — KMP is a legitimate **optional** way to package the shared *logic* core.
- **React 19 + TypeScript** for desktop + web — desktop and web coordinator UX are ~85% the same screens at different breakpoints, so one React codebase covers both with Tauri as the desktop shell and a PWA build for web. Ditto's **JavaScript SDK is the only Ditto SDK that runs in a browser**, so it is the natural cloud client for both. Standard tooling (Vite, TanStack Query), easy hiring, no backend impedance mismatch. **Selected for Plane B.**
- **Tauri v2 over Electron** for the desktop shell — ~8 MB vs ~150 MB bundle (matters for low-bandwidth distribution), faster startup, stable since Oct 2024. Electron remains an acceptable fallback if the team prefers a pure-Node integration. The desktop shell does no radio work, so the choice is ergonomic, not architectural.

### How the shared logic core stays in sync (the real coupling)

The schema/fold/crypto is the only code that *must* be byte-identical in behavior across Kotlin and TypeScript. Keep it honest with:

1. **A language-agnostic spec** for the record wire format (canonical CBOR, COSE-style sorted keys) and the §3.4 fold algorithm.
2. **Two reference implementations** — Kotlin (APK) and TypeScript (desktop/web). *Optionally*, extract the Kotlin reference as a **KMP `baran-core` artifact** consumed by the APK (and, if ever wanted, a JVM desktop), but this is an implementation convenience, **not** a requirement and **not** the cross-platform delivery vehicle.
3. **Shared cross-language test vectors**: sign a record in Kotlin, verify in TypeScript; feed an identical record+attestation set to both fold implementations and assert identical `tier / verified / disputed / reach`. This is a CI gate (the "Phase 0 convergence test").

### Toolchain summary

**APK (Plane A):** Kotlin, Jetpack Compose, Ditto Kotlin SDK v5 (pinned, offline license token), MapLibre Native + PMTiles, libsodium (Ed25519/X25519/XChaCha20), CameraX + ML Kit (QR), NFC HCE, Foreground Service + WorkManager. Build → signed `.apk`/`.aab`.

**Desktop (Plane B):** Rust + Tauri v2, React 19, TypeScript 5, `@dittolive/ditto` JS SDK (Big Peer client), `@tauri-apps/api`, Vite, Leaflet/MapLibre GL JS, TanStack Query. Build → `.msi` / `.dmg` / `.AppImage`/`.deb`.

**Web/PWA (Plane B):** React 19, TypeScript 5, `@dittolive/ditto` JS SDK (Big Peer client), Workbox SW, Vite, Leaflet/MapLibre GL JS. Build → static bundle on any HTTPS/CDN host; installable PWA.

### Ditto single-vendor risk (P0) and the transport seam

Single-vendor dependence on Ditto (offline licensing, BLE behavior, cloud availability) is a P0 risk. Mitigations:

1. **Lock the version** (e.g. Ditto v5.x pinned); no auto-upgrade during a blackout.
2. **Confirm offline licensing in writing** *before* deployment: tokens must be issued to device identities, **not** expiry-locked to build date, and renewable offline via QR before a blackout. **Hard-stop blocker.**
3. **Abstract the transport** behind a `SyncTransport` interface on the APK (see Part 3). If Ditto fails catastrophically, swap in **Google Nearby Connections + an open CRDT (Yjs/Automerge)** without touching the record schema, fold, or crypto. Build `NearbyTransport` in parallel during Phase 1 so the fallback is tested before the dependency hardens.
4. **Signatures are verified before merge**, so a malicious or compromised cloud cannot forge field records.

---

## Part 3 — Shared-Core vs Platform-Specific Architecture

### Three tiers

**Tier 1 — Shared logic core (all platforms).** Record schema + canonical CBOR/COSE serialization; deterministic **trust fold** (§3.4); proof validation (gps_match, pluscode_match, ble_encounter, subject_cosign, qr_nfc); Plus Code geometry + proximity thresholds; CRDT merge predicates (order-independent, idempotent); identity/key handling (Ed25519/X25519, minus hardware wrappers); reach computation; subscription/query predicates. **No Ditto, no platform I/O.** Implemented in Kotlin (APK) and TypeScript (desktop/web); optionally packaged as a KMP `baran-core` artifact for the JVM side.

**Tier 2 — Platform transport & store (native per target), behind two interfaces:**

- **APK:** `DittoTransport` (wraps Ditto Kotlin SDK) + fallback `NearbyTransport`; `DittoStore` (Ditto embedded DB) + fallback `RoomStore` (SQLite). Plus foreground service, WorkManager, StrongBox keystore, native radios, battery state machine.
- **Desktop:** `CloudAPITransport` (HTTP/WebSocket to Plane C); `LocalSQLiteStore` (SQLDelight) for offline read cache.
- **Web/PWA:** `CloudAPITransport` (fetch/WebSocket); `IndexedDBStore` for offline read cache; Service Worker for asset caching.

**Tier 3 — Presentation (platform-native, intentionally divergent):** Compose for Android (rescuer UX); React + Tauri for desktop and React PWA for web (coordinator UX). Same data, **opposite** information hierarchy — rescuers see the shared picture + take local actions; coordinators see all bridged records + issue tasking.

### Abstraction boundaries (the two interfaces that decouple logic from backend)

```kotlin
interface SyncTransport {                 // swappable: Ditto / Nearby / CloudAPI
  suspend fun start(config: TransportConfig)
  suspend fun stop()
  fun subscribe(query: SyncQuery): Flow<List<Record>>
  suspend fun publish(record: Record, priority: Int = record.prio())
  fun peerInfo(): Flow<PeerInfo>          // count, isBridging ("Puente activo"), lastInternetContact
  fun bridgeReceipts(): Flow<BridgeReceipt> // record reached cloud → reach=bridged
}

interface SignedRecordStore {             // swappable: Ditto / Room / SQLite / IndexedDB
  suspend fun append(record: Record): Boolean         // append-only, idempotent on content_hash
  suspend fun query(q: SyncQuery): Flow<Record>
  suspend fun attestationsFor(reportId: String): List<Attestation>
  suspend fun getVerification(reportId: String): VerificationResult?
  suspend fun getMeta(recordId: String): RecordMeta?  // reach/read/pinned/muted — local-only, never synced
  suspend fun setMeta(recordId: String, meta: RecordMeta)
  suspend fun merge(delta: SyncDelta)
  suspend fun evictByPriority(targetBytes: Long): List<String>
}
```

`TransportConfig.enableCloudAPI` is `false` on Android (mesh-first) and `true` on desktop/web (cloud-only).

### Trust fold — the convergence guarantee

The §3.4 fold is a **pure, deterministic, order-independent** function `(report, attestations, subject) → VerificationResult`. It runs identically on every platform because:

1. Tier computation is a monotone lattice-max over a set of valid attestations (no input ordering effects).
2. Signatures are **verified before** the fold; unsigned/bad-sig records drop before merge.
3. `reach` is computed locally from signed `bridge` attestations + local-only `_meta`, never trusted from the wire.
4. Proofs are validated **offline** against local keys — no cloud lookup.

```kotlin
val tier = when {
  selfOK          -> TrustTier.SELF_CONFIRMED
  deviceOK        -> TrustTier.DEVICE_CONFIRMED
  proximityOK     -> TrustTier.ON_SITE
  distinctAgree>=2-> TrustTier.CORROBORATED
  else            -> TrustTier.REPORTED
}
val verified = proximityOK || deviceOK || selfOK || reporterAffirm
val disputed = validAtts.any { it.att_type == "dispute" } || hasConflictingFacts(validAtts)
```

**Mandatory Phase 0 convergence test:** emit the same SOS + attestation set into the APK store, a desktop mock `CloudAPITransport`, and a web IndexedDB store; assert all three render an **identical** verification chip (tier + reach). This is a CI gate.

### Module structure (abbreviated)

```
baran/
├── core/                      # shared logic (Kotlin ref; optional KMP artifact ~2 MB)
│   └── domain · schema(CBOR/COSE) · crypto · trust(fold) · geo(PlusCode) ·
│       mesh(SyncTransport, SignedRecordStore, SyncQuery, BridgeReceipt) ·
│       time(HLC, TTL) · model(VerificationResult, RecordMeta)
├── core-ts/                   # TypeScript port of schema+fold+crypto (desktop/web), test-vector-locked
├── android/                   # Plane A — Compose UI, Ditto+Nearby transport, BLE/Wi-Fi radios,
│   │                          #   StrongBox keystore, foreground service, QR/NFC, CameraX
│   └── app/ → baran-release.apk (+ bundled offline OSM tiles + Ditto SDK)
├── coordinator-web/           # Plane B — React 19 + TS; Ditto JS (Big Peer) / CloudAPI client
│   ├── (web build)  → static PWA bundle (index.html + app.js + manifest + SW)
│   └── (tauri build)→ desktop binaries (.msi / .dmg / .AppImage / .deb)
└── api-contract/              # OpenAPI 3.1 + shared cross-language test vectors (CI gate)
```

### Mesh vs API seam, side by side

| Aspect | Android mesh (Plane A) | Desktop/Web (Plane B) |
|---|---|---|
| Transport | Ditto P2P (BLE/Wi-Fi/Nearby) + cloud bridge | CloudAPI (HTTPS/WS) only |
| Record flow | peer ↔ peer (signed CRDT) → gateway → cloud | device → cloud → query back |
| Reach | `in_mesh` → `bridged` → `anchored` | `bridged` / `anchored` only |
| Store | Ditto embedded DB / Room (append-only) | SQLite / IndexedDB cache (append-only) |
| Trust tier | identical fold | identical fold |
| Latency | ms (P2P) to hours (carry-forward) | ~1–5 s (poll/subscribe) |
| Offline | full (create/map/verify) | partial (cached read; no publish until reconnect) |

---

## Part 4 — The API Seam (attach-later backend)

The backend is **not built in this phase**; this part defines the contract so it can be attached later without client changes. **The seam is the four-collection signed-record model + signed-CRDT merge + the subscription/mutation contract — the backend vendor is swappable.**

### Two interchangeable backend paths (same contract)

- **Path A — Ditto Big Peer (managed, zero custom code).** Desktop/web use the Ditto JS SDK to connect to Big Peer over WebSocket and consume CRDT collections directly. Simplest; binds to Ditto Big Peer licensing/availability.
- **Path B — Custom REST + WebSocket bridge (portable, self-hosted).** A thin **stateless** façade wraps Big Peer (or a delegated store) and exposes the *same* record semantics over REST + WebSocket, in our normalized model (not raw DQL). Enables air-gapped/BYOC deployment and independent auth/rate-limiting.

Both paths share: identical four-collection model, identical signature verification (re-checked on every bridge write — no forgery passes), identical subscription/publication semantics, identical offline→online reconciliation.

### Resource model (the four synced collections + local meta)

```
identities   _id=identity_id(pubkey hash) · pubkey_ed25519/x25519 · role · display_name   [LWW scalars]
subjects     _id=subject_id(PII-safe) · name_hash · age_band · home_plus_code ·
             subject_device_id · merged_into:OR-Set                                        [LWW + OR-Set]
reports      _id=author_id:author_seq · kind(sos|victim_found|need|status|hazard|missing_person) ·
             geo(WGS84+PlusCode) · subject_id? · hlc · wall_ms · prio · ttl_s · expires_at ·
             body · enc(X25519 sealed)? · refs[] · sig(Ed25519)               [IMMUTABLE append-only]
attestations _id=claimer_id:a:claimer_seq · target{report_id,content_hash}|{subject_id} ·
             att_type(corroborate|on_site|device_confirm|self_confirm|dispute|resolve|retract|anchor) ·
             assert{fact} · proof{type,…} · confidence · hlc · wall_ms · sig  [IMMUTABLE append-only]
_meta (LOCAL-ONLY, NEVER signed, NEVER synced): reach · read · pinned · received_at · hops
```

**Invariants:** reports/attestations are write-once, append-only, signed; merge is set-union + deterministic conflict surfacing (no silent overwrite). Identities/subjects carry mutable fields (LWW/OR-Set) because they describe a device/person, not a claim. `_meta` (including `reach`) is device-local and recomputed, never on the wire.

### Read paths — subscriptions & queries

**WebSocket:** `wss://api.baran.zone/v1/live` (Path A = Ditto Big Peer; Path B = bridge). Client subscribes to a collection with AND-ed filters: `geo{lat,lng,radius_km}`, `kind[]`, `prio{min,max}`, `expires_at{gt,lt}`, `reach[]`, `tier[]`, `author_id`, `subject_id`, `disputed`. Optional `projection` to trim body/enc for list views. Server emits `snapshot` then incremental `update` frames with explicit actions: `insert`, `tier_change` (attestation promoted a report), `reach_change` (`in_mesh`→`bridged`), `conflict` (both signed sides included), `delete`/retract (hide, not erase).

**REST queries (cache-keyed by filter hash):**

| Endpoint | Returns | TTL |
|---|---|---|
| `GET /v1/records?geohash=&since=&prio=&kind=&tier=&disputed=` | filtered reports + attestations + `cursor` + aggregates | 30 s |
| `GET /v1/records/:id/attestations` | full provenance chain for trust fold | 10 s |
| `GET /v1/subjects/:id` | subject + merged-link graph | 2 min |
| `GET /v1/identities/:id` | pubkey + role + fingerprint | 5 min |
| `GET /v1/search` | multi-collection geo/text search | 30 s |

Every returned record carries server-stamped `_meta.reach`. **No server-side tier computation** — clients run the §3.4 fold locally so two coordinators always agree without trusting server authority.

**Push SLA:** P0/P1 < 5 s from cloud ingestion to client; P2–P3 < 30 s; P4 (photos/tiles) < 2 min.

### Write paths — mutations (online clients only)

Only the cloud side authors **after** field capture; field records sync up via gateway, coordinator records sync down. A coordinator posts a `status`/reply targeting an existing report:

```
POST /v1/replies   (Path B) — Authorization: Bearer <coordinator_token>
{ "kind":"status", "author_id":"k_coordinator_ngo", "author_seq":42,
  "refs":["k_ana9f2a:1"], "body":{"text":"Equipo en camino. ETA 30 min.","safe":false}, "prio":4 }
```

Bridge validation (reject on any failure): valid Ed25519 over canonical CBOR; `refs` point to real reports; `author_id` is a known coordinator key (whitelist / JWT-derived); `prio`/`ttl_s` within the author-role bounds; **field keys may not author replies** (field creates reports, coordinators create attestations/replies); X25519 seals decryptable by ≥1 recipient; no out-of-order seq (equivocation). **Idempotent** by `author_seq` + content hash. The bridge stamps `_meta.reach=bridged` and pushes the record down to connected gateways for re-injection into the mesh.

### Offline ↔ online reconciliation

**Field record up:** created+signed offline → gossiped P2P (`in_mesh`, sig verified every hop, never modified) → gateway batches outbox when any phone gets signal → cloud re-verifies sig + stores, sets `reach=bridged` → cloud emits a bridge receipt → receipt syncs back down as a CRDT merge so **online and offline devices converge** to seeing `bridged` on the original report.

**Coordinator reply down:** posted via web/desktop → cloud validates + stores → active gateway pulls it (or WS delivers live) → gateway re-injects as a signed CRDT record (no re-signing; just `refs` back) → mesh gossips P2P → recipient renders it with a `bridged` badge + coordinator identity.

**Conflict on merge:** two offline clusters with contradictory facts (e.g. "alive" vs "deceased") each stay internally consistent; when a mule carries both into range, merge is **set-union** — both signed records retained, conflict detected deterministically on every device, UI shows **Disputed** with both proofs; resolution requires a *new* signed record (dispute or higher-tier proof). Nothing is silently overwritten.

### Auth

- **Field (APK):** no login. Ed25519 keypair on first install; pubkey hash = pseudonymous DeviceID. Offline license token burned in pre-deployment. Every record signed; unsigned dropped before merge. Authority comes from signed append-only proof, not server grant.
- **Coordinator (web/desktop):** RBAC roles `read_only` / `reply_author` / `tasking_author` / `admin`. Bearer JWT `{operator_id, role, device_key_id, iat, exp}` signed by the cloud, stored in an httpOnly+sameSite cookie. Validated on every write; reads require a token but no role check (data is already PII-minimized). Coordinator **signing keys** are pre-registered Ed25519 (stable across JWT rotation for mesh consistency). Field keys never authenticate; coordinator keys never originate field reports.

### Reach badges, latency & ordering

Delivery is **at-least-once** (clients must be idempotent). Updates respect HLC **causal ordering** (a report is delivered before an attestation that references it). No replay on reconnect — a reconnecting client gets a fresh snapshot. Conflicts surface as `action:conflict` frames carrying both signed records.

### Optional GenLayer anchoring (edge-only, non-blocking)

When the cloud holds verified records (tier ≥ On-site, excluding `in_mesh`-only), it may batch their hashes into a Merkle root (PII excluded — hash only), submit to a GenLayer contract, and embed the tx hash in a new `anchor` attestation that syncs back down (`reach=anchored`). If GenLayer is unreachable, the field is unaffected — `anchored` simply isn't set. No field latency, ever.

### Deployment topology

- **Pattern 1 — Big Peer (managed):** `[Android mesh] → gateway phone (Small Peer) → Big Peer ← web/desktop JS SDK`. Zero custom backend; vendor-locked + metered.
- **Pattern 2 — Custom bridge (self-hosted):** `[Android mesh] → gateway → REST+WS bridge → Big Peer/custom DB ← REST+WS ← web/desktop`. Portable/on-prem/BYOC; engineering + ops cost.

Implementation sketch: stateless bridge (Cloud Run / Lambda / Fly.io) triggered by inbound Big Peer syncs; durable queue (SQS/PubSub) buffering bridged records + replies; datastore (Firestore/DynamoDB/Postgres) indexed by geohash + freshness; WebSocket relay for live subscriptions.

### Versioning

Endpoints are versioned (`/v1/`). Records carry `schema_v`; unknown fields are ignored gracefully so field phones and web clients update asynchronously across version skew. Breaking changes announced 90 days ahead; run both bridge versions during transitions.

### Seam contract (who does what)

| Aspect | Field (APK) | Cloud (bridge/Big Peer) | Web/Desktop |
|---|---|---|---|
| Sign records | ✅ device key | ✅ coordinator key | — |
| Verify sigs before merge | ✅ | ✅ | optional (UI fingerprint) |
| Compute tiers (§3.4) | ✅ | ✅ (cache) | ✅ (local sort) |
| Push up / pull down | ✅ gateway | receives/validates/sends | — |
| Subscribe | ✅ native | streams/polls | ✅ WebSocket |
| Stamp reach | ✅ local `_meta` | ✅ on inbound | ✅ consumed |
| Auth | Ed25519 (no login) | issues/validates JWT | JWT/operator creds |

---

## Part 5 — Spec Deltas vs the Base Field Spec

These edits layer the three-plane model onto the Android-only base spec.

- **§1 Architecture → Three-Plane Model.** Add Plane A (field APK / mesh), Plane B (desktop + web coordinators, online-only), Plane C (cloud Data API seam). Data flows **A → C → B** at bridge time; B is read-mostly and authors only `status`/tasking that flows back through C → A. No mesh peer joins from a browser/desktop — state this explicitly in the component diagram.
- **§2 Record model → unchanged**, now declared the **shared contract** across all three planes (identical CBOR/COSE; signatures valid end-to-end; no re-signing in the cloud).
- **§3.4 Trust fold → unchanged**, now declared **convergence-critical** and gated by cross-language (Kotlin↔TypeScript) test vectors.
- **§6 UX → add the Coordinator console (desktop + web).** Rescuer app (APK) keeps its five tabs (Mapa / Señales / FAB / Yo / Ajustes), fully offline. New coordinator surface = three responsive screens, same data:
  - **Console Home** — filter/search panel · all-bridged-records map (density heatmap by type) · selected-pin details + quick-reply composer. Top ribbon shows sync freshness: "N registros · última puente hace T min · próxima sync en S s." Never claim real-time.
  - **Task List** — priority-sorted reports without replies (P0 red / P1 amber / P2 grey) · team/task map · reply drafts. Coordinators author `status` records `{refs:[report_id], body, assigned_to?}` (signed, flow back into mesh).
  - **Report Timeline** — global audit/provenance: chronological attestation thread per report · signer details · proof diagram (GPS distance, BLE RSSI). Same append-only chain a rescuer sees.
  - Layout: desktop 13"+ three-column (filter / map / details); mobile web <768px single-column tabs with embedded map + tap-to-expand. Touch targets ≥ 48 px. Header always shows "Malla en línea ✓ (N)" vs "Malla sin puente — hace 8 min." **Honest reach** on every pin (in-mesh / bridged / anchored), never conflated with tier. **Coordinators cannot author SOS/reports — only `status`/tasking + corroborate/resolve.**
- **§7 Tech stack → split by plane** (Part 2 above): Plane A native Kotlin/Compose/Ditto-Kotlin (unchanged); Plane B React/TS with Tauri (desktop) + PWA (web) on the Ditto JS / HTTPS-bridge client. Reject single-Wasm-runtime-everywhere (mesh is native). Reject native iOS for Phase 1 (near-zero iOS in target barrios; iOS background BLE is restricted; PWA covers iOS coordinators).
- **§8 Build & distribution → three targets:** `.apk`/`.aab` (Play + sideload + mesh-shared QR-to-APK); Tauri desktop binaries (`.msi`/`.dmg`/`.AppImage`/`.deb` via GitHub Releases); PWA static bundle on CDN. GitHub Actions per target; macOS signing needs a paid Apple dev account; APK signed from a keystore in CI secrets.
- **Shared-asset reality:** ~20% genuinely shared (schema + CBOR canonicalization, §3.4 fold, crypto suite, map tile sets, **test vectors**); ~80% platform-native (UI, background services, radios, deployment). This redundancy is **accepted** — forcing a single shared runtime across three I/O models would cost more than the reimplementation saves, and would compromise the native mesh.

---

## Part 6 — Phased Delivery Plan

**Ordering principle:** the offline mesh is the entire reason Baran exists and is the hardest part — build and prove it **native and first**. The coordinator console is comparatively easy and rides a mock API until Phase 2. Don't block field shipping on backend infrastructure.

### Phase 0 — Scaffold, keys, Ditto offline validation *(~1 session)*
- APK boots offline; Ed25519 keypair on first run in Android Keystore; canonical CBOR sign/verify pipeline compiles.
- **Cross-language convergence harness** stood up (Kotlin ↔ TypeScript test vectors).
- **Acceptance:** two phones in airplane mode generate keys; a hand-signed record authored on phone 1 verifies on phone 2 over Ditto P2P. **Hard-stop checkpoint:** Ditto offline licensing confirmed in writing.

### Phase 1 — MVP / demo target *(~2–3 sessions per surface)*
- **APK (rescuer):** Compose UI + MapLibre offline tiles + record list; 3-step create (type → location → send, signs + broadcasts); BLE + Wi-Fi Direct propagation via Ditto with verify-on-merge; pins by type; reach badge; one-tap Corroborate / On-site; **gateway mode** (bridge up, pull replies down). Build `NearbyTransport` fallback in parallel.
- **Coordinator (web/PWA minimum):** React + Leaflet map + record list reading from a **mock cloud API** (static JSON / tiny echo server); filter by geohash; show tier + reach; "reply" creates a `status` record in the mock.
- **Acceptance:** full demo script on 4 phones — offline SOS created → human-relayed (carry-forward) → confirmed on-site → bridged up → replied from dashboard → delivered back through the mesh. Coordinator sees the same records on a map and can reply. APK is the only platform that ships in this phase.

### Phase 1b — Desktop app (same codebase, wrapped) *(~1 session)*
- Repackage the Phase 1 React app with **Tauri** (window chrome, file dialogs, native notifications); add the 3-column desktop layout; test macOS/Windows/Linux.
- **Acceptance:** desktop shows the same data as the PWA with filters + reply drafting. Three platforms sync the same records.

### Phase 2 — Trust depth, conflicts, real cloud API *(~2–3 sessions)*
- **APK:** full ladder (Reported / Corroborated / On-site / Device-confirmed / Self-confirmed / Disputed); proximity proofs (GPS/Plus-Code, BLE beacon, subject cosign, QR/NFC); authority rules (only reporter or proximity-proof holders raise tier); dispute surfacing (both sides, append-only).
- **Coordinator:** stand up the **real Data API** (Big Peer or custom bridge per Part 4); web/desktop read live; WebSocket subscriptions (records appear without refresh); coordinators author tasking that the API queues for bridge-back to the mesh.
- **Acceptance:** §8.3 verification/conflict matrix passes on 4 devices; live demo with one phone bridging — coordinator sees the record in real time and tasks it; task propagates back through the mesh.

### Phase 3 — Battery, range, carry-forward robustness *(~2 sessions)*
- **APK:** adaptive duty cycle (Normal/Conserve/Frugal/Lifeline); Doze-surviving foreground service; TTL + content-hash dedup/eviction; multi-hop mule chain.
- **Acceptance:** battery/range tests pass; 6-device mule chain completes with signatures intact and no OOM on a low-end phone. Coordinator inherits freshness via cursor polling (no changes).

### Phase 4 — Censorship spine, hardening, ops *(~2 sessions, lower priority)*
- **APK:** optional GenLayer anchoring of verified-record hashes; Duress PIN + decoy + quick-wipe; full Spanish i18n + low-literacy mode (voice prompts, icon-only, text scale).
- **Coordinator:** CSV export, bulk task assignment, supervisor audit log.
- **Acceptance:** anchored hashes verify on-chain; duress works; app fully usable in Spanish offline.

### Milestone summary

| Milestone | APK | Web/PWA | Desktop | Cloud API | Gate |
|---|---|---|---|---|---|
| **Phase 0** | keys + Ditto + convergence harness | — | — | — | architecture + offline license validated |
| **Phase 1** | MVP rescuer + gateway | mock API | — | mock | **DEMO READY** |
| **Phase 1b** | — | — | first release | — | three platforms proven |
| **Phase 2** | full trust + disputes | real API + WS | real API | real backend | field + coordination production-ready |
| **Phase 3** | battery + carry-forward | poll tuning | — | cursor pagination | mesh reliability at scale |
| **Phase 4** | GenLayer + duress + i18n | export/audit | admin UI | anchoring | censorship spine + hardening |

**Why this succeeds:** the mesh is built native and proven (Phase 1 demo) before a line of coordinator JS depends on a backend; the web/desktop console is genuinely cheap once the APK works and rides a mock API until Phase 2; and all three planes converge on **one schema + one fold locked by shared test vectors**, so cross-platform trust agreement is *measured*, not assumed.

Sources: [Ditto Mesh Networking 101](https://docs.ditto.live/sync/concepts/mesh-networking-101) · [Ditto Transports Overview](https://docs.ditto.live/sync/concepts/transports-overview) · [Ditto Customizing Transports v5](https://docs.ditto.live/sdk/v5/sync/customizing-transport-configurations) · [Ditto JS SDK release notes](https://docs.ditto.live/sdk/v4-9/release-notes/js) · [Web Bluetooth API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API) · [Tauri 2.0 stable](https://v2.tauri.app/blog/tauri-20/) · [Capacitor + React](https://capacitorjs.com/solution/react)
