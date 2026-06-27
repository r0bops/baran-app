# Baran — Implementation Plan

> Offline, phone-only, peer-to-peer rescue-coordination app + its online coordinator surfaces. This is the build roadmap: concrete tasks, deliverables, acceptance criteria, and tests across Phase 0 → Phase 4, plus the cross-cutting testing, CI/CD, dependency, risk, and milestone spine.

---

## Executive Summary

**Goal.** Build Baran: a distributed, CRDT-backed rescue mesh that works with **no internet, no cell towers, and no central server** in the field, while still surfacing the field picture to online coordinators (NGOs, SAR, family) through a thin cloud API. Field nodes form an opportunistic mesh over BLE / Wi-Fi Direct and carry rescue records (SOS, victim-found, missing-person, hazard, need, status) peer-to-peer. Every record is signed; trust is **computed, never asserted**; the same canonical record is understood identically by an offline Android phone and an online web console.

**The APK-first principle.** The native **Android APK is the only offline mesh node and the riskiest target**, so it is built first and is the source of the canonical data contract. "No mocks — only the real app": every component is the production component, and the **only deferred piece is the backend server** (designed and stubbed now, built in Phase 2). Desktop and web are **online-only** clients; they never join the radio mesh and can only see records whose reach is `bridged` or `anchored`.

**The hybrid stack (locked).**
- **Android APK (offline mesh node):** native Kotlin + Jetpack Compose + Ditto Kotlin SDK.
- **Mobile web / PWA (online coordinator):** React 19 + TypeScript.
- **Desktop (online coordinator):** Tauri 2 wrapping the same React app — one codebase, build-time routing/breakpoints.
- **Shared across all targets:** a single canonical record schema (deterministic CBOR/COSE), a deterministic **trust fold** (§3.4 of the field spec), the **reach ladder** (`in_mesh → bridged → anchored`), and the **crypto envelope** (Ed25519 sign, X25519 seal, BLAKE3 hash). The coupling point is the **data contract + cross-language test vectors**, not a shared binary. Kotlin and TypeScript each re-implement the contract faithfully; CI vectors prove byte-identical agreement.

**The API seam.** A REST + WebSocket API sits in front of Ditto Cloud (Big Peer) or, optionally, a custom HTTPS bridge. Coordinator records (`status`, `task`) are **signed locally with Ed25519**, tagged `origin:online` and **lower-trust until verified in-zone**, then re-injected into the mesh through an opportunistic gateway phone. The backend is built in Phase 2; its seam (`SyncTransport`, `SignedRecordStore`, `CloudAPITransport` interfaces + OpenAPI spec + mock server) is designed and stubbed from Phase 0/1.

**Security fixes folded in (non-negotiable).**
- **(P0-2) Device-confirmed = corroborated-location:** a Device-confirmed tier requires a subject-anchored Ed25519 challenge-response (subject signs its own coarse cell, echoed and re-verified on every device) **or** ≥2 independent attestors agreeing on the same coarse cell. No subject private key → no Device-confirmed.
- **(P0-3) Immutable-HLC round-4:** the signed HLC is **never mutated**; a class-gated ingress accept/reject gate replaces clamp-on-write (P0/P1 always replicate, P2/P3 quarantine on >30 min drift); a `BOOT_COUNT` reboot bridge + monotonic `elapsedRealtime()` anchor TTL; sort by causal HLC, not wall-clock. Validated by a **two-device skewed-clock convergence test on real hardware** (a Phase 2 blocker).

**What is deferred.** The cloud backend server (Phase 2); full coordinator depth and all five trust tiers wired to a real API (Phase 2); battery/scale hardening and field drills (Phase 3); coercion/surveillance protection, key recovery, flood control, GenLayer anchoring, full i18n, and production ops (Phase 4). iOS native is out of scope through Phase 2 (PWA covers iOS coordinators).

**Phase overview at a glance.**

| Phase | Theme | Ships | Headline exit gate |
|---|---|---|---|
| **0** | Foundations + convergence proof | Monorepo, keys, schema, fold, vectors | Two phones mesh offline; identical trust tier; Ditto offline licensing confirmed in writing |
| **1** | APK mesh core (deepest) | Field APK MVP + mock coordinator | 4-phone demo: offline SOS → carry-forward → bridge → reply |
| **1b** | Desktop wrapper | Signed Tauri desktop (Win/macOS/Linux) | 3-platform signed builds; same data as web |
| **2** | Cloud API seam + coordinator depth | Real API, all 5 tiers, web/PWA console | E2E field → coordinator → field; skewed-clock test passes |
| **3** | Field robustness | Battery, mesh range, carry-forward, OEM | ≥72 h standby on Redmi Go; P0 never silent-evicted |
| **4** | Hardening + ops | Coercion spine, flood control, anchoring, release | Panic-wipe, duress, P0 round-4 convergence, full es-VE |

---

## Table of Contents

1. **Foundations: Monorepo & Shared Packages**
2. **Phase 0 — Scaffold, Keys, Ditto Validation & Convergence Harness** (Tasks 0.1–0.10 + exit gate)
3. **Phase 1 — APK Mesh Core** (Workstreams 1.1–1.6 + exit gate + risks)
4. **Phase 1b — Desktop App (Tauri 2)** (1b.1–1b.3 + exit gate)
5. **Phase 2 — Cloud API Seam, Web/PWA & Coordinator Console** (2.1–2.8 + residual risks)
6. **Phase 3 — Field Robustness & Battery Efficiency** (Workstreams 3.1–3.6 + exit gate)
7. **Phase 4 — Hardening & Operational Security** (Workstreams 4.1–4.8 + exit gate)
8. **Cross-Cutting: Testing & Quality Harness** (8.1–8.6)
9. **Cross-Cutting: CI/CD per Target** (9.1–9.4)
10. **External Dependencies & Consolidated Risk Register** (10.1–10.5)
11. **Milestones & Sequencing Summary** (11.1–11.4)

---

# 1. Foundations: Monorepo & Shared Packages

### 1.1 Overview & Principles

Baran's foundation is a **three-plane, distributed, CRDT-backed rescue mesh** built on a single, cryptographically-locked data contract. The architectural bet: a **native Android APK** is the only viable offline peer in the mesh; desktop (Tauri) and web (React/PWA) are thin online-only coordinators that see the field indirectly through a cloud Data API seam, never through the radio mesh.

**In scope for the foundation:** monorepo scaffold, shared-package build, Ditto licensing validation, Ed25519 keystore, record schema + CBOR serialization, cross-language test vectors, and the convergence harness (field APK ↔ coordinator web, same record, identical trust tier). **Coupling point** is the data contract + test vectors, not a shared binary. Kotlin (`baran-core`) is the reference implementation; TypeScript (`baran-core-ts`) is a faithful re-port; both are locked by vectors.

Tooling: GitHub Actions CI/CD; `pnpm` workspaces + Gradle; `ktfmt`/`ktlint` (Kotlin) + `prettier`/`eslint` (TypeScript); 100-char lines, 2-space indent.

### 1.2 Monorepo Structure

Root: `/repo/baran/`.

```
baran/
├── .github/workflows/
│   ├── android-build.yml      # Gradle APK/AAB + Play Store
│   ├── desktop-build.yml      # Tauri Win/macOS/Linux (signed)
│   ├── web-deploy.yml         # React PWA + Cloudflare Pages
│   ├── convergence-gate.yml   # Kotlin↔TS test-vector gate (blocks PRs)
│   └── ci-gates.yml           # Phase 0 convergence harness + unit tests
├── gradle.properties          # Pinned: Kotlin 1.9.x, Gradle 8.x, Ditto SDK v5.1.x
├── settings.gradle.kts        # Subprojects: baran-core, android/app
├── pnpm-workspace.yaml        # TS workspaces: baran-core-ts, coordinator-web
├── package.json               # husky, prettier, commitlint
├── tsconfig.base.json         # ES2020, moduleResolution node, strict
│
├── baran-core/                # ← Shared logic core (Kotlin REFERENCE)
│   └── src/main/kotlin/baran/
│       ├── domain/            # Record, RecordId, TrustTier, VerificationResult, Reach, GeoProof
│       ├── schema/            # CanonicalCBOR, COSE, RecordSchema, SchemaV1
│       ├── crypto/            # Ed25519Signer, X25519Sealer, BLAKE3
│       ├── trust/             # TrustFold (§3.4), ProofValidator, ProximityProof, ReachComputation
│       ├── geo/               # GeoPoint, PlusCode, GeohashCell
│       ├── time/              # HLC, ClockBound
│       ├── mesh/              # SyncTransport, SignedRecordStore, SyncQuery, BridgeReceipt (interfaces)
│       └── util/              # Result, Extensions
│
├── baran-core-ts/             # ← TypeScript port (desktop/web), byte-identical to Kotlin
│   └── src/{domain,schema,crypto,trust,geo,time}/  # + index.ts
│
├── baran-api-contract/        # ← OpenAPI 3.1 spec + cross-language test vectors
│   ├── openapi-v1.yaml
│   └── test-vectors/
│       ├── convergence-vectors.json  # [{report, attestations, expected:{tier,verified,reach}}]
│       ├── crypto-vectors.json       # cross-sign validation
│       ├── cbor-vectors.json         # {record_json, expected_canonical_cbor_hex}
│       └── proof-vectors.json        # {proof, report, subject, expected_valid}
│
├── android/                   # ← Plane A: Field APK (Kotlin + Compose + Ditto)
│   └── app/src/main/kotlin/baran/
│       ├── MainActivity.kt, ui/screens/{Map,Signal,Create,Profile,Settings}Screen.kt
│       ├── data/{DittoStore,NearbyTransport,RoomStore,LocalPreferences}.kt
│       ├── service/{MeshSyncService,BridgeManager,DutyCycleManager,ProximityProofService}.kt
│       └── viewmodel/{Map,Create,Sync}ViewModel.kt
│
├── coordinator-web/           # ← Planes B & C: React 19 web + Tauri desktop
│   ├── src/{pages,components,hooks,lib,styles}/      # ConsolePage, MobilePage, Map.tsx, ...
│   ├── src-tauri/             # Tauri 2 Rust shell (window, dialogs, keychain)
│   └── public/               # index.html, manifest.json, service worker (Workbox)
│
├── tools/mock-api/            # Phase 1 mock cloud (Ktor/MockWebServer)
├── docs/                      # ARCHITECTURE, SCHEMA, TRUST-FOLD, CRYPTO, P0-RESOLUTIONS, PHASES
└── planning/                  # symlink to source spec docs
```

**Shared packages.** `baran-core` (Kotlin, reference) and `baran-core-ts` (TypeScript, port) re-implement the **same** domain model, canonical CBOR, COSE envelope, trust fold, proof validators, reach computation, Plus-Code geometry, and HLC. They are kept in lockstep by the convergence gate (§9.4). `baran-api-contract` holds the OpenAPI spec + the vectors that bind both.

---

# 2. Phase 0 — Scaffold, Keys, Ditto Validation & Convergence Harness

**Duration:** ~3–5 days. **Gate:** Two field phones generate distinct identities; a hand-signed record authored on phone 1 verifies on phone 2 over Ditto BLE mesh; the coordinator web console displays the same report with identical trust tier without internet; Ditto offline licensing confirmed **in writing** by the vendor.

### Task 0.1 — Monorepo Scaffold & Build Configuration

**Deliverables:** root `settings.gradle.kts` (subprojects: `baran-core`, `android/app`); `gradle.properties` pinning Kotlin 1.9.x / Gradle 8.x / Ditto Kotlin SDK v5.1.x; `pnpm-workspace.yaml` (`baran-core-ts`, `coordinator-web`); root `package.json` (prettier, typescript, lint); `tsconfig.base.json` (ES2020, node resolution, strict); `.prettierrc.json` (100 cols, 2-space); `ci-gates.yml` scaffolding the three gates (0.3/0.4/0.5); top-level README with clone + Phase 0 checklist.

**Acceptance:** `./gradlew build` compiles all subprojects (`baran-core` → `.jar`); `pnpm install` installs all TS workspaces; `pnpm -r prettier --check` passes; GitHub Actions logs pass/fail clearly.

**Tests:** Actions syntax valid; clean clone builds with no errors.

### Task 0.2 — Device Identity, Ed25519 Keystore & Key Generation

**Deliverables.**
- *Kotlin:* `Ed25519Signer.kt` (Tink/Conscrypt) — `generateKeypair()`, `sign(message, privkey) → 64-byte sig`, `verify(pubkey, message, sig)`. `LocalPreferences.kt` stores identity in Android Keystore (StrongBox if available): on first run generate keypair → store `pubkey_ed25519` (plaintext, replicated) + `privkey_ed25519` (Keystore-encrypted); derive `identity_id = "k_" + base64url(blake3(pubkey_ed25519)[0:16])`; expose `getIdentityId()`, `getPubkeyEd25519()`, `signBytes()`. Generate an X25519 keypair alongside (future E2E sealing).
- *TypeScript:* `ed25519.ts` (`@noble/ed25519`) — async `generateKeypair/sign/verify`. `device-identity.ts` manages identity in IndexedDB (web) / OS keychain (Tauri); coordinator keys are **pre-registered**, not self-generated at launch.

**Acceptance:** Each platform independently generates a keypair; **signatures on the same message are byte-identical** (deterministic Ed25519); Kotlin-signed message verifies in TypeScript with the Kotlin pubkey; APK creates identity in Keystore on first launch and persists across kill/restart (idempotent — no re-generate).

**Tests:** Unit sign/verify on both platforms; cross-language vector (Kotlin ↔ TypeScript).

### Task 0.3 — Record Schema, Canonical CBOR Serialization & Signing Pipeline

**Deliverables.**
- *Kotlin:* `Record.kt` sealed class with `Report` / `Attestation` / `Identity` / `Subject` data classes per spec §2.2–2.5; enums as sealed types (Kind, AttType, Role, Reach, TrustTier). `CanonicalCBOR.kt`: `toCBOR(record) → ByteArray` (lexicographically sorted keys, snake_case enums, binary as multibase-`u` base64url, omits `sig` and local `_meta`) + `fromCBOR(bytes)` with `schema_v` validation. `COSE.kt`: `signRecord(record, signer)` (CBOR minus sig → sign → attach) + `verifyRecord(record)` (recompute → verify → drop if invalid). `RecordBuilder.kt`: fluent builders managing HLC, seq, TTL defaults.
- *TypeScript:* `record.ts` union types (branded ID types); `canonical-cbor.ts` producing **byte-identical** output to Kotlin; cross-language test deserializes Kotlin CBOR hex, re-encodes, asserts identical bytes.

