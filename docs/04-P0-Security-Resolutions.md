# Baran — P0 Resolutions (spec §9 fixes)

## Introduction

This document consolidates the seven P0 ("make or break") resolutions for the Baran offline mesh disaster-response system into a single reference. Each P0 corresponds to a blocking defect surfaced in the spec critique (§9): a single-vendor sync dependency with no fallback (P0-1), a cryptographically forgeable proximity proof (P0-2), unbounded clock-skew that weaponizes expiry (P0-3), an undefined and unverifiable "bridged" reach signal (P0-4), a store-bounding scheme that breaks append-only signature integrity (P0-5), a privacy default that silently disables on-site verification for the most at-risk subjects (P0-6), and the absence of any flood/abuse control for the shared map independent of the trust tiers (P0-7). For each, the full resolution — schemas, algorithms, protocol flows, spec deltas, and an honest accounting of residual limitations — is reproduced below. Two of these resolutions (Device-confirmed and clock-drift) were subsequently subjected to adversarial verification; both came back **BROKEN**, and the required follow-up patches are folded into the appendix. Readers integrating these fixes must treat P0-2 and P0-3 as conditionally resolved: ship them only with the appendix patches applied.

## Summary: P0 → Resolution → Residual Risk

| P0 | One-line resolution | Residual risk |
|---|---|---|
| **P0-1** De-risk single-vendor Ditto dependency | Abstract sync/store behind `SyncTransport`/`SignedRecordStore` interfaces, get Ditto's offline-license/identity/BLE claims validated in writing, and parallel-build a `NearbyTransport` + open-source CRDT (Yjs/Automerge) fallback in Phase 1. | If Ditto cannot bundle a perpetual offline license, pre-deployed field phones brick at token expiry with **no code workaround**; Nearby Connections is Android-only; cloud-bridge censorship remains unsolved. |
| **P0-2** Redesign forgeable Device-confirmed proof | Replace the published-key rolling beacon with a real-time Ed25519 **challenge-response**: the subject signs a fresh attestor nonce with its private key. | Relay/wormhole attacks remain (named in UI); subject phone must be awake/in range. **NOTE: adversarial verification returned BROKEN** — the as-written fix discards the subject signature; see Appendix A.1 for the required propagate-and-re-verify patch, without which the tier is still forgeable from one free key. |
| **P0-3** Bound clock drift; clock-independent expiry | Clamp incoming HLC `wall_ms` to a ±30 min window and anchor TTL/eviction to the record's immutable author `wall_ms` rather than the receiver's clock. | **NOTE: adversarial verification returned BROKEN** — clamping mutates a signed field (breaks sig/convergence) and the wall-clock TTL gate survives at the §4.3 replication/subscription layer; see Appendix A.2 for the required monotonic-clock + no-mutation patch. |
| **P0-4** Make `bridged` reach a signed, synced receipt | The Big Peer issues a signed `bridge` attestation (pinned Ed25519 key) per ingested report; it syncs back through the mesh so non-gateway devices learn `bridged` via ordinary gossip. | A device never on any gateway path can never learn its records bridged; a compromised Big Peer can issue false `bridge` attestations (mitigated by GenLayer audit + key rotation). |
| **P0-5** Replace integrity-breaking compaction with a real store-bound | Three-tier Hot/Warm/Cold storage with signed `hide` tombstones; bodies are **never** dropped from the network, only evicted from local cache and re-fetchable on demand. | Recovery latency / relay refusal in a partitioned network; attestation bloom on heavily-corroborated reports; device-specific (not global) eviction bound due to geo-courier carry. |
| **P0-6** Reconcile coarse-geo privacy with proximity proof | Allow `pluscode_match` against 8-char sensitive reports via **prefix-match containment**: an attester's precise 10–11 char code validates if its 8-char prefix equals the report's cell. | Cell-level co-location of attester and subject is observable; requires attester GPS fix; proof is duress/relay-spoofable like any proximity proof (mitigated by multiple independent attestations). |
| **P0-7** Flood/abuse control for the shared picture | Four-layer offline defense: per-key outbound rate limits, per-cell inbound clustering, adaptive proof-of-work in Flood Mode, and local web-of-trust triage weighting. | Does **not** stop a state adversary with unlimited keys / physical devices / RF control; raises cost only. Human judgment (provenance, corroboration, dispute) is the ultimate defense. |

---

## P0-1 — De-risk the single-vendor Ditto dependency

### Problem Summary