**Acceptance:** an `sos` `Report` with 5 fields encodes to a fixed byte sequence; Kotlin and TypeScript bytes match (debug until they do); a record signed in Kotlin → serialized → deserialized in TypeScript → verified with the Kotlin pubkey is valid; APK can create + sign a `victim_found` record locally.

**Tests:** CBOR vector test; cross-language sign/verify; schema validation.

### Task 0.4 — HLC Implementation & Clock Bounding (P0-3 round-4)

**Deliverables.**
- *Kotlin:* `HLC.kt` — `HLC(wall_ms, counter, node)`, `toString()` → `"<48b-hex>.<16b-hex>.<node>"` (sortable), `parse()`, monotonic increment (counter resets to 0 if `local_wall_ms > max_seen_wall`, else increments), thread-safe `AtomicReference` accumulator. `ClockBound.kt` — `clampIncomingWallMs(...)`: if `|incoming − local| > DRIFT_LIMIT_MS` (30 min), clamp **advisory only** (class-gated, never applied to the signed field), flag in `_meta` for UI. `createLocalHLC(nodeId)`.
- *TypeScript:* `hlc.ts` identical interface + logic.

**Acceptance:** local record creation advances HLC (counter increments on same wall_ms; resets on forward jump); receiving `wall_ms > now + 30 min` raises a flag but **does not alter the signed hlc**; two NTP-synced devices order merged records correctly; a device that skips forward 2 h resets its counter and writes its new local wall_ms (no self-clamp), while peers clamp incoming, not stored.