Baran's entire mesh/sync is a "thin layer over Ditto" (§1.1, §7.3), yet three assumed properties are unvalidated with **no fallback**:
1. **Offline license tokens** baked into an APK will not expire mid-blackout (Ditto's historical practice is to time-box and identity-tie them).
2. **Identity model** is compatible with per-device Ed25519 trust and can be pinned away from Ditto's cloud auth (§7.3 caveat).
3. **BLE-primary sync throughput** on 2–4 GB Android Go is realistic for sub-200-byte P0 "first-round delivery" (§2.7, §4.4).

Failure of **any one** kills the core premise. The critique (P0 item 1) flags this as the make/break bet.

### I. Written Questions for Ditto

Send these to Ditto's enterprise/startup team **before coding any mesh integration** and require signed written answers:

#### 1. Offline License & Activation
- Q: Does Ditto issue **permanently-valid offline license tokens** (never expiring, not time-boxed) that can be embedded in an Android APK at build time?
- Q: If a token *does* expire, what is the behavior? Does the Small Peer (a) refuse all sync, (b) degrade functionality, (c) require network revalidation? All are fatal in a blackout.
- Q: Can a token be issued with **no identity/device binding** — i.e., valid on any phone running the APK? (Binding to a hardcoded app identity is acceptable; binding to a unique device ID is not.)
- Q: For a disaster-scenario non-profit with no budget, is there a **zero-cost offline license tier** or a donation-based exception process?

#### 2. Identity & Trust Pinning
- Q: Can the Ditto Small Peer identity be **derived from our own Ed25519 public key** rather than Ditto's cloud-issued credential, so trust routes through our signature model, not their servers?
- Q: If so, what is the minimum surface we must expose to Ditto cloud (if at all) for offline P2P to function? Must any phone ever contact Ditto's servers to perform mesh operations?
- Q: Does the offline-P2P code path (BLE/Wi-Fi Direct sync) require *any* Ditto service endpoint to be reachable, or is it fully decoupled?

#### 3. BLE Sync Realism
- Q: What is the **minimum-MTU one-way sync latency** for a 200-byte CBOR record on Android BLE GATT 4.2 at 1 Mbps, measured on commodity low-end hardware (Xiaomi Redmi Go equivalent, ~2 GB RAM, budget BLE chipset)? Account for: GATT discovery + connection + MTU negotiation + first-packet transmission.
- Q: What is the **maximum concurrent Ditto peer connection count** in the Small Peer SDK before resource exhaustion (memory, radio contention) on 2 GB RAM?
- Q: Does Ditto expose **per-document priority queuing** so P0 records are guaranteed to sync before P3? If not, how do we guarantee 200-byte P0 "fits the first sync round"?

#### 4. Contingency Fallback
- Q: If Ditto's offline capabilities are insufficient, may we **drop the proprietary Ditto sync layer and replace it with an open-source CRDT library** (e.g., Yjs, Automerge) while keeping your document store for local queries? What data-model porting effort would that entail?

### II. Contingency Architecture: SyncTransport & Store Interface

To decouple the signed-record model from Ditto, define an **abstraction boundary** with two core interfaces. This allows **runtime swapping** of sync backend if Ditto fails:

#### A. SyncTransport Interface
```kotlin
interface SyncTransport {
  /**
   * Start P2P discovery and peer bonding on available radios (BLE, Wi-Fi Direct, etc).
   * Runs inside a foreground service; must respect battery state.
   */
  fun start(config: TransportConfig)
  fun stop()
  
  /**
   * Subscribe to a scoped data set. DQL-style geo+priority+time filters.
   * Transport prioritizes P0/P1 subscriptions; lower-priority may defer.
   */
  fun subscribe(query: SyncQuery): Flow<SyncEvent>
  
  /** Publish a record to the mesh. Signed bytes only; transport is dumb. */
  fun publish(recordId: String, canonicalCbor: ByteArray, priority: Int)
  
  /** Peer count + connection health for UI. */
  fun peers(): Flow<PeerInfo>
  
  /** Confirm record reached cloud (for reach=bridged marker). */
  fun bridgeStatus(): Flow<BridgeReceipt>
  
  data class TransportConfig(
    val enableBLE: Boolean,
    val enableWiFiDirect: Boolean,
    val enableWiFiAware: Boolean,
    val dutyBucketMs: IntRange = 1000..60000
  )
}

data class SyncQuery(
  val collections: List<String>,  // ["reports", "attestations"]
  val plusCodes: List<String>,    // geo filter
  val minPriority: Int = 0,
  val maxAge: Duration = 14.days
)

data class BridgeReceipt(
  val recordId: String,
  val cloudHLC: String,           // server-side HLC for dedup
  val timestampMs: Long
)
```

#### B. Store Interface
```kotlin
interface SignedRecordStore {
  /**
   * Append a signed record (report, attestation, identity).
   * Idempotent; returns whether it was new or a duplicate.
   */
  suspend fun append(record: Record): Boolean
  
  /**
   * Query records by collection + filter.
   * Returns all replicas; app folds them into tier state.
   */
  suspend fun query(q: SyncQuery): Flow<Record>
  
  /**
   * Get all attestations for a report_id.
   * Sync transport calls this to drive the trust fold.
   */
  suspend fun attestationsFor(reportId: String): List<Attestation>
  
  /** Locally-derived state: never synced, never signed. */
  suspend fun getMeta(recordId: String): RecordMeta?
  suspend fun setMeta(recordId: String, reach: Reach, localFlags: Int)
  
  /** CRDT merge on inbound delta. */
  suspend fun merge(delta: SyncDelta)
  
  /** Storage pressure eviction (local cache only, network unaffected). */
  suspend fun evictByPriority(targetBytes: Long)
}
```

**Benefits:**
- Swap **DittoTransport** (wraps Ditto SDK) for **NearbyTransport** (Google Nearby Connections) or **YjsTransport** (local-first CRDT library) **without changing signed-record schema or trust fold logic**.
- DittoStore (wrapper over Ditto's document DB) can be replaced by **RoomStore** (local SQLite) + **Yjs** if needed.
- Trust computation (§3.4) and UI remain invariant across backends.

### III. Fallback Architectures (if property fails)

#### Fallback 1: License Token Expires

**Contingency: Bundled long-lived offline-renewable token**

- Pre-bake a token with a **6–12 month TTL** instead of assuming "permanent" (ask Ditto for max duration).
- 60 days before expiry, a gateway device **issues a renewal request** to Ditto's bridge (if reachable); renewed token syncs back into the mesh via a signed `token_refresh` record.
- If the bridge is never reached, the app **degrades at token expiry**: P0 SOS still works peer-to-peer via NearbyTransport fallback (below); P1/P2 deferred until renewal.
- **Build path:** immediately after Ditto setup in Phase 1, build **NearbyTransport** in parallel as a drop-in transport for BLE/WiFi-Direct sync, configured as an automatic fallback if Ditto's offline identity fails.

**Specification:** New `token_refresh` record type (§2.4 addition):
```json
{
  "kind": "token_refresh",
  "author_id": "gateway_device_id",
  "target": "ditto_small_peer",
  "new_token": "base64(ditto_renewed_token)",
  "expires_at": 1750000000000,
  "sig": "..."
}
```

#### Fallback 2: Identity Model Incompatible

**Contingency: Self-issued Ditto identity pinned to Ed25519**

- If Ditto requires cloud-issued credentials for the Small Peer, **mint a Ditto identity once at app install**, hash our Ed25519 pubkey with it, and **store the binding permanently**.
- All subsequent records carry `author_id = hash(our_ed25519_pk + ditto_issued_id)` so the identity is stable and routable through Ditto but cryptographically sourced from our key.
- For P2P fallback (NearbyTransport): **skip Ditto identity entirely**; peers verify records by Ed25519 signature alone.

#### Fallback 3: BLE Sync Throughput Unrealistic

**Contingency: Nearby Connections as primary bulk transport**

If BLE cannot reliably deliver 200 bytes in a brief contact due to GATT overhead (the critique's §4.4 challenge), **promote Nearby Connections to a higher priority tier**:

- **Use** `NearbyTransport` for **bulk record sync** (>1 KB) and **map-tile chunks**.
- **Keep BLE** as the **always-on discovery + presence beacon** (minimal energy, tiny payloads).
- **Rewrite §4.1 transport table** to rank by *latency + energy*, not cost:
  - BLE: control plane (peer presence, P0 records, keep-alive beacons).
  - Nearby Connections (Google-provided): bulk sync (P1/P2 backlog, map tiles) when both phones stable.
  - Wi-Fi Direct: fallback if Nearby unavailable.

**Implementation notes:**
- Nearby Connections has **no iOS path** — iOS remains BLE-only (acceptable per §7.11), narrowing the fallback to Android only.
- Wrap Nearby in `NearbyTransport` interface to keep it a pluggable choice, not a rewrite.
- Test this **before Ditto integration**: prototype a 3-second BLE contact + Nearby bulk catchup on Xiaomi Redmi Go / Transsion Tecno hardware.

### IV. Specification Changes Required

| Section | Change | Rationale |
|---|---|---|
| §1.1 | Revise "thin trust/UX layer over Ditto" to **"abstracted over a SyncTransport interface, defaulting to Ditto."** | Honest about contingency. |
| §2.4 | Add `token_refresh` record kind + `ditto_identity_binding` (optional) to identities §2.2. | Support token renewal and pinned identity. |
| §4.1 | Reorder transport table: BLE for control plane; Nearby Connections as primary bulk; Wi-Fi Direct fallback. Qualify all "guarantees" as "prioritized best-effort." | Reflects realistic BLE latency. |
| §4.9 | Add SyncTransport/Store interfaces and note that Ditto is *one implementation*. **Define two additional impls: NearbyTransport + YjsStore** as tier-1 fallback candidates. | Decouple arch from vendor. |
| §7.3 (new) | Add subsection "Ditto Licensing & Contingency": (a) list the written questions; (b) if answers are insufficient, build NearbyTransport + Yjs in Phase 1 pilot. | De-risk before full build. |
| §8.3 (risks) | Update "P0 build blocker" to mark "Ditto license token, identity model, BLE throughput **validated by Ditto in writing**" as gating Phase 1 completion; note NearbyTransport fallback is parallel-tracked. | Governance. |

### V. Honest Residual Limitations

1. **If Ditto offline license truly cannot be bundled**, any offline-first phone is bricked at token expiry until it touches the internet — **no mitigation exists**. This is a deployment-time (not runtime) risk: either Ditto provides a perpetual-offline token or the app cannot ship to field phones pre-disaster. **No code workaround.**
2. **Nearby Connections is Android-only** with no iOS equivalence. iOS will remain BLE-only and materially slower — acceptable for Phase 2, but it means **a unified mesh topology (iOS + Android) cannot rely on bulk Nearby sync**, only BLE. Map tiles and large backlogs must be pre-distributed to iPhones.
3. **BLE + Nearby Connections together are not a fully-formed CRDT**: they are **transports only**. You still need a **local CRDT library** (Ditto's strength) or **must hand-implement deterministic merge** (expensive, error-prone). Yjs or Automerge are candidates but add binary size and GC overhead. **Plan for a ~500 KB increase in APK size** if you drop Ditto's CRDT and adopt a WASM library.
4. **Sybil-flatness (trust tiers) remains valid** under Nearby/Yjs — it relies on Ed25519 signing, not the sync transport — but **message-ordering depends on HLC, which itself has unresolved issues** (critique item 2a: clock drift can poison the HLC). Fix the HLC bounded-drift rules (§2.1) independently of which transport is chosen.
5. **State censorship of the cloud bridge** (blocking Ditto Big Peer endpoint) **remains a vulnerability** — domain-fronting is dead (2018 onwards), and pluggable-transport URL rotation to offline devices is unsolved (critique §5.6). This is a 2026 problem, not solvable by de-risking Ditto alone. **Plan for an alternative bridge topology** (e.g., signed mesh-level bridge-endpoint lists, or a Tor-friendly bridge if feasible).

### VI. Phase 1 Gating Checklist

**Do not proceed past Phase 1 planning (§8.1) without:**

- [ ] **Written answers from Ditto** on all four questions (§I), signed by their product/licensing team.
- [ ] **Decision:** if answers are insufficient, **commit to parallel building NearbyTransport + a CRDT library choice** (Yjs or Automerge) in Phase 1, with SyncTransport interface tests passing before Phase 2 mesh integration.
- [ ] **BLE throughput prototype:** hand-test 200-byte-record first-round delivery on Xiaomi Redmi Go + Transsion handset pair, measuring GATT overhead end-to-end. If <3 s on average, proceed; if >10 s, escalate Nearby to primary immediately.
- [ ] **License token check:** confirm Ditto can issue a 12-month-valid offline token with no device binding, or commit fallback #1 (renewal + NearbyTransport escape hatch) to the build plan.

**Honest summary:** Ditto is the right choice *if and only if* their offline licensing, identity model, and BLE-throughput claims survive written validation. If any fails, NearbyTransport + an open-source CRDT library are viable (with cost in binary size and maintenance surface). The SyncTransport abstraction makes that swap feasible without re-architecting trust. **Do the Ditto validation now — before the first line of mesh code.**

---

## P0-2 — Redesign the forgeable Device-confirmed proof (SECURITY)

> **Status caveat:** The protocol below is the intended design. Adversarial verification (Appendix A.1) found that the as-written *data flow* re-instantiates the P0 because the subject's signature is validated locally and discarded rather than propagated. Apply the Appendix A.1 patch (carry `subject_sig` in the proof and re-verify it in the fold) before treating this tier as unforgeable.

### Challenge-Response Device-Confirmed Tier

**Security Issue**

The current `ble_encounter` proof is cryptographically broken. The spec requires the subject device to broadcast a rolling beacon = `HMAC(subject_key, coarse_time_slot)`, where `subject_key` is published. Any attacker can recompute valid beacons for any time slot from the public key and fabricate encounter attestations anywhere, claiming to have seen the subject device. This defeats the tier; a single attacker can forge Device-confirmed. The spec's claim that it "cannot be Sybil-forged: requires the subject key's keystream" is unfounded — if the keystream is derived from a public key, everyone has it. Exposure Notifications avoids this by publishing keys only *retrospectively*, after the time window closes, so real-time beacons cannot be precomputed. The current design inverts that principle and breaks real-time unforgeability.

**Design Decision**

Replace the published-key rolling-beacon model with a **real-time challenge-response protocol** where the subject device signs a fresh nonce with its **private Ed25519 key**. This restores cryptographic unforgeability: only the subject device, holding the private key, can produce a valid signature on a challenge presented by an attestor. Device-confirmed becomes a genuine intermediate tier between On-site and Self-confirmed, distinct from Self-confirmed because it requires no user interaction — the device responds automatically when awake and in BLE range.

**Trade-off:** This collapses one potential design where Device-confirmed and Self-confirmed were purely ordinal. The new model creates a clearer semantic boundary: **Self-confirmed** = user is consciously confirming (scanning QR, tapping "I'm safe") with full agency and liveness; **Device-confirmed** = device proves proximity via cryptographic signature but without user awareness. Both are unforgeable and both require the subject's private key, but they differ in *user agency*. This separation is acceptable because it preserves honesty in the UX (the user sees which tier was reached and *how*) and keeps Device-confirmed valuable in the disaster context (a person may be unable to interact but their device is nearby and powered).

### Exact Protocol

**Beacon / Discovery Phase**

Subject device advertises a BLE "Baran" service containing:
- `identity_id` (public, 16 bytes: short fingerprint of the device's Ed25519 pubkey)
- A 2-byte **protocol version** and **flags** (e.g., "challenge-response enabled")
- No credential or nonce — just identity advertisement

Any device in BLE range can see this and recognize the subject.

**Challenge-Response Phase (triggered by attestor)**

1. **Attestor initiates.** Upon seeing the subject device's BLE advertisement and deciding to attest proximity, the attestor sends a BLE **GATT write** containing:
   ```
   {
     message_type: "device_confirm_challenge" (1 byte),
     attestor_id: identity_id (16 bytes),
     challenge_nonce: random 32 bytes,
     timestamp_ms: wall_ms (8 bytes, for TTL binding),
     rssi: int8 (RSSI at the attestor's receiver)
   }
   ```
   - Challenge nonce is generated fresh by the attestor and used exactly once.
   - `timestamp_ms` is bound to the current time; the subject will refuse nonces older than ~30 seconds to prevent replay across time slots.
   - RSSI at attestor is measured; subject will measure its own receive RSSI and include both in the response.

2. **Subject device responds.** The subject device (running in the foreground, with the app awake and the Baran service active):
   - Verifies the challenge message structure and timestamp freshness.
   - Constructs a **response payload**:
     ```
     response_payload = {
       message_type: "device_confirm_response" (1 byte),
       subject_id: identity_id (16 bytes),
       attestor_id: (from the challenge, 16 bytes),
       challenge_nonce: (echoed from challenge, 32 bytes),
       subject_rssi: int8 (RSSI at subject's receiver),
       timestamp_response_ms: wall_ms (current time at subject, 8 bytes)
     }
     ```
   - Signs the **canonical CBOR bytes** of `response_payload` (excluding `sig` field) with the subject's Ed25519 private key.
   - Sends back via BLE GATT notification:
     ```
     {
       message_type: "device_confirm_response",
       payload: <response_payload>,
       sig: <Ed25519 signature over canonical(response_payload)> (64 bytes)
     }
     ```

3. **Attestor validates & creates attestation.** The attestor validates:
   - Signature over the response payload is valid (verifies using subject's *published* Ed25519 pubkey, which is known via `subject.subject_device_id`).
   - `challenge_nonce` echoed matches the challenge sent.
   - `attestor_id` in response matches the attestor's own identity.
   - Both timestamps are recent (within ~2 minutes of the attestor's current time; this bounds drift).
   - **Time difference** `|timestamp_response_ms - timestamp_ms| ≤ 1000 ms` — the response was signed within a short window of the challenge, preventing stale signature reuse.
   - Both RSSI values are ≥ floor (e.g., -85 dBm for ~10–15 m reliable BLE, device-dependent; can be configured per platform).

   If all checks pass, the attestor creates a signed `device_confirm` attestation:

   ```json
   {
     "_id": "k_ATTESTOR:a:42",
     "claimer_id": "k_ATTESTOR",
     "claimer_seq": 42,
     "target": {"report_id": "k_MISSING_PERSON:7", "content_hash": "u9Qe1...c4"},
     "att_type": "device_confirm",
     "hlc": "01919e9d3500.0001.ATTESTOR",
     "wall_ms": 1750776100000,
     "confidence": 90,
     "proof": {
       "type": "ble_encounter_challenge",
       "subject_device_id": "k_SUBJECT",
       "challenge_nonce": "uABC123...xyz",
       "attestor_rssi_dbm": -72,
       "subject_rssi_dbm": -68,
       "time_slot": "01919e9d3500",
       "seen_hlc": "01919e9d3500.0000.SUBJECT",
       "own_loc": {"lat": 10.601, "lng": -66.934, "plus_code": "77GR2J4C+9P"}
     },
     "sig": "uProof...sig"
   }
   ```

   (The challenge, response payload, and subject's response signature are *not* included in the attestation in the original draft — they are validated locally and discarded. **Per Appendix A.1, this is the bug: the signed `response_payload` and `subject_sig` MUST be embedded and re-verified by every device.**)

### Validation & Convergence

When this attestation replicates to other devices:

1. In the original draft, **other devices cannot re-validate the signature** (they don't have the subject device's private key) and instead **trust the attestor's signature** over the attestation itself. (Appendix A.1 replaces this with global re-verification of the carried `subject_sig` against the subject's *public* key.)

2. The trust fold (§3.4) checks:
   ```
   deviceOK = ∃ a in A: a.att_type=="device_confirm" 
                        and validProof(a.proof,R)==ble_encounter_challenge
   ```
   Where `validProof` checks:
   - The attestation is signed by a valid key (`claimer_id`).
   - The proof type is `ble_encounter_challenge`.
   - `time_slot` is within a **6-hour acceptance window** from the current HLC (prevents stale attestations from being re-endorsed long after the encounter).
   - `subject_device_id` matches the target report's subject.
   - *(Appendix A.1 adds: `Ed25519_verify(pubkey_of(subject_device_id), canonical(response_payload), subject_sig)` ✓, plus `attestor_id == claimer_id` and `challenge_nonce` binding/dedup.)*

3. **Convergence:** Because the attestation is signed and its proof digest is embedded, every device that receives it computes the identical tier from the same signatures — CRDT-convergent and offline-safe.

### Threat Resistance

| Threat | Mitigated? | How |
|---|---|---|
| **Real-time forgery by attacker without subject's private key** | ✓ YES | Ed25519 signature on the response nonce. Only the subject device (holding the private key) can produce a valid signature. |
| **Sybil inflation (1000 fake keys creating fake beacons)** | ✓ YES | Each attestation must be signed by the attesting device (Sybil witness) *and* validated against the subject's signature. Attestor count doesn't help; tier depends on proof type, not signer count. |
| **Replay of old challenge-response pairs** | ✓ Bounded | Nonce is fresh per challenge (one-time use); time binding (`timestamp_response_ms` within ~1 s of `timestamp_ms`) prevents reusing an old signed response for a new challenge. HLC time-slot bounding (6 h window) further limits stale attestations. A captured response can be replayed on the same peer for hours, but the attestation itself has HLC ordering, so a newer contradicting attestation (e.g., the subject being found safe elsewhere) will surface as Disputed. |
| **Relay attack (attacker near subject, victim far away)** | ✓ Partial | RSSI thresholds on both ends constrain range (~10–15 m nominal for -85 dBm floor), but an attacker with a relay radio can forward BLE frames between a distant subject and an attacker's phone, defeating the proximity bound. Known residual risk; mitigated by combining Device-confirmed with geographic proof. |
| **Wormhole attack (two RF relays tunnel BLE over internet)** | ✗ NOT mitigated | If an attacker has two radios and a network link, they can forward BLE traffic between a subject device and an attester at any distance, making the signature valid but the physical claim false. Residual risk, named in UI. |
| **Passive eavesdropping of the challenge/response** | ✗ Signal leaks | BLE is unencrypted on the ground (by design; encryption would prevent third-party validation). An observer can see that a challenge-response happened and extract timing/signal-strength metadata. Content is not sensitive, but presence metadata leaks. Mitigated by MAC randomization and duty-cycled scanning. |
| **Man-in-the-middle on the BLE link (jam, replay, forge frames)** | ✓ Signature prevents forgery; timing/RSSI constrain replay | An attacker on the same BLE frequency can jam (DoS) but not forge a signature. Replay of past responses fails (nonce is one-time). Implausible RSSI values are visible in provenance and can be flagged. |

### Differences from Self-confirmed

| Aspect | Device-confirmed | Self-confirmed |
|---|---|---|
| **Who signs?** | Subject device (automatic, no UI) | Subject device (user-initiated) |
| **Proof of user awareness?** | No — device acts autonomously | Yes — user explicitly confirmed |
| **User interaction** | None required | Scans QR or taps "Estoy a salvo" |
| **Liveness binding** | Challenge nonce + timestamp | Fresh timestamp + user action |
| **When to use** | Subject nearby but incapacitated, or unconscious but phone powered | Subject is conscious and able to confirm their status |
| **Tier strength** | 4 (Device-confirmed) | 5 (Self-confirmed, top) |
| **Residual risk** | Relay/wormhole attacks; requires device awake & in BLE range | None (besides key compromise) |

**Is this acceptable?** Yes. In a disaster, both scenarios occur: a rescuer finds a phone (Device-confirmed) before locating the person, and a survivor texts "I'm OK" (Self-confirmed). The tiers reflect degrees of evidence, not binary truth. The UI must clearly distinguish *how* each tier was reached ("confirmado por dispositivo = la persona puede estar dormida" vs "confirmado por la persona = está consciente").

### Field Changes & Record Schema

**1. Attestation proof object (§2.5), replace:**
```
ble_encounter | {subject_device_id, beacon, rssi, time_slot, seen_hlc, own_loc?}
```
**with:**
```
ble_encounter_challenge | {subject_device_id, challenge_nonce, attestor_rssi_dbm, subject_rssi_dbm, time_slot, seen_hlc, own_loc?}
```
- `challenge_nonce`: base64url nonce sent by attestor (for dedup and audit).
- `attestor_rssi_dbm`, `subject_rssi_dbm`: signed RSSI values from both ends of the link.
- `time_slot`: HLC slot for ordering; coarse-binned slot ID.
- Signature is now over the **attestation**, not a pre-computed beacon. *(Appendix A.1: also carry the subject's `response_payload` + `subject_sig`.)*

**2. Validation predicate (§2.5), update:**
```
ble_encounter_challenge | valid Ed25519 by subject_device_id over challenge response 
                        | attestor_sig validates the attestation 
                        | AND both RSSI >= floor 
                        | AND challenge_nonce is one-time (dedup) 
                        | AND time_slot HLC within 6 h of attestation HLC
```

**3. Trust fold (§3.4), no change:** already gates on `validProof(a.proof,R)==ble_encounter_challenge`; the predicate just updated.

**4. Optional: new BLE protocol spec (§4 or appendix):**
- Define message types, GATT UUIDs, marshaling, timeout/retry.
- Document RSSI floor calibration (platform-specific).
- Specify nonce freshness window (≤2 min for acceptance).

### Residual Limitations (Named Honestly)

1. **Relay & Wormhole Attacks.** An attacker with two radios can forward BLE traffic between a subject device and an attester arbitrarily far apart, creating a valid cryptographic proof of a false proximity. This is a known, unfixable property of wireless protocols. **Mitigation in UX:** combine Device-confirmed with the attestor's own GPS proof (two independent channels); if the attestor claims to be at Loc X but their GPS says Loc Y, raise a dispute flag.
2. **Subject Device Must Be Awake.** A phone in deep sleep, low-battery shutdown, or battery-saver mode will not respond. **Residual:** you cannot Device-confirm a dead/sleeping subject's phone. **Mitigation:** fallback to On-site (GPS/Plus-Code) or Self-confirmed. UI states "Confirmación por dispositivo no disponible: el teléfono puede estar apagado o sin batería."
3. **Requires Cooperation.** The subject device must not refuse the response (e.g., privacy setting, duress mode). **Acceptable** because users have agency.
4. **No Metadata Privacy on the Link.** BLE challenge-response is unencrypted and visible to any RF observer in range. Same leak as the original beacon design, so **not a regression**.
5. **Dead-Victim Case (Strongest Residual Risk).** If a subject is deceased or severely incapacitated (no device), you can only reach On-site or Self-confirmed. Device-confirmed is unavailable. **Trade-off accepted:** you cannot cryptographically prove the dead.

**Why Drop the Current Proof?** Do not keep both protocols. The published-key beacon design is cryptographically broken and should be removed entirely. Keeping it as a "weaker Device-confirmed variant" only invites confusion and false confidence.

**Scope Changes**
- §3.5: Replace entire `ble_encounter` row and description with `ble_encounter_challenge` protocol.
- §2.5: Update proof type and validation predicate.
- §3.4: No change to fold logic; predicate name changes from `ble_encounter` to `ble_encounter_challenge`.
- §4 (or new subsection): Add BLE challenge-response protocol specification.
- §6.7 (Provenance UI): Update inline warnings ("dispositivo respondió hace 6 h" + "⚠ Requiere el teléfono de la persona encendido y en rango Bluetooth"; explain wormhole risk).
- §5.9 (Threat model): Update threat #3 (Sybil) and add new row for relay/wormhole attack.

---

## P0-3 — Bound clock drift; make expiry clock-independent (SECURITY)

> **Status caveat:** Adversarial verification (Appendix A.2) found this resolution **BROKEN** as written: clamping mutates a signed field (breaking signatures / convergence) and the decisive wall-clock TTL gate survives at the §4.3 replication/subscription layer. The full design is reproduced for completeness; **do not ship without the Appendix A.2 patch** (no mutation of signed bytes; monotonic-clock TTL; clock-independent replication).

### HLC Drift Bounded & TTL Clock-Independent

**Design Decision**

Replace wall-ms-based TTL with **author-time-relative expiry** and introduce a **bounded-drift acceptance window** for incoming HLC events. This makes eviction immune to skewed receiver clocks while preserving causal ordering and protecting devices that have been genuinely offline for weeks.

**Core insight:** The problem has two orthogonal sources — (1) HLC max-merge allows one future-clock device to ratchet all peers' logical clocks forward irreversibly, poisoning global ordering, and (2) eviction checks `now() > expires_at`, so a receiver with a fast clock expires records it shouldn't, and a receiver in the past hoards forever. The fixes are independent: clamp incoming HLCs for global ordering safety; anchor expiry to author-time (not receiver-time) for local TTL immunity.

### Part (i): Bounded HLC Drift Acceptance & Clamping

**Acceptance Window:** `±30 minutes` (configurable per deployment).

```
function receiveAndStoreRecord(record, peer):
  incoming_wall_ms = parseHLC(record.hlc).wall_ms
  local_wall_ms = currentWallTimeMs()
  
  drift = incoming_wall_ms - local_wall_ms
  drift_limit = 30 * 60 * 1000  # ±30 minutes in milliseconds
  
  if abs(drift) > drift_limit:
    # Clamp the wall_ms component only; preserve counter + node for causal order
    wall_ms_clamped = local_wall_ms + clamp(drift, -drift_limit, drift_limit)
    record.hlc = formatHLC(wall_ms_clamped, parseHLC(record.hlc).counter, 
                           parseHLC(record.hlc).node)
    record._meta.hlc_clamped = true  # flag for UI/debugging
  
  store(record)
  return record
```

**Causality Preservation:**
- **Within a single device:** the 16-bit HLC counter is strictly monotonic per device and orders events regardless of wall-ms clamping.
- **Across devices via multi-hop:** Ditto's CRDT merge semantics guarantee convergence. A record from device A through B to C arrives with A's original counter; even if B clamped A's wall_ms, the counter+node still establishes A's causal precedence. The clamped wall_ms only affects *local* tie-breaks.
- **No permanent ratcheting:** because every device clamps incoming HLCs to within its own ±30 min window, the global mesh's maximum wall_ms component never drifts beyond any device's local time by more than the window.

**Weeks-Offline Device Protection:** A device offline for 3 weeks reconnects; incoming records with wall_ms ~21 days in the future are clamped, but their *counters* preserve causal order. The device's new records carry its actual (weeks-old) local wall_ms, which receiving peers clamp down — they still enter the mesh correctly and causally.

### Part (ii): Clock-Independent Expiry & TTL

**Mechanism:** Replace absolute wall_ms-based expiry with **author-time-relative expiry**. The record's `expires_at` becomes anchored to the *author's* wall-ms at creation, not the receiver's clock.

**Schema Changes (reports & attestations, §2.4/§2.5):**

| Field | Current | Updated |
|---|---|---|
| `wall_ms` | epoch ms (immutable) | epoch ms, **the author's local clock at creation** (immutable) |
| `expires_at` | `wall_ms + ttl_s*1000` (immutable) | same formula, but now anchored to author's wall_ms, not receiver's |
| `_meta.received_at_wall_ms` | *(not tracked)* | **NEW, local-only:** receiving device's wall_ms when first stored. Fallback for relative-age. Never synced, never signed. |
| `_meta.received_at_hlc` | *(not tracked)* | **NEW, local-only:** receiving device's HLC when first stored. Optional. |

**Eviction Rule (§4.4 replacement):**
```sql
EVICT FROM <collection> WHERE:
  (now_wall_ms - wall_ms) > ttl_s * 1000  
  AND not (referenced_by_live_attestation OR unresolved_higher_prio_record)
  AND receives_at_wall_ms is absent OR (now_wall_ms - received_at_wall_ms) > (ttl_s * 1000 * 1.5)
```

**Implementation logic:**
```python
def isExpired(record, now_wall_ms=None):
  if now_wall_ms is None:
    now_wall_ms = currentWallTimeMs()
  
  if not hasattr(isExpired, '_local_max_wall_ms'):
    isExpired._local_max_wall_ms = now_wall_ms
  else:
    drift_limit = 30 * 60 * 1000
    isExpired._local_max_wall_ms = max(isExpired._local_max_wall_ms, 
                                        now_wall_ms - drift_limit)
  
  author_age = isExpired._local_max_wall_ms - record.wall_ms
  if author_age > record.ttl_s * 1000:
    return True
  
  if hasattr(record, '_meta') and record._meta.received_at_wall_ms:
    receiver_age = isExpired._local_max_wall_ms - record._meta.received_at_wall_ms
    if receiver_age > record.ttl_s * 1000 * 1.5:
      return True
  
  return False
```

**Why this works (per the original draft):**
1. **Fast-clock immunity:** expiry is computed against the *record's* author wall_ms, not the receiver's.
2. **Fallback for hoarding prevention:** `_meta.received_at_wall_ms` lets a device stuck in the past evict after 1.5× TTL of local time.
3. **No cross-device propagation of clock weaponization:** eviction is *local and cache-only*; device Y computes expiry independently.
4. **Network integrity:** the signed record never changes; eviction is a *cache hint* only. *(See Appendix A.2: the static `_local_max_wall_ms` is re-seeded from the untrusted clock on every cold start, which OEM app-killers trigger constantly — so the fast-clock immunity evaporates on restart. Use a persisted monotonic baseline instead.)*

### Schema & Spec Section Updates

**§2.1 (Primitives) — Update time rules:**
> Every record carries an HLC `hlc` for deterministic ordering across offline peers. `wall_ms` captures the *author's* local wall-time at signing; it is **immutable and synced**. **All ordering and merge tie-breaks use `hlc`, never `wall_ms` directly.** When a device receives an HLC with a wall-ms component more than 30 minutes ahead or behind its local clock, it clamps the wall-ms component to its window, preserving counter and node ID. **Expiry and eviction are immune to receiver clock skew: they compute age relative to the record's immutable `wall_ms` and TTL, never the receiver's current wall_ms.** `wall_ms` may be quantized to a 15-minute bucket for sensitive records (§5).

**§2.4 — Update expires_at and _meta:** add `_meta.received_at_wall_ms`, `_meta.received_at_hlc`, `_meta.hlc_clamped` (all local-only, never synced/signed).

**§2.7 (TTL) — Replace eviction rule:**
> `ttl_s` is per-kind (author-proposed, clamped locally). A record is **GC-eligible if not referenced** and its age exceeds the TTL: `age = min(now_wall_ms, max_safe_wall_ms) - record.wall_ms; if age > record.ttl_s * 1000: eligible_for_gc` where `max_safe_wall_ms` is clamped to prevent jumping >30 min ahead of its first value. A `ttl_extend` attestation pushes expiry forward. **Eviction is cache-only and local.**

**§4.4 — Update TTL enforcement:**
```sql
EVICT FROM coverage WHERE 
  (min(now_wall_ms, clamped_wall_ms) - wall_ms) > ttl_s * 1000
  AND not (referenced_by_attestation OR unresolved_higher_prio)
EVICT FROM media WHERE
  (min(now_wall_ms, clamped_wall_ms) - wall_ms) > ttl_s * 1000
  OR (storage_pressure AND prio = 4)
```

**§4.7 — Clarify HLC handling:** acceptance-window bounding of the max-merge rule; preserves causal ordering via the HLC counter.

**§5.6 — Add clock-skew threat mitigation:** wall_ms components clamped within ±30 min; expiry relative to author wall_ms; a receiver's clock affects only its own local replica.

### Residual Limitations
1. **Within-window clock skew still possible** (±30 min). Tighter windows are fragile to GPS/NTP jitter; wider windows tolerate more damage. Monitor mesh clock health.
2. **Author clock poisoning within-device:** a device that sets its own clock far in the future creates records with that future `wall_ms`; the clamp does not affect records it *authors*. Accepted because the device is accountable for its own signed records and P0 carry-protection prevents critical-record auto-eviction.
3. **NTP/GPS cold-start not assumed:** the HLC counter enforces ordering; expiry uses the immutable record `wall_ms`.
4. **GenLayer anchoring unchanged:** anchors via `wall_ms`; coarse (per-day bucket) and audit-only.

### Algorithm Precision & Pseudocode

**HLC Acceptance (ingress):**
```
DRIFT_LIMIT_MS = 30 * 60 * 1000

function clampIncomingHLC(hlc_str, local_wall_ms):
  parts = hlc_str.split('.')
  wall_ms_incoming = parseHex48(parts[0]); counter = parts[1]; node = parts[2]
  drift = wall_ms_incoming - local_wall_ms
  if drift > DRIFT_LIMIT_MS:    wall_ms_clamped = local_wall_ms + DRIFT_LIMIT_MS
  elif drift < -DRIFT_LIMIT_MS: wall_ms_clamped = local_wall_ms - DRIFT_LIMIT_MS
  else:                         wall_ms_clamped = wall_ms_incoming
  hlc_clamped = formatHex48(wall_ms_clamped) + '.' + counter + '.' + node
  return { hlc: hlc_clamped,
           hlc_clamped_flag: (drift != 0 and abs(drift) > DRIFT_LIMIT_MS),
           original_hlc: hlc_str }
```

**TTL Eviction:**
```
function isRecordExpired(record, local_state):
  now = currentTimeMs()
  if not local_state.max_wall_ms_ever_seen:
    local_state.max_wall_ms_ever_seen = now
  clamped_now = min(now, local_state.max_wall_ms_ever_seen + DRIFT_LIMIT_MS)
  age_ms = clamped_now - record.wall_ms
  primary_expired = age_ms > record.ttl_s * 1000
  fallback_expired = false
  if record._meta.received_at_wall_ms:
    receiver_age_ms = clamped_now - record._meta.received_at_wall_ms
    fallback_expired = receiver_age_ms > record.ttl_s * 1000 * 1.5
  return primary_expired or fallback_expired
```

The 30-minute window is conservative; real deployments should validate it against observed Android clock stability on target chipsets (Transsion, Xiaomi, Samsung entry-level). **See Appendix A.2 for why the as-written design must be replaced by a non-mutating, monotonic-clock approach before deployment.**

---

## P0-4 — Make `bridged` reach a signed, synced receipt

### Design Decision

**Define a signed, synced `bridge` attestation type** issued by the Big Peer, propagating through the mesh like any other attestation. This replaces the undefined "write-receipt" promised in §1.6 and resolves the contradiction between "reach is local-only" and "non-gateway devices learn `bridged`."

The Big Peer (Ditto or custom HTTPS spine) becomes a low-trust but cryptographically-checkable witness: it signs a `bridge` attestation for each report it receives, and that signature proves the record reached the internet, without the Big Peer being able to forge records or alter existing ones. The original reporter's phone learns its record bridged not via a private receipt, but via the ordinary mesh sync of a public, signed, verifiable attestation.

### Record Schema — `bridge` Attestation Type

New attestation kind (added to §2.5):

| Field | Type | Notes |
|---|---|---|
| `_id` | string | `"bridge:" + report_id + ":" + server_ts + ":" + server_seq` |
| `claimer_id` | identity_id | **The Big Peer's Ed25519 public key** (fixed, baked into APK) |
| `claimer_seq` | int | Monotonic per-Big-Peer (prevents equivocation; resets if Big Peer key rotates) |
| `target` | object | `{report_id, content_hash}` (binds to the exact report version bridged) |
| `att_type` | enum | **`"bridge"`** |
| `assert` | object? | **`{fact: "bridged"}`** (optional semantic marker) |
| `hlc` / `wall_ms` | string / int | **Big Peer's causal time, not field time.** |
| `server_cursor` | int | **Monotonic sequence number on the Big Peer.** Used for dedup across syncs. |
| `payload` | object? | `{received_at, ingested_at, bytes, ttl_accepted}` — observability (optional). |
| `sig` | string | **Ed25519 over canonical bytes, signed by the Big Peer's private key.** |
| `schema_v` | int | |

**Note:** `bridge` attestations are **system-issued, not user-authored**. The Big Peer is a structured participant with a fixed, pre-known identity. The signature is **non-repudiable evidence that a report was seen by the spine**.

### Big Peer Identity & Key Distribution

1. **Big Peer key generation (once, at deployment):** the cloud spine generates a single long-lived Ed25519 key pair offline. The **public key is baked into the APK** as a hex constant. The private key is held securely (Secrets Manager / KMS / HSM).
2. **Key pinning in the app (§7.3 adds):**
   ```kotlin
   object TrustAnchors {
     val BIG_PEER_PUBKEY_ED25519 = "u3d7f9c2e... (64 hex chars)" // baked at build time
     val BIG_PEER_IDENTITY_ID = "k_" + base64url(blake3(BIG_PEER_PUBKEY_ED25519)[0:16])
   }
   ```
3. **Verification:** on every inbound `bridge` attestation, verify `Ed25519.verify(...)` succeeds and `claimer_id == BIG_PEER_IDENTITY_ID`. Forgeries dropped at ingest, before merge (§5.3).
4. **Key rotation (if spine compromised):** a new key ships in a binary update. Old bridge attestations remain valid (signatures don't break); the new key is trusted for future attestations.

### `reachOf()` Function (Canonical)

Replace the §3.4 reference `reach: reachOf(R)` with:
```text
function reachOf(R):
  bridgeAtts = [ a in A
                 if sigValid(a)                                  # Ed25519 by BIG_PEER_PUBKEY
                 and a.att_type == "bridge"
                 and a.target.report_id == R._id
                 and a.target.content_hash == R.content_hash ]
  anchorAtts = [ a in A
                 if sigValid(a)
                 and a.att_type == "anchor"
                 and a.target.report_id == R._id ]
  if |anchorAtts| > 0: return "anchored"
  if |bridgeAtts| > 0: return "bridged"
  return "in_mesh"
```
Multiple `bridge` attestations for the same report are idempotent; reach is "bridged" if at least one valid signature exists.

### How Non-Gateway Devices Learn `bridged` — The Flow

1. **Reporter creates a report offline** (Device A, no signal): signs/stores report `{_id: "k_MARIA:7", ...}`; mesh gossips to B, C, D; reach computed as `in_mesh`.
2. **A gateway device gets signal** (Device E enters 4G at 14:23): Bridge Manager batches outbox incl. Maria's SOS, opens a WebSocket to the Big Peer, pushes `[report "k_MARIA:7", ...]`.
3. **Big Peer receives and processes:** validates Maria's Ed25519 sig, stores in spine replica, **immediately generates a `bridge` attestation:**
   ```json
   {
     "_id": "bridge:k_MARIA:7:1750774800000:42",
     "claimer_id": "k_BIGPEER9e2a",
     "claimer_seq": 42,
     "target": {"report_id": "k_MARIA:7", "content_hash": "u9Qe1...c4"},
     "att_type": "bridge",
     "assert": {"fact": "bridged"},
     "hlc": "01919e8a1400.0000.BIGPEER",
     "wall_ms": 1750774800000,
     "server_cursor": 12847,
     "payload": {"received_at": 1750774799500, "ingested_at": 1750774800000, "bytes": 156},
     "sig": "uK2m9X...",
     "schema_v": 1
   }
   ```
   The signature proves: **the Big Peer saw this report at this wall-clock time, with this hash, and accepted it.**
4. **Gateway pulls the receipt back down:** Device E bi-directional sync; spine pushes the new `bridge` attestation back.
5. **Gateway re-injects into the mesh:** Device E writes the `bridge` attestation to its local store; signature is already valid (no re-signing); CRDT sync gossips it E → B, C, D.
6. **Reporter learns the receipt:** Device A meets Device B later, syncs, merges, verifies the `bridge` signature, keeps it.
7. **UI updates automatically:** Device A recomputes `reachOf("k_MARIA:7")` → `"bridged"`. Pin flips from "Solo en malla" to "Subido a internet · hace 18 min." **Maria knows her SOS reached the internet,** without ever having had signal herself.

### Dedup & Idempotence

- **Two gateways** push the same report: Big Peer issues **one** `bridge` attestation (first-write-wins by identical `content_hash`); both gateways receive the same record; mesh gossips one unified attestation; `reachOf()` deterministic across devices.
- **Same gateway retries:** `server_cursor` identifies the duplicate; same `(report_id, content_hash, server_ts)` tuple collapses; no divergence.

### Reconciliation with "`_meta` is Local-Only"

- **`_meta.reach` remains a local projection / cache** for fast UI rendering.
- **The canonical reach value is `reachOf(R)`, computed from synced, signed attestations.**
- When a phone syncs a new `bridge` attestation, it recomputes `reachOf()`, updating `_meta.reach` as a side effect.
- **`_meta` is never the source of truth; it is a derived, optimized view.** No contradiction: `_meta` is local-only, but the *data it derives from* is fully synced and convergent.

### What Is Knowable When the Cloud Is Unreachable

1. **Records authored offline are never bridged:** they remain `in_mesh`; `reachOf()` always returns `in_mesh`.
2. **No false positive "bridged":** only the Big Peer can issue `bridge` attestations; if unreachable, none exist.
3. **Original report remains verifiable:** tier is independent of reach. A report can be On-site but still `in_mesh`. UI: "En sitio · Solo en malla."
4. **Replies from the spine never arrive:** tasking requires a bridge attestation; if the spine is down, tasking does not propagate inward. UI: "Último internet: hace 6 h" or "Sin conexión."
5. **GenLayer anchoring is skipped.**

**Residual limitation (honest):** a device never part of any gateway sync — isolated for weeks with no peers who touched the internet — will never see `bridge` attestations and will never know if its own records reached the cloud. Unavoidable. UI exposes it honestly: "No hemos confirmado que internet vio esto" vs. "Internet confirmó este mensaje."

### Changes to the Spec

- **§2.5** — add `bridge` row (Role: Cloud receipt; Signed by: Big Peer Ed25519 key; system-issued, one per report per bridge event; rolled up into reach ladder).
- **§3.4** — replace `reach: reachOf(R)` reference with the `reachOf()` pseudocode; note local `_meta.reach` is a cached projection recomputed whenever attestations change.
- **§2.4** — refine `_meta` note to "**local-only projection** — never synced, never signed; derived from synced attestations via `reachOf()`."
- **§4.6** — revise the bridge description: Big Peer generates a signed `bridge` attestation on receipt; gateways re-inject it; it converges on every device; **reach is independent of whether the device ever accessed the internet itself.**
- **§7.3** — add Big Peer key anchoring (pin `BIG_PEER_PUBKEY_ED25519` at build time; forged bridging is cryptographically impossible; key rotation requires a binary update).
- **§5.9** — add two threat rows: (1) forge a `bridge` attestation → mitigated by pinned-key signature verification; residual if Big Peer compromised (offline audit + key rotation). (2) device never learns `bridged` if cloud unreachable + peer path blocked → unavoidable; honest UI.

**Summary:** `_meta.reach` remains local-only but derived; the source of truth is `reachOf(R)` over signed, synced `bridge` attestations; non-gateway devices learn `bridged` via ordinary gossip; the Big Peer is a low-trust, non-repudiable witness; the key is pre-distributed; when the cloud is unreachable, no `bridge` attestations exist (no false positives); tier and reach remain orthogonal. **Honest residual:** a device never on a gateway path can never confirm bridging.

---

## P0-5 — Replace integrity-breaking compaction with a real store-bound

### Store-Bounding Strategy: Append-Only-Safe Multi-Tier Eviction with Signed Tombstones

**The Problem:** §8.1/§8.3 propose "record compaction (drop superseded note bodies, keep hashes)" to bound store growth on 2 GB devices, but §2.4 and §5.3 mandate body-signing and re-verification on every receive. Dropping bodies breaks signature validation, relay integrity, and CRDT merge idempotency. The system OOMs on weeks of a city's records unless store-bounding is real.

**Resolution:** Never drop bodies from the append-only network. Instead, implement a **three-tier storage model** on each device with signed tombstones hiding local evictions while preserving verifiable relay.

### 1. Storage Architecture: Hot / Warm / Cold

- **Hot store (Ditto DB, always full records):** current-day + last 48 h of all synced records (~100–200 MB on a 2 GB device); no eviction; always memory-mapped.
- **Warm cache (local Room DB, evictable, recoverable):** records 2–30 days old; indexed by `{kind, plus_code_cell, age_bucket, prio}` (~500 MB–1 GB); evicted records removed from local storage only, not the network; re-fetched from a peer or the cloud on demand.
- **Cold store (optional, manual export to SD/external):** archive tier for liability/post-disaster audit; not synced; explicit user-initiated restore.
- **In-memory projection (UI cache):** local-only view state (read flags, reach, computed tiers); never synced; recomputed from the trust fold.

### 2. Eviction Policy & Thresholds

**Records NOT evicted (carry protection):**
- **P0 reports** (SOS `trapped=true`, `victim_found.condition=trapped`) until `resolve` + bridged confirmation
- **Unresolved P1** (missing-person, med-need) — held ≥14 days or until `resolve`
- **Referenced by unresolved records**
- **Author's own records** — not evicted until ≥48 h after authorship + at least one bridge confirmation
- **Recent (<48 h)** — always hot
- **Identity chain** (`identities`, `prev_key`, `revoke`) — never evicted
- **Attestations** — core attestations kept for tier recomputation

**Records eligible for eviction (Warm cache only):**
```
For each record R in Warm cache:
  if isPrimary(R) ∧ ¬isResolved(R):
    if prio(R) ≤ P1: continue  # P0/P1 protected
  if isReferencedByActive(R): continue
  if age(R) < ttl(kind(R)): continue
  geo_distance = haversine(R.geo, device.travelCorridor)
  if geo_distance < 5000 m: continue  # within 5 km corridor
  if prio(R) ∈ {P2,P3,P4} ∧ age(R) > ttl(R.kind):
    priority = MAX(age(R) - ttl(R.kind), geo_distance - corridor_radius, 1 / prio(R))
    evictionQueue.push({R, priority})
```

**Threshold algorithm (storage-pressure-driven):**
```
While storeUsage > SOFT_LIMIT (1.2 GB):
  R = evictionQueue.pop()
  evict(R)
  createHideAttestation(R, reason="cache_eviction", expires_at=null)
```

**Parameters:** `SOFT_LIMIT` = 1.2 GB (warn at 1 GB); `HARD_LIMIT` = 1.5 GB (force GC + pause ingest); `CARRY_RADIUS` = 5 km (learned from GPS trail); `HOT_SIZE` = 100–200 MB (last 48 h).

### 3. Signed Hide Attestations (not deletes)

New `att_type` in the attestation schema (§2.5):
```json
{
  "_id": "k_device:a:seq",
  "claimer_id": "k_device",
  "claimer_seq": <monotonic>,
  "target": {"report_id": "...", "content_hash": "..."},
  "att_type": "hide",
  "reason": "cache_eviction" | "resolved_archived" | "retracted_by_author",
  "expires_at": <optional; null = permanent>,
  "payload": { "freed_bytes": <size>, "device_storage_mb": <usage> },
  "hlc": "...", "wall_ms": ..., "sig": "Ed25519 over preceding fields"
}
```
**Semantics:** `hide` syncs like any other attestation; peers understand "the issuing device evicted this record from its local cache; the record still exists on the network." `cache_eviction` = temporary/recoverable; `resolved_archived` = permanent UI hiding; `retracted_by_author` = author retract. **No body is dropped.**

### 4. Relay & Re-Sync Integrity

**When a peer asks to sync a record you evicted:**
```
if localHas(R) in Hot: send(R)
elif localHas(hide(R)):
    if reason == "cache_eviction":
        refetch(R) via broadcastSync()
        if success: addToWarm(R); send(R)
        else: send(hide(R))
    elif reason == "resolved_archived": send(hide(R)) + mark resolved in peer UI
else: send(nil)
```
**When relaying to the wider mesh:** never send a record without its original body; if you don't have the body, recover it first or skip relay; the original signature is never modified.

### 5. UI Hiding & User Visibility
- Default map/list excludes records with `hide` (reason ≠ `retracted_by_author`); exception: P0 unresolved always shown ("not in this phone's cache").
- "Histórico"/"Archivado" toggle shows hidden records grayed-out, read-only; reload re-syncs.
- Resolved records (`resolve` + `hide`) appear in the audit section indefinitely; original signed chain remains in Warm cache + network.

### 6. TTL, Carry-Protection & P0 Re-broadcast
- **P0 carry-protection (§2.7, unchanged):** SOS / victim_found.trapped → `ttl_s = 6 h`, NEVER auto-evict while unresolved, re-broadcast every sync cycle, evictable only after resolve + confirmed-bridged.
- **`ttl_extend` attestation** pushes expiry forward and resets the carry timer. As long as a P0 record is active, the mesh keeps it refreshed; eviction never happens.

### 7. Cold Storage (Optional Archive Tier)
On demand, export `{record, resolve, all attestations}` as CBOR for `prio ≤ P1 ∧ age > 7 days ∧ resolved`, sign with device key, write to `/sdcard/RescueRelay/archive/YYYY-MM-DD.cbor`. Recovery is manual ("Restore from archive"); hashes must match; no automatic sync. Not on the critical path.

### 8. Spec Changes & Affected Sections
- **§2.4** — add to `reports._meta`: `"evicted": false`, `"eviction_reason": null`.
- **§2.5** — add `att_type: "hide"` to the enum `{corroborate, on_site, device_confirm, self_confirm, affirm, dispute, resolve, reclassify, ttl_extend, retract, anchor, hide}`; fields `reason`, `expires_at`, `payload`.
- **§4.4** — replace single-line eviction with the full policy; add: "Eviction is **cache-only and local**… a signed `hide` attestation documents the eviction; the original record's signature and body are never altered."
- **§4.6** — add: relay must recover a record before relaying or skip; relay never sends partial/headerless records.
- **§8.1 Phase 3** — replace "record compaction (drop superseded note bodies, keep hashes)" with "local storage-scoped eviction of non-P0 records via signed `hide` attestations; Warm cache bounded by geo/age/priority; Hot store (last 48 h) always kept; full records always re-syncable."
- **§8.3 Test Plan** — add storage-eviction-under-pressure test (flood 1,000 records; confirm policy-correct eviction, `hide` propagation, recoverability, no OOM, no P0/unresolved loss).

### 9. Honest Statement of Residual Limitations
1. **Recovery latency:** in a partitioned network, recovery may fail; you cannot relay a record you don't have. Honest — the record exists on other replicas, not yours.
2. **Geo-scoped courier bias:** a long-distance traveler holds a larger cache; the eviction bound is device-specific, not global.
3. **Attestation bloom:** attestations are not evicted (needed for the trust fold). Mitigation: cap attestation storage per report (keep strongest N by confidence + recency); soft-hide surplus old disputes.
4. **Cold-store recovery is manual:** SD export is a one-time archive, not a live replica; acceptable (post-disaster audit, not real-time function).
5. **Privacy trade-off (minor):** `hide` reveals which device evicted which records; no new PII (same device authored/relayed the original).
6. **TTL clock-skew risk (pre-existing):** addressed by P0-3 (and its Appendix A.2 follow-up); the hide-tombstone approach introduces no new clock risk.

### 10. Reconciliation: Append-Only Integrity Preserved
The original signed record never leaves the network even when locally evicted; peers can always re-request/re-sync; relay integrity is preserved; CRDT merge remains convergent (the `hide` is a new attestation syncing like any other); the audit trail is complete; P0 carry-protection is explicit. **No data is secretly lost.** This separates the **durable network-wide append-only log** (unchanging, fully signed, relay-able) from the **local storage cache** (evictable, recoverable, invisible to the trust model). A 2 GB device can hold weeks of activity while guaranteeing P0 carry-protection and end-to-end cryptographic integrity.

---

## P0-6 — Reconcile coarse-geo privacy with proximity proof

### Prefix-Match Containment for Coarse-Geo On-Site Verification

**The Problem (Restated):** Sensitive reports are forced to 8-char Plus Codes (~110 m cell) for privacy (§2.1, §5.5), but `pluscode_match` validation requires a precise 10–11 char code that "equals" the stored code (§2.5). This collision silently caps at-risk reports below On-site verification — the privacy default defeats the safety feature for exactly the victims who need it most.

### Design Decision: Prefix-Match Containment Check

Allow `pluscode_match` attestations against 8-char (coarse) reports via a **containment/prefix-match rule**: an attester's 10–11 char Plus Code validates if its 8-char prefix matches the report's 8-char Plus Code. This proves the attester is *within the reported ~110 m cell* without leaking finer-grained subject location.

**Why this works:** attesters have precise GPS and compute their full 10–11 char Plus Code locally; the 8-char cell is already the stated privacy boundary; proving presence in cell X does not leak where in cell X the subject is; validation is purely local.

### Exact Mechanism: Validation Algorithm & Record Schema

```pseudocode
function validProof(proof: object, report: Report, subject: Subject | null): boolean
  if proof.type != "pluscode_match": return false
  target_code = report.geo.plus_code
  if not target_code and subject: target_code = subject.home_plus_code
  if not target_code: return false
  attester_code = proof.plus_code
  
  if len(target_code) == 8:                      # Coarse-geo report: prefix-match
    if len(attester_code) >= 8: return attester_code[0:8] == target_code[0:8]
    else: return false                           # attester code too coarse
  
  if len(target_code) >= 10:                     # Standard precision: exact match
    if len(attester_code) >= 10: return attester_code[0:len(target_code)] == target_code
    else: return false
  
  return false
```

**Precision needed vs. stored:**

| | Stored | Computed by attester | Shared in attestation |
|---|---|---|---|
| **Subject location** | 8-char Plus Code (~110 m cell) | — | No (public in report) |
| **Attester location** | N/A (stays on device) | 10–11 char from GPS | 10–11 char Plus Code in `proof.plus_code` |
| **Validation** | — | 8-char prefix extraction | Local check: `attester[0:8] == report[0:8]` |

**Updated `pluscode_match` proof schema (§2.5):**

| Field | Type | Validation |
|---|---|---|
| `type` | enum | `"pluscode_match"` |
| `plus_code` | string | Attester's 10–11 char Plus Code (from current GPS). For coarse (8-char) reports, validates by prefix-match (`attester[0:8] == report[0:8]`). For standard (10-char) reports, validates by exact match. |

### Spec Section Changes
- **§2.1 (Primitives — Geo):** add — "On-site verification via `pluscode_match` is supported for 8-char reports: an attester's precise 10–11 char code validates if its 8-char prefix matches the report's location, proving co-location within the same ~110 m cell."
- **§2.5 (attestations — `proof` types):** update — "Validates via prefix-match if report is coarse (8-char): attester's code shares the 8-char prefix. Validates via exact match if report is standard (10-char). Coarse-geo case proves co-location within the reported ~110 m cell."
- **§3.3:** no change — the On-site definition is still correct; the validation predicate changes.
- **§3.5 (Proximity Proofs — Strength table):** add a note row for coarse-geo `pluscode_match` (◆◆ Medium; prefix-match; attester's precise code and time revealed; residual: cell-level co-location observable, finer subject location not leaked).
- **§5.5 (PII Minimization):** add — "the attester's precise location (10–11 char) is published in the signed attestation, revealing their presence in the cell; the subject's location remains coarse. Intended privacy/functionality tradeoff."

### Privacy & Precision Tradeoff Analysis

**Privacy gain:** subject's location remains at 8-char granularity (~110 m cell); an observer cannot tell whether the subject is at the attester's precise location or elsewhere within the cell.

**Precision/usability gain:** sensitive reports (at-risk persons, surveilled family members) can now be promoted to On-site via Plus Code.

**Residual privacy exposure:**

| Exposure | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Attester co-location in cell X visible to mesh | Low | Attesters are rescuers; volunteering presence is not secret. | None — accepted by design. |
| Subject confirmed in cell X (8-char, ~110 m) | Minimal | Cell X already public from coarse-geo report; proof adds no new subject info. | Acceptable — cell is the privacy granule. |
| Attester's precise location visible in attestation | Moderate | Attester chose to be on-site and attest. Risk is to the *attester*, not the subject. | Acceptable — attesters are lower-risk population. |
| Temporal correlation (attester in cell X at time T) | Low | HLC + quantized `wall_ms` (§2.1, §5.6) reduce granularity. | Structural to proximity proofs. |
| Mesh observer infers social structure | Moderate | Pseudonymous attestations; per-signer local reputation only (§3.6). | Acceptable; already acknowledged (§5.9, threat #8). |

### Implementation Notes
1. **Validation is local** — no network trust needed.
2. **Backward compatible** — standard 10-char reports still validate by exact match.
3. **Proof ordering:** coarse-geo reports require a 10–11 char attester code; an attester with only an 8-char code (e.g., ultra-low-power) cannot validate. Acceptable: Lifeline mode is receive-only and does not attest (§4.8); rescuers are expected to have GPS in Normal/Conserve modes.
4. **No schema expansion** — the `proof` object remains `{type, plus_code}`; only validation logic changes.

### Residual Limitations
1. **Observability of cell-level co-location** — structural to any proximity proof; the tradeoff for enabling on-site verification of sensitive subjects.
2. **GPS availability** — in rubble/indoors, Plus Code matching may fail; QR/NFC alternatives available (pre-existing §3.7 limitation).
3. **Duress/coerced false attestation** — a hostile actor forcing proof at a falsified location endorses a false cell; mitigation: multiple independent attestations.
4. **Time-freshness** — temporal activity patterns inferable; mitigated by quantized `wall_ms` (§5.6, 15-min buckets).

### Summary Table: What Changes

| Section | Change | Rationale |
|---|---|---|
| §2.1 | Clarify 8-char coarse-geo is now compatible with Plus Code on-site. | Announce the resolution. |
| §2.5 | Update `pluscode_match` validation rule to support prefix-match for 8-char reports. | Define the exact predicate. |
| §3.5 | Add a note on coarse-geo `pluscode_match` proof strength and residual privacy. | Explain strength semantics and tradeoff. |
| §5.5 | Clarify privacy boundary: subject location remains coarse; attester's presence in the cell is revealed. | Honest privacy statement. |

No changes to §3.3, §3.4 (fold), or trust tier definitions. The fold remains unchanged; only the `validProof` predicate for `pluscode_match` evolves.

---

## P0-7 — Flood/abuse control for the shared picture (independent of tiers)

**Problem.** Sybil-flatness (§3.3) protects verification *tiers* from count-gaming: many fake keys can only reach Corroborated, never On-site. But the *map* — the app's core product — has no defenses: 1,000 free Ed25519 keys each posting fake SOS pins in a cell render the picture unusable before any reach verified status. The only mitigation named (§3.6, §5.9) is "local mute" — manual, reactive, per-device. For a state adversary with unlimited keys and possibly control of physical devices/RF, this is a **total denial of core function**.

This section specifies a four-layer, offline-compatible anti-abuse system that operates **independent of the tier model and entirely on-device**, with an honest accounting of its limitations.

### §3.6.1 Layer 1 — Per-Key Outbound Rate Limiting

Enforcement: on-device, local-only, applies to all records authored by this device.

| Priority class | Max records per rolling hour | Rationale |
|---|---|---|
| **P0** (SOS trapped, victim_found trapped) | **Unlimited** (life-safety carve-out) | Life-critical signals must never be rate-limited |
| **P1** (missing person, medical need) | 10 / hour | A volunteer can author at most ~10 searches/hour |
| **P2** (hazards, general needs, status) | 5 / hour | Prevents casual spam |
| **P3** (search coverage, informational) | 2 / hour | Informational only |

**Implementation:** a local ring-buffer of `(hlc, report_id, kind)` tuples for the last hour of outbound reports. On Capture, before signing, check `count(records this hour) < limit[kind]`. If violated, prompt *"Has creado N reportes en la última hora. Espera, o disminuye la urgencia."* The report is not blocked (user may lower prio), but discouraged.

**Trade-off:** negligible CPU; prevents *this* phone from being weaponized to flood, but does nothing against an attacker with many physical phones or a state with bot devices.

### §3.6.2 Layer 2 — Per-Cell Inbound Rate Limiting & Dedup Suppression

Enforcement: on-device, computed locally for inbound records. For each Plus Code 10-char cell, track incoming reports by `(kind, author_id)` over a rolling 15-minute window:

| Condition | Action |
|---|---|
| 1st–3rd unverified report of kind K in cell C | Render individually on map (full priority) |
| 4th–10th report, same K + C | **Cluster:** aggregate into a summary bubble; count visible; one tap expands |
| 10+ reports, same K + C within 15 min | **Suppress to cluster only** unless user filters "Show all"; toast "N reportes sin verificar aquí — probable ruido. Mostrando resumen." |

Suppressed records are **never deleted** (append-only is inviolable) — they remain in the local store, sync normally, and are visible in the **Señales** feed and expanded map views. Mapa simply **declutters by stacking** unverified low-trust duplicates.

**"Unknown key" heuristic:** a key with 0 valid proofs in the local store and no `contacto conocido` reputation. A key with even one verified report, or marked a known contact, is exempt from per-cell clustering.

**Trade-off:** legitimate reports in a flooded cell also get clustered (honest cost) but retain full Reported status and reach; clustering is **visual de-cluttering**, not a filter. **Residual:** a state with 1,000 phones can still store/replicate all records; only the *rendering* is grouped.

### §3.6.3 Layer 3 — Optional Adaptive Proof-of-Work on Record Creation

Enforcement: on-device at create time; adaptive to local flooding signal. When inbound rate per cell exceeds a threshold (e.g., >10 unverified reports/cell/15 min from distinct unknown keys), the cell enters **Flood Mode**, adding an optional PoW requirement:
```
blake3(canonical_cbor_bytes(record) || nonce) & 0xFFFF0000 == 0
```
(leading 16 bits zero — ~2^16 = 65k hash trials, ~100 ms on ARM Cortex-A53 @ 2 GHz).

**Engagement:** a one-line note *"Zona con muchos reportes. Este reporte incluirá una prueba de computación (tarda ~1 segundo)."* PoW runs **in the background during the confirm-and-send screen**, not a modal block.

**Adaptive raise:** if flooding persists (>100 reports/cell/15 min), raise to 20-bit PoW (~1.5 s), configurable per cell; **never exceeds 24-bit (~25 s)**.

**Trade-off:** legitimate reporters also incur the delay; **defaults off**, only enabled in active Flood Mode; user can disable via power-mode toggle. P0 reports skip PoW even in Flood Mode (life-safety carve-out). **Residual:** a state with unlimited phones can still overwhelm by sheer count; PoW raises cost, not eliminates it.

### §3.6.4 Layer 4 — Local Web-of-Trust Weighting & Triage Bias

Enforcement: on-device, purely local, never authoritative or global. The existing `contacto conocido` mark (§3.6, in-person QR fingerprint exchange) becomes a **triage signal**, not a trust gate:

1. **Reputation accrual:** marked key starts `reputation_score = 1.0`; +0.1 per report verified to On-site+ within 24 h (max 5.0); −0.2 per dispute; decays to 0 after 30 days of no contact.
2. **Sort & UI bias:** in Mapa clustering, pins from high-reputation keys (>2.0) are **excluded from suppression**, always rendered individually; in Señales, known-contact reports sort above unknown-key reports of the same urgency.
3. **Local-only, subjective, transparent:** UI shows a subtle "⭐ 3.2" badge with note *"Basado en verificaciones previas en este teléfono. Depende solo de tu experiencia."* Not in headline, not synced.
4. **No global consensus / no routing through reputation:** Phone A's local reputation has zero effect on Phone B. The trust fold (§3.4) is **never** indexed by reputation — Corroborated still requires 2+ distinct signers, On-site still requires a valid proximity proof, regardless of scores.

**Trade-off:** reputation amplifies legitimate teams but does **not** prevent flooding by unknown keys (a state simply uses unknown keys). **Honest use case:** after the first 24 h, a known team's reports rise in triage order and are protected from clustering — a real usability win with no cryptographic dependencies.

### §3.6.5 Manual Escalation & Dispute-Driven Mitigation
1. **Team consensus:** via QR-based channel keys (§5.4), a team establishes a private `consensus` feed — only channel members' reports/disputes visible. Filters all mesh noise at the cost of excluding other rescuers. Out-of-band, offline.
2. **Batch dispute:** sign a single high-confidence `dispute` against *all* of a malicious key's recent reports in a cell (`{target: {author_id: k_ATTACKER}, att_type: dispute, fact: false, proof: {type: multiple_false_in_cell}}`); UI renders them with a red "En disputa" overlay.
3. **Local block / mute:** long-press a key → "No confiar"; locally mutes (hidden in default views, visible in forensic mode). Never deletes; never propagates.

### §3.6.6 Residual Limitations: Honest Threat Model

| Threat vector | What CAN be limited | What CANNOT be stopped |
|---|---|---|
| **Many free keys posting SOS pins** | Rate per device (~5/hr); PoW adds ~100ms–1s/report | 1,000 phones can still inject 5,000 reports/hr; clustering hides visually but doesn't delete |
| **Misdirection (false "found safe")** | Requires valid resolve with proof; only original reporter unambiguously resolves (§3.2) | A state can post a false resolve; teams must dispute manually and judge |
| **Flooding a cell with identical false reports** | Clustering + PoW; reputation weighting of known teams | Identical reports from N keys still replicate; each device stores all; de-cluttering is local |
| **DoS via RF jamming / BLE saturation** | Not in software scope — documented residual (§5.6) | RF jamming is physical; software cannot defend |

**Critical residual risk:** **On-site / Device-confirmed tiers can still be forged by a single, motivated, physically-present attacker.** Sybil-flatness prevents *count*-gaming the tier but not *proof*-gaming. Mitigation: multiple independent corroborations and dispute surfacing. The provenance drawer shows "1 contradictory claim ↔ 3 independent confirmations." Honest UI (§6.7, §3.7) shows the conflict and leaves final judgment to the human.

### §3.6.7 Specification Changes
1. **§2.4:** add optional `proof_of_work` field to reports: `{nonce: string, bits: int}`. Immutable. Reports with `bits > 0` but invalid PoW are dropped at ingest. Verification (§3.4) ignores PoW — rate-limiting signal, not trust signal.
2. **§3.4:** unchanged. PoW does not factor into tier computation.
3. **§4.3:** add a subscription filter for Flood-Mode reports per cell to allow backfill when leaving Flood Mode.
4. **§6.4 (Mapa):** add the clustering rule (>10 unverified reports from unknown keys → summary bubbles; tap to expand; records not deleted).
5. **§6.10 (Yo):** add "Mis contactos confiables" list (reputation > 1.0) with "No confiar" option.
6. **§8.3 (Test plan):** add a flood-injection test (1,000 SOS pins from random keys; confirm clustering, PoW toggling, accurate Señales count, consensus-channel filtering).

### Architecture Notes
- **Flood Mode state machine:** the Duty-Cycle / Power Manager tracks per-cell inbound rate; if >10 unknown-key reports/cell/15 min, set `flood_mode[cell]=true` and enable PoW for new Captures; reset after 1 h of <3 reports/min.
- **PoW computation:** in a background coroutine during confirm-and-send; confirm disabled until the nonce is found; **skipped for P0** even in Flood Mode.
- **Storage cost:** per-cell clustering metadata (~100 bytes/cell) and reputation scores (~500 bytes/known key) stored in the local encrypted store, not synced.
- **Convergence:** each device independently applies clustering and reputation; a late-joining phone recomputes from its local store and arrives at identical tier and clustering decisions.

### Honest Assertion
**This design does NOT stop a determined state attacker.** It raises map-flooding cost from zero to marginal and makes legitimate reports' discovery faster. Against an adversary with 1,000 devices and RF control, the map will still degrade under sustained assault. **The real mitigation is human judgment:** rescue teams read provenance, corroborate on-site, dispute false claims, and rely on the append-only/signed audit trail to surface conflicts. The app's role is to **show the truth** (all claims, all proofs, all disputes, never hidden) and **make legitimate work faster** (clustering clutter, weighting trusted teams). Anything stronger — a global reputation system or on-chain gating — either requires connectivity (which doesn't exist) or breaks the Sybil-flat axiom. Human resilience, not technical cryptography, is the ultimate defense against sustained denial-of-service.

---

## Appendix A — Adversarial Verification Verdicts

Two of the resolutions above were submitted to independent adversarial verification against the spec at `/root/Hackathons/qvac/venezuela-build/App1-Baran-spec.md`. **Both returned BROKEN.** The verdicts and their required follow-up patches are recorded here. The corresponding P0 sections above carry status caveats pointing to this appendix; the patches in A.1 and A.2 are mandatory prerequisites before P0-2 and P0-3 may be considered resolved.

### A.1 — Device-confirmed (P0-2): VERDICT BROKEN

**The break — "discarded-evidence forgery" (the attestor is trusted on its word).** The whole security argument rests on the subject signing a fresh nonce with its private Ed25519 key. But the fix explicitly states the subject's response signature is *"validated locally and discarded. Only the digest/proof of successful validation is recorded,"* and under Convergence: *"Other devices cannot re-validate the signature… Instead, they trust the attestor's signature over the attestation itself."* That single sentence is the kill. The cryptographic evidence (the subject's signature) never leaves the attestor. What propagates is the `ble_encounter_challenge` proof object (`{subject_device_id, challenge_nonce, attestor_rssi_dbm, subject_rssi_dbm, time_slot, seen_hlc, own_loc?}`) — **not one of these requires the subject's private key.** The remote `validProof` only checks (1) the attestation is signed by `claimer_id`, (2) proof type is `ble_encounter_challenge`, (3) `time_slot` within 6 h, (4) `subject_device_id` matches the target — all four attacker-controllable.

`subject_device_id` is a public LWW field replicated to every peer, and identity creation is free and permissionless (§5.2). The attack:
1. Mint a throwaway key `k_EVIL` (free).
2. Read the victim's `subject_device_id` from the replicated `subjects` collection.
3. Fabricate the proof: any 32-byte `challenge_nonce`, plausible RSSI (`-72`/`-68`), `time_slot`/`seen_hlc` = now, `own_loc` = anywhere.
4. Sign the **attestation** with `k_EVIL` (legitimately held).

Every receiving device runs the fold → `sigValid` ✓, proof type ✓, 6 h window ✓, subject match ✓ → `deviceOK = true` → tier ≥ Device-confirmed (4). **No challenge was ever sent; no subject device was ever contacted.** The subject's phone can be off, dead, or the subject deceased — the forgery still lands at tier 4. This is strictly *worse* than "requires the subject phone awake." It violates Axiom 1 (§3.1, "trust is computed, never asserted") and Axiom 4 ("Sybil-flat by construction"). The CRDT-convergence requirement ("every device computes identical tier from identical records") fundamentally conflicts with "only the attestor can verify"; the fix resolves that conflict by dropping the crypto — which is the bug. This is the *strongest* attack precisely because it needs no relay/wormhole radio, no timing race, no key compromise, no Sybil swarm: one key + one public identifier.

**Required follow-up patch — propagate the subject's signature and re-verify it on every device:**
1. **Embed the signed material in the proof.** Add to `ble_encounter_challenge` the canonical `response_payload` fields (`subject_id, attestor_id, challenge_nonce, subject_rssi, timestamp_ms, timestamp_response_ms`) **and** `subject_sig` = the subject's Ed25519 signature over `canonical(response_payload)`. Do **not** discard it.
2. **Re-verify on every device** in `validProof(ble_encounter_challenge, R)`:
   - `Ed25519_verify(pubkey_of(subject.subject_device_id), canonical(response_payload), subject_sig)` ✓ — the line that makes forgery require the subject's private key, computed identically everywhere → CRDT-convergent.
   - `response_payload.subject_id == subject.subject_device_id`.
   - `response_payload.attestor_id == attestation.claimer_id` — binds the signed response to *this* attestor, so an eavesdropper (BLE is cleartext) who captured a real response signed for attestor A cannot replay it under their own `claimer_id`.
   - `response_payload.challenge_nonce == proof.challenge_nonce`, with nonce uniqueness enforced by CRDT set-union dedup per subject (first `claimer_seq` wins; reuse → equivocation/Disputed).
   - keep the in-payload `|timestamp_response_ms − timestamp_ms| ≤ 1000 ms` and the 6 h HLC window (now part of the *signed* payload, so they can't be retro-edited).
3. **Close the secondary location-rebinding gap.** The subject signs identity + time + attestor + nonce — *not* the report or location, so one genuine encounter can be stamped onto reports at arbitrary `own_loc` within 6 h. Bind it: include the attestor's coarse `plus_code` in the signed `response_payload` (subject co-signs the claimed cell), **or** have the fold cap a `device_confirm` at lower confidence unless the same `claimer_id` also presents an independent `on_site` GPS proof for the same cell. The pure relay/wormhole residual remains (correctly named in the fix), but forge-from-nothing and eavesdrop-replay are closed.

**In short:** the fix is sound in cryptographic intent and broken in data flow — it throws away the one artifact (the subject's signature) that carries the security. Carry that signature in the attestation and verify it in the fold, and the Device-confirmed tier becomes genuinely unforgeable by anyone lacking the subject's private key.

### A.2 — Clock-drift (P0-3): VERDICT BROKEN

The fix is internally inconsistent with the spec it edits and — even granting its own design — leaves the dominant wall-clock dependency in place at the layer that actually decides whether a record propagates. Five independent concrete breaks; two are decisive.

**Strongest attack — the fix patches eviction but not replication; the wall-clock TTL gate survives at the subscription layer (§4.3).** The fix rewrites the eviction query in §4.4 but leaves the DQL *subscription* filter in §4.3 untouched:
```sql
SELECT * FROM sos   WHERE plus_cell IN :nearCells AND expires_at > now()
SELECT * FROM needs WHERE plus_cell IN :nearCells AND expires_at > now()
```
These subscriptions gate which records Ditto replicates over the radio *at all* — not just local cache. `now()` is the receiver's wall clock and `expires_at = wall_ms + ttl_s*1000` is anchored to the author's wall_ms. A record that fails this filter is never pulled from a peer, never stored, and never reaches the hardened eviction code. Two weaponizations, neither requiring forgery:
1. **Fast-clock receiver goes blind and stops relaying** (the original P0-3 break, intact). A device with `now()` = 2035 has `expires_at > now()` false for every live record → subscriptions exclude all live SOS/needs → it stops syncing and relaying them.
2. **Author-side suppression of a real SOS — no malice or rooting needed.** SOS `ttl_s` is 6 h. Cheap phones routinely boot with wrong clocks ("often the epoch, e.g., Jan 1, 1970"). An honest reporter whose clock is ~7 h slow signs an SOS with `expires_at = (real_now − 7h) + 6h = real_now − 1h`. On every correctly-clocked rescuer's device, `expires_at > now()` is **false** → subscriptions silently refuse to replicate it. The trapped-person report is invisible mesh-wide, and carry-protection is moot because the record was never synced. The fix actually *worsens* this: it pins `expires_at` to the author's clock as the authoritative immutable value, so a skewed author now poisons replication for everyone.

**Second decisive break — clamping mutates a signed field.** Part (i) does `record.hlc = formatHLC(wall_ms_clamped, …)`. But `hlc` is immutable inside the signed envelope (§2.4) and `sig` is Ed25519 over the canonical record bytes. Rewriting `hlc` invalidates the signature. Consequences: (a) §5.3/§3.4 drop-on-invalid-sig means a device whose clock differs from an honest author by >30 min (the epoch-1970 cold-start case) clamps every incoming record → breaks the sig → drops life-critical SOS; (b) if instead the clamped copy is stored locally, the fold's `sigValid(a)` rejects every clamped attestation → a skewed device computes a *different, degraded tier* than honest peers, violating the "every device computes the identical result" invariant (§2.8, §3, §4.7); (c) on re-gossip, clamped bytes fail verification at the next hop → the clamp poisons epidemic spread; (d) cross-path nondeterminism: the same record arriving via two paths is clamped to two wall_ms values → divergent LWW tie-breaks. Note also: the §9.3 bug is Ditto's *internal* HLC max-merge, listed in §4.9 as Ditto-provided and not app-interceptable — the fix clamps the app's `hlc` *string field*, not Ditto's engine clock, so it doesn't even touch the ratchet it claims to fix.

**Three more, briefly:**
3. **Fast-clock immunity evaporates on restart.** `isExpired._local_max_wall_ms` / `max_wall_ms_ever_seen` is in-memory function-static state, re-seeded from the untrusted clock on first call and never persisted. OEM killers restart the app constantly (§7.11). On a cold start while the clock reads 2035, the baseline initializes to 2035, `clamped_now = 2035`, and **every non-P0 record's `author_age` exceeds TTL → instant mass eviction.** Persisting it doesn't help: monotonic-max means a single forward glitch becomes a permanent ratchet.
4. **Author `wall_ms` is never clamped and feeds expiry directly.** The Part (i) clamp touches only the `hlc` wall_ms component, not the separate signed `wall_ms` field Part (ii) uses. Future-dated `wall_ms` → negative `author_age` → primary rule never expires; on RTC-less phones, the fallback's `received_at`/`clamped_now` also never advance → immortal records → storage exhaustion on 2–4 GB Android Go.
5. **`ttl_extend` keep-alive defeats the privacy TTL collapse.** §2.7 sets effective expiry = max over valid `ttl_extend` payloads, and attestations bind by `report_id`+`content_hash` with no author restriction. Any Sybil key can `ttl_extend` an at-risk-person record to year 2100, keeping sensitive location alive forever and defeating the §5.5 protection.

**Required follow-up patch:**
1. **Never mutate signed bytes.** Delete the `record.hlc = …` clamp entirely. The signed `hlc`/`wall_ms` stay immutable; sig is verified over original bytes. If a sort value needs bounding, compute it into a *local-only, non-signed* `_meta.sort_key` derived **deterministically from immutable fields only** (e.g., `(author_seq, author_id)` per-author causal order + a wall-free cross-author tiebreak) — no receiver clock, no arrival time — so every device derives the identical value.
2. **Make replication clock-independent, not just eviction.** Remove `expires_at > now()` from the §4.3 subscriptions. For P0/P1, always replicate within `:nearCells` and rely solely on local eviction; for lower classes, filter on a relative-age cursor, never on author `wall_ms` vs receiver `now()`.
3. **Anchor TTL to a monotonic clock, not wall time.** Compute age from a persisted **monotonic** baseline (`SystemClock.elapsedRealtime()` deltas, journaled across reboots), set at first receipt: `expired ⇔ monotonic_elapsed_since_first_seen > ttl_s`. Immune to author backdating and receiver clock skew; not resettable by restart or clock glitch. Drop `wall_ms` to display-only, untrusted, and forbid it from any expiry/replication/ordering computation.
4. **Bound author drift at ingress by REJECT-or-flag, never silent clamp.** If `|wall_ms − local|` exceeds the window, store the record unmodified (sig intact), flag `_meta.clock_suspect`, exclude `wall_ms` from all security logic — but still replicate it.
5. **Lift P0 carry-protection to the subscription layer:** unresolved P0 records are always replicable and only ever soft-hidden locally until a signed `resolve` arrives.
6. **Restrict `ttl_extend`:** only `author_id` or a proximity-verified attester may extend, with a capped cumulative maximum, so Sybil keys can't immortalize sensitive records.

Until at minimum items 1, 2, and 3 are implemented, the fix does not hold: it leaves the wall-clock TTL gate on the replication path, and its clamp contradicts the signature/convergence guarantees the rest of the system depends on.

### A.3 — Follow-up Patch Tracker

| P0 | Verdict | Mandatory follow-up before "resolved" |
|---|---|---|
| **P0-2** Device-confirmed | BROKEN | Carry `response_payload` + `subject_sig` in the proof; re-verify `subject_sig` against the subject's public key in the fold on every device; bind `attestor_id == claimer_id` and dedup `challenge_nonce`; co-sign the attestor's coarse `plus_code` (or require an independent `on_site` GPS proof for the cell). (A.1 items 1–3) |
| **P0-3** Clock-drift | BROKEN | Stop mutating signed bytes (local-only `_meta.sort_key` from immutable fields); remove `expires_at > now()` from §4.3 subscriptions; anchor TTL to a persisted monotonic clock; reject-or-flag (never clamp) author drift at ingress; lift P0 carry-protection to the subscription layer; restrict `ttl_extend` to author/verified-attester with a capped max. (A.2 items 1–6; items 1–3 are the hard gate) |

Reference spec for both verdicts: `/root/Hackathons/qvac/venezuela-build/App1-Baran-spec.md`.

---

## Appendix B — Round-2 Re-Verification (diverse adversarial panel)

The A.1 / A.2 patches were re-verified by a 6-attacker panel (3 distinct lenses per fix) + a lead-reviewer judge per fix. **Both returned PARTIAL.** The primary life-safety direction **HOLDS for both** — forge-from-nothing is closed for P0-2, live-SOS-suppression is closed for P0-3 — but each retains one surviving *non-suppression* defect with a specified, minimal round-3 patch. Each round's surviving defect is narrower and less severe than the last; the fixes are converging.

### B.1 — Device-confirmed (P0-2): PARTIAL → one-field fix
- **Closed:** forge-from-nothing (all 3 lenses agree); CRDT convergence holds (no signed bytes mutated, deterministic nonce dedup); sign-as-self / cross-claimer replay closed by `attestor_id == claimer_id` binding.
- **Survives — location-rebinding.** A.1's Item 3 (co-sign the cell) was written as an uncommitted "OR" and the Item-1 field list omits any location field — so one genuine encounter's `subject_sig` can be re-attached to attestations at any `own_loc` within the 6 h window → Device-confirmed (tier 4) at locations never visited → **misdirects rescue.**
- **Round-3 patch (mandatory, ~1 field + 1 check):** make `attestor_plus_code` (8-char coarse cell) a **mandatory signed field** in `response_payload` (attestor sends it in the challenge; subject echoes + signs), and enforce `response_payload.attestor_plus_code == coarse8(proof.own_loc)` in `validProof` on every device. Drop the fragile fold-cap alternative.
- **Verdict: NO-SHIP as-written; ship after the one-field fix.**

### B.2 — Clock-drift (P0-3): PARTIAL → reboot-bridge fix
- **Closed:** clock-manipulation suppression of a live SOS (all 3 lenses); replication path is clock-independent for P0/P1; no signed bytes mutated.
- **Survives — reboot-induced TTL violation** (the seeded trap, confirmed). A.2 anchors expiry to `SystemClock.elapsedRealtime()` deltas "journaled across reboots" yet forbids `wall_ms` from any expiry math — but `elapsedRealtime()` **resets to 0 on reboot**, so it cannot bridge a reboot without an absolute anchor. Result: after the frequent reboots of cheap Android, records **never expire** → at-risk-person location data lives indefinitely (a privacy harm in the *opposite* direction) + storage exhaustion. **No attacker required.**
- **Round-3 patch (mandatory):** permit the **receiver's own local wall clock** for reboot bridging (forbid only the *author's* embedded `wall_ms`). Journal `received_at_{elapsed,wall}` per record + `last_app_start_{elapsed,wall}`; on reboot (detected via `elapsedRealtime() < last_app_start_elapsed`) advance each record's effective age by `max(0, now_wall − last_app_start_wall)`, then re-baseline. Cold-boot / epoch-1970 fallback is **class-dependent**: privacy/at-risk records **evict** (protect privacy), SOS records **retain** (never silence). Fast-follow: relative-age cursor compares **full HLC string order** (inbound-dedup only, ±30 min ingress bound); `ttl_extend` numeric cap `min(orig+CAP, max(valid extends))` with CAP ≈ +30 d, reject-at-ingress.
- **Verdict: NO-SHIP for the life-safety tier until the reboot-bridge patch lands.**

### Convergence note
Round 1 surviving breaks were **catastrophic** (forge tier-4 from nothing on a dead victim / suppress a live SOS mesh-wide). Round 2 surviving defects are **serious but narrower and opposite-direction** (re-stamp a real encounter to a wrong location / over-retain records after reboot). Critically, **neither round-2 survivor lets an attacker silence a real SOS.** Recommended path to HOLDS: implement the two round-3 patches (both small and concrete), then one final verification pass.

---

## Appendix C — Round-3 Final Verification (canonical designs) → BOTH BROKEN

The round-3 canonical designs (A.1+B.1 / A.2+B.2 fully applied) were authored and final-verified by a 3-lens panel + lead judge each. **Both returned BROKEN.** The surviving defects are narrower and now well-characterized — and one (P0-2) has surfaced a near-fundamental limit that requires a trust-model **decision**, not another patch.

### C.1 — Device-confirmed (P0-2): BROKEN — location forgeable on one attestor's word
**Root cause:** the B.1 location check `coarse8(own_loc) == response_payload.attestor_plus_code` is **tautological** — the attestor controls *both* operands (it puts `attestor_plus_code` in the challenge *and* `own_loc` in the proof; the subject merely echoes + signs the attestor-supplied cell). The subject usually has no GPS (the very reason it needs Device-confirm), so it cannot detect a cross-cell lie. → a malicious attestor (free key) + one real-or-relayed encounter mints valid tier-4 at **any cell on the planet, on its word alone**. The subject's signature proves an encounter happened; it proves nothing about *where*. The tier's entire deliverable (location) is forgeable.

**This is a near-fundamental limit:** you cannot cryptographically prove your *own* physical location to a third party, offline, without the subject independently confirming it or multiple independent witnesses. The resolution is a **trust-model decision**, not a patch:
- **C.1(a) Subject-anchored:** when the subject HAS a fix, the subject signs its *own* coarse cell (not an echo); validate against that — the attestor cannot move it.
- **C.1(b) No subject fix → no tier-4 on one word:** require **≥2 distinct, independent attestor keys** reporting the same coarse cell (corroborated-on-site), else cap at a lower tier ("presence/identity confirmed, location UNVERIFIED").
- **C.1(c)** move `attestor_rssi` into the subject-signed payload.

### C.2 — Clock-drift (P0-3): BROKEN — clamping still breaks convergence
**Root cause (no attacker needed):** the round-3 design *still* clamps incoming HLC `wall_ms` to a receiver-relative ±30 min window, so two honest devices with normal drift clamp the same record to **different HLC strings** → divergent sort + replication cursor → silent record loss, including dropping a P0 SOS. It ships the contradiction "HLC never mutated" + "clamp incoming HLC." Secondary: an uncapped reboot wall-delta lets a root+clock attacker defeat eviction (bounded by the 1.5× fallback to ~1.5× TTL, not "forever," but still real over-retention of at-risk records).

**Round-4 patch (clear + mechanical):**
1. **Never mutate the HLC.** Store/sort/replicate the author's immutable signed HLC, identical everywhere. Convert ±30 min into a pure ingress **accept/reject gate**, **class-gated** (P0/P1 always accepted; only P2/P3 quarantined when author_wall is >30 min from local). Advance the local ratchet on the causal/counter component only; bound `wall_ms` only when *issuing* a local HLC.
2. **Reboot bridge:** detect reboot via `BOOT_COUNT` (not wall-delta); hard-cap cumulative wall-bridge ≤12 h and reject any delta exceeding monotonic evidence; tighten the absolute fallback 1.5× → 1.2× TTL.
3. **`sort_key = (author_id, author_seq, hlc_counter)`** for same-author causal order; `wall_ms` only as cross-author tiebreak (kills multi-message SOS reordering).
4. **Privacy:** don't journal `received_at_wall` at ms precision — keep monotonic `received_at_elapsed` + boot-id, or coarse-bucket to 15 min.
Mandatory: a convergence regression test on **two skewed-clock honest devices**.

### Meta-assessment (after three verification rounds)
The adversarial loop has been highly productive — each round found genuine, increasingly subtle flaws, and the surviving defects have narrowed sharply (P0-2: forge-from-nothing → rebind-real-encounter → lying-attestor-location; P0-3: suppress-live-SOS → reboot-never-expire → clamp-breaks-convergence). We are now at diminishing returns for *automated* iteration:
- **P0-2** has reached a fundamental property (single-party location is not self-provable). The fix is a **product trust-model decision** (corroboration / subject-anchor) that modestly changes what "Device-confirmed" means — not another patch.
- **P0-3** has a clear, mechanical **round-4 fix**; the remaining proof is a **real-hardware convergence regression test**, not more agent rounds.

Recommended: make the P0-2 trust-model call, treat the round-4 patches as implementation guidance, and validate on devices in Phase 0 — rather than spin further verification rounds. Full round-3 canonical designs + attack transcripts: `raw-agent-outputs/07-p0-round3-final.json`.