**Tests:** monotonicity (100 records → strictly increasing counters); clock-drift (device 1 sends `+1 h`, device 2 clamps for display, then device 2's own record remains causally ordered).

### Task 0.5 — Trust Fold (§3.4 canonical) & Convergence Harness

**Deliverables.**
- *Kotlin:* `TrustFold.kt` — `computeTrust(report, attestations, subject?) → VerificationResult(tier, verified, verifiedBy, disputed, reach, confidence_scope)`; deterministic, pure; implements §3.4 axioms (trust computed-never-stored, tier = lattice-max over proof types, Disputed = overlay); authority rule (§3.2: only reporter or proximity-proof holder unlocks the Verified band); idempotent + commutative (set-monotone max). `ProofValidator.kt` — `validProof(proof, report, subject?) → ProofType?`: `gps_match` (haversine ≤ 50 m, accuracy ≤ 50 m, `is_mock=false`), `pluscode_match` (exact 10-char or prefix-match for 8-char per P0-6), `ble_encounter_challenge` (subject sig + time binding + RSSI floor per P0-2), `subject_cosign`, `qr_nfc`. `ReachComputation.kt` — `reachOf(...)` checking signed `bridge` (Big Peer) / `anchor` (GenLayer) attestations → `IN_MESH → BRIDGED → ANCHORED` (P0-4).
- *TypeScript:* `trust-fold.ts` identical algorithm, tested against Kotlin output.
- *Convergence harness:* `convergence-vectors.json` (≥10 vectors covering Reported, Corroborated, On-site GPS, On-site Plus-Code coarse, Device-confirmed, Self-confirmed, Disputed, resolved). `ci-gates.yml` runs Kotlin `computeTrust` and TypeScript `computeTrust` on each vector → asserts **byte-identical** JSON; diff on failure.

**Acceptance:** all 10 vectors agree across Kotlin/TypeScript (FP tolerance on confidence); conflicting attestations (alive vs deceased) surface `disputed=true` on both; a mock `bridge` attestation flips reach `in_mesh → bridged`; a higher-tier resolve signed by the reporter clears `disputed`.

**Tests:** convergence harness; per-proof-validator unit tests; reach-state tests.

### Task 0.6 — Ditto Offline-Licensing Validation & Vendor Q&A (HARD GATE)

**Deliverables.** Written inquiry to Ditto with the four P0-1 §I blocks, documented responses in `docs/DITTO-VENDOR-VALIDATION.md`:
- **Q1** Do perpetual (never-expiring) offline license tokens exist, unbound to device IDs?
- **Q2** Can the Small Peer identity derive from our Ed25519 key?
- **Q3** Minimum BLE first-packet latency for 200 bytes on a 2 GB Android Go device?
- **Q4** May we swap Ditto transport for Google Nearby Connections if Ditto fails?

Offline license token provisioned and baked into the APK at build time. Confirmation: APK launches in airplane mode, authors + signs an SOS locally, contacts no network.

**Acceptance:** written answers on file; Q1 ≈ "yes, perpetual tokens exist"; Q3 ≤ 5 s for 200-byte first packet (>10 s → escalate Nearby to Phase 1); token baked in; APK runs offline without token fetch. **If answers are insufficient, begin the `NearbyTransport` fallback (stub now, full in Phase 1/3.2b).**

### Task 0.7 — Android APK Phase 0 Minimal Build & Identity Init

**Deliverables.** `MainActivity.kt` (empty Compose UI "Baran Phase 0"; on first launch `generateAndStoreIdentity()`; foreground notification "Identidad generada: k_XXXX…"). `AndroidManifest.xml` (BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION, INTERNET, READ_EXTERNAL_STORAGE; foreground service type `dataSync`). `build.gradle.kts` (baran-core, Ditto SDK v5.1, Compose, CameraX stub, OkHttp; debug signing; minify off). Build: `assembleDebug` → `app-debug.apk` (~80 MB with Ditto).

**Acceptance:** installs on Android 9+; first launch generates Ed25519 keypair, stores in Keystore, logs `identity_id`; survives kill/restart; idempotent.

**Tests:** Manual (install + verify Logcat); integration test in 0.8.

### Task 0.8 — Two-Phone Ditto Mesh Sync Spike (CONVERGENCE GATE)

**Setup.** Two Android devices (physical or emulated), **airplane mode ON** for both, both running the Phase 0 APK.

**Scenario.**
1. **Phone A** creates + signs a `victim_found` report (subject "Juan", `adult`; Plus Code; body `{condition:"trapped", people_count:1}`), serializes to CBOR, stores in Ditto.
2. **Phone B** polls local Ditto; observes the record arrive (gossiped over BLE).
3. Both recompute fold → tier `reported` (no attestations); **assert both JSON-identical**.
4. **Phone B** creates a signed `corroborate` attestation targeting A's report; Ditto gossips it back.
5. Both recompute → tier `corroborated`; **both log identical `VerificationResult` JSON**.

**Harness.** `DittoMeshConvergenceTest.kt` (instrumented; in-memory Ditto mock simulating B's merge; asserts identical fold output).

**Acceptance.** Distinct keys per phone; A's signed record verifies on B; both produce identical tier/verified/disputed/reach JSON. **HARD GATE — if this fails, Phase 0 is blocked.**

### Task 0.9 — Coordinator Web Mock Console (Static)

**Deliverables.** `ConsolePage.tsx` with hardcoded test data from 0.8, calling `trustFold(...)` from `@baranrescue/core-ts`; renders report card (kind, Plus Code, "Reportado · En malla"), attestation list (signer fingerprint), and a JSON dump of `{tier, verified, disputed, reach, confidence_scope}`. `trust-fold-adapter.ts` wraps the core-ts fold for API-shaped input. `vite.config.ts` static SPA build. PWA `manifest.json` + Workbox SW stub (static-asset cache only).

**Acceptance.** `pnpm run dev` displays the test report + attestations; the fold result matches the APK's JSON; build < 5 MB minified.

**Tests.** Visual inspection + fold-adapter unit test (vectors through TS fold match Kotlin).

### Task 0.10 — Cross-Platform Test Vector Validation (CI GATE)

**Deliverables.** `convergence-vectors.json` (≥10 vectors, all major tiers + Disputed + resolved). `ConvergenceVectorTest.kt` (Kotlin) and `convergence-vectors.test.ts` (Vitest) load vectors, run `computeTrust`, serialize, assert against `expected`. `ci-gates.yml` runs both; fails if **any** platform diverges, with side-by-side diff.

**Acceptance.** All ≥10 vectors pass on both platforms; cover Reported/Corroborated/On-site/Device-confirmed/Self-confirmed/Disputed/resolved; a deliberately broken impl (hardcoded "always On-site") fails CI clearly.

### Phase 0 Exit Checklist & Gate

| Item | Deliverable | Status |
|---|---|---|
| Monorepo scaffold | settings.gradle.kts, pnpm-workspace.yaml, CI | ◻ |
| Ditto Q&A | Written vendor answers (licensing, identity, BLE latency) | ◻ |
| Device identity | Ed25519 in Android Keystore | ◻ |
| CBOR schema | Kotlin + TS byte-identical output | ◻ |
| HLC + clock-bound | Monotonic HLC; ±30 min advisory clamp | ◻ |
| Trust fold | §3.4 canonical, both platforms | ◻ |
| APK minimal build | Installs, identity persists | ◻ |
| **Two-phone sync** | BLE gossip; fold converges offline | **HARD GATE** |
| Web console mock | Same report, same tier | ◻ |
| **Convergence vectors** | ≥10 vectors, both platforms identical | **CI GATE** |

**All five must pass before Phase 1:** (1) two phones mesh, A's signed record reaches B; (2) both compute JSON-identical `VerificationResult`; (3) written Ditto answers on hand; (4) all convergence vectors green; (5) APK runs offline, web console shows the same trust state. Any failure → debug synchronously; on Kotlin/TS divergence, clarify the spec, fix both, re-run the vector. **Do not proceed until all green.**

---

# 3. Phase 1 — APK Mesh Core

The deepest phase. Six workstreams (1.1–1.6) build the offline field app on the locked contract. Internal task IDs `T1.x … T6.x` map to workstreams 1.1 … 1.6 respectively.

## Workstream 1.1 — Canonical Schema, CBOR Serialization & Cross-Language Test Vectors

**Scope.** Implement the authoritative record data model (spec §2) as deterministic CBOR + COSE in Kotlin; lock it with Kotlin↔TypeScript vectors; establish canonicalization rules all platforms follow.

**Tasks.**
- **T1.1 — Kotlin record schema.** `sealed class Record`: `ReportRecord`, `AttestationRecord`, `IdentityRecord`, `SubjectRecord`; immutable data classes with auto equals/hashCode for CRDT dedup (report by `(author_id, author_seq)` + `content_hash`; attestation by `(claimer_id, claimer_seq)`); `enum ReportKind`, `enum AttestationType` per §2.4/§2.5. Stdlib only.
- **T1.2 — Deterministic CBOR (COSE-style).** `toCanonicalCBOR()` per record type following RFC 7049 + COSE RFC 9052: sorted map keys, no null-optionals, canonical integer encodings; signing field order excludes `sig` and `_meta`; `fromCBOR()` with round-trip guarantee `toCanonicalCBOR(fromCBOR(b)) == b`; hand-craft 10 minimal records and verify canonical bytes match TypeScript.
- **T1.3 — Ed25519 & X25519 envelope.** Wrap `androidx.security.crypto.MasterKey` for hardware-backed Ed25519 (StrongBox if available); `identity_id = "k_"+base64url(blake3(pubkey)[0:16])`. `signRecord(record, priv) → 64-byte sig` over canonical CBOR (minus sig/_meta); `verifySignature(...)` idempotent, false on any mutation. X25519 sealed-box for the `enc` object via libsodium/Bouncy Castle (pure-Kotlin sealing, **not** Keystore, for portability): `sealBox`, `openBox`.
- **T1.4 — BLAKE3 & SHA-256.** `contentHash(record) = blake3(canonical(body)) → base64url`; salted `blake3Hash(data, salt?)` for name/address dedup (`name_hash = blake3(normalize(name))`); `sha256Hash` for future GenLayer anchoring. `com.appmattus.crypto:cryptohash` (pure Kotlin).
- **T1.5 — HLC.** `class HLC(wall_ms, counter, node)`; `node = base64url(identity_id[0:6])`; `HLC.now(local_wall_ms, prev?)`; `HLC.compare()` total order (wall_ms → counter → node); inject a `TimeProvider` interface (no direct `System.currentTimeMillis()`).
- **T1.6 — TypeScript reference.** Port T1.1–T1.5 to `core-ts/` with identical APIs (`tweetnacl-js`, `ts-blake3`); `toCanonicalCBOR()` byte-identical to Kotlin. **Re-implement, don't share code** — both are reference.
- **T1.7 — Cross-language vectors (CI gate).** 20+ vectors: minimal record of each kind; attestation of each type; Identity + Subject; edge cases (max-length fields, special chars, X25519 sealed payloads). For each: author JSON → Kotlin canonical CBOR hex → assert TS byte-identical → Kotlin-sign → TS-verify → reverse. Store as YAML/JSON with expected bytes + signatures. Both must pass all 20+ before Phase 1 merge.

**Deliverables.** `android/.../model/`, `android/.../crypto/`; `core-ts/src/model/`; `/test-vectors/` (20+ YAML + `test-vectors.sh`).

**Acceptance.** All 20+ vectors pass (CBOR round-trip, sigs both ways, deterministic); Kotlin CBOR fully canonical; TS byte-identical; Ed25519 keygen works offline with hardware keystore; X25519 seal/unseal symmetric; HLC monotonic + tie-breaks; no platform-specific crypto deps.

**Tests.** Kotlin `CborTest`/`SignerTest`/`HlcTest`; TS mirrors; `CrossLanguageTest` runs the 20+ vectors; consensus test (two devices exchange signed records via offline storage mock, verify both sides) as a pre-Phase-1 gate.

## Workstream 1.2 — Ditto Integration, Local Store & Multi-Transport Subscriptions

**Scope.** Integrate Ditto Kotlin SDK v5 for P2P mesh; class-gated priority subscriptions (no wall-clock on the replication path); multi-transport duty-cycling; local-only metadata; `SyncTransport` abstraction (P0-1 mitigation).

**Tasks.**
- **T2.1 — Ditto Small Peer init + offline licensing.** `DittoManager.init(ctx) → dittoPeer`; offline license from `BuildConfig` (**hard-stop gate: Ditto confirms perpetual-offline tokens in writing**); disable cloud auto-discovery (Big Peer only via gateway); four collections `identities/subjects/reports/attestations`; pin identity to device Ed25519 via deterministic hash binding (P0-1 II.B).
- **T2.2 — `SyncTransport` interface + `DittoTransport`.** `start(config)`; `subscribe(query): Flow<List<Record>>`; `publish(recordId, cbor, priority)`; `peers(): Flow<PeerInfo>`; `bridgeStatus(): Flow<BridgeReceipt>` ({recordId, cloudHLC, ts}). Normalize all queries to `SyncQuery` DTO (no raw DQL/document IDs exposed).
- **T2.3 — Priority-gated subscriptions (P0/P1 first).** Split into `reports_p0`, `reports_p1`, `reports_p2p3`, `reports_p4` (§2.7). `PrioritySubscriptionManager`: subscribe P0 + attestations first; add P1 at battery >30%; add P2/P3 + tiles at >50% + Wi-Fi; drop to P0-only on saver/<10%. Backpressure via `MutableSharedFlow<SyncEvent>`. Verify Ditto per-document priority queuing; if absent, escalate to Ditto support, fallback to collection + subscription order.
- **T2.4 — Local encrypted store.** `SignedRecordStore` + `DittoStore`: `append` (idempotent on content_hash), `query`, `attestationsFor(reportId)`, `getMeta/setMeta` (local-only `_meta`: reach, read, pinned, received_at — never synced), `merge(delta)` (validate sigs **before** merge), `evictByPriority(targetBytes)` (P0-5 bound: evict low-prio unreferenced, **never delete from network**, local-hide only). Payloads stored as CBOR blobs; signature validation on read. **Fallback** `RoomStore` (SQLite, identical interface) for drop-in replacement.
- **T2.5 — HLC + wall-ms clamp on ingress (P0-3).** On receipt: parse incoming HLC; if drift > ±30 min, clamp **into `_meta.hlc_clamped` only** (never mutate the signed `hlc`); persist `max_wall_ms_ever_seen` as a monotonic baseline (cap drift checks at startup against last-known baseline; prevents OEM cold-start resets enabling future clocks); store original + clamped in `_meta`. `clampHLC(hlc, localWallMs) → Pair<HLC, Boolean>`.
- **T2.6 — Duty-cycling state machine.** `DutyManager(battery)`: Normal (>50%) BLE + Wi-Fi Aware continuous; Conserve (30–50%) BLE 5 s / Wi-Fi 30 s; Frugal (<30%) BLE 30 s; Lifeline (<10%, P0 only) BLE beacon 2 min, background sync off. Battery `BroadcastReceiver` → reconfigure transports; exponential backoff on sync failure; run inside a foreground service (respect Doze + App Standby).
- **T2.7 — Signature verification on merge.** Verify Ed25519 **before** `DittoStore.append()`; drop unsigned/bad-sig records before they enter the replica; log rejects (count, reason). `validateRecordSignature(record)`: strip sig, canonical CBOR, verify against `author_id` pubkey.

**Deliverables.** `mesh/SyncTransport.kt`; `ditto/{DittoManager,DittoTransport,DittoStore}.kt`; `sync/{PrioritySubscriptionManager,DutyManager,SignatureValidator}.kt`; `time/HLCClamp.kt`. Handles 4+ concurrent peers without OOM on 2 GB RAM.

**Acceptance.** Small Peer inits offline (no internet); independent subscriptions to `reports_p0/p1/attestations`; P0 records < 200 bytes fit one BLE GATT exchange; mesh records sig-verified before storage (invalid dropped); drift > ±30 min flagged in `_meta.hlc_clamped` (signed HLC unchanged); battery changes adjust duty cycle (mock `BatteryManager`); `merge()` idempotent; no OOM with 10,000 records.

**Tests.** `DittoTransportTest`, `SignatureValidatorTest`, `HLCClampTest`, `DutyManagerTest`; integration (two emulators exchange 5 P0 records via BLE mock, converge); stress (1,000 records, no OOM, eviction works); manual on two budget phones (one offline creates SOS, second BLE-syncs < 3 s).

## Workstream 1.3 — Deterministic Verification Fold & P0 Round-4 Security Fixes

**Scope.** Canonical trust fold (§3.4) with identical semantics on every device; P0-2 (Ed25519 challenge-response Device-confirmed) and P0-3 (immutable-HLC monotonic TTL) fixes; validate against vectors.

**Tasks.**
- **T3.1 — Trust fold core.** `computeTrust(report, atts, subject?) → VerificationResult`: filter to valid-sig attestations targeting `content_hash`; keep strongest per signer; check proof predicates; compute gated signals `proximityOK/deviceOK/selfOK/reporterAffirm`; derive tier (lattice max): selfOK → Self-confirmed(5); else deviceOK → Device-confirmed(4); else proximityOK → On-site(3); else ≥2 distinct non-reporter agree → Corroborated(2); else Reported(1). Disputed overlay on any `dispute` or ≥2 distinct signers with conflicting facts (alive/deceased, present/false_alarm). Return `{tier, verified, verifiedBy, disputed, outcome, confidence_scope, corroboration_count, best_proof}`. **No mutable state.**
- **T3.2 — Proof predicates (deterministic, no network/entropy).** `gps_match` (haversine ≤ 50 m, accuracy ≤ 50 m, `is_mock=false`); `pluscode_match` (10–11 char exact); `ble_encounter_challenge` (P0-2, see T3.3); `subject_cosign` (Ed25519 by subject key over `content_hash`); `qr_nfc` (known pre-registered POI key; verify nonce binding for dynamic NFC).
- **T3.3 — P0-2 Device-confirmed via Ed25519 challenge-response.** *Subject device:* advertise `identity_id` + version; on inbound `device_confirm_challenge` GATT write validate freshness (±30 s), build `response_payload` (subject_id, attestor_id, nonce, subject_rssi, ts), **sign with Ed25519**, return via notification, and **embed the signed `response_payload` + `subject_sig` in the attestation (Appendix A.1 patch — do not discard); re-verify on all devices, not just the attestor.** *Attestor:* scan by service UUID, identify subject, write challenge (32-byte nonce, ts, attestor_id, RSSI), validate the response sig against the subject's public key, create signed `device_confirm` with embedded payload + subject_sig. *Validation:* `Ed25519_verify(subject pubkey, canonical(response_payload), subject_sig)`; verify attestation sig; both-end RSSI ≥ floor (≈ −85 dBm, tunable); `time_slot` HLC within 6 h. Implement `BLEAttestor` + `BLEResponder`.
- **T3.4 — P0-3 immutable HLC + monotonic TTL (Appendix A.2).** Never mutate signed `hlc`; clamped HLC in `_meta.hlc_clamped` only. `MonotonicClockBaseline` persists `max_wall_ms_ever_seen`; on cold start, if `current < baseline − 1 day` bump baseline +1 day (block future clocks on restart); on accept `baseline = max(baseline, current)`. TTL is **author-time-relative**: `age = min(now, baseline+30min) − record.wall_ms`; expire if `age > ttl_s*1000` AND not (referenced-by-live-attestation OR unresolved-higher-prio). Fallback: if `_meta.received_at_wall_ms` set, expire after `1.5 * ttl_s` of local time. `isExpired(record, baseline)` deterministic.
- **T3.5 — Attestation folding & dispute.** On new attestation, recompute tier + dispute for the target; `mergeAttestation(existing, new)`; append-only (never delete/overwrite).
- **T3.6 — Cross-platform fold validation.** Feed identical tuples through Kotlin `computeTrust` and a TS invocation; assert identical results; cover reporter-affirm, corroborate, on-site GPS, device-confirm, self-confirm, dispute.

**Deliverables.** `verify/TrustFold.kt`; `verify/proofs/{GpsMatch,PluscodeMatch,BleEncounter,SubjectCosign,QrNfc}Validator.kt`; `ble/{BLEAttestor,BLEResponder}.kt`; `time/{MonotonicClockBaseline,TtlEvictor}.kt`; Kotlin + TS `computeTrust` test-vector-locked.

**Acceptance.** All 20+ vectors pass fold validation; tier monotone-lattice (never decreases on new attestations; only Disputed adds); Device-confirmed requires valid subject sig (else caps at On-site); Appendix A.1 + A.2 patches applied; monotonic baseline blocks persisted future clocks; two independent offline devices never compute different tiers for the same set; invalid proofs don't promote tier.

**Tests.** `TrustFoldTest`, `GpsMatchValidatorTest`, `BleEncounterValidatorTest`, `TtlEvictorTest`; cross-language fold (CI gate); 3-device consensus (A offline creates report + SOS, B GPS-attests On-site, C syncs both and recomputes identical tier); adversarial (bad-sig attestation rejected before merge, no promotion).

## Workstream 1.4 — Compose Rescuer UI — 6 Core Screens + Capture Flows

**Scope.** es-VE, low-literacy-tolerant Jetpack Compose UI: Mapa, Señales, FAB create-SOS, Yo, Ajustes, report-detail, plus proximity-attestation + SOS-creation flows. No backend calls (offline + mock gateway).

**Tasks.**
- **T4.1 — Shell + bottom nav.** `BaranApp()` Scaffold with 4 tabs (Mapa/Señales/Yo/Ajustes), red "+" FAB → create modal; es-VE strings in `strings.xml`; `NavController`; persist tab on pause/resume.
- **T4.2 — Mapa.** MapLibre Native + offline OSM/PMTiles; pins by kind (SOS red, victim_found orange, missing yellow, need green, hazard purple, status gray); clustering at zoom < 12; tap → bottom-sheet (kind, subject if non-sensitive, **tier badge** + **reach badge** kept separate, confidence, body, attestations); "Confirmar aquí" → attestation flow; draggable filter panel (kind/prio/tier/reach/disputed, real-time); reach chip from `_meta.reach` (never conflated with tier).
- **T4.3 — Señales.** List sorted `prio desc, hlc desc`; row = icon + summary + tier + reach + timestamp + attestor count; swipe-left quick-corroborate (confidence 0–100), swipe-right mark read (`_meta.read`); long-press → detail; FAB create.
- **T4.4 — Create flow (3-step modal).** Step 1 type carousel (SOS·Atrapado, SOS·Herido, Persona desaparecida, Necesidad, Peligro, Estado); Step 2 location (GPS + auto Plus-Code, tap-to-adjust, manual entry, "Disminuir precisión" → 8-char coarse for sensitive); Step 3 type-specific details + optional low-res CameraX photo (P4 local record, linked via `refs`); "Enviar" → sign locally, assign `author_seq`, insert, Outbox marks "pending broadcast", confirm "Registrado · enviando a la malla". No profile/name/device-ID required at first run (pseudonymous).
- **T4.5 — Proximity attestation flow.** Step 1 proof-type selector (GPS <50 m / Plus-Code / QR·NFC / subject cosign / auto BLE if subject device near) with plain-language explanations; Step 2 type-specific acquisition (GPS with accuracy warning > 50 m; Plus-Code auto/manual; BLE scan + challenge-response via `BLEAttestor`; QR via ML Kit / NFC reader; subject cosign via displayed challenge QR); Step 3 confidence slider + "modo silencioso" (duress) checkbox + submit (signed `on_site`/`device_confirm`/`self_confirm`, insert, broadcast, animated tier update).
- **T4.6 — Yo (Profile).** Device fingerprint, role selector, optional local display name (never broadcast unless shared); duress PIN stub (greyed, Phase 4); export CSV / wipe-local; mesh online/peer-count or last-sync.
- **T4.7 — Ajustes.** Language (es-VE/es-ES/en), low-literacy icons-only toggle (TTS stub), battery mode override, mesh-visibility hops toggle, transport status + peer count + active gateway, notifications stub.
- **T4.8 — Report detail.** Header (kind/subject/tier/reach/timestamp); body + geo + photo; chronological attestation list (expandable proof details, GPS coords/accuracy, RSSI, QR result), disputes in red, resolutions in green; action bar: Confirmar/Corroborar, Disputar, Marcar resuelto (Encontrado a salvo / fallecido / Falsa alarma / Trasladado → `resolve`).
- **T4.9 — Accessibility & i18n.** All text in `strings.xml` (es-VE) + es-ES + en; font 14–20 sp; touch targets ≥ 48 dp; content descriptions; dark mode; low-literacy vocabulary (short, present tense, imperative).

**Deliverables.** `ui/` screens; `ui/flow/` (CreateSosFlow, AttestationFlow, BLEProofScreen, GpsProofScreen, …); `viewmodel/` (state via ViewModel + Flow); `res/values*/strings.xml`; MapLibre + offline PMTiles (~10 km² Caracas for Phase 1).

**Acceptance.** All 6 screens render without crash on a budget device (Redmi Go class); create-SOS produces a valid signed record (CBOR-verifiable); attestation validates and embeds proof; tier badges reflect current `VerificationResult` (including Disputed); reach badges accurate; map renders 100+ pins at > 30 FPS on 2 GB RAM; Spanish readable; low-literacy mode usable; no permission dialogs before user-initiated actions.

**Tests.** ViewModel tests with `MockRecordStore`; Compose snapshot per screen (100 records, no crash); integration (create report → details → attest → tier updates on map); manual on two phones (SOS on A, GPS-confirm on B, real-time tier change on both).

## Workstream 1.5 — Offline Map (MapLibre + PMTiles + Plus Codes)

**Scope.** MapLibre Native offline rendering; bundled OSM/PMTiles for Caracas + La Guaira (~25 km²); Plus-Code geometry + proximity.

**Tasks.**
- **T5.1 — MapLibre + offline tiles.** `com.mapbox.maps:android:11.0.0+`; pre-built `.pmtiles` (Caracas + La Guaira, zoom 12–18, vector + raster, via `tippecanoe`, ~200–500 MB); `OfflineTileProvider` loads from assets and registers with MapLibre; minimal light basemap.
- **T5.2 — Plus Codes.** `com.google.maps.android:maps-ktx` Open Location Code; encode lat/lng → 10–11 char; decode → bbox/center/bounds; `toPlusCodeCoarse(code10) = code10.substring(0,8)` (~110 m, sensitive); display as tappable chip (zoom to center).
- **T5.3 — Pin rendering.** Query `reports`; decode `geo.plus_code` → center; marker by kind + tier; cluster at zoom < 12 (256 px cell grid, count + dominant color); live updates via `Flow<SyncEvent>` (add pin on new, recolor on tier change).
- **T5.4 — Proximity/geo queries.** `nearbyReports(center, radiusKm)` (haversine); used by attestation flow (`radiusKm = 0.1` to suggest confirm targets); `haversine(...)` in meters.
- **T5.5 — Map controls.** Pinch/pan; locate-me (ACCESS_FINE_LOCATION, accuracy circle); layer toggles per kind; search by Plus-Code or non-sensitive subject name; pulsing current-location marker.
- **T5.6 — Cache management.** First-launch download confirm; extract to `getFilesDir()/maps/`; store version/size/checksum in prefs; wipe + re-download on full storage.

**Deliverables.** `map/{MapManager,OfflineTileProvider,PinRenderer}.kt`; `geo/{PlusCodeHelper,GeoUtils,GeoQuery}.kt`; pre-built `.pmtiles` asset; Mapa integration.

**Acceptance.** Offline map loads on first launch (no internet); 500+ pins at > 30 FPS; Plus-Code 10↔8 char + lat/lng round-trips lossless (< 10 m); `nearbyReports` correct within 1 km; locate works on real hardware; tile cache ≤ 500 MB; no external API calls.

**Tests.** `GeoUtilsTest` (haversine), `PlusCodeHelperTest`; map snapshot (100 pins); integration (report at GPS → pin at Plus-Code location); manual (locate self, create at current location, appears < 2 s).

## Workstream 1.6 — Opportunistic Gateway Bridge & Store-Carry-Forward

**Scope.** Transient gateway (Plane B) for phones with internet: batch the outbox to the mock cloud, pull replies, re-inject as signed records, stamp reach. `BridgeManager` state machine + store-carry-forward persistence.

**Tasks.**
- **T6.1 — Internet detection + gateway election.** `NetworkMonitor` (`ConnectivityManager.NetworkCallback`); detect full IP / captive portal / hotspot; `Flow<NetworkState>`; manual "Ser puente" toggle (Ajustes); stateless + transient (one gateway per instance; resume via Ditto CRDT recovery if link drops).
- **T6.2 — Outbox batching.** `Outbox` persistent queue (local SQLite, never synced): `{id, record_id, canonical_cbor, priority, author_seq, created_at, status: pending|acked|failed|expired}`; on each local authored record insert; batch `WHERE status=pending ORDER BY priority DESC, created_at ASC LIMIT 100`; dedup by content_hash; serialize to a JSON batch envelope (`batch_id`, `records[]`, `timestamp_ms`, `gateway_device_id`, `gateway_seq`).
- **T6.3 — Push to cloud (mock).** `CloudAPIClient` POST `/v1/records/batch`; exponential backoff (1/2/4/8/30 s, max 3); on ACK `{batch_id, processed_count, failed_ids[]}` mark `acked`; on validation error mark `failed`.
- **T6.4 — Pull replies.** `pullReplies(since_hlc?)` GET `/v1/records?since=&kind=status,attestation`; polling every 30 s (battery >30%) / 5 min (<30%); WebSocket `/v1/live` is Phase 2.
- **T6.5 — Re-inject into mesh.** Verify coordinator sig (pre-registered whitelist stub); `DittoStore.append()`; mark `_meta.reach="bridged"`; Ditto replicates P2P; UI shows "Respondido por [coordinator] hace T"; conflicting cloud records → store both + Disputed (T3 fold).
- **T6.6 — Bridge receipt (P0-4 signed).** Cloud issues a signed `bridge` attestation (mock returns synthetic) linking `report_id` + server HLC; re-inject; Ditto replicates so non-bridged phones learn reach via gossip.
- **T6.7 — Gateway UI.** Ajustes: "Activar modo puente" toggle; Outbox status ("N esperando · última puente hace T"); sync freshness; peer count; active banner "🌐 Sirviendo de puente para N"; push toasts/backoff warnings.
- **T6.8 — Store-carry-forward persistence.** Ditto DB is ground truth; Outbox is secondary; `StorageManager` evicts at > 80% (TtlEvictor, never delete synced records, only local low-prio expired unreferenced); resume bridging on restart.
- **T6.9 — Mock cloud API.** Standalone Ktor/MockWebServer accepting `/v1/records/batch` (logs, synthetic ACK, in-memory store) and GET `/v1/records?since=`; run on a laptop for the Phase 1 demo. Not the real backend (Phase 2).

**Deliverables.** `gateway/{GatewayManager,CloudAPIClient,Outbox}.kt`; `network/{NetworkMonitor,NetworkState}.kt`; `sync/ReplyInjector.kt`; `tools/mock-api/` (Ktor); Outbox schema + Room migrations.

**Acceptance.** Toggle bridge in Settings; batches up to 100 sorted by prio + age; POST with retry; pull every 30 s; re-inject merges + replicates; cloud records marked `bridged`; Outbox persists across restart; no crash on socket timeout / 500 / DNS failure; offline→bridged→online convergence (A offline creates, B offline-syncs, C bridges; A+B learn `bridged` via mesh gossip of the cloud `bridge` attestation).

**Tests.** `OutboxTest`, `NetworkMonitorTest`; integration (two emulators, one gateway + mock server; push → cloud receives; pull → appears in offline peers); manual (two phones offline create reports, third bridges to laptop mock, mock `status` reply syncs back to both maps).

### Phase 1 Exit Gate

**Complete and shipping when:**
1. **Convergence (cross-language):** all 20+ vectors pass (CBOR identical, sign/verify both ways, fold identical tiers).
2. **Two-device skewed-clock (hardware):** Phone A at T, Phone B at T+45 min; A creates SOS, B receives via BLE; B creates `missing_person` at skewed time, A receives. **Assert:** both compute identical HLC causal ordering (counter + node enforce order despite clamping) and identical tier. TTL: set A back 48 h — verify the 6 h-TTL SOS is NOT evicted (P0 carry-protected) and a 12 h unreferenced status IS evicted. No OOM/crash. (Full spec in §8.3.)
3. **MVP demo (4 phones, ~30 min):**
   - *Act A (offline):* P1 creates SOS "Atrapado en edificio" (Petare) → Señales + orange pin, Reported, in_mesh. P2 receives via BLE → GPS 8-char Plus-Code → On-site on both, still in_mesh. P3 corroborates (no proof) → stays On-site.
   - *Act B (carry-forward):* P4 (isolated 500 m) walks into BLE range → auto-syncs SOS + attestations → On-site on P4.
   - *Act C (bridge):* P4 gets internet → "Activar modo puente" → Outbox POSTs to mock → ACK → reach flips in_mesh → bridged on all 4 via the cloud `bridge` attestation.
   - *Act D (reply):* operator posts `status` "Equipo Rojo en camino, ETA 40 min" (refs SOS) → P4 pulls → re-injects → all 4 see the reply via BLE gossip with reach=bridged + coordinator identity + timestamp.
4. **Security spot-checks:** P0-2 (B's `device_confirm` embeds the signed `response_payload`; fold re-verifies the subject sig on all devices; invalid subject sig caps at On-site); P0-3 (if Appendix A.2 not yet applied, document + gate Phase 2 on the fix); signature integrity (corrupt a record's body CBOR → fold rejects, never syncs).
5. **Artifact:** signed, stripped release APK < 100 MB (with offline maps), installs on Redmi Go (2 GB); git tag `phase-1-complete` + convergence results + demo capture.

**Definition of done:** all exit criteria green; APK sideloadable to field testers; Workstreams 1.1–1.6 finalized (no "TBD"); known limitations documented honestly (Appendix patches, mock-only API, GenLayer deferred); Product + Security sign-off.

### Phase 1 Risk Mitigations

- **Ditto licensing (P0-1, CRITICAL):** written perpetual-offline confirmation required; else parallel `NearbyTransport` + open-source CRDT.
- **P0-2/P0-3 patches:** implement Appendix A.1/A.2 in Workstream 1.3, not deferred; gate Phase 2 if compatibility breaks; brief external security review if complexity rises.
- **Ditto CRDT convergence:** T2.3 tests priority subscriptions; T3.6 validates cross-device convergence; escalate to Ditto support or pivot to Nearby if merge doesn't guarantee convergence.
- **BLE throughput:** P0-1 III prototype on Redmi Go + Transsion; if > 10 s first-round 200 bytes, promote Nearby (bulk over Nearby, BLE control plane).
- **2 GB OOM:** T2.4 eviction bounds cache < 500 MB; profile with Memory Profiler; lazy-load attestations on demand if needed.
- **Mock API divergence from real backend:** thin no-auth mock (T6.9); `CloudAPIClient` interface designed for swap; Phase 2 adds JWT + rate-limiting + real DB.

---

# 4. Phase 1b — Desktop App (Tauri 2 Wrapper)

Ships the desktop coordinator (Tauri 2 + React, wrapping the Phase 1 PWA) with zero new backend dependency. Runs in parallel with the Phase 2 API groundwork. ~10–12 h.

### 1b.1 — Tauri 2 Shell & Native Packaging

**Deliverables.** Tauri 2 + React 19 + TypeScript scaffold; native window chrome (title bar, context menus, file dialogs); signed `.msi` (Windows), `.dmg` (notarized macOS), `.AppImage`/`.deb` (Linux); multi-platform CI; OS keychain (macOS Keychain / Windows Credential Manager / Linux SecretService) for persistent JWT.

**Tasks.** Init via `create-tauri-app` (React); copy the Phase 1 React UI into `src/` unchanged (same Vite + TanStack Query); `tauri.conf.json` (min 1024×768; disable FS/process spawning — no RCE surface; `@tauri-apps/api` for dialogs/clipboard); macOS notarization in CI (Apple dev account secret); Windows code-signing (DigiCert/self-signed dev); Linux AppImage/`.deb`; wire `Tauri.invoke()` to OS keychain for JWT.

**Acceptance.** Builds + runs on Windows 11, macOS 12+, Ubuntu 22.04 with zero config changes; signed binaries pass Gatekeeper/SmartScreen; reproducible (same hash on rebuild within 1 h); JWT persists in keychain, no plaintext in config; CI on git tag publishes to GitHub Releases.

**Tests.** 3-platform install (`.msi` install/launch, `.dmg` drag/launch, `.AppImage` chmod/launch); JWT persistence (login → close → reopen, still logged in); native menu shortcuts.

**Residual.** macOS notarization needs Apple dev account ($99/yr) — `--skip-notarization` for dev; Windows cert costly — self-signed dev builds (clear install warnings).

### 1b.2 — Desktop UI — Three-Column Layout & Responsive Breakpoints

**Deliverables.** Desktop console (3-column: Filter | Map+Details | Quick-Reply); CSS Grid breakpoints (desktop ≥ 1024px 3-col `25% 50% 25%`; tablet 768–1024px 2-col + overlay map; mobile < 768px single-col tabs); touch targets ≥ 48 px + keyboard nav.

**Tasks.** Refactor to `<CoordinatorShell>` → `<FilterPanel>` + `<MapPane>` + `<DetailsPane>`; screens Console Home / Task List / Report Timeline (logic unchanged, layout rearranged). Filter panel: kind / prio P0–P4 / reach / tier checkboxes, geo bbox or Plus-Code grid, time range (4 h/24 h/7 d), full-text search (body, name hash, reporter fingerprint). Map pane: density heatmap per Plus-Code cell; pin click → details; reach badge per pin. Details pane: quick-reply composer (status/task, ≤ 280 chars, assign/date/confidence/send); proof diagram (GPS distance, BLE RSSI gradient, Plus-Code cell overlap). Audit-log timeline: HLC-ordered append-only thread, signer fingerprint + role, tier-transition highlights.

**Acceptance.** 3-column at 1024×768 with no horizontal scroll; tablet hides composer (shows on tap); mobile tabs; filter updates < 200 ms (TanStack `useSuspenseQuery`); heatmap redraw < 1 s; proof diagrams render; audit log HLC-sorted (not wall_ms), append-only.

**Tests.** Resize 1920×1080 → 375×667 (no breakage); filter list+map lockstep; proof diagrams per type; keyboard nav (Tab/Enter/arrows).

### 1b.3 — Signing & Notarization CI Pipeline

**Deliverables.** `.github/workflows/build-desktop.yml` (on tag `v*`): build-windows (sign `.msi`), build-macos (x86_64 + aarch64, `notarytool submit`), build-linux (`.AppImage` + `.deb`), publish (`gh release create` with checksums). Certs in encrypted Org Secrets (`WINDOWS_CODE_SIGNING_CERT`, `APPLE_ID/PASSWORD/TEAM_ID`). (Full cross-target CI spec in §9.)

**Acceptance.** Builds complete on all three within ~15 min; artifacts in Releases with SHA-256; `.msi` passes SmartScreen; `.dmg` passes `xcrun stapler validate`; `.AppImage` runs after `chmod +x`.

**Tests.** Tag + push triggers CI, artifacts downloadable; signature verification (Windows Properties → Digital Signatures; macOS `codesign -v`).

### Phase 1b Exit Gate
- [ ] Tauri builds + signs on Windows/macOS/Linux; Gatekeeper/SmartScreen pass.
- [ ] 3-column at 1024×768; responsive breakpoints verified.
- [ ] CI publishes signed binaries to Releases on tag.
- [ ] Desktop shows the same data as the web console.

---

# 5. Phase 2 — Cloud API Seam, Web/PWA & Coordinator Console

Stands up the real API seam (REST + WebSocket) in front of Ditto Cloud or a custom HTTPS bridge; web/desktop coordinators author replies/tasking that flow back to the mesh. Desktop + web see only `reach ≥ bridged`. ~25–30 h.

### 2.1 — REST + WebSocket API Contract & Documentation

**Deliverables.** OpenAPI 3.1 (`api/openapi.yaml`); Postman collection; TS types via `openapi-typescript`; `msw` mock backend for the Phase 1→2 transition; `docs/API.md`.

**Endpoints.** `GET /v1/records` (filters: geohash, kind[], prio{min,max}, reach[], tier[], since, cursor → `{records[], aggregates{count_by_kind/tier/reach}, cursor}`); `GET /v1/records/{id}/attestations` (`{report, attestations[]}` — full provenance for the fold); `GET /v1/subjects/{id}` (subject + merged-link graph); `GET /v1/identities/{id}`; `POST /v1/replies` (`{kind: status|task, author_id, author_seq, refs[], body, prio 0–5}` → 201 Attestation | 401 | 400); `bearerAuth` security scheme. `docs/API.md` documents record flow (field→cloud→web), sig verification, reach semantics, error codes/retry, rate limits (10 req/s per IP, 1000 req/h per token).

**Mock backend.** `msw` handlers for all Phase 1 reads + `POST /v1/replies` (sign reply with coordinator key, append, broadcast to WS clients).

**Acceptance.** OpenAPI complete (20+ endpoints, required fields marked); generated TS types compile; mock handles all Phase 1 reads, returns realistic payloads with reach badges; Postman imports clean; curl examples in docs.

**Tests.** `openapi-validator` passes; `openapi-typescript` output compiles under `tsc --strict`; seed 100 records, run all queries, assert response shapes.

### 2.2 — Ditto Big Peer Client or Custom HTTPS Bridge (swappable)

**Deliverables.** Path A: Ditto JS SDK as Big Peer client (web + desktop). Path B: custom REST+WS bridge (thin façade over Big Peer / delegated store) for self-hosted/air-gapped. Unified `CloudAPITransport` interface; real-time WebSocket subscription.

**Path A (Ditto, recommended for speed).** `@dittolive/ditto`; init with `appID`/`license`/`webTransport`; `auth.loginWithToken(jwt)`; subscribe `ditto.store.collection('reports').find("prio>=1 AND kind IN [...] AND reach IN ['bridged','anchored']").subscribe(...)`; `docs/DITTO_SETUP.md` (Big Peer provisioning, token renewal, retry).

**Path B (custom bridge).** Stateless bridge (Cloud Run/Lambda/Fly.io): `POST /v1/replies` (validate sig + auth, validate refs against real reports, build attestation with server time, upsert, broadcast to sockets); `WS /v1/live` (auth + filters, snapshot, stream updates via Firestore listener / DynamoDB Streams / Postgres NOTIFY); choose store (Firestore/DynamoDB/Postgres) indexed by geohash + freshness.

**Shared interface.**
```ts
interface CloudAPITransport {
  subscribe(query: SyncQuery): Observable<Record[]>;
  query(query: SyncQuery): Promise<{ records: Record[]; cursor: string }>;
  postReply(reply: ReplyPayload): Promise<Attestation>;   // coordinator only
  login(c: Credentials): Promise<{ token: JWT; identity: Identity }>;
  logout(): Promise<void>;
  isConnected(): Observable<boolean>;
  lastSyncTime(): Observable<Date>;
}
```

**Acceptance.** Path A inits/authenticates/subscribes/streams via WS; Path B endpoints + WS stream in real time; both render identical records (same tier + reach); path switch via one env var (`REACT_APP_BACKEND_PATH`); offline reads cached 1 h on WS disconnect.

**Tests.** Ditto: seed 50 reports, subscribe, snapshot + 3 incremental updates in order; bridge: POST reply → sig validation → broadcast → appears in subsequent GET; failover: disconnect WS → "Última sincronización hace 5 min" → reconnect → snapshot + backlog.

### 2.3 — Web/PWA Progressive Enhancement & Service Worker

**Deliverables.** Offline-first PWA (Workbox via `vite-plugin-pwa`); IndexedDB cache (last 1000 records + metadata); offline map tiles (PMTiles/vector cache); install prompt.

**Tasks.** `VitePWA` (injectManifest; runtime caching CacheFirst for `/v1/records` 1 h/100 entries and OSM tiles; manifest name/icons/screenshots). IndexedDB stores `reports/attestations/subjects/identities` (keyPath `_id`, geohash index); persist API responses; offline read from cache. MapLibre with pre-bundled PMTiles (Venezuela ~500 MB) served from SW cache, graceful online fallback. `beforeinstallprompt` → "Instalar Baran". Build → static `dist/` for Cloudflare Pages/Vercel/Netlify.

**Acceptance.** Installs on Android Chrome / iOS Safari (fullscreen, no chrome); offline loads 50 records from IndexedDB < 1 s; first load ~500 KB gzipped (code-split); SW caches ~1.5 MB tiles + 1 h API, offline shows "Última sincronización hace 15 min"; install prompt after 2 visits; Lighthouse PWA passes.

**Tests.** DevTools offline → records from IndexedDB; Lighthouse PWA audit; cache test (50 records cached → kill server → refresh same records); tile test (offline pan from cache, online fresh on zoom).

### 2.4 — Coordinator Console UI — Final Polish & Interaction

**Deliverables.** Three-screen console wired to the real API; live map via WebSocket (records + tier changes stream); quick-reply composer with draft persistence; audit-log timeline.

**Tasks.** *Console Home:* banner "N registros · última puente hace T · próxima sync en S"; left filter; center heatmap; right pin-detail card (report + subject name salted-hash if PII-minimized; attestation timeline; signer fingerprint + role; proof icons; reach badge). *Task List:* table Priority (red P0, amber P1, grey P2–P3) | excerpt | reporter | last reply | assigned; sort prio desc, no-reply-first, newest HLC; row → details + composer. *Report Timeline:* HLC-ordered append-only thread; proof detail widgets; CSV export. Wire `useSuspenseQuery` + `useWebSocket` (insert / tier_change) + `useMutation(postReply)`. Honest reach labels (skip `in_mesh` display entirely; "Subido a internet hace T" for bridged; "Verificado en cadena" for anchored). Proof diagrams: GPS distance + accuracy; BLE attestor/subject RSSI + estimated range; Plus-Code cell area.

**Acceptance.** Home 3-column; heatmap updates on filter < 200 ms; Task List sorted by priority; timeline 20+ attestations without lag; new record on map < 2 s after a coordinator reply; proof diagrams correct; **reach honest — desktop/web never show `in_mesh`**.

**Tests.** Filter combos update map; pin click → details → reply → broadcasts + appears; real-time (coordinator 1 posts → coordinator 2 sees live); CSV export (HLC-sorted, no PII).

### 2.5 — Cross-Language Test Vectors & Trust-Fold Convergence

**Deliverables.** Shared `test-vectors.json` (Kotlin + TypeScript); CI gate (both compute identical tier + reach); canonical fold docs. Vectors expand the Phase 0/1 set to cover `missing_person_corroborated`, `missing_person_on_site` (gps), `device_confirmed_challenge_response`, `disputed_conflicting_proofs`, etc. (See §8.1 for the consolidated master vector spec — this workstream extends that corpus and re-runs it against the real API path.)

**Tasks.** Kotlin `VerifyTestVectors` test + TS Jest `describe('Trust Fold Convergence')`; `.github/workflows/convergence-test.yml` runs both; CI < 2 min, gates merge; vectors version-controlled + human-readable.

**Acceptance.** ≥10 vectors covering all tiers + edge cases (no proofs, expired, conflicting); Kotlin + TS identical on all; CI gates PR; adding a real-world demo SOS + 5 attestations still agrees; a fold-logic regression fails CI as expected.

### 2.6 — Local Ed25519 Signing of Coordinator Records & Re-Injection

**Deliverables.** Coordinator `status`/`task`/`reply` records signed in web/desktop, tagged `origin:online` (lower-trust until verified in-zone), uploaded to cloud, propagated through a gateway into the mesh; no impersonation.

**Tasks.** *Identity setup (once per coordinator):* generate (or import pre-shared) Ed25519 via SubtleCrypto; store private key in OS keychain (desktop) / IndexedDB (web, XSS-mitigated); register public key + role. *Sign reply:* canonical CBOR → `crypto.subtle.sign('Ed25519', ...)` → attach `author_id` + base64url sig. *POST* `/v1/replies` with Bearer JWT. *Cloud validates + re-injects:* verify JWT role (`reply_author`/`tasking_author`/`admin`), verify Ed25519 sig (reject unknown signer), validate refs + prio bounds (`reply_author` cannot set prio > 2), build attestation tagged `origin:'online'`, `confidence:80` (no proximity proof), store + enqueue for the gateway, broadcast to WS clients. *Gateway pulls + re-injects:* `pullRepliesDown()` gets `origin=online` attestations since `lastSyncHLC`, `localStore.append` (not re-signed), `meshTransport.publish`. *Fold handling:* `origin=='online'` can reach **Corroborated** only; cannot unlock On-site/Device-confirmed/Self-confirmed alone; honest UI "Estado: Equipo en ruta · desde coordinador · sin verificación en sitio".

**Acceptance.** Coordinator reply signed locally → sent; cloud verifies (rejects unknown signer); re-injects via gateway queue; field phone renders the reply with an `origin:online` badge; fold never raises online replies above Corroborated without on-site proof; two coordinators with conflicting replies → both attestations, conflict surfaces, field shows Disputed.

**Tests.** Sign → verify with public key matches; POST signed reply 201, mutated sig 400; E2E coordinator → mock gateway → APK store → field UI; conflict (two `status` with contradicting `safe` flags → Disputed).

### 2.7 — Reach Ladder, Honest UI Labeling & PII Minimization

**Deliverables.** Reach as `in_mesh → bridged → anchored`; UI always separates reach from tier; honest copy ("Subido a internet hace 5 min", never "enviado"/"confirmado").

**Tasks.** `computeReach(record, meta, now)` (anchored if `meta.anchored_hlc`; bridged if `meta.bridged_receipt`; else in_mesh). Honest labels: render tier chip and reach chip separately. Desktop/web rules: reach filter offers only bridged/anchored toggles (never `in_mesh`); a record on the desktop map is guaranteed ≥ bridged (validated at query time); always show a separate reach row. PII: field stores plaintext names (locally encrypted); desktop/web show subject name as salted hash unless explicitly unsealed by a recipient. Proof-diagram honesty (GPS distance + accuracy with warning if distance > accuracy; BLE RSSI + estimated range with uncertainty; Plus-Code cell size 8-char ≈ 110 m / 10-char ≈ 14 m; subject cosign liveness time; QR/NFC POI + sig time).

**Acceptance.** Filter panel has reach toggles without `in_mesh`; every pinned desktop record is ≥ bridged (API-validated); reach distinct from tier everywhere; PII shown only if unsealed (default subject ID only); proof diagrams show confidence bounds.

**Tests.** Reach filter (bridged-only vs anchored-only counts); PII (B sees subject name only if unsealed via `enc`); proof diagram (GPS distance matches haversine; BLE RSSI shown).

### 2.8 — Phase 2 Gating Checklist & Demo Script

**Demo (4 phones + 1 desktop + 1 web, ~15 min).**
- *Act 1 (offline):* rescuer on Phone A taps SOS → appears on B/C/D via BLE < 3 s; B/C/D corroborate; desktop/web still empty (record is `in_mesh`-only).
- *Act 2 (bridge & reply):* Phone A gets LTE → gateway → SOS reaches the API < 2 s → desktop shows it ("Subido hace 2 s") → coordinator "Responder" "Equipo en ruta, ETA 15 min" → signed reply stored → Phone A pulls reply (mesh gossip) in 1–2 s.
- *Act 3 (verification):* Phone B reaches the location → GPS fix → On-site + photo → syncs to A/C/D → desktop tier changes Reported → On-site live (WebSocket) with a proof diagram (e.g., 12 m ± 8 m).
- *Act 4 (conflict & resolution):* Phone C claims `false_alarm` → disputes → all four show Disputed overlay; desktop "En sitio · En disputa" → coordinator authors `resolve {outcome: false_alarm}` → flows back → SOS resolved.

**Gating checklist:**
- [ ] Desktop reproducible + signed; PWA < 500 KB gzipped, installs Android+iOS, offline reads work.
- [ ] OpenAPI complete; mock passes all reads + `POST /v1/replies`.
- [ ] Real API path chosen (A or B); Ditto JS / REST client implemented.
- [ ] Kotlin + TS fold identical on all vectors (CI gate).
- [ ] Reach separated from tier; no `in_mesh` on desktop/web.
- [ ] Coordinator signs replies locally; cloud validates; replies flow back to field.
- [ ] Full 15-min demo succeeds with all tiers + conflicts surfacing.

### Phase 2 Residual Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Ditto Big Peer availability | P1 | Path B bridge fallback; client circuit-breaker + exponential backoff |
| macOS notarization | P2 | Apple dev account; closed-beta pre-test |
| Windows SmartScreen | P2 | Self-signed dev; HTTPS distribution from known publisher |
| SW stale records | P2 | `staleTime: 5s`; SW cache expiry 1 h |
| Ed25519 in browser (SubtleCrypto/XSS) | P2 | Tauri OS keychain on desktop; PWA coordinators secondary (no field-equivalent keys) |
| Reach gap (non-gateway offline) | P3 | Reach is informational; tier is the primary signal |
| No iOS native | P3 | PWA covers iOS coordinators; field iOS deferred (BLE background limits) |
| GenLayer unreachable | P3 | Non-blocking; `anchored` simply unset |

---

# 6. Phase 3 — Field Robustness & Battery Efficiency

Transforms the MVP into a field-hardened app on real 2 GB Android Go hardware (Xiaomi Redmi Go, Transsion Tecno). No online dependency in this phase. ~4–6 weeks (parallel workstreams).

## Workstream 3.1 — Adaptive Duty-Cycle Tuning on Real Low-End Hardware

**Objective.** Validate/optimize the battery state machine on genuine 2 GB / Cortex-A53 devices: **≥72 h standby, ≥24 h active meshing, ≥6 h sustained scanning.**

**Tasks.**
1. **Baseline power profiling** (3× Redmi Go + 2× Tecno; Monsoon power meter). *Deliverable:* per-bucket power traces over 24 h continuous sync. *Acceptance:* Normal ≤ 80 mW, Conserve ≤ 40 mW, Frugal ≤ 15 mW, Lifeline ≤ 5 mW; at 40 mW a 2,400 mAh usable budget → ≈ 60 h (meets ≥72 h standby goal in mixed buckets).
2. **Foreground service robustness.** Small Peer sync in a foreground service + MediaStyle notification; WorkManager scheduler. *Acceptance:* survives 8 h continuous without OOM/restart; notification always visible ("Malla activa · XXX peers"); Force Stop kills cleanly; relaunch resumes.
3. **Duty-cycle state machine.** `DutyCycleManager` (NORMAL: scan 1000 ms/adv 500 ms/wifi 30 s/all-prio; CONSERVE: 5000/500/120 s/P0–P1; FRUGAL: 30000/2000/300 s/P0; LIFELINE: no scan/adv 10000 ms/no sync). Transitions: >50% NORMAL; 30–50% CONSERVE; 15–30% + ≥1 unresolved P0 FRUGAL; <15% LIFELINE; manual override allowed. *Acceptance:* NORMAL→CONSERVE at 49% on three devices, power drops within 2 cycles; P0 carry-protection (advertise a beacon every 10 s in LIFELINE if >1 unresolved SOS); power curves within ±10%.
4. **Scan/advertise calibration.** Discovery-latency histograms per bucket/device pair (0–10 m). *Acceptance:* NORMAL 95p < 3 s; CONSERVE < 15 s; FRUGAL < 90 s; no device unreachable > 2 min in NORMAL.
5. **HLC + clock validation (P0-3 round-4).** Pure ingress accept/reject gate (P0/P1 always; P2/P3 quarantine if >30 min drift); `BootCountManager` (read BOOT_COUNT, persist `last_boot_count`); `ClockSkewDetector` (flag `_meta.clock_suspect` if `|author_wall−now| > 30 min` + prio ≤ P2, store unmodified). *Acceptance:* one device booted at 2035, one correct — both sync P0 unmodified; P0 never dropped; future-clock P2 flagged but stored; reboot increments monotonic counter, HLC counter never resets, two devices with different boot counts compute identical tier.
6. **WorkManager scheduling.** `SyncWorker` (≥20 min interval in Frugal); `enqueueUniquePeriodicWork`. *Acceptance:* correct intervals, no duplicate work; cold-start after kill resumes < 5 min (NORMAL) / < 20 min (CONSERVE).

## Workstream 3.2 — BLE Mesh Range & Density Validation

**Objective.** Measure delivery latency and discovery under field conditions; validate the "P0 first sync round < 3 s" claim and Ditto throughput.

**Tasks.**
1. **Discovery rig.** Companion TestApp timestamps advertisement/discovery to SQLite; 5 phones at 1/5/10 m. *Acceptance:* 1 m 95p < 200 ms; 5 m < 500 ms; 10 m < 2 s.
2. **Ditto P2P sync (200-byte P0).** Inject on A, measure until B reflects; 50× across pairs. *Acceptance:* median ≤ 1 s; 95p ≤ 3 s; loss < 5%.
3. **Multi-hop relay (mule).** 6 phones in a line, increasing hop distance. *Acceptance:* 2 m hops, 6-hop < 30 s zero drop; 5 m hops < 60 s, < 2%/hop.
4. **High-density cluster.** 15–20 phones, P2 at 1 Hz for 10 min. *Acceptance:* all converge < 10 s; < 300 MB Ditto heap; < 50% CPU; no OOM.
5. **Coverage map.** 8-phone search team over 500×500 m grid. *Acceptance:* full convergence < 20 min; ≤ 2 coverage gaps.
6. **Ditto offline licensing verification (HARD GATE).** Signed Ditto attestation: (a) tokens never expire, (b) no device binding, (c) offline P2P contacts the cloud zero times. *Acceptance:* email dated before Phase 3 start; APK boots in airplane mode with the bundled token, syncs P2P, `tcpdump` shows zero outbound packets. **If it fails, escalate to 3.2b.**
7. **(Contingency 3.2b) NearbyTransport fallback.** If Ditto fails any §I question, build a `NearbyTransport` over Google Nearby Connections + a deterministic CRDT merge (Yjs-via-JNI or hand-rolled for the small schema). *Acceptance:* 10 phones sync a 200-byte record < 5 s; deterministic convergence (append-only signed records only). **Parallel track, decision-gated before Phase 4.**

## Workstream 3.3 — Store-Carry-Forward & Partition Handling

**Objective.** Three-tier storage (P0-5) on 2 GB devices under weeks of load; P0 carry-protection; correct partition merges.

**Tasks.**
1. **Hot/Warm/Cold architecture.** Hot (Ditto DB, last 48 h, never evicted, ~100–200 MB); Warm (Room with TTL index, 2–30 days, evictable, soft-hidden via `hide` attestations, ~0.5–1 GB); Cold (user-initiated SD export, off-sync-path). Schema adds `_meta.evicted`/`eviction_reason` + attestation type `hide`. *Acceptance:* Hot always last 48 h; Warm queries < 100 ms on 10k records (indexed `{kind, plus_code_cell, age_bucket, prio}`); Cold export no perf impact.
2. **Eviction + carry-protection.** `EvictionEngine` per P0-5: never evict P0/P1 unresolved, referenced, own <48 h, recent <48 h, identity chain; candidates = P2/P3/P4 > TTL + distant (>5 km from location history); soft limit 1.2 GB warn / hard 1.5 GB GC; on evict create a signed `hide` attestation + sync. *Acceptance:* 2,000 mixed records on 2 GB — P0 never evicted, P1 held ≥14 d or until resolved, P2 resolved+>TTL evicted within 10 min of 1.2 GB; no OOM; post-GC < 1.0 GB.
3. **`hide` propagation.** `hide` syncs like any record; peers gray-out hidden records (still exist on the network); `refetch()` on demand; `reason="retracted_by_author"` = permanent tombstone. *Acceptance:* A evicts P2 + `hide`, B grays it out, B can re-fetch from another peer.
4. **Partition merge.** Two-week partition (Cluster X 8 phones "presumed dead" vs Y 12 phones "presumed alive"); mule bridges. *Acceptance:* both records exist post-merge (append-only), `disputed=true`, UI shows both claims + provenance, no silent overwrite, highest-tier proof wins.
5. **Store monitoring.** `StorageMonitor` daily log + alerts at 80/90/95% (es + en); "¿Qué se eliminará?" detail list.

## Workstream 3.4 — OEM Background-Killer Mitigation

**Objective.** Survive aggressive OEM task killers (MIUI, One UI, ColorOS); ensure P0 carry-protection survives a surprise kill.

**Tasks.**
1. **Persistent foreground service** (`PersistentMeshService`, MediaStyle, "Malla activa · X peers", visible in DnD, cannot be swiped away). *Acceptance:* 24 h without system kill; `dumpsys activity services` shows "started (foreground)".
2. **WorkManager EXPEDITED** (`setExpedited(RUN_AS_NON_EXPEDITED)`); battery-optimization exemption prompt (suggest, don't force). *Acceptance:* EXPEDITED runs within 1 min in low-power; prompt once, app works either way.
3. **OEM allowlist registration.** Detect via `Build.MANUFACTURER`; offer to open the OEM battery-saver page (Xiaomi/Samsung/Oppo/Vivo). *Acceptance:* Redmi Go + Tecno prompts open the right settings; prompt only once.
4. **Process keep-alive (last resort).** `KeepAliveThread` (NORMAL + P0 unresolved only; WakeLock 500 ms every 5 min; disabled in LIFELINE; overhead < 3 mW). *Acceptance:* foreground+EXPEDITED first line; KeepAlive second; disabled if allowlist granted.
5. **Integration on real OEMs.** Force Stop → measure resume. *Acceptance:* NORMAL < 5 min, CONSERVE < 20 min; P0 never lost; re-sync on resume.

## Workstream 3.5 — Offline-Map Packaging & Distribution

**Objective.** Package OSM PMTiles for Venezuela (Caracas, La Guaira, barrios) into the APK / downloadable update; post-disaster update pipeline.

**Tasks.**
1. **PMTiles extraction.** Geofabrik Venezuela → `tippecanoe` (zoom 0–15). *Acceptance:* zoom 0–10 country with labels; 11–15 street-level Caracas/La Guaira; < 200 MB.
2. **Bundling + dynamic delivery (Option A, modular).** Base APK ships Caracas + La Guaira (~50 MB); downloadable `venezuela-full.pmtiles` (150 MB CDN); in-app "Descargar mapa regional" if > 300 MB free. *Acceptance:* base APK < 250 MB; expansion downloads < 6 min on 5 Mbps with progress bar; maps work offline immediately.
3. **MapLibre integration.** `MapProvider` (`DiskMapProvider` + `CloudMapProvider` fallback); Mapa tab. *Acceptance:* cold start < 2 s; pan/zoom < 100 ms; pins overlay correctly; clustering works (P0-7).
4. **Post-disaster update pipeline (Phase 4 gate).** GitHub Actions (input: affected_area, damage_type) → PMTiles → CDN → in-app notify. *Acceptance:* 50 MB regional set in < 2 h; in-app update notification; optional download.
5. **Offline geocoding.** MVP: none (Plus Codes suffice). Phase 4 optional: `OfflineGeocoder` (Overpass cached).

## Workstream 3.6 — Field Drills & Reliability Validation

**Objective.** Realistic multi-site exercises (2–3 drills, 20–40 participants) to validate mesh, carrier protocols, battery, and field failure modes.

**Tasks.**
1. **Drill 1 — isolated sector.** 2-block collapse; 8 on-scene + 12 at collection points; SOS → corroborate → rooftop gateway. *Acceptance:* SOS to all 20 < 60 s; cloud push < 10 s when signal; reply back < 30 s; < 5%/h drain in CONSERVE.
2. **Drill 2 — multi-site carry-forward.** Two sites 2 km apart; mule walks A→B. *Acceptance:* pre-merge A=15/B=12 → unified 27, no dup/loss; convergence < 30 min.
3. **Drill 3 — QR trust anchors & channels.** 5 rescuers exchange QR → private channel. *Acceptance:* 5/5 QR exchanges; channel converges < 10 s; outsiders see zero channel records.
4. **Battery longevity.** 4 phones NORMAL 8 h. *Acceptance:* ≤ 60% of 3,000 mAh; 12+ h projected field uptime.
5. **Telemetry ingestion.** Per-phone append-only SQLite `{timestamp, event, peer_count, battery%, bucket, hops, latency_ms, error}`; USB extraction; per-drill reports with graphs.
6. **Debrief.** 30-min UX feedback (clarity, reach badge comprehension, icon confusion); prioritized backlog for Phase 4.

### Phase 3 Exit Gate
All drills pass acceptance; battery targets met on Redmi Go + Tecno (≥72 h standby, ≥24 h active); Ditto offline licensing validated in writing (or NearbyTransport fallback chosen); P0 carry-protection proven (never silent-evicted under storage pressure); mesh 95p latency < 3 s; P0-3 round-4 fully integrated (no HLC mutation, monotonic TTL, BOOT_COUNT, accept/reject ingress). Any failure → documented mitigation + Phase 4 carryover, or escalate.

---

# 7. Phase 4 — Hardening & Operational Security

Coercion/surveillance protection, key recovery, flood control, RBAC, optional anchoring, production ops, and final P0-patch integration. ~4–6 weeks (mostly independent workstreams).

## Workstream 4.1 — Coercion & Surveillance Protection Spine

**Tasks.**
1. **Panic-wipe.** Hidden gesture (5× top-right corner, customizable); < 2 s secure wipe of all records/identities/keystores + Ditto DB; no residual in logs/cache/thumbnails; appears freshly installed. `WipeManager`. *Acceptance:* gesture < 500 ms, wipe < 2 s; no artifacts via `adb shell ls`; clean reinstall usable immediately; no PII leaks to logs.
2. **Duress PIN + decoy.** Optional duress PIN distinct from unlock; opens a decoy instance (curated public low-sensitivity records only; real identity stays locked); seamless switch back with the real PIN; UI never reveals "decoy". `DurressManager` (two keystores). *Acceptance:* two PINs; decoy loads < 1 s; real mode full data; no cross-contamination.
3. **Fuzzy location.** `sensitive_subject` flag → 8-char Plus Code (~110 m); on-site verification still works via prefix-match (P0-6); prominent toggle; visually distinct on map. *Acceptance:* 8-char and 10-char distinct; corroborable via GPS prefix-match.
4. **Signal suppression.** "Bloquear puente a internet" toggle: sync P2P, never push up (replies may still come down); acts as relay only. `BridgeSuppressor` (local flag, never synced). *Acceptance:* toggle on logs "Puente bloqueado"; off resumes.
5. **Anonymous keypair rotation (offline).** Mark old `revoked`, generate new, `prev_key` link (old signs new); new records use new key; old records immutable. `KeyRotationManager`. *Acceptance:* rotation < 1 s offline; audit trail old→new; no cloud needed.
6. **Time quantization.** Sensitive reports round `wall_ms` to 15-min buckets (immutable, deterministic); UI shows "~03:15". *Acceptance:* all devices compute identical quantized value.
7. **Coercion integration test.** Duress PIN → decoy → agent inspects, no personal data → real PIN later → full data intact. *Acceptance:* decoy < 1 s; complete separation.

## Workstream 4.2 — Key Recovery & author_seq Backup

**Tasks.**
1. **Encrypted SD backup.** AES-256 (user passphrase, in-memory only) of `{priv, pub, created_at, fingerprint}` to `/sdcard/RescueRelay/identity_backup.bin`. `IdentityBackupManager`. *Acceptance:* backup < 2 s (~1 KB); restore on a new phone < 5 s, same `author_id`.
2. **author_seq recovery.** Query mesh for this identity's records; set local seq to `max(seen)+1` (avoid equivocation). `AuthorSeqRecoveryManager`. *Acceptance:* scan < 30 s; new records never equivocal; fallback baseline (timestamp/1000) if isolated.
3. **Continuity attestation (optional).** Signed "old device lost; same key restored" for audit.

## Workstream 4.3 — Flood/Abuse Control (P0-7)

**Tasks.**
1. **Layer 1 — per-key outbound rate limit.** P0 unlimited (life-safety); P1 10/h; P2 5/h; P3 2/h; toast on exceed (do not block; user may lower priority). `OutboundRateLimiter` (rolling-hour ring buffer). *Acceptance:* P1 11th shows toast, re-classify to P2 works; P0 unlimited; < 10 KB/key.
2. **Layer 2 — per-cell inbound clustering.** Per 10-char cell track unverified by `(kind, author_id)` over 15 min: 1–3 individual, 4–10 summary bubble, 10+ cluster-only (unless "Show all"); suppressed records never deleted (visible in Señales/expanded map); aggressive clustering for unknown keys. `InboundClusteringEngine`. *Acceptance:* 100 unverified SOS in one cell → 1 bubble (tap = list of 100); verified-key reports always individual; Señales accurate.
3. **Layer 3 — adaptive PoW.** Flood Mode at >10 unknown-key/cell/15 min → `blake3(cbor||nonce) & 0xFFFF0000 == 0` (16-bit, ~100 ms on Cortex-A53); P0 bypasses; adaptive to 20-bit (~1.5 s) cap 24-bit. `FloodModeDetector` + `ProofOfWorkEngine`; record carries `{nonce, bits}`. *Acceptance:* activates at threshold; 16-bit 100–150 ms on Redmi Go; P0 bypass; PoW replicates in the signed record.
4. **Layer 4 — local web-of-trust.** Mark `contacto conocido` via QR fingerprint; `reputation_score` (start 1.0, +0.1/verified, −0.2/dispute, max 5.0, 30-day decay); >2.0 exempt from clustering; sort Señales by reputation; "⭐ 3.2" badge; **local-only, never synced.** `ReputationEngine`. *Acceptance:* known contact always individual; unknown clustered after 4/cell; persists; decays to 0 after 30 days.
5. **Manual escalation.** QR channel `consensus` feed (members-only); batch dispute; local block/mute (long-press → "No confiar", hidden default, visible forensic, unmutable). *Acceptance:* mute hides but retains in store; batch dispute syncs red overlay.
6. **Convergence + honest assertion.** Each device clusters/reputes/PoWs independently → identical UI state; help text: "No tenemos manera de detener un adversario estatal con 1,000 teléfonos. Nuestra defensa es mostrar la verdad…". *Acceptance:* convergence test passes; help text clear.
7. **Flood integration test.** 1,000 unverified SOS in one cell. *Acceptance:* < 50 MB extra; pan/zoom < 500 ms; 1 bubble; Señales accurate (1000), no lag.

## Workstream 4.4 — Online-Side Role-Based Access & Redaction (Desktop/Web)

**Tasks.**
1. **Auth + RBAC.** Coordinators auth (email+password / OAuth2 / email-code) → JWT `{operator_id, role, device_key_id, iat, exp}`; roles `read_only` / `reply_author` / `tasking_author` / `admin`. `POST /v1/auth/login`, `GET /v1/auth/verify`; `CloudAuthManager` hook. *Acceptance:* login < 2 s; invalid token 401 → re-login; `reply_author` blocked from admin endpoints.
2. **Redaction by role.** Sensitive fields (`name_hash`, `home_plus_code`, notes): `read_only` "[redacted]"; `reply_author`/`tasking_author`/`admin` full; response filter at API/bridge layer. *Acceptance:* `read_only` sees "[redactado]" but task assignments; `reply_author` full + tasking; audit log tracks access.
3. **Audit logging.** Immutable append-only `{timestamp, operator_id, action, target_id, changes, ip}`; `GET /v1/audit?since=&operator_id=`. *Acceptance:* every write logged; queryable by time + operator.
4. **Big Peer / bridge integration.** Ditto read-only subscriptions natively, or redaction at the bridge.

## Workstream 4.5 — Optional GenLayer Anchoring (Edge-Only, Non-Blocking)

**Field never waits for anchoring.**

**Tasks.**
1. **Verified-record batching.** Cloud-side every 10 min / 100 records, collect hashes of tier ≥ On-site, Merkle root. `VerifiedRecordBatcher`.
2. **GenLayer submission.** `submitVerificationBatch(merkle_root, ts, preamble)`; `GenLayerClient` (retries + cost). *Acceptance:* submitted < 20 min async; contract emits `BatchAnchored`.
3. **Anchor attestation sync.** `{att_type:"anchor", target:{report_id, content_hash}, payload:{chain:"genlayer", tx, merkle_root}, sig: BigPeer}` syncs to field → reach=anchored. *Acceptance:* anchors sync back < 30 min.
4. **Post-disaster verification.** Auditors query batches by operation_id; verify field records (optional, post-MVP).
5. **Cost.** ~$0.01–0.10/batch; ~144 batches/24 h ≈ $1.44–14.40/operation; per-day budget cap.

## Workstream 4.6 — Release & Ops (Crash Reporting, Update Channels, Rollback)

**Tasks.**
1. **Crash reporting (PII-safe).** Sentry/Crashlytics, opt-in; log app/Android version, model, stack trace, flags — **never** PII. `CrashReporter`. *Acceptance:* crash logged with no PII; Settings → Diagnostics shows what's sent.
2. **Secure signing + CI/CD.** Signed APK (GitHub Secrets / hardware key); on tag build/sign/SHA-256 → GitHub Releases + Play Store internal (staged 25→50→100%) + self-hosted CDN. *Acceptance:* `apksigner verify` passes; Play upload via `bundletool`.
3. **Update channels.** alpha (daily) / beta (weekly, 25%) / stable (after 1 week beta, 100%); in-app opt-in; daily update check, non-forced. *Acceptance:* beta notified < 1 h; stable < 1 day.
4. **Rollback.** Pull beta, hotfix < 4 h; Managed rollout → 0%; previous stable installable 30 days; runbook.
5. **QR APK distribution (offline, optional).** `qr-installer.py` → QR + CDN URL.
6. **Version pinning (emergency, optional).** Blacklisted client versions get HTTP 426 + "Actualización de seguridad requerida".

## Workstream 4.7 — P0 Patch Integration (Round-4 Clock & C.1 Device-Confirmed)

**Tasks.**
1. **P0-3 round-4 (clock/TTL).** (a) Never mutate HLC; ingress accept/reject (P0/P1 always; P2/P3 quarantine >30 min). (b) Remove `expires_at > now()` from replication subscriptions; P2/P3 filter on relative-age HLC cursor. (c) Anchor TTL to `elapsedRealtime()` + BOOT_COUNT reboot bridge (never wall time). (d) Flag author drift `_meta.clock_suspect`, store unmodified. (e) P0 unresolved always replicable at the subscription layer. (f) Restrict `ttl_extend` to author or proximity-verified attester, cumulative cap ~+30 d, reject-at-ingress. `ClockDriftHandler` + `MonotonicTTLEngine` + subscription class-partition filters. *Acceptance:* Device A (2025-01-01) + B (2025-01-15) sync the same P0 → identical tier + reach, no drops; P0 never auto-expires; HLC never mutated, sig always valid.
2. **P0-2 C.1 (subject-anchored device-confirm).** When subject has a fix: subject signs its own 8-char cell, attestor includes it, subject echoes + signs; validate `response_payload.subject_plus_code` == attestor's `proof.own_loc` (same 8-char cell). When subject has no fix: require ≥2 distinct independent attestors with the same cell, else cap at "presence/identity confirmed, location UNVERIFIED". Schema adds `attestor_plus_code` (8-char) to `ble_encounter_challenge`. *Acceptance:* subject-with-GPS reaches Device-confirm when cells match + subject signs; subject-without-GPS needs ≥2 independent attestors; all devices compute identical tier (subject sig re-verified everywhere).
3. **Regression — convergence under skew.** Three honest devices (A correct, B +2 h, C −3 h) sync 20 mixed records. *Acceptance:* identical tier/reach/clustering; no drops; convergence < 5 min.
4. **Convergence under reboot.** Device boots at epoch — TTL still correct; P0 never dropped; P1+ eviction not wall-clock-based; NTP correction resumes normal TTL.

## Workstream 4.8 — Full Spanish i18n & Low-Literacy UX

**Tasks.**
1. **Complete translation.** Audit all strings; professional `es_ES` + `es_LA` (primary for Venezuela). *Acceptance:* 100% translated; no English fallback.
2. **Icons-only mode.** Large recognizable icons (SOS red circle, victim orange, hazard yellow, status blue); 5-tap create; icon settings. *Acceptance:* recognizable to non-readers; toggle "Modo de texto" ↔ "Modo de iconos".
3. **Voice prompts (optional).** TTS Spanish ("Tap para crear un SOS"). `VoicePromptManager`.
4. **Large text + spacing.** Default 16 sp; small/normal/large/extra-large; 1.5× line spacing. *Acceptance:* extra-large readable at arm's length.
5. **Plain-language errors.** "Error 404" → "No pudimos conectar. Intenta de nuevo"; "Ubicación no disponible" → "GPS no encuentra la ubicación. Intenta en un lugar abierto". *Acceptance:* no technical codes visible.
6. **Cultural adaptation.** Notification icon must not resemble police sirens; natural Venezuelan Spanish; NGO review.
7. **Accessibility testing.** 5–10 non-literate rescuers; measure time-to-task, error rate. *Acceptance:* SOS created < 30 s (icons + voice); error rate < 10%.

### Phase 4 Exit Gate
Security features (panic-wipe < 2 s, duress separates real/decoy, key recovery) implemented + tested; flood control mitigates 1,000 bad records (map usable, reputation ranks); P0-3 round-4 + P0-2 C.1 integrated, convergence test passes (skewed clocks identical tier); Device-confirm subject-anchored or ≥2-corroborator gated; full es-VE + icons + voice; crash reporting + updates + rollback production-ready; GenLayer anchoring available (field independent of it). **Ship criteria (MVP):** Phases 0–3 complete; Phase 4 security + flood control + ops + i18n **mandatory**; GenLayer anchoring optional (can ship post-MVP).

---

# 8. Cross-Cutting: Testing & Quality Harness

The progressive vector corpus grows across phases: **10 (Phase 0) → 20+ (Phase 1) → 77 canonical (this consolidated master) → 150+ (Phase 2+)**. §8.1 is the canonical master spec; the phase tasks (0.5/0.10, 1.1/T1.7, 2.5) feed into it.

### 8.1 Cross-Language Test Vectors (Convergence Gate — Master Spec)

**Purpose.** Lock schema, fold, and crypto to byte-level behavior across Kotlin (APK) and TypeScript (desktop/web). **Hard CI gate** before any target ships (§9.4).

**`test-vectors/` layout:** `corpus/` (schema_v1_records.json — 50 canonical reports + attestations; edge_cases.json; conflict_matrices.json), `kotlin/` (VectorTest.kt + fixtures), `typescript/` (vector.test.ts + fixtures), `shared/` (ReferenceImplementation.md, trust_fold_edge_cases.md), `CI/` (phase-0-convergence.yaml, convergence-checker.sh).

**Categories (77 canonical):**

| Category | Count | Scope |
|---|---|---|
| Basic signing/verification | 8 | Single report + sig; invalid sigs drop before merge |
| Single-tier promotions | 12 | Reported → Corroborated (≥2 distinct, no proof) → On-site (GPS/PlusCode) → Device-confirmed → Self-confirmed |
| Authority rules | 6 | Only reporter or proof-holder enters Verified; corroborators never raise above Corroborated |
| Proof predicates | 15 | GPS (≤50 m + accuracy ≤50 m); PlusCode (exact 10–11); BLE-challenge (sig + nonce + RSSI floor); subject-cosign; QR/NFC |
| Dispute & conflict | 10 | Two keys assert mutually-exclusive facts; Disputed surfaces; higher-tier resolves |
| Reach & metadata | 8 | in_mesh → bridged (signed bridge att) → anchored (GenLayer tx); never mutate signed fields |
| HLC & TTL | 10 | Order by HLC not wall_ms; expiry relative to author wall_ms; clamp affects no signed bytes (P0-3) |
| Edge cases & OOM | 8 | Oversized (dropped); empty collections; null optionals; ~200 distinct signers (memory bound) |

**Acceptance.** Kotlin suite on emulator API 28/32 passes all 77; TS suite on Node 18+ passes the same 77; outputs compared on `tier_label/verified/verifiedBy/disputed/outcome/reach/confidence_scope` — **100% byte-exact**; crypto (CBOR, Ed25519, X25519) bit-identical on all 50 records; any mismatch blocks PR with a detailed diff.

**Maintenance.** New tier/proof type → add a vector + update both implementations in lockstep. **Never remove a vector** — only extend (target 150+ by Phase 2).

### 8.2 Unit Tests — Trust Fold & Conflict Logic (Kotlin + TypeScript, Phase 1)

Exhaustive isolation tests of the §3.4 fold + dispute. Representative Kotlin cases:
- Tier lattice: `reportedWithNoAttestation`; `corroboratedWith2DistinctNoProof` (count=2); `reporterAffirmDoesNotRaiseTierAlone` (verified=true, tier stays Reported without proof); `onSiteRequiresProximityProofOfType` (GPS match → On-site; null proof → Reported); `deviceConfirmedRequiresBLEChallengeValid` (valid → Device-confirmed; `time_slot` >6 h → Reported); `selfConfirmedRequiresSubjectSignature` (valid subject sig → Self-confirmed; wrong key → Reported).
- Conflict: `disputeExplicit` (disputed=true, tier frozen at highest reached, not lowered); `conflictImplicitTwoDistinctFactsContradictory` (alive vs deceased → disputed, Corroborated); `resolveViaHigherTierProof` (device_confirm "alive" → Device-confirmed, disputed stays true since both claims retained).
- Authority/Sybil: `onlyReporterOrProximityHolderMayEnterVerified` (1000 same-key signatures → stays Corroborated, verified=false); `authorAffirmWithProofRaisesOnSite`.
- Idempotence/convergence: `foldIdempotent` (order-independent, duplicates no-op); `foldConvergesUnderMerge` (merged tier = lattice-max of isolated tiers).
- Rejection: `forgedSignatureDroppedBeforeFold`.

**Acceptance.** Kotlin 150+ tests pass API 28–34; TS 150+ Jest mirror; fold module coverage ≥ 95% (all lattice branches); Kotlin < 5 s, TS < 3 s; both suites pass-or-fail together (fold changes update both).

### 8.3 Two-Device Skewed-Clock Convergence (Mandatory Regression — Phase 1, Phase 2 blocker)

**Purpose.** Validate P0-3 (clock-independent expiry) + HLC clamping on real hardware.

**Design.** Phone A at `now`; Phone B at `now + 90 min` (extreme future skew within clamp window + margin); BLE in range.
1. A authors `{kind:sos, ttl_s:3600, wall_ms:A.now}`, stores (Reported, in_mesh).
2. B receives via gossip; `wall_ms_A` vs `wall_ms_B = A.now+90 min`. **HLC clamp** to `B.now+30 min` in `_meta.hlc_clamped` only — signed bytes unchanged. **TTL** computed relative to author wall_ms (`A.now`) → NOT expired (age 0, TTL 3600 s).
3. B corroborates; fold on both → Corroborated, verified=false, in_mesh.
4. Clock reset B → A's time; re-sync → records still not expired (age from stored author wall_ms).

**Harness.** `SkewedClockTest.kt` instrumented: `twoDeviceSkewedClockConvergence` (assert `_meta.hlc_clamped` true; signature still verifies; both compute identical tier/verified/disputed) and `expiryIndependentOfReceiverClock` (fresh record not expired; advancing A's time by 65 s past TTL → expired even though B's clock unmoved).

**Acceptance.** Runs on two real phones (or emulators with clock mocking); clamp flagged when drift > 30 min, signed bytes intact, sig verifies; TTL relative to author wall_ms; both converge to identical tier/verified/disputed despite 90-min skew; passes API 28/30/32/34; < 30 s real-time. **CI:** Phase 1b on Firebase Test Lab as a flaky gate (re-run 3×, 2+ pass opens the gate). **Critical Phase 2 blocker** — consistent failure means clock-skew safety is broken (rework per Appendix A.2).

### 8.4 Multi-Device Mesh Drills (Phases 1–2, Integration)

**Purpose.** Validate topology, carry-forward, bridging, conflict surfacing on 3–6 devices.
- **Test 1 — 3-device linear carry-forward:** A→B→C via mule; assert C has the SOS, signature intact, tier unchanged (`MultiDeviceMeshTest.threeDeviceCarryForward` with a `MeshSimulator` toggling range).
- **Test 2 — 4-device cluster + bridge:** Cluster X (A↔B) + Cluster Y (C↔D), bridge event ingests outboxes to a `CloudBridgeSimulator` and re-injects; assert A+B see C+D with `_meta.reach == "bridged"`.
- **Test 3 — conflict resolution via proof:** A reports missing, B corroborates "alive" → disputed; C on-site GPS "alive" → all converge On-site, disputed stays true (append-only), best_proof = on_site.

**Acceptance.** Carry-forward propagates with intact sig + tier; post-bridge both clusters see each other (reach stamped); Disputed surfaces on all devices; resolution via higher-tier proof works; pass on 2 phones + 1 emulator; < 2 min/test; OOM-safe on 2 GB.

### 8.5 Security Tests — Replay, Tamper, Sybil, Flood (Phases 1–2)

- **Replay:** BLE challenge nonce not replayable (dedup by `(subject_id, challenge_nonce)` → content_hash idempotent); HLC sort prevents reorder attacks (deliver att2 before att1 → fold sorts by HLC, dispute + correct tier).
- **Tamper:** `forgedSignatureDropped` (random sig rejected before merge); `mutatedFieldAfterSigningRejected` (changing `confidence` with the old sig fails verification, dropped).
- **Sybil:** `sybilSwarmCannotInflateTier` (1000 fake keys → stays Corroborated, verified=false, count visible but not tier-raising); `sybilCannotMakeDeviceConfirmedWithoutSubjectKey` (missing subject sig → no promotion).
- **Flood (P0-7):** `perKeyRateLimitEnforced` (>5/window dropped locally, not synced); `perCellInboundClusteringAndDedup` (50 same-cell reports → ~5 representative sync out, rest local-only).

**Acceptance.** Replay idempotent; forged/mutated sigs always dropped before merge; 1000 fake keys never reach Verified/Device-confirmed without proof; per-key rate limiting + per-cell clustering hold; pass on both platforms where applicable.

### 8.6 Web/Desktop End-to-End Tests (Phases 1–2)

- **Phase 1 (mock API):** filter + display bridged records; coordinator authors status/tasking (`kind=status`, refs target, body); subscriptions live-update map without refresh.
- **Phase 2 (real API):** end-to-end field SOS → Small Peer syncs to Big Peer → coordinator sees it → authors + posts signed reply (`Ed25519.verify` passes) → gateway pulls back to field → field merges the reply.

**Acceptance.** All Phase 1 mock flows pass; Phase 2 real Big Peer end-to-end works; honest reach badges render correctly; subscription latency < 5 s (P0/P1) or < 30 s (P2/P3); offline console shows cache-only label; no false delivery claims.

---

# 9. Cross-Cutting: CI/CD per Target

### 9.1 Android APK/AAB (GitHub Actions)

`android-build.yml` — trigger on push to `main`/`develop` (paths android/core/test-vectors) + manual dispatch with `release_track` (internal/alpha/beta/production). Jobs: **build** (setup-java 17, Gradle cache, decode keystore from secrets, `assembleDebug`, `./gradlew test`, on dispatch `assembleRelease` + `bundleRelease`, upload AAB to Play via `r0adkll/upload-google-play`, upload APK artifact, Slack notify) and **device-test** (Firebase Test Lab via `test-config.yml`, upload results). Matrix: API 28/30/32/34 on Pixel 3a/4/5 (low-spec representative). *Acceptance:* builds with no warnings (`-Werror` release); unit + instrumented tests pass all API levels; signed APK < 80 MB, AAB < 50 MB; FTL < 15 min.

### 9.2 Tauri Desktop (Windows/macOS/Linux)

`desktop-build.yml` — matrix `ubuntu-latest`/`macos-latest`/`windows-latest` with per-OS artifact names. Steps: setup-node 18, Rust toolchain, Linux deps (gtk/webkit2gtk), `npm ci && npm run build && npm run tauri build --ci`, macOS code-sign + notarize (cert from secrets), upload to Release on tag. *Acceptance:* builds on all three with no code-sign errors; `.msi`/`.dmg`/`.AppImage`/`.deb` generated; < 150 MB each; installers tested via VirtualBox/Docker.

### 9.3 PWA Static Deployment

`web-deploy.yml` — push to `main` (paths coordinator-web/core-ts) + manual env choice. Steps: setup-node 18, `npm run build:web`, `workbox generateSW`, deploy to Cloudflare Pages (staging or production), purge CDN cache, Playwright E2E against staging, Lighthouse CI. *Acceptance:* Vite build, bundle < 500 KB gzipped; SW caches, offline works; E2E passes on staging before production; Lighthouse ≥ 90; production deploy < 5 min after merge.

### 9.4 Shared Test-Vector Convergence Gate (blocks all targets)

`convergence-gate.yml` — on PR (paths core/core-ts/test-vectors/android/coordinator-web). Jobs: **kotlin-vectors** (run + export JSON), **typescript-vectors** (run + export JSON), **convergence-check** (`convergence-checker.py` compares; 100% agreement required; on failure post a `REQUEST_CHANGES` review with diff; on success `APPROVE`). *Acceptance:* both languages output JSON; any divergence blocks the PR with a detailed diff; gate passes before any merge.

---

# 10. External Dependencies & Consolidated Risk Register

### 10.1 Ditto Dependency (P0-1, CRITICAL GATE)

Phase 1 cannot start until Ditto answers four written questions:

| Q | Question | Status |
|---|---|---|
| a | Permanently-valid offline tokens, embeddable in an APK at build time, never expiring? | **Required before Phase 1.a** |
| b | Small Peer identity derivable from our Ed25519 pubkey (not Ditto's cloud credential)? | **Required before Phase 1.a** |
| c | Minimum-MTU one-way sync latency for 200 bytes on low-end Android; max concurrent peers on 2 GB RAM? | **Required before Phase 1.a** |
| d | May we replace the sync layer with an open-source CRDT while keeping the store? | **Required before Phase 1.a** |

**Contingency.** Build `NearbyTransport` in parallel (~1.5 sprint) over `play-services-nearby` implementing the shared `SyncTransport`; evaluate open-source CRDT (Yjs/Automerge, ~500 KB WASM). The `SyncTransport` + `SignedRecordStore` interfaces allow a runtime swap with no change to fold/schema/crypto. **Risk level: P0** — if offline tokens or identity pinning are unavailable, the mesh premise fails.

### 10.2 Physical Android Device Fleet (Phase 1+)

| Device | Count | Purpose |
|---|---|---|
| Xiaomi Redmi Go (2 GB, budget BLE) | 2 | Low-spec baseline; BLE throughput |
| Transsion Tecno/Infinix (2–3 GB) | 2 | Target market; carry-forward |
| Samsung Galaxy A-series (4+ GB) | 2 | Mid-range; maps + backlog |
| Pixel 4a (unlocked) | 2 | Clean Android + Firebase Test Lab |

~$300–500. Procure by Phase 1 start; dedicated bench + BLE isolation cage. **Risk: Medium** — procurement delays Phase 1 by 2–3 weeks; pre-order early.

### 10.3 Ditto Cloud Account & Support

Big Peer account (managed or self-hosted); license for ≥5 test devices + 1 gateway; support channel + escalation for offline licensing/throughput. Contact sales 4 weeks before Phase 1 (~$500/mo early-stage or negotiated donation). **Risk: Medium** — vendor negotiation delay; fallback self-host Big Peer (longer setup).

### 10.4 OEM Background Behavior

Low-end phones aggressively kill background apps. Validate foreground service + WorkManager + Doze exemption on Redmi Go (MIUI), Tecno (modified Android); battery drain over 4 h active < 2 mA avg. OEM-specific tuning guide by Phase 3.

### 10.5 Consolidated Cross-Phase Risk Register

| Risk | Severity | Mitigation | Escalation |
|---|---|---|---|
| Ditto licensing failure | CRITICAL/P0 | Written attestation before Phase 1; SyncTransport abstraction | NearbyTransport + Yjs parallel (3.2b) |
| Low-end hardware underperforms | High | Redmi Go + Tecno targets; measured power; tuned duty cycle | Degrade to LIFELINE beacon-only (5 mW); P2P-only, no relay |
| Clock-drift survives P0-3 round-4 | High | 4.7 regression + convergence gate before Phase 4 | Round-5 patch (Appendix C) |
| Device-confirmed forgery despite C.1 | Medium | Subject-anchor or ≥2-corroborator, both crypto-verified | Fallback to corroboration (documented) |
| Flood-control PoW annoys users | Medium | PoW off by default, only Flood Mode, P0 bypass, user-disable | Field drills validate UX |
| OEM app-killing | Medium | Foreground service + EXPEDITED + allowlist + KeepAlive | Discovered in Phase 3, fixable |
| GenLayer unavailable | Low | Non-blocking; reach stays bridged; anchored unset | None — field unaffected |
| Mock API ≠ real backend | Low | Thin no-auth mock; CloudAPIClient swap-ready | Pause demo pending Phase 2 API |

---

# 11. Milestones & Sequencing Summary

### 11.1 Phase-by-Phase Milestone Tables

**Phase 0 (~3 days).** Ditto Q&A signed; Ed25519 keystore; canonical CBOR (50-vector match); Kotlin+TS fold identical on 77 vectors; convergence CI gate; offline two-phone BLE sync. **Exit:** Ditto answers (or fallback decision) + convergence gate + offline BLE sync. → unblocks Phase 1.

**Phase 1 (~2 weeks).** APK 6-screen UI; 3-step capture (signed records); Ditto P2P (4 phones in a stairwell < 10 s); sig-verify before merge; tier + reach badges; 150 fold unit tests; multi-device mesh tests; React console on mock API; mock cloud; signed APK (~65 MB on Pixel 4a / FTL); Android CI; 4-phone demo. **Exit:** all 6 tabs offline; 4-phone offline→bridge→reply→convergence; fold + mesh tests; sideloadable APK; web console reads mock. → unblocks 1b + 2.

**Phase 1b (~3 days).** Tauri scaffold; native chrome; 3-column layout; macOS notarized `.dmg`; Windows `.msi`; Linux `.AppImage`/`.deb`; 3-OS CI. **Exit:** all four artifacts build + code-sign; desktop shows same data as web. → unblocks Phase 2.

**Phase 2 (~2 weeks).** Device-confirmed BLE challenge-response (P0-2); Self-confirmed cosign; dispute detection; On-site GPS + Plus-Code; real Big Peer / bridge; OpenAPI + vectors; coordinator tasking; cross-platform fold over real API; E2E + 12-scenario verification matrix. **Exit:** all 5 tiers via proof; Disputed surfaces; real cloud live; E2E field→coordinator→field; identical tier on field (Kotlin) + web (TS). → unblocks Phase 3.

**Phase 3 (~4–6 weeks).** Duty-cycle state machine; foreground service surviving Doze + app-kill; 6-device mule chain; content-hash dedup; TTL + eviction (P0 protected); battery drain (< 2 mA on Redmi Go); OEM Doze profiles; 2-device BLE in 3 s; PMTiles packaging; 3 field drills. **Exit:** 6-device chain converges; battery acceptable; Doze exemptions work; Ditto licensing validated in writing (or fallback). → unblocks Phase 4.

**Phase 4 (~4–6 weeks).** GenLayer anchoring; duress PIN + decoy + panic-wipe; key recovery + author_seq; flood control (4 layers); RBAC + redaction + audit; crash reporting + CI/CD + staged rollout + rollback; P0-3 round-4 + P0-2 C.1; convergence regression (skewed clocks); full es-VE + icons + voice; CSV audit export. **Exit:** security features tested; flood control mitigates 1,000 bad records; round-4 convergence passes; full Spanish; ops production-ready; anchoring available (non-blocking). → Production deployment.

### 11.2 Master Milestone Summary Table

| Phase | Duration | APK | Web/Desktop | Cloud | Key Exit Gate |
|---|---|---|---|---|---|
| **0** | ~3 d | Schema + keys locked | — | — | Ditto Q&A ✓ + 77-vector convergence ✓ + offline BLE sync ✓ |
| **1** | ~2 w | MVP rescuer ships | Mock-API console | Mock | 4-phone offline → carry-forward → bridge → reply |
| **1b** | ~3 d | — | Tauri desktop (signed) | Mock | 3-platform builds + codesigns; same data as web |
| **2** | ~2 w | All 5 tiers + Device-confirm | Real API + tasking + PWA | Real Big Peer/bridge | E2E field→coordinator→field; skewed-clock test passes |
| **3** | ~4–6 w | Duty-cycle + mule chain | Polling/cursor | Cursor API | 6-device carry-forward; ≥72 h standby; P0 never evicted |
| **4** | ~4–6 w | Duress + flood + i18n | Audit export + RBAC | GenLayer anchor | Spanish + round-4 convergence + panic-wipe/duress |

### 11.3 Critical Path

1. **Phase 0** (Ditto validation + convergence gate) gates everything.
2. **Phase 1** (APK MVP) must work before any coordinator console depth.
3. **Phase 1b** (Tauri) runs **parallel** to Phase 1 / Phase 2 API groundwork — no blocker.
4. **Phase 2** (real cloud) requires Phase 1 success; enables field ↔ coordinator; the §8.3 skewed-clock test is a **Phase 2 blocker**.
5. **Phases 3–4** (scale + hardening) are lower-risk and can compress/defer if needed; the Ditto offline-licensing attestation (3.2.6) is a Phase 3 hard gate; the NearbyTransport contingency (3.2b) must be decision-gated before Phase 4.

### 11.4 Resource & Timeline Estimate

**Combined Phase 1b + 2:** ~35–42 h (~1–1.5 weeks with moderate overlap; critical path 2.1 → 2.2 → 2.4, with 1b in parallel). **Phase 3 + 4:** ~8–12 weeks (~2–3 months). **Team:** 2 Android (Kotlin/Compose) + 1 Cloud/API + 0.5 Localization/Accessibility + 1 QA/Field + 1 PM/Ops (4–5 engineers core). The APK ships first and hardened; the mesh is robust at 2 GB scale; rescuers are protected from coercion; coordinators get the tools they need — every workstream carries concrete deliverables, acceptance criteria, and tests, with the P0 resolutions integrated and a cross-language convergence gate enforcing the single data contract end to end.
