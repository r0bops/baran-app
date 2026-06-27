# Baran — Build Specification

**App 1 of the disaster-response suite · Offline-first, phone-only rescue coordination**
*Named for **Paul Baran**, who invented the distributed, infrastructure-free, self-rerouting packet-switched network — the architecture this app puts in every pocket. Companion to **Faraday**.*
*Scenario anchor: 2026-06-24 twin earthquakes (M7.2 / M7.5), Caracas / La Guaira, Venezuela — power and cell towers down, government internet blackout + censorship, Spanish-speaking population, cheap Android phones, no field infrastructure.*

---

## Executive Summary

Baran is an offline-first, phone-only coordination tool for the people *rescuing* others after a disaster — neighborhood volunteers, search-and-rescue helpers, and families helping families — built for an environment with no power, no cell service, a state internet blackout, and only cheap Android phones to work with. It is a **three-plane, eventually-consistent system** whose single source of truth is an append-only set of tiny, Ed25519-signed records (SOS, victim-found, need, status, hazard, missing-person, and verification attestations) replicated as conflict-free CRDT documents over Ditto's multi-transport mesh (BLE / Wi-Fi Aware / Wi-Fi Direct / LAN-hotspot), with QR/NFC as a manual sneakernet path. Every phone is a full peer that works with **zero connectivity**; whenever *any* phone momentarily catches a signal it elects itself a transient gateway and bridges the whole mesh up to an optional cloud spine and pulls replies/tasking back down — store-carry-forward plus CRDT merge, with humans physically ferrying data between isolated clusters. Trust is **computed, never asserted**: reports start Unverified and rise through graduated, append-only tiers (Reported → Corroborated → On-site → Device-confirmed → Self-confirmed, with a Disputed overlay) only via the original reporter or firsthand proximity proof, so a Sybil swarm can never manufacture verification. The system is hardened for coercion and surveillance (pseudonymous keys, minimized PII, optional E2E, duress controls) and is relentlessly honest in its UI — it shows **trust tier and internet-reach as two separate axes** and never fakes delivery or certainty. An optional GenLayer anchor at the internet edge commits hashes of verified records to an immutable, censorship-proof log; nothing in the field ever depends on it.

---

## Table of Contents

1. [System Architecture & Component Model](#1-system-architecture--component-model)
2. [Data Model & Record Schema](#2-data-model--record-schema)
3. [Verification & Trust Model](#3-verification--trust-model)
4. [Sync, Mesh & Gateway](#4-sync-mesh--gateway)
5. [Security, Privacy & Threat Model](#5-security-privacy--threat-model)
6. [Rescuer-Facing UX](#6-rescuer-facing-ux)
7. [Tech Stack & Decisions](#7-tech-stack--decisions)
8. [Build Plan, Demo Script, Test Plan & Risks](#8-build-plan-demo-script-test-plan--risks)
9. [Appendix A — Canonical Conventions (conflict resolutions)](#appendix-a--canonical-conventions)

---

## Glossary

| Term | Meaning |
|---|---|
| **Record** | Any tiny, Ed25519-signed, append-only document in the system. Umbrella term covering the four collections: `identities`, `subjects`, `reports`, `attestations`. |
| **Report** | A signal record about a situation: `sos`, `victim_found`, `need`, `status`, `hazard`, `missing_person`. (Earlier drafts called this a "claim" — *claim ≡ report*.) |
| **Attestation** | A signed record *about* a report — corroboration, proximity confirmation, dispute, resolution, lifecycle change. The **only** way a report's state evolves. |
| **Subject** | The person a report is about (e.g. a missing neighbor). May or may not run the app. |
| **Identity / DeviceID** | A device's self-generated Ed25519 public key (+ short fingerprint). Pseudonymous; not bound to a legal identity. Root of trust. `author_id` / `claimer_id` reference it. |
| **Tier** | The verification rung of a report — Reported → Corroborated → On-site → Device-confirmed → Self-confirmed, with **Disputed** as an orthogonal overlay. **Always derived, never stored.** |
| **Reach** | How far a record has *traveled*: `in_mesh` → `bridged` (cloud write-receipt) → `anchored` (GenLayer). Shown **separately from tier**; never conflated. |
| **Proximity proof** | Evidence of physical presence that unlocks the Verified band: `gps_match`, `pluscode_match`, `ble_encounter`, `subject_cosign`, `qr_nfc`. |
| **Gateway** | Any phone that momentarily has internet and elects itself to bridge the mesh ⇄ cloud. Transient, stateless, disposable, untrusted (cannot forge or read sealed payloads). |
| **CRDT** | Conflict-free Replicated Data Type. Merge is order-independent and convergent; provided by Ditto. |
| **HLC** | Hybrid Logical Clock. Sortable causal timestamp used for *all* ordering/tie-breaks (wall-clocks are untrusted in the field). |
| **Plus Code** | Open Location Code — a short, speakable, infrastructure-free geocode; canonical site identifier and a proximity-proof primitive. |
| **Small Peer / Big Peer** | Ditto terms: the on-device embedded peer (Small) vs. the optional managed cloud peer (Big) that the gateway syncs to. |
| **GenLayer anchor** | Optional, edge-only commitment of SHA-256 hashes of *verified* records (batched as a Merkle root) to GenLayer for tamper-evident, censorship-proof existence proof. Hashes only — never PII. |
| **P0–P4** | Priority *classes* (P0 = life-critical) that drive transport eligibility, TTL and retention. |
| **Disputed** | State surfaced when signed records contradict each other. Never auto-resolved; both sides shown. |

---

## 1. System Architecture & Component Model

### 1.1 Architectural Stance

Baran is a **three-plane, eventually-consistent system** built on a single source of truth: an append-only set of tiny **signed records** replicated as CRDT documents. Every device is a full peer holding the complete (filtered) dataset it has seen; there are no field servers, no fixed relays, and no privileged nodes in the field. "Connectivity" is treated as a rare, transient *event* any peer may experience, not a state the system depends on. The same record schema, the same signatures, and the same merge rules apply identically in a hand-to-hand BLE exchange and in a cloud sync — only the **confidence signal** (reach + tier) attached to a record differs. The prime directive is **honest provenance**: every record carries who-saw-what-where-when, and the UI renders confidence from that provenance rather than asserting delivery.

The mesh/replication substrate is **Ditto** (Small Peer SDK on every phone; optional Big Peer or thin HTTPS bridge as the cloud sync target). Ditto provides multi-transport P2P discovery, partition-tolerant CRDT documents, and *automatic* opportunistic cloud sync when a Small Peer sees internet — exactly the "human gateway" behavior, made native. We wrap Ditto with our own identity, trust, proximity, power, and bridge-policy layers.

### 1.2 Component Diagram

```
                          ╔════════════════════════════════════════════════╗
                          ║        PLANE C — CLOUD SPINE (optional)         ║
                          ║                                                 ║
   internet ───────────▶  ║  Sync Gateway (Ditto Big Peer / HTTPS bridge)   ║
   (whoever has signal)   ║      │                                          ║
                          ║      ├─ Record Validator (re-verify signatures) ║
                          ║      ├─ Global CRDT Store + Replica fan-out      ║
                          ║      ├─ Tasking / Reply Authoring (coordinators) ║
                          ║      └─ GenLayer Anchor Service ──▶ [GenLayer]   ║
                          ╚═══════════════════▲═════════════════════════════╝
                                              │  opportunistic, bidirectional
                                              │  store-carry-forward + CRDT merge
        ┌─────────────────────────────────────┼───────────────────────────────────┐
        │                       PLANE B — OPPORTUNISTIC HUMAN GATEWAY               │
        │   Any phone that *currently* has signal acts as gateway for its cluster.  │
        │   ┌────────────────────────────────────────────────────────────────────┐ │
        │   │  Bridge Manager: detect link ▸ batch outbox ▸ push up ▸ pull        │ │
        │   │  replies/tasking down ▸ re-inject into local mesh ▸ mark provenance │ │
        │   └────────────────────────────────────────────────────────────────────┘ │
        └───────────────────────────────────▲──────────────────────────────────────┘
                                             │  (gateway role is transient & elective)
   ╔═════════════════════════════════════════╪══════════════════════════════════════╗
   ║                     PLANE A — ON-DEVICE MESH (every phone)                       ║
   ║                                         │                                        ║
   ║   ┌───────────────┐   ┌────────────────┴──────────────┐   ┌──────────────────┐  ║
   ║   │  Capture &    │   │     Mesh Sync Engine (Ditto)   │   │  Shared Picture  │  ║
   ║   │  UI (es-VE)   │──▶│  BLE │ Wi-Fi Aware/Direct │ LAN │◀─▶│  MapLibre + OSM  │  ║
   ║   └──────┬────────┘   └───┬───────────┬───────────┬────┘   └────────▲─────────┘  ║
   ║          │                │           │           │                 │            ║
   ║   ┌──────▼────────┐  ┌─────▼─────┐ ┌───▼──────┐ ┌──▼─────────┐ ┌─────┴────────┐  ║
   ║   │ Record/Schema │  │  CRDT     │ │ Duty-    │ │ Proximity  │ │ Verification │  ║
   ║   │ + Outbox      │  │  Merge    │ │ Cycle /  │ │ Proof Svc  │ │ & Trust      │  ║
   ║   │ (signed)      │  │  Layer    │ │ Power Mgr│ │ (GPS/BLE/  │ │ Engine       │  ║
   ║   └──────┬────────┘  └───────────┘ └──────────┘ │ QR/NFC)    │ │ (tier fold)  │  ║
   ║          │                                      └────────────┘ └──────────────┘  ║
   ║   ┌──────▼────────────────────────────┐   ┌───────────────────────────────────┐  ║
   ║   │ Identity & Keystore               │   │ Local Encrypted Store (Ditto DB)  │  ║
   ║   │ Ed25519 sign · X25519 seal · HW   │   │ append-only signed records        │  ║
   ║   └───────────────────────────────────┘   └───────────────────────────────────┘  ║
   ╚═════════════════════════════════════════════════════════════════════════════════╝
```

### 1.3 Plane A — On-Device Mesh (the only network that always exists)

Every phone runs the full stack and is a complete, autonomous peer. With **zero** connectivity the app is fully functional: create SOS/victim-found/need/status/hazard/missing-person records, see and edit the shared rescue picture from everything the device has heard, raise verification tiers, and attach proximity proofs. Records are authored locally, **signed with the device's Ed25519 key**, written to the append-only local store, and handed to the **Mesh Sync Engine** (Ditto), which gossips them to any peer in radio range over whichever transport is cheapest and available.

Key properties:
- **Multi-transport, duty-cycled discovery.** BLE for ultra-low-power presence + small records; Wi-Fi Aware/Direct or a local hotspot for bulk catch-up (map tiles, photo thumbnails, large backlogs). The **Duty-Cycle / Power Manager** governs scan/advertise windows so radios sleep aggressively (no-recharging assumption).
- **CRDT, not RPC.** Peers exchange *document deltas*, not requests. Two devices that meet for three seconds in a stairwell exchange whatever each lacks and part — no handshake, session, or server. Merges are deterministic and order-independent.
- **Append-only + signed.** No record is ever silently deleted or overwritten. Updates are new signed records referencing the prior one; the **Verification & Trust Engine** folds them into a tier state. Conflicting claims don't clobber — they surface as **Disputed**.
- **Minimized PII at rest.** The **Local Encrypted Store** is the Ditto DB on hardware-backed encryption. Sensitive fields (names, exact addresses) can be X25519-sealed to intended recipients; the mesh still routes them blind.

### 1.4 Plane B — Opportunistic Human Gateway (connectivity as a moving event)

There is no dedicated gateway. **Any** phone that momentarily catches a signal — a hilltop LTE bar, a working Wi-Fi behind a shop, a satellite SMS window — *elects itself* gateway for as long as the link lasts. The **Bridge Manager** is the elective controller:

1. **Detect** a usable uplink and classify it (full IP, captive portal, SMS-only — capabilities differ).
2. **Batch** the local **Outbox**: everything the cloud hasn't acknowledged, oldest-and-highest-severity first, compressed and deduplicated.
3. **Push up** to the Cloud Spine (or let Ditto's Small-Peer→Big-Peer sync drain it automatically).
4. **Pull down** replies, tasking, corroborations, and cloud-confirmed reach addressed to *anyone* in the mesh — not just this phone.
5. **Re-inject** downstream records into the local mesh as ordinary signed CRDT documents, which propagate onward.
6. **Stamp provenance**: records that touched the internet get a `bridged` reach marker (and `anchored` if GenLayer-committed); everything else stays `in_mesh`. This is the raw material for honest confidence UI.

The gateway is **stateless and disposable**: it carries data for others without being trusted, because it can neither forge signatures nor read sealed payloads it isn't a recipient of. If it loses signal mid-sync, CRDT sync resumes from where it left off on the next opportunity, on this phone or any other.

### 1.5 Plane C — Cloud Spine (optional amplifier, never a dependency)

When records reach the internet they converge on the **Sync Gateway** — either Ditto's managed **Big Peer** or a thin custom HTTPS bridge speaking the same record schema. The spine does four things and nothing the field depends on:

- **Re-validates** every inbound record's signature and rejects forgeries (defense against a malicious gateway).
- **Global fan-out**: holds the union of all records and replicates relevant subsets back down, so a phone in Petare can learn of a rescue in La Guaira once both have touched the net.
- **Tasking & reply authoring**: vetted coordinators (NGOs, family abroad, SAR command) inject tasking/replies *as signed records* with their own keys — they get tiers and reach exactly like field records; no command channel is privileged in the data model.
- **GenLayer anchoring** (optional trust spine): periodically writes hashes of verified records to GenLayer for an immutable, censorship-proof, tamper-evident log. The field never waits on this.

The spine is explicitly **best-effort and replaceable**. Under blackout/censorship it may be unreachable for hours; the field keeps working, and the spine catches up when a gateway breaks through.

### 1.6 Data-Flow Narratives

**Narrative 1 — A signal created offline reaches the cloud.**
1. A volunteer with no signal taps **"Victim found — trapped, conscious."** Capture builds `{kind: victim_found, geo(plus_code), body, hlc, prio}`.
2. **Identity & Keystore** signs it Ed25519; sensitive fields are X25519-sealed if a recipient is set. Written append-only to the **Local Store** and queued in the **Outbox**; derived tier = **Reported**.
3. **Mesh Sync Engine** gossips over BLE to three nearby phones; each merges via the **CRDT Layer** and re-gossips. The record now lives on a dozen still-offline devices. On the **Shared Picture** it appears as an amber "Reportado · Solo en malla" pin across the cluster.
4. Two hours later a carrier walks uphill into a 30-second LTE sliver. The **Bridge Manager** detects the link, elects gateway, batches the Outbox (this record + everything held for others), and pushes.
5. The **Cloud Spine** re-validates the signature, stores it, and stamps reach `bridged`. That reach flows back down on the next pull; the pin's reach chip flips from "Solo en malla" to "Subido a internet" — without claiming the victim was *rescued*, only that the *report got out*.

**Narrative 2 — A reply / tasking comes back into the mesh.**
1. An NGO coordinator authors a `status`/tasking record: `{kind: status, refs:[victim_report_id], body:"Team Bravo en route, ETA 40m", prio}`, signed with the coordinator's key.
2. It lands in the spine. The next time *any* gateway phone (not necessarily the reporter's) touches the internet, the **Bridge Manager** pulls it down.
3. That gateway re-injects it as an ordinary signed CRDT record; the mesh propagates it peer-to-peer.
4. The **Trust Engine** links it to the target report via `refs`. The victim pin shows "Tasked: Team Bravo, ETA 40m" with `bridged` reach and the coordinator's verified identity.
5. The reply may reach the original reporter through an entirely different human chain than the one that carried the SOS out — the mesh is undirected; records find recipients by replication, not routing.

**Narrative 3 — An isolated cluster bridged by a moving person.**
1. **Cluster X** (collapsed block, 8 phones) and **Cluster Y** (triage point 600 m away, 15 phones) are each internally synced but radio-isolated.
2. A runner from Y walks to X to deliver water. Entering BLE range, both meshes treat her phone as a peer; the **CRDT Layer** exchanges the symmetric difference in the background — she carries Y's records into X and X's out, with no UI interaction.
3. She has **physically transported the data** between two partitions at walking speed. X learns the triage point exists and what it searched; Y learns of the trapped victims. The **Verification Engine** merges overlapping reports: matching claims raise tiers to **Corroborated**, contradictory ones surface as **Disputed**.
4. When she later climbs to a ridge with signal, her one phone becomes the **gateway for both clusters at once**, draining the merged backlog to the spine and pulling replies for either cluster down — carried back on her return trip.

### 1.7 In-App Modules / Services

| Module / Service | Responsibility |
|---|---|
| **Capture & UI (es-VE)** | Spanish-first, low-literacy-tolerant capture; one-tap severity; renders confidence chips (reach) and trust tiers honestly; camera + GPS capture for proofs. |
| **Record / Schema & Outbox** | Canonical record schema, deterministic CBOR serialization, severity/TTL fields, durable send queue; enforces "small + signed + append-only"; assigns IDs. |
| **Identity & Keystore** | Per-device Ed25519 signing key + X25519 sealing key in hardware-backed Keystore; signs every outbound record; manages contact public keys; supports subject self-cosign. |
| **Crypto Sign/Verify Pipeline** | Signs on write, verifies on every receive (drops forgeries before merge), seals/unseals sensitive fields, minimizes PII to relays. |
| **Mesh Sync Engine (Ditto wrapper)** | P2P discovery + replication over BLE / Wi-Fi Aware/Direct / LAN / hotspot; transport selection, peer lifecycle, backlog catch-up. |
| **CRDT Merge / Conflict Layer** | Deterministic, order-independent merge; never overwrites; produces Disputed states for genuine conflicts. |
| **Verification & Trust Engine** | Deterministic fold over tiers (Reported → Self-confirmed + Disputed); enforces who-may-verify rules (original reporter or firsthand proximity). |
| **Proximity Proof Service** | Generates/validates proofs: GPS / Plus-Code, BLE subject-device encounter, subject self-cosign, QR/NFC at a known location; feeds the Trust Engine. |
| **Bridge Manager (Gateway)** | Detects/classifies uplinks, elects transient gateway, batches Outbox up, pulls replies/tasking down, re-injects, stamps reach. |
| **Cloud Spine Client** | Speaks to Big Peer / HTTPS bridge: auth, push/pull, dedup acks, backoff under censorship/flaky links. |
| **Duty-Cycle / Power Manager** | Schedules radio windows and sync intensity vs. battery and record urgency; favors BLE at rest, escalates to Wi-Fi for bulk only when worthwhile. |
| **Shared Picture (MapLibre + OSM)** | Offline vector map with bundled tiles; clusters/dedups records into the eventually-consistent map + list of needs/found/searched; drives de-duplication of effort. |
| **Local Encrypted Store** | Hardware-encrypted Ditto DB holding the append-only signed record log; the device's source of truth, fully usable offline. |
| **GenLayer Anchor Client (optional, edge-only)** | Hashes verified records and anchors them to GenLayer; never on the field critical path. |

**Design invariants enforced across all modules:** (1) every record is signed and append-only; (2) confidence shown to users derives strictly from **reach** (`in_mesh`/`bridged`/`anchored`) and **trust tier**, never from assumed delivery; (3) the system degrades to a fully working single-device experience with zero connectivity and zero infrastructure; (4) no node — field or cloud — is trusted to alter another's claims, only to carry them.

---

## 2. Data Model & Record Schema

> **Canonical conventions are fixed in [Appendix A](#appendix-a--canonical-conventions).** In brief: schemas below are shown as **JSON for human readability**, but the **canonical signed wire form is deterministic CBOR** (COSE-style, sorted keys). Signatures are **Ed25519** over the canonical bytes of the record minus `sig` and local-only `_meta`. Content-addressing and privacy match-hashes use **BLAKE3** (salted where noted); **SHA-256** is used only for GenLayer anchoring. Binary values shown in JSON are `base64url` (unpadded) with a multibase `u` prefix. All enum string values are **snake_case**.

### 2.1 Primitives

- **Geo.** WGS84 decimal degrees + an Open Location Code (Plus Code). Default published precision is the **10-char (~14 m)** code; a one-tap downgrade to **8-char (~110 m)** is forced for sensitive subjects. Raw lat/lng never leaves the device for sensitive reports.
- **Time.** Every record carries a Hybrid Logical Clock `hlc` (string, sortable, `"<48b-wallms>.<16b-counter>.<nodeShort>"`) for deterministic ordering across offline peers, and `wall_ms` (int, epoch ms) for human display. **All ordering and merge tie-breaks use `hlc`, never `wall_ms`** (clocks are untrusted in the field). For surveillance protection, `wall_ms` may be quantized to a 15-minute bucket on records the reporter marks sensitive (see §5).
- **Immutability rule (core CRDT decision).** `reports` and `attestations` are **append-only collections of write-once, content-signed documents**; they are *never* updated after creation, so cross-peer merge is pure set-union — conflict-free by construction. All "change" (verification, dispute, resolution, TTL extension, reclassification, retraction) is a *new* attestation, never a mutation. Only `identities`, `subjects`, and local-only projection docs contain mutable (LWW/OR-Set) fields.
- **Ditto mapping.** Each collection is a Ditto collection; each record = one Ditto document. Sets are Ditto maps keyed by element id (OR-Set semantics). Scalar mutable fields are Ditto LWW registers (HLC tie-broken).

### 2.2 `identities` — Device / Identity

One record per device keypair. The Ed25519 public key is the root of trust; identity is self-asserted (trust is earned through attestations and out-of-band, never granted by a server).

| Field | Type | CRDT | Notes |
|---|---|---|---|
| `_id` | string | immutable | `identity_id` = `"k_" + base64url(blake3(pubkey_ed25519)[0:16])` |
| `pubkey_ed25519` | string | immutable | signing key |
| `pubkey_x25519` | string | immutable | for sealed-box encryption (X25519) |
| `created_at` | {hlc, wall_ms} | immutable | |
| `display_name` | string? | **LWW-register** | optional, minimized; nickname only |
| `role` | enum | **LWW-register** | `volunteer \| sar \| family \| coordinator \| subject` |
| `prev_key` | object? | immutable | `{identity_id, sig}` — signed rotation link (old key signs new) |
| `schema_v` | int | immutable | |

`identity_id` is the universal author reference used by `author_id` / `claimer_id` everywhere, and equals the **DeviceID** (its short fingerprint is shown in the UI). Identity lifecycle (generation, rotation, revocation, duress) is specified in §5.2.

### 2.3 `subjects` — The person a report is about

Minted by the first reporter. Designed so two reporters who independently create a record for the same person can be *soft-merged* without overwriting, and so a person can be matched without exposing PII.

| Field | Type | CRDT | Notes |
|---|---|---|---|
| `_id` | string | immutable | `subject_id` = `"s_" + base64url(random_128)` (random, not content-derived, to avoid PII-in-key) |
| `name_hash` | string? | immutable | salted `blake3(normalize(full_name))` — match/dedup without revealing the name |
| `display_name` | string? | **LWW-register** | optional plaintext; omit under surveillance risk |
| `age_band` | enum? | **LWW-register** | `infant\|child\|teen\|adult\|elder` |
| `sex` | enum? | **LWW-register** | minimized |
| `description` | string? | **LWW-register** | clothing/marks, free text |
| `home_plus_code` | string? | **LWW-register** | site the person is associated with |
| `subject_device_id` | string? | **LWW-register** | `identity_id` of the person's own phone, if any → enables Device/Self-confirmed |
| `merged_into` | OR-Set\<subject_id\> | **OR-Set** | dedup links; canonical = lexicographically-smallest live id in the union |
| `created_by` | identity_id | immutable | |
| `schema_v` | int | immutable | |

> **Reconciliation note:** the trust section's `subject.subjectKey` ≡ `subjects.subject_device_id`; the security section's "subject token" ≡ `subjects.name_hash` (salted). One concept, one field.

**Dedup:** candidate match when `name_hash` equal **or** (`home_plus_code` shares 10-char prefix **and** `age_band` equal). Confirmed merges write reciprocal `merged_into` entries; the canonical subject is recomputed deterministically from the OR-Set union.

### 2.4 `reports` — Signal / Report (append-only, signed, immutable)

Status is **never stored here** — it is computed from `attestations` (see §3.4).

**Common envelope (all kinds):**

| Field | Type | CRDT | Notes |
|---|---|---|---|
| `_id` | string | immutable | `report_id` = `author_id + ":" + author_seq` |
| `author_id` | identity_id | immutable | signer |
| `author_seq` | int | immutable | monotonic per device → stable id + replay/equivocation key |
| `content_hash` | string | immutable | `blake3(canonical(body))` — collapses byte-identical relayed copies |
| `kind` | enum | immutable | `sos \| victim_found \| need \| status \| hazard \| missing_person` |
| `hlc` / `wall_ms` | string / int | immutable | |
| `geo` | object? | immutable | `{lat, lng, plus_code, accuracy_m, src: gps\|manual\|pluscode}` |
| `subject_id` | string? | immutable | required for `missing_person`, `victim_found` |
| `prio` | int 0–5 | immutable | author-proposed; **recomputed locally** (see §2.7) |
| `ttl_s` | int | immutable | seconds; clamped locally (see §2.7) |
| `expires_at` | int | immutable | `wall_ms + ttl_s*1000` |
| `enc` | object? | immutable | optional X25519 sealed-box envelope `{alg, recipients[], ct}` |
| `refs` | [string]? | immutable | other `report_id`s this replies-to / supersedes (e.g. coordinator tasking) |
| `body` | object | immutable | type-specific (below) |
| `sig` | string | immutable | Ed25519 over canonical bytes of `record \ {sig,_meta}` |
| `schema_v` | int | immutable | |
| `_meta` | object | **local-only** | `{received_at, hops, read, pinned, reach}` — never synced, never signed |

> **Reconciliation note:** `tier` is **not** a stored field on a report. (An earlier draft's single `records` collection carried a `tier` string — that was illustrative and is corrected here: tier is *always* derived via the §3.4 fold.) The four collections (`identities`, `subjects`, `reports`, `attestations`) replace any single `records`/`claim` collection. `author_pk` ≡ `author_id`'s pubkey; `claimId/claimHash` ≡ `report_id/content_hash`.

**`body` for `kind = "missing_person"`:**

| Field | Type | Notes |
|---|---|---|
| `subject_id` | string | the missing person |
| `last_seen_plus_code` | string? | |
| `last_seen_at` | int? | epoch ms |
| `site_address_hash` | string? | salted `blake3(normalize(address))` — "lives at site Y" without leaking it |
| `reporter_relationship` | enum | `self\|family\|neighbor\|bystander\|sar` |
| `condition_hint` | enum? | `unknown\|presumed_ok\|injured\|trapped\|deceased_reported` |
| `note` | string? | short free text (opt-in, length-capped, E2E-only — see §5) |

**Other kinds:** `sos.body`={severity, people_count, trapped:bool}; `victim_found.body`={condition, people_count, trapped:bool}; `need.body`={category: water\|med\|fuel\|shelter\|extraction, qty, unit}; `hazard.body`={type: gas\|fire\|collapse\|flood, radius_m}; `status.body`={text, safe:bool}.

### 2.5 `attestations` — Verification events (append-only, signed, immutable)

Every verification, dispute, resolution, retraction, and lifecycle change is one of these. This is the *only* way report state evolves.

| Field | Type | Notes |
|---|---|---|
| `_id` | string | `attestation_id` = `claimer_id + ":a:" + claimer_seq` |
| `claimer_id` | identity_id | signer |
| `claimer_seq` | int | monotonic per device |
| `target` | object | `{report_id, content_hash}` (binds to an exact report version) or `{subject_id}` |
| `att_type` | enum | `corroborate \| on_site \| device_confirm \| self_confirm \| affirm \| dispute \| resolve \| reclassify \| ttl_extend \| retract \| anchor` |
| `assert` | object? | `{fact: present\|alive\|deceased\|safe\|moved\|false\|searched_clear}` |
| `hlc` / `wall_ms` | string / int | ordering / display |
| `proof` | object? | proximity proof, validated locally (below) |
| `confidence` | int 0–100 | claimer-asserted certainty |
| `payload` | object? | type-specific (`resolve`→`{outcome: found_alive\|found_deceased\|relocated\|false_alarm}`; `reclassify`→`{new_condition}`; `ttl_extend`→`{new_expires_at}`; `anchor`→`{chain:"genlayer", tx, merkle_root}`) |
| `sig` | string | Ed25519 |
| `schema_v` | int | |

> `affirm` is the original reporter's re-affirmation (an earlier draft called this `verify_reporter`; same semantics). `retract` is a signed tombstone that hides a record in default views but **remains in the append-only log and still replicates** — a coerced/malicious node cannot erase rescue data. Identity-control records (`key_rotation`, `revoke`) are carried in the `identities` context (§5.2).

**`proof` types & local validation predicate (must pass or the proof is treated as absent):**

| `proof.type` | Fields | Valid iff |
|---|---|---|
| `gps_match` | `{lat,lng,accuracy_m, is_mock?, sat_count?}` | `is_mock` false AND `accuracy_m` ≤ 50 m AND haversine(proof, report.geo) ≤ 50 m |
| `pluscode_match` | `{plus_code}` | 10–11 char code equals report/subject site code |
| `ble_encounter` | `{subject_device_id, beacon, rssi, time_slot, seen_hlc, own_loc?}` | rolling beacon matches `subject.subject_device_id`'s published key for `time_slot` (≤ 15 min slot) AND `rssi ≥ floor` AND attestation `hlc` within 6 h of `seen_hlc` |
| `subject_cosign` | `{sig_by_subject_device}` | valid Ed25519 by `subject.subject_device_id` over the report's `content_hash` |
| `qr_nfc` | `{poi_id, token, sig, nonce?}` | valid signature by a known POI key over `{poi_id, claimer_id, ~time}`; NFC dynamic-challenge `nonce` required for the higher-strength variant |

(Proof *strength* semantics and offline spoofing limits are specified in §3.5.)

### 2.6 CRDT Representation Summary

| Collection | CRDT strategy | Rationale |
|---|---|---|
| `reports` | **Append-only log** (immutable signed docs; merge = union) | tamper-evident, no silent overwrite, trivially convergent offline |
| `attestations` | **Append-only log** (immutable signed docs; merge = union) | full verification history; conflicts surface, never lost |
| `subjects` | **LWW-register map** (descriptive fields) + **OR-Set** (`merged_into`) | last edit wins per field; dedup links accumulate |
| `identities` | mostly immutable + **LWW-register** (`display_name`,`role`) | key is fixed; profile is editable |
| `*_proj` (status cache, read flags, reach) | **local-only / LWW**, never trusted from wire | UI sort/perf only; always recomputed |

### 2.7 IDs, Dedup, Priority & TTL

**Dedup.**
- *Report:* primary key `(author_id, author_seq)`; secondary `content_hash` collapses byte-identical relayed copies. Both deterministic → peers carrying the same record converge to one doc. A second, *different* report at the same `author_seq` is **equivocation** → the author is flagged Disputed.
- *Attestation:* `(claimer_id, claimer_seq)`. Identical re-attestation (same target/type/proof) by the same claimer is idempotent.
- *Subject:* `name_hash` / (`home_plus_code` prefix + `age_band`) → `merged_into` OR-Set.

**Priority — two complementary scales (reconciled).**
A per-record numeric **`prio` 0–5** (5 = life-critical) is recomputed locally so a malicious author can't jump the queue. It maps to a coarse **priority *class* P0–P4** that drives transport eligibility, TTL and retention (see §4).

| Condition | `prio` | Class |
|---|---|---|
| `sos` trapped, or `victim_found.condition=trapped` | 5 | **P0** |
| `sos`, `missing_person.condition_hint ∈ {injured,trapped}` | 4 | **P0/P1** |
| `missing_person` (unknown), `need.category=med` | 3 | **P1** |
| `need` (water/extraction), `hazard` | 2 | **P2** |
| `status`, informational, search-coverage ("zona buscada") | 1 | **P2/P3** |
| photos / map tiles (attachments) | — | **P4** |
| expired but referenced | 0 | — |

Sync drains **highest `prio` first**, then newest `hlc`; radios advertise only `prio ≥ 3` during low-battery mode. Because Ditto exposes no per-document priority queue, P0/P1 reports are placed in their own small Ditto collections that are subscribed **first** (see §4.4); keeping P0 payloads sub-200 bytes guarantees they fit the first sync round on a brief BLE contact.

**TTL (canonical, reconciled).** `ttl_s` is per-kind (author-proposed, clamped locally). After `expires_at` a record is **GC-eligible only if not referenced** by a live attestation or an unresolved higher-prio record; a `ttl_extend` attestation pushes `expires_at` forward (effective expiry = max over valid `ttl_extend` payloads). **Eviction is cache-only and local — it never deletes data from the network** (the record persists on other replicas, in the cloud, and if anchored on GenLayer).

| Kind | Class | Nominal `ttl_s` | Eviction rule |
|---|---|---|---|
| `sos` | P0 | 6 h, **re-broadcast every cycle** | **Never auto-evicted while unresolved** (P0 carry-protection) |
| `victim_found` | P1 | 14 d | Evict after expiry if unreferenced |
| `missing_person` | P1 | 14 d | Evict after expiry if unreferenced |
| `need` (med) | P1 | 48 h | Evict after expiry if unreferenced |
| `need` (water/extraction/other) | P2 | 48 h | Evict after expiry if unreferenced |
| `hazard` | P2 | 24 h | Evict after expiry if unreferenced |
| `status` / search-coverage | P2/P3 | 12–72 h | Evict after expiry if unreferenced |
| photos / tiles | P4 | 24 h / LRU | Evict on expiry **or** storage pressure |

> A resolved record ("found safe"/"rescued") propagates a signed `resolve` attestation that collapses its active map entry, reducing the standing pool of sensitive location data. Local soft-hide of unresolved life-safety records is suppressed (they ride until they land).

### 2.8 Computed Display Status

Report status is a **pure, deterministic fold** over `{report} ∪ valid attestations(report_id)`. Because both inputs are append-only and signature-filtered, every device computes the identical result — convergence without storing status. **The canonical fold is specified once in [§3.4](#34-deterministic-trust-fold-canonical).** The UI consumes its outputs (`tier_label`, `verified`, `verifiedBy`, `disputed`, `outcome`, `corroboration_count`, `confidence_scope`) plus the separately-tracked `reach`.

### 2.9 Worked Example

**Missing-person report** (Maria `k_MARIA…` reports neighbor Juan `s_JUAN…` unreachable at his home):

```json
{
  "_id": "k_MARIA9f2a:7",
  "author_id": "k_MARIA9f2a",
  "author_seq": 7,
  "content_hash": "u9Qe1...c4",
  "kind": "missing_person",
  "hlc": "01919e6a4c00.0003.MARIA",
  "wall_ms": 1750772400000,
  "geo": {"lat":10.6011,"lng":-66.9342,"plus_code":"77GR2J4C+9P","accuracy_m":18,"src":"gps"},
  "subject_id": "s_JUAN4b71",
  "prio": 3,
  "ttl_s": 1209600,
  "expires_at": 1751981600000,
  "body": {
    "subject_id": "s_JUAN4b71",
    "last_seen_plus_code": "77GR2J4C+9P",
    "last_seen_at": 1750766000000,
    "site_address_hash": "u3aa19f...e2",
    "reporter_relationship": "neighbor",
    "condition_hint": "unknown",
    "note": "No responde. Edificio con daños."
  },
  "sig": "uYx0p...A1",
  "schema_v": 1
}
```

**Attestation 1 — Pedro corroborates from afar, no proof → Corroborated:**

```json
{
  "_id": "k_PEDRO22c8:a:3",
  "claimer_id": "k_PEDRO22c8",
  "claimer_seq": 3,
  "target": {"report_id": "k_MARIA9f2a:7", "content_hash": "u9Qe1...c4"},
  "att_type": "corroborate",
  "hlc": "01919e7b1200.0001.PEDRO",
  "wall_ms": 1750773300000,
  "confidence": 60,
  "proof": null,
  "sig": "uK2m9...77",
  "schema_v": 1
}
```

**Attestation 2 — SAR volunteer Ana reaches the site, Plus-Code matches → On-site + verified:**

```json
{
  "_id": "k_ANA7d10:a:12",
  "claimer_id": "k_ANA7d10",
  "claimer_seq": 12,
  "target": {"report_id": "k_MARIA9f2a:7", "content_hash": "u9Qe1...c4"},
  "att_type": "on_site",
  "hlc": "01919e9d3400.0002.ANA",
  "wall_ms": 1750776000000,
  "confidence": 95,
  "proof": {"type":"pluscode_match","plus_code":"77GR2J4C+9P"},
  "sig": "uPp4r...0e",
  "schema_v": 1
}
```

**Resulting computed status** (identical on every device):

```json
{
  "report_id": "k_MARIA9f2a:7",
  "tier_label": "On-site",
  "verified": true,
  "verifiedBy": ["proximity"],
  "disputed": false,
  "outcome": null,
  "best_proof": "pluscode_match",
  "confidence_scope": "device/proximity-verified",
  "corroboration_count": 2,
  "reach": "in_mesh"
}
```

If a later **`dispute`** (`hlc > Ana`) asserted "wrong building," `disputed` flips to `true` and the UI renders **"En sitio · En disputa"** — the On-site proof is retained (append-only), the conflict surfaced, and only a subsequent strictly-higher-tier *verified* attestation (e.g. a `device_confirm` BLE encounter of Juan's phone) would clear it.

---

## 3. Verification & Trust Model

This section is normative for trust. Every rule is a **pure, deterministic function of signed, append-only records**, so any device — offline, mid-merge, or freshly synced — computes an identical trust state from an identical record set (a hard requirement for CRDT convergence).

### 3.1 Design Axioms

1. **Trust is computed, never asserted.** No record carries a "tier" field; tier is derived on-device from the set of signed attestations → order-independent, idempotent, merge-safe.
2. **Three orthogonal honesty axes, never collapsed into one number:**
   - **Trust tier** — how well-evidenced the *claim* is (Reported → Self-confirmed, with Disputed overlay).
   - **Authority** — *who* unlocked the Verified band (original reporter and/or a proximity attester).
   - **Reach** — *how far the record traveled* (`in_mesh` / `bridged` / `anchored`); shown separately, **never** conflated with trust. An offline Self-confirmed record must not look "more delivered" than it is.
3. **Append-only, signed, no silent mutation.** Deletes/edits do not exist; only new signed records that *supersede* (`refs`), `dispute`, `resolve`, or `retract`. Disagreement surfaces as Disputed, never overwrites.
4. **Sybil-flat by construction.** Trust crosses bands on *proof type and physical proximity*, not on *count of signers*. Minting 1,000 keys can only inflate "Corroborated"; it can never manufacture On-site, Device-confirmed, or Self-confirmed.

### 3.2 The Authorization Rule

A report starts **Unverified (Reported)**. It enters the **Verified band only** through an attestation from exactly one of two authorities:

- **(a) The original reporter** — `claimer_id == report.author_id` (an `affirm` or proof-bearing attestation). The reporter owns their report and may re-affirm or set its resolution.
- **(b) A firsthand proximity attester** — any key, *including the reporter*, presenting a **valid proximity proof** (`gps_match`/`pluscode_match`, `ble_encounter`, `subject_cosign`, or `qr_nfc`) that validates against `report.geo`/`subject`.

Proof is **optional for both paths**, but proof determines *how high* in the Verified band the record lands. A bare reporter affirmation with no proof sets `verified = true` (authority present) **but does not raise the evidence tier** — the UI shows *"Verificado por quien reportó · sin prueba independiente."* This is the core honesty move: authority and evidence are shown side-by-side, never merged into a false "verified" glow.

Anyone who is **neither** the reporter **nor** carrying proximity proof can only ever produce **Corroborated** weight.

### 3.3 Graduated Tiers & Promotion Evidence

`tier` is the strongest rung satisfied; `Disputed` is an overlay flag that can sit on any rung.

| Tier | Band | Meaning | Exact evidence that promotes to it |
|---|---|---|---|
| **Reported** | Unverified | A single signed report exists. | Default on creation: one valid signature. |
| **Corroborated** | Unverified | Independent keys agree, none on-site. | ≥ 2 **distinct** signing keys assert the same fact, **none** with a valid proximity proof. (Reporter's own affirmation does not count toward the distinct-key total.) |
| **On-site** | **Verified** | Someone physically at the site attests. | ≥ 1 `on_site` attestation whose `gps_match`/`pluscode_match` or `qr_nfc` proof validates against `report.geo`. |
| **Device-confirmed** | **Verified** | The subject's *own device* was cryptographically encountered near the site. | ≥ 1 `device_confirm` carrying a valid `ble_encounter` to `subject.subject_device_id`. |
| **Self-confirmed** | **Verified (top)** | The subject themselves cosigned — identity + agency at signing time. | ≥ 1 `self_confirm` where `claimer_id == subject.subject_device_id` and signature verifies. |
| **Disputed** | Overlay | Independent signed records contradict each other. | Any `dispute`, **or** ≥ 2 distinct keys asserting mutually-exclusive facts (e.g. `alive` vs `deceased`, `present` vs `false`). |

**Honesty constraint for non-participant subjects:** Device-confirmed and Self-confirmed are reachable *only* when `subject.subject_device_id != null` (subject runs the app). For the common missing-person case where the subject is not on the network, the **ceiling is On-site**, and the UI states this explicitly (*"Confirmación por dispositivo no disponible: la persona no está en la red"*). Absence of the top tiers must never read as doubt about an On-site confirmation.

### 3.4 Deterministic Trust Fold (canonical)

This single function is the source of truth for §2.8 and the UI. It is commutative and idempotent over the attestation set (set-monotone `max` over a fixed lattice) → it converges under CRDT merge regardless of arrival order or duplication. `Disputed` is never auto-resolved; resolution requires a new signed `resolve`/superseding record.

```text
# CANONICAL trust fold — runs identically on every device, fully offline.
# Inputs: report R; the set ATTS of all attestations in the local store; subject S = subject(R).
function computeTrust(R, ATTS, S):
  A = [ a in ATTS
        if sigValid(a)                              # drop forgeries before merge
        and a.target.report_id == R._id
        and a.target.content_hash == R.content_hash ]
  A = strongestPerSigner(A)                         # one effective attestation per claimer_id

  # --- proof-gated signals (each proof validated by §2.5 predicate) ---
  proximityOK    = ∃ a in A: a.att_type=="on_site"        and validProof(a.proof,R) in {gps_match,pluscode_match,qr_nfc}
  deviceOK       = ∃ a in A: a.att_type=="device_confirm" and validProof(a.proof,R)==ble_encounter
  selfOK         = ∃ a in A: a.att_type=="self_confirm"   and validProof(a.proof,R)==subject_cosign
                                                          and a.claimer_id==S.subject_device_id
  reporterAffirm = ∃ a in A: a.claimer_id==R.author_id
                             and a.att_type in {affirm,on_site,device_confirm,self_confirm}
  distinctAgree  = |{ a.claimer_id : a in A, assertsPrimaryFact(a,R) }|

  # --- tier: monotone max over a fixed lattice (CRDT-convergent) ---
  tier = REPORTED(1)
  if distinctAgree >= 2: tier = max(tier, CORROBORATED(2))
  if proximityOK:        tier = max(tier, ON_SITE(3))
  if deviceOK:           tier = max(tier, DEVICE_CONFIRMED(4))
  if selfOK:             tier = max(tier, SELF_CONFIRMED(5))

  # --- authority gate (who unlocked the Verified band) ---
  verified   = proximityOK or deviceOK or selfOK or reporterAffirm
  verifiedBy = ({"reporter"}  if reporterAffirm) ∪ ({"proximity"} if (proximityOK or deviceOK or selfOK))

  # --- dispute overlay (never auto-resolved by the function) ---
  disputed = (∃ d in A: d.att_type=="dispute"
                and not ∃ v in A: v.hlc>d.hlc and tierOf(v)>tierOf(d) and isVerified(v))
             or mutuallyExclusiveFacts(A)

  # --- resolution overlay (LWW by HLC over resolve attestations) ---
  outcome = lwwByHLC({ a.payload.outcome : a in A, a.att_type=="resolve" })

  return {
    tier_label: ["","Reported","Corroborated","On-site","Device-confirmed","Self-confirmed"][tier],
    verified, verifiedBy, disputed, outcome,
    corroboration_count: distinctAgree,
    confidence_scope: verified ? "device/proximity-verified" : "self-asserted",
    reach: reachOf(R)        # in_mesh | bridged | anchored  (see §4.6)
  }
```

**UI honesty rules baked in:** display carries `reach` separately; never collapses "many corroborations" into "verified"; `Disputed` is always shown alongside the underlying tier (e.g. "En sitio · En disputa"), never silently hidden.

### 3.5 Proximity Proofs: Strength & Offline Spoofing Limits

Each proof carries its provenance into the attestation; strength is **relative and surfaced** to the user, not hidden. (Validation predicates are in §2.5; this table gives trust semantics.)

| Proof | `att_type` | Strength | What it proves | Offline spoofing limit & mitigations |
|---|---|---|---|---|
| **`gps_match` / `pluscode_match`** | on_site | ◆◆ Medium | Device reported a position within R of the site at time T. | GPS is mock-able on rooted phones; offline we can't cross-check cell/Wi-Fi. Mitigations: reject if Android `isFromMockProvider`/`isMock` set (flag it); require `accuracy_m ≤ 50 m` and `haversine ≤ 50 m`; bind `ts` to the event window; record GNSS sat count/SNR when available; N independent GPS confirmations raise confidence *within* On-site ("3 confirmaciones en sitio"). |
| **`qr_nfc` at known location** | on_site | ◆◆ QR / ◆◆◆ NFC | Attester physically interacted with a tag bound to a known place. | **Static QR is shareable** (a photo proves "saw the code," not "was here") → Medium, never above On-site. **NFC tap** signs a fresh challenge `nonce` → no remote replay → Medium-High. Place tokens are issuer-signed `{poi_id, plus_code, issuer_key}`, pre-provisioned by coordinators/shelters. Residual risk: tag cloning — combine with GPS for two-factor presence. |
| **`ble_encounter` of subject device** | device_confirm | ◆◆◆◆ High | Subject's *device* was within radio range in a recent slot. | Subject broadcasts a **rolling beacon** = truncated `HMAC(subject_key, coarse_time_slot)` (Exposure-Notification-style). Attester stores `{beacon, rssi, time_slot, own_loc}`; any device recomputes expected beacons from the *published* subject key and matches. Replay bound to ≤ 15-min slot + `rssi ≥ floor`; cross-location replay further constrained by attester's own GPS. Cannot be Sybil-forged: requires the subject key's keystream. |
| **`subject_cosign` (self-confirm)** | self_confirm | ◆◆◆◆◆ Highest | The subject, holding their private key, signed *now* — identity + liveness/agency. | Forgeable only if the subject's private key is compromised. Onboarding binds the key via in-person QR fingerprint exchange (TOFU + optional verification). Liveness is implicit in a fresh `ts`+`nonce` signed value (e.g. scanning an "Estoy a salvo" challenge QR). Strongest possible offline assertion. |

All proof checks run fully offline against locally-held public keys and place tokens.

### 3.6 Anti-Abuse

- **Signatures everywhere; identity = pubkey.** Every report and attestation is Ed25519-signed; pseudonymous keys keep PII low. Unsigned/bad-sig records are dropped at ingest and never merged.
- **Append-only / no silent overwrite.** Edits and "deletes" are new signed records: `refs` (supersede), `resolve` (lifecycle), `dispute`, or `retract` (signed tombstone — hides in default views but remains in the log and replicates, so a coerced node **cannot erase** rescue data).
- **Sybil-flatness (primary defense).** Band-crossing requires proof *type* + physical proximity, not signer *count*; a Sybil swarm tops out at Corroborated. Distinct-key count is displayed but **clamped** — it never crosses a band on its own.
- **Per-signer dedup.** Multiple attestations from one key collapse to that key's strongest; no self-stacking. Two different reports at the same `author_seq` ⇒ equivocation ⇒ author flagged Disputed.
- **Dispute surfacing, not arbitration.** Any participant may append a `dispute`; the app **shows both sides** and never auto-picks a winner offline. Only the original reporter (lifecycle authority) or a higher-tier proof changes the headline, and the dispute remains visible in provenance.
- **Optional local reputation / web-of-trust.** Purely subjective, on-device: keys verified via in-person QR fingerprint exchange get a "contacto conocido" mark; repeated honest co-encounters accrue local weight. Used **only** to sort/triage and name signers; **never** authoritative, global, or gating; degrades gracefully to absent. Spam keys can be **locally muted (hidden), never deleted** for others.
- **Coercion/PII safety.** Subject `display_name`/`subject_device_id` optional; location may be coarsened to 8-char Plus Code on sensitive records; optional X25519 encryption to a recipient/coordinator key for need/status payloads, while the signed *hash and tier* still propagate (mesh sees "a verified SOS here" without the body).

### 3.7 Trust & Provenance in the UI

(Full screen specs in §6; the trust-specific rules below are normative.)

**Headline chip (every list row and map pin)** — icon + shape + color + Spanish text (never color alone):

| Tier | Color / shape | Label |
|---|---|---|
| Reported | amber, hollow ○ | "Reportado" |
| Corroborated | blue, half ◐ | "Corroborado · N coinciden" |
| On-site | green, ◆ | "En el sitio" |
| Device-confirmed | green, ◆ + signal glyph | "Confirmado por dispositivo" |
| Self-confirmed | violet, ●✓ | "Confirmado por la persona" |
| Disputed | grey diagonal stripes | "En disputa" (always shows both claims) |

**Three honest axes, always visible together:** **Trust** = tier chip; **Authority** = caption ("Verificado por quien reportó" / "Verificado por testigo en sitio"; or the explicit "sin prueba independiente"); **Reach** = a separate glyph ⛰ "Solo en malla" vs ☁︎ "Subido a internet" — never merged with trust.

**Provenance drawer (tap to expand):** chronological signed timeline — each event shows signer short-fingerprint (or "contacto conocido" name), `att_type`, asserted fact, **distance to site + GPS accuracy**, time, proof type. Inline warnings: "⚠ ubicación simulada," "QR estático: prueba de presencia débil," "última confirmación hace 6 h," "la persona no está en la red → confirmación por dispositivo no disponible." Disputed records render a split banner showing each side's signed claim and proofs, stating "No resuelto sin más pruebas." Anchor badge ("Anclado en GenLayer · inmutable") if present.

**Action affordances (verify-where-you-stand):** when the user is the original reporter, or the device detects it is within proximity threshold of a report's site, the row surfaces a one-tap **"Tú puedes verificar esto"** flow capturing the strongest available proof (GPS → BLE → QR/NFC → request subject self-cosign) and emitting the appropriate signed attestation; the UI states *which tier the action will reach* before the user signs ("Esto elevará a: En el sitio").

### 3.8 Optional Online Trust Spine (GenLayer Anchoring)

Specified canonically in §5.9. In trust terms: at the internet edge, a gateway **optionally** batches the `content_hash`es of records that reached a chosen threshold (Verified band, or any `dispute`/`resolve`) into a Merkle root anchored to GenLayer, yielding an immutable, timestamped, censorship-proof **existence-and-tier proof**. Only hashes are anchored — no content, no PII, no location. Strictly additive: a record's tier is identical whether or not it was ever anchored. A returning `anchor` attestation merges back as a non-trust badge.

---

## 4. Sync, Mesh & Gateway

### 4.1 Transport Stack & Selection Policy

The mesh runs on Ditto's multiplexed P2P transport layer. Ditto auto-selects and bonds transports per peer; **we configure which transports are enabled, gate them by battery state, and decide which data class is allowed over each.** Selection is by cost, not preference — cheap radios carry everything; expensive radios are demand-driven.

| Transport | Role | Range / Throughput | When it fires |
|---|---|---|---|
| **BLE** | Always-on control plane + small-record sync | ~10–30 m, ~5–50 kbps | Discovery, presence beacons, and **all P0/P1 records** (SOS, victim-found, need). Runs screen-off, in Doze. The backbone — the only radio guaranteed up. |
| **Wi-Fi Aware (NAN)** | Bulk transfer | ~30–100 m, multi-Mbps | Only when there is a **backlog of bulk/low-priority data** AND a peer is stable > 8 s AND battery ≥ Conserve. Torn down immediately after flush. Many cheap Androids lack NAN → fall through. |
| **Wi-Fi Direct (P2P)** | Bulk fallback | ~100–200 m, multi-Mbps | When Aware is unsupported but two devices are co-located long enough to amortize the ~1–3 s group-formation cost. Disrupts normal Wi-Fi, so gateway-mode devices avoid it. |
| **LAN / local hotspot (mDNS+TCP)** | Opportunistic high-speed | Highest | If anyone raises a hotspot or infra Wi-Fi survives, Ditto's LAN transport bonds automatically. Free throughput — always accept. |
| **QR / NFC** | Cold "sneakernet" path | Touch / line-of-sight | Not a sync radio. Key exchange + peer onboarding, proximity proofs, and last-resort single-record hand-off to a phone physically leaving to find signal. |

**Nearby Connections is explicitly NOT in the default path** — Ditto already abstracts BLE+Wi-Fi multiplexing; layering Google's stack on top duplicates discovery and fights for the same radios, and it is Android-only with no iOS path. Reserve it only as a per-device fallback if Ditto's Wi-Fi transports measurably underperform on a given handset.

### 4.2 Peer Discovery & Mesh Formation

- **Discovery is Ditto-native and continuous.** Each device advertises a tiny BLE presence beacon (Ditto peer ID + sync-version cursor) and scans for others. No central coordinator, no manual pairing in the field.
- **The mesh is epidemic, not routed.** Ditto does **not** packet-route across hops; every device holds a CRDT replica of its subscribed data and any two bonded peers reconcile their sets (delta-sync — only the diff crosses the radio). Multi-hop reach is emergent: A↔B and B↔C means A's SOS reaches C even though A and C never meet.
- **Connection budget:** cap concurrent bonded peers (e.g. 4–6) to bound radio contention and battery; Ditto rotates connections to reach more of the local crowd over time.

### 4.3 Subscriptions Are the Throttle

A phone does not try to hold the country's data. We register DQL subscriptions scoped by **geo-cell + priority + freshness**, so only relevant records cross a link:

```sql
-- High-priority: wide net, always synced
SELECT * FROM sos      WHERE plus_cell IN :nearCells AND expires_at > now()
SELECT * FROM needs    WHERE plus_cell IN :nearCells AND expires_at > now()
-- Lower-priority: only added when capacity allows
SELECT * FROM coverage WHERE plus_cell IN :nearCells AND prio >= 2
```

`:nearCells` = the device's current Plus-Code cell + neighbors + a corridor along recent travel, so data spreads outward with moving people without flooding distant cells.

### 4.4 Priority, Dedup & TTL on the Wire

The canonical record-level priority/TTL/dedup rules live in §2.7. Sync adds the transport/retention layer:

- **Dedup by content address (secondary key).** Identical re-submissions (same SOS rebroadcast by five phones) collapse via `content_hash`. Status changes/corroborations are **separate** attestations referencing the target, never overwrites.
- **Priority classes drive transport eligibility** (P0/P1 on BLE always; P3 on BLE-if-idle else Wi-Fi; P4 Wi-Fi only). **P0/P1 reports live in their own small Ditto collections** subscribed first, because Ditto exposes no strict per-document priority queue. Keeping P0 payloads sub-200 bytes guarantees first-round delivery on a brief BLE contact.
- **TTL enforcement** is `expires_at` + periodic local eviction:
  ```sql
  EVICT FROM coverage WHERE expires_at < now()
  EVICT FROM media    WHERE expires_at < now() OR (storage_pressure AND prio = 4)
  ```
  Eviction is **cache-only and local** — never deletes data from the network; append-only integrity preserved.

### 4.5 Store-Carry-Forward (Delay-Tolerant Behavior)

Because each device is a durable replica, store-carry-forward is **inherent, not bolted on**: a record written with zero peers present persists locally and replicates the instant any peer appears — minutes or hours later, in a different neighborhood, on the reporter's body. What we add:
- **Travel-corridor subscriptions** (§4.3) so a volunteer walking from a cut-off barrio to a triage point passively ferries that barrio's SOS records into a denser part of the mesh.
- **The QR carry path** for the hard case: a runner heading to a hilltop can scan a compact QR bundle (signed P0 records only, CBOR+gzip) off a phone with no working radio link, then bridge them from the hilltop. Records remain signed end-to-end — the carrier is a courier and cannot tamper.
- **No expiry of unresolved life-safety data while in carry:** TTL eviction is suppressed for P0 records not yet resolved or confirmed-bridged, even under storage pressure.

### 4.6 The Opportunistic Cloud Bridge (Gateway)

This falls out of Ditto's Big Peer architecture; we shape its behavior:

- **Any online device is a gateway — automatically and concurrently.** When a Small Peer gets connectivity, Ditto opens a WebSocket to the Big Peer and bidirectionally syncs every subscribed collection: the mesh's accumulated records flush **up**, replies/tasking flush **down**; the device re-shares the downlink inward over BLE/Wi-Fi. No leader election — CRDT merge makes multiple simultaneous gateways idempotent.
- **Gateway escalation (we build):** on becoming a gateway the device (a) un-throttles radios to full duty until the flush queue drains, (b) widens subscriptions briefly to vacuum P0/P1 from neighbors, (c) shows a clear "Puente activo — mantén el teléfono quieto" prompt, then drops back to its battery bucket. Bridging is **manual-confirm by default** in surveillance contexts (see §5.7).
- **Honest reach, propagated back inward (canonical definition).** The Big Peer stamps a write-receipt (server HLC + monotonic cursor) on bridged records; the receipt syncs **back down**, flipping the original reporter's record from in-mesh to reached-internet. **Reach is a three-rung ladder, computed locally and shown verbatim — never a claim that a human received anything:**

  | Reach value | Meaning | UI (es-VE) |
  |---|---|---|
  | `in_mesh` | seen by N peers, no cloud receipt | "Solo en malla (N vecinos)" |
  | `bridged` | has a cloud write-receipt | "Subido a internet · hace T" |
  | `anchored` | has a GenLayer tx hash | "Anclado · inmutable" |

  (A coordinator's reply/tasking arriving back is a *downlink record*, rendered with `bridged` reach and the coordinator's verified identity — distinct from the reach of the original report.)
- **GenLayer anchoring is edge-only and optional:** only Verified-tier record hashes are anchored, only by a gateway, off the critical path (§5.9). Mesh function is identical with anchoring fully disabled.

### 4.7 Conflict Resolution & Convergence

- **Ditto handles the CRDT merge:** per-field LWW resolved by **Hybrid Logical Clocks** (causal ordering without synced wall-clocks), plus CRDT counters/registers/maps. Convergence is guaranteed regardless of merge order or partition.
- **We avoid overwrites entirely via event sourcing.** Verification tier and resolved-state are **never** mutable fields; they are *derived* by folding the signed event set (§3.4). Conflicts surface (`Disputed`), never silently resolve; two contradictory signed events both persist with their signers.
- **Trust is cryptographic, not positional.** Only the original reporter's key or a key presenting firsthand proximity proof can raise a tier — enforced at fold time by signature/proof check, so a malicious relay cannot forge promotion even though it relays the bytes.

### 4.8 Battery Duty-Cycling Strategy

Radios are duty-cycled by a **battery-bucket state machine** running inside an Android foreground service (persistent "Baran activo" notification + battery-optimization exemption request) that keeps BLE alive through Doze.

| Engine bucket | Battery | BLE | Wi-Fi (bulk) | Behavior |
|---|---|---|---|---|
| **Normal** | >60% | Continuous scan/advertise | Allowed on backlog + stable peer | Full mesh participation |
| **Conserve** | 30–60% | Continuous, longer scan interval | Only for P≤2 backlog | Bulk deferred |
| **Frugal** | 15–30% | Duty-cycled: ~1 s scan / 10 s | Off | P0/P1 only |
| **Lifeline** | <15% | Advertise own SOS as beacon; scan in short bursts ~every 60 s | Off | Emit + opportunistically receive only |

The UI exposes these four engine buckets as **three selectable power modes** (see §6.6): **Completo** = Normal; **Ahorro** = Conserve/Frugal; **Supervivencia** = Lifeline. Auto-switch happens at the bucket boundaries (60 / 30 / 15%); teams may set a more conservative Ahorro trigger (e.g. 40%). **Outbound SOS and self-status are exempt from suppression at every tier.**

Plus:
- **Honest limitation:** Ditto does not expose fine-grained BLE scan-window tuning. We duty-cycle primarily by **enabling/disabling transports and pausing/resuming sync** (at Lifeline, stopping/starting the Ditto instance on a timer); where the OEM stack allows, we set low-power scan mode.
- **Radio-role desync:** devices jitter scan schedules and alternate transient *scanner*/*advertiser* roles via `hash(deviceId, epochMinute)`, so the local crowd isn't all scanning at once — cuts energy and BLE contention while keeping someone listening.
- **Lonely-device backoff:** exponential increase of scan cadence when no peer is seen; **reset to aggressive on any contact** so a fresh encounter syncs fast.
- **Gateway override:** bridging always wins over the bucket — full radios until the flush completes, then snap back.

### 4.9 Ditto vs. Us — Responsibility Split

| Ditto provides | We configure / build |
|---|---|
| Transport discovery, bonding, multiplexing, reconnection | Per-bucket `TransportConfig` (which transports on/off), data-class→transport gating |
| Epidemic delta-sync + multi-hop replication | Geo+priority+freshness subscription queries (the throttle) |
| CRDT merge, HLC causal ordering, counters | Event-sourced verification fold + Disputed surfacing; Ed25519 signing / X25519 encryption |
| Big Peer cloud sync (the opportunistic bridge) | Gateway escalation, cloud write-receipt → `in_mesh`/`bridged`/`anchored` reach ladder |
| Eviction engine + subscriptions | Content-address dedup IDs, TTL/priority policy, eviction rules, P0 carry-protection |
| — | Android foreground service + Doze handling, battery state machine, radio-role desync, QR/NFC cold path, GenLayer anchoring |

### 4.10 Failure Modes & Honest Confidence

- **No peers, no signal:** records persist locally; UI shows "Solo en malla · 0 vecinos" — explicitly *not delivered*. Nothing is ever shown as delivered to a person.
- **Clock skew / partition:** HLC + CRDT guarantee convergence on reconnect; no data loss, no fake ordering.
- **Multiple gateways:** idempotent — no duplication; receipts converge.
- **Storage pressure:** lowest-priority cache evicted first; P0/unresolved life-safety never auto-evicted while un-bridged; the append-only network record remains intact.

---

## 5. Security, Privacy & Threat Model

This section is normative. Defaults are chosen for a high-coercion, surveilled environment where a captured phone, a hostile mesh participant, and a state-level network observer are all assumed present. Guiding rule: **a record must never make its subject easier to find, identify, or punish than they already are.** When safety and functionality conflict, default to the safer behavior and let the user opt up.

### 5.1 Cryptographic Primitives (fixed, no negotiation)

| Purpose | Algorithm | Notes |
|---|---|---|
| Device identity / signing | **Ed25519** | One identity keypair per device install. |
| E2E key agreement | **X25519** | Derived from the same seed (separate key, not the signing key). |
| Symmetric AEAD | **XChaCha20-Poly1305** | 24-byte random nonce; safe for offline devices with no reliable clock/counter. |
| KDF | **HKDF-SHA-256** for derivation; **Argon2id** for passphrase-wrapping at-rest | Argon2id ~1 s on a low-end Android (m=64 MB, t=3, p=1). |
| Content hash / record IDs | **BLAKE3** | Fast on ARM; used for `content_hash`, content-addressing, salted privacy match-hashes. |
| GenLayer anchoring hash | **SHA-256** | Chain-standard; used only at the anchoring edge. |
| Group / channel keys | 256-bit symmetric, distributed out-of-band (QR/NFC) | See §5.4. |

**No algorithm agility in v1:** a single hard-coded ciphersuite removes downgrade attacks and shrinks the audited surface. The wire format carries a 1-byte `suite_id` only so a future version can rotate, never to negotiate down at runtime.

### 5.2 Device Identity & Key Lifecycle

**Generation.** On first launch the device generates a 32-byte random seed (`SecureRandom` / `/dev/urandom`) and derives via HKDF: (1) an Ed25519 signing key, (2) an X25519 agreement key. The signing key's BLAKE3 hash (truncated to 16 bytes, short fingerprint) is the **DeviceID** (= `identity_id`). No account, no phone number, no server registration.

**Pseudonymity, not anonymity.** A device is consistently identifiable by its DeviceID (so trust accrues to a stable identity), but it is **not** bound to a legal identity. The human display name is free-text, changeable, optional, and **never** a security boundary.

**At-rest protection.** The seed is stored in Android Keystore / StrongBox where hardware allows, wrapped by an Argon2id key derived from a user PIN/passphrase. The decrypted seed lives in memory only while foregrounded; backgrounding zeroizes it. **Panic / duress controls (mandatory):**
- **Duress PIN** — a second PIN unlocks a decoy/empty state and silently wipes the real keystore and record DB.
- **Quick-wipe** — one gesture from the lock screen destroys keys and the local CRDT store; signed records already propagated remain in the mesh (append-only) but the device can no longer be tied to new authorship.

**Backup.** Opt-in, off by default (a backup is a coercion target). When chosen: a 24-word BIP-39-style mnemonic of the seed, shown once, never stored, never transmitted. Optional encrypted social-recovery: Shamir 2-of-3 shards (XChaCha20-wrapped) handed via QR to trusted peers; reconstruction fully offline.

**Loss & rotation.** Because trust attaches to a DeviceID, key loss means starting a new pseudonym at tier zero. To preserve continuity safely we support a **signed `key_rotation` record** `{old_pub, new_pub, ts}` (carried via `identities.prev_key`): the old key signs the new, and peers that observed the old key transfer accrued trust. A device that is *captured* must NOT rotate (the attacker holds the old key) — instead the user issues a **`revoke` (self-revocation)** record, or peers raise the DeviceID to **Disputed** on anomaly. Revocations are append-only and gossip like any other record.

### 5.3 Message Signing (always on)

Every record is a small CBOR object, canonically encoded (sorted keys, COSE-style envelope), then signed. Signing is **non-optional** — an unsigned record is dropped on receipt, never displayed, never relayed. (Field-level mapping is the §2 schema; this is the logical view.)

```
Record = {
  id,        // = report_id/attestation_id; content_hash = blake3(canonical body)
  type,      // sos | victim_found | need | status | hazard | missing_person
             // | attestation(att_type) | key_rotation | revoke
  author,    // Ed25519 pubkey / identity_id
  ts,        // hlc + coarse wall_ms (see Metadata)
  geo,       // Plus Code, truncated — see §5.5
  payload,   // type-specific, length-capped
  refs,      // ids this corroborates/disputes/replies-to
  sig        // Ed25519 over all preceding fields
}
```

- **Canonical encoding** so the same logical record hashes identically on every device — required for CRDT convergence and GenLayer anchoring.
- **Append-only, signed** gives the trust model its teeth: no silent delete/overwrite; an attacker can only *append* a contradicting record, which surfaces as **Disputed**.
- **Replay/dedup:** content-addressed `content_hash` makes replays idempotent; the per-author `author_seq` counter detects equivocation (two different records at the same seq ⇒ author flagged Disputed).
- Tiers are computed locally from the signed attestation set (§3.4) — **never** a trusted field inside a single record.

### 5.4 Optional End-to-End Encryption

Most rescue signal is intentionally **public within the mesh** — broadcasting "collapse at Plus Code 8FQX+5W, 3 trapped" to every nearby phone is the point, and is signed-but-cleartext so any rescuer can act. E2E is reserved for the minority of records whose *content* is sensitive:

- **Private 1:1** (family coordinating; subject self-cosigning): X25519 ECDH → HKDF → XChaCha20-Poly1305. The ciphertext still gossips; only the addressed device opens it. Relays carry opaque blobs.
- **Group/team channels:** a 256-bit channel key minted by the team lead, distributed **out-of-band via QR/NFC** (never over the air, never via cloud). Records are AEAD-sealed under the channel key; metadata (that *a* channel record exists) is visible, contents are not. Forward secrecy is limited by the offline constraint — documented; key rotation is manual (new QR) after suspected compromise.

Encrypted records still carry a signature over the ciphertext so relays can authenticate and dedup without decrypting.

### 5.5 PII Minimization & Data Handling

**Default-minimal.** The app collects the least data that still lets a rescuer act, and makes the safe choice the easy one.

**What is broadcast (public records):**
- Coarse location only — **Plus Codes truncated to ~14 m (10-char) by default, one-tap downgrade to ~110 m (8-char)** for sensitive subjects. Raw GPS lat/long is *never* on the wire; it stays on-device for the reporter's own map.
- Need/hazard category from a **fixed Spanish-localized enum** (agua, médico, atrapado, fuego, estructura inestable…), not free text.
- Subject reference: by default a **non-reversible subject token** (`subjects.name_hash`, salted) rather than a plaintext name, so corroboration links reports about the same person without publishing identity.

**What is NOT broadcast (ever, by policy):** phone numbers, national ID, exact home address as text, full-resolution faces, raw contact lists, IMEI/MAC, account handles. Free-form notes are **opt-in, length-capped, and E2E-only** — never in a public record.

**Photos.** Discouraged for people; when used: stripped of all EXIF on capture, downscaled to a **redacted thumbnail (≤96 px, optional auto face-blur)**, attached only to **E2E** records. A full-resolution image never enters the mesh. The UI states this before the first photo.

**Consent & subject-protection.** Reporting a *missing/at-risk person* triggers an explicit consent/risk prompt ("¿Podría esta ubicación ayudar a alguien a perseguir a esta persona?"). If yes, the record is forced to coarse geo + subject token + E2E-by-default, and is eligible only for **Self-confirmed** promotion by the subject. Self-reports (your own SOS) bypass this — you may always endanger only yourself.

**Retention.** Local records carry a soft TTL (§2.7) after which they're hidden from the active map and eligible for local GC; the signed copy may persist elsewhere. Resolved records propagate a signed `resolve` that collapses the map entry, shrinking the standing pool of sensitive location data.

### 5.6 Censorship & State-Surveillance Threat Model

Three adversaries: **(A) hostile/curious mesh participant**, **(B) network/RF observer + censoring state**, **(C) device-capturing actor**.

**A hostile actor ON the mesh CAN:** read every public record (by design); inject false records under their own/Sybil DeviceIDs; replay old records (idempotent — no effect); flood/DoS the gossip layer; observe traffic-flow metadata; selectively *withhold* records they're asked to relay (a relay can drop, not forge).

**A hostile actor on the mesh CANNOT:** forge a record as another DeviceID or alter/delete an existing signed record (Ed25519 + append-only); silently promote trust (verification requires reporter-or-proximity signed records); decrypt E2E/channel records without keys; Sybil-win the trust model (tiers weight proximity-proven and original-reporter cosigns above raw count; equivocation flags Disputed). Mass false reports degrade the *picture* (a real risk) but cannot fake *verification*.

**Metadata exposure (named honestly).** Even with content protected, *existence and pattern* leak: DeviceID activity graphs, coarse geography, timing, social structure. Mitigations: **coarse, 15-min-quantized timestamps** + coarse geo; no persistent display-name requirement; one-tap DeviceID rotation; duty-cycled radios incidentally reduce RF fingerprinting. We **do not** claim to defeat RF-level device tracking — see adversary B — and we tell the user so.

**Adversary B — network/RF observer & censoring state.** The mesh's core defense against the blackout is that it doesn't need the internet: BLE/Wi-Fi-Direct gossip is invisible to a shut-down cellular core. The **opportunistic cloud bridge is the exposure point** — the moment any phone uplinks, it is observable. Mitigations: bridging is **manual-confirm by default** (the user chooses to become a gateway, understanding the risk); bridge traffic goes to a **domain-fronted / pluggable-transport endpoint** to resist DPI/blocking; payloads are the same signed/encrypted blobs (no extra plaintext); the app **rotates which device bridges**. Android **MAC randomization required-on**; BLE advertising uses rotating RPAs. We **cannot** hide that *a* radio is transmitting from someone with a spectrum analyzer next to you — documented as out of scope for software.

**Adversary C — device capture.** Covered by Duress PIN, quick-wipe, foreground-only key decryption, StrongBox at-rest. A captured, unlocked phone exposes its local map and authored records; it does **not** expose other users' E2E content or let the captor forge history under others' keys.

**Plausible deniability.** Ship an **innocuous launcher icon/name option** + duress decoy state so an inspected phone reveals an empty/benign app. Pseudonymous DeviceIDs + coarse geo give deniability that *a particular human* authored *a particular report*. E2E records are opaque blobs; a relay operator can truthfully say they cannot read what they carried. We **do not over-promise**: against a determined state with physical access and RF tooling, deniability is partial — the UI never tells a user they are "anonymous."

**The report-endangers-subject risk (first-class).** A well-meaning "Ana is trapped at <exact address>, status unknown" can hand a hostile actor a target. Defenses are structural, not advisory: subject tokens instead of names, forced coarse geo for at-risk-person reports, E2E-by-default for them, consent prompts naming the specific danger, and a one-tap **`retract`** that appends a signed suppression (the map entry collapses everywhere it propagates, though original signed bytes cannot be cryptographically unsent).

### 5.7 Honest Confidence Signaling (security requirement)

Every record shows **two independent, never-conflated indicators** — (1) **trust tier** (§3) and (2) **reach** (`in_mesh` / `bridged` / `anchored`, §4.6). The app must **never** imply delivery or rescue is guaranteed; reach is best-effort with the last-bridged timestamp. Disputed and stale records are visually distinct and never silently hidden.

### 5.8 Optional GenLayer Anchoring (online edge, hashes only)

**Purpose:** give selected **verified** records a censorship-proof, tamper-evident existence proof — so a regime cannot later claim a report never existed — **without** publishing sensitive content.

- **Hashes only.** Anchored value is the **SHA-256 digest** of the canonical signed record (plus its tier and coarse-time bucket), never the payload, geo finer than coarse Plus Code, or subject tokens. The chain stores a commitment; the preimage stays in the mesh.
- **Strictly opt-in, edge-only.** Anchoring happens only when (a) a device has internet, (b) the record has reached **On-site/Device-confirmed/Self-confirmed**, and (c) the user/team enabled anchoring for that category. Never on the offline critical path.
- **Batched Merkle anchoring.** Bridges accumulate eligible digests into a Merkle tree and anchor the **root** to a GenLayer Intelligent Contract; each record carries its Merkle proof. Minimizes on-chain footprint, cost, and metadata.
- **What it buys / doesn't.** Proves *a record with this content existed by time T and was verified to tier T* — for accountability, post-disaster auditing, countering deletion/denial. It does **not** establish ground truth (garbage-in still anchors) and is **not** required for any rescue function. If GenLayer is unreachable, everything else works unchanged.
- **Subject safety wins:** at-risk-person records are **excluded** from anchoring by default; anchoring them requires explicit per-record consent and is coarsened further (small/guessable preimage spaces are a liability even as hashes).

### 5.9 Threats & Mitigations

| # | Threat | Adversary | Mitigation | Residual risk |
|---|---|---|---|---|
| 1 | Forge a record as another user | Mesh | Ed25519 mandatory; unsigned/invalid dropped | None cryptographically; relies on key secrecy |
| 2 | Tamper with / delete an existing record | Mesh / state | Append-only, content-addressed, signed; edits surface as **Disputed** | Original bytes can't be "unsent"; mitigated by `retract` |
| 3 | Sybil flood of fake corroborations to fake-verify | Mesh | Trust weights proximity-proven & original-reporter cosigns; equivocation ⇒ Disputed | Degrades shared picture (noise), not verification |
| 4 | False SOS / false "found safe" to misdirect | Mesh / state | Pseudonym accountability, Disputed surfacing, tier+reach UI, local mute of flagged DeviceIDs | Some wasted effort before dispute propagates |
| 5 | Replay old records | Mesh | Idempotent content IDs; per-author counters detect equivocation | None |
| 6 | Read sensitive private content | Mesh / capture | XChaCha20-Poly1305 E2E (X25519) + out-of-band channel keys | Metadata of E2E records still visible |
| 7 | Downgrade/MITM the crypto | Mesh / state | Single fixed ciphersuite, no runtime negotiation | Requires version bump to rotate |
| 8 | Traffic analysis / social-graph inference | State observer | Coarse geo + quantized time, pseudonym rotation, duty-cycled radios, no name requirement | Pattern leakage remains; named as residual |
| 9 | RF/device fingerprinting (BLE/Wi-Fi MAC) | State w/ RF tooling | MAC randomization required; rotating BLE RPAs; duty cycling | Cannot fully hide a transmitting radio |
| 10 | Block/identify the cloud bridge | Censoring state | Manual-confirm bridging, domain-fronting/pluggable transport, rotating gateway device, signed/encrypted payloads | Bridging device inherently exposed while uplinking |
| 11 | Seize an unlocked/locked device | Capturing actor | StrongBox + Argon2id at-rest, foreground-only key in memory, Duress PIN decoy, quick-wipe | Unlocked seized phone exposes its own local data |
| 12 | App presence incriminates the user | Capturing actor | Innocuous icon/name option, duress decoy, optional E2E-only mode | Forensic recovery may still reveal app traces |
| 13 | Report endangers its subject | Mesh / state | Subject tokens, forced coarse geo, E2E-by-default & consent prompt for at-risk persons, one-tap retract | Coerced/known preimage can still re-identify |
| 14 | Anchored hash leaks subject info | State | Hashes-only, at-risk records excluded from anchoring by default, coarse-time buckets | Guessable preimages of small spaces |
| 15 | Key loss / compromise breaks continuity | User / mesh | Opt-in mnemonic + Shamir recovery; signed `key_rotation` transfers trust; `revoke` for compromise | Compromised key valid until revocation propagates |
| 16 | Fake/over-stated delivery confidence | UX failure | Separate, never-conflated **trust tier** vs **reach** indicators; best-effort language; stale/Disputed always visible | User may still over-trust; mitigated by copy |

---

## 6. Rescuer-Facing UX

### 6.1 Design Principles (apply to every screen)

- **Spanish-first, icon-led.** Default locale `es-VE`; short Venezuelan Spanish ("Pedir ayuda," not "Crear solicitud de auxilio"). Every actionable element pairs a **glyph + word + color**, parseable by icon alone. English is a settings toggle, never the default.
- **Glove- and panic-friendly.** Minimum touch target **56 dp** (primary actions 72 dp); ≥12 dp spacing; no gestures on any critical path (long-press is always an *accelerator*, never the only way). Primary actions in the bottom third (thumb zone).
- **High-contrast, sunlight-readable.** WCAG AAA contrast; default light "daylight" theme; separate dark **night/stealth** theme. Confidence/status is **never** color alone — always color **+ shape/icon + text**.
- **One decision per screen.** Multi-field forms become single-question steps with a progress-dots row.
- **Honest confidence, always.** The app never renders a record as "delivered" or "true." Two orthogonal axes everywhere: **Verification tier** and **Reach** — visually distinct, never conflated.
- **Battery is sacred.** Map animations, tile prefetch, and radio scans respect the current power mode; the UI lets the user trade reach for runtime explicitly.

### 6.2 Screen List & Navigation

Five primary destinations on a persistent bottom tab bar, plus modal flows from a permanent FAB.

| Tab | Spanish label | Glyph | Purpose |
|---|---|---|---|
| Mapa | **Mapa** | map pin | Shared rescue picture (default landing) |
| Señales | **Señales** | radio waves | Chronological signed-record feed |
| (center FAB) | **PEDIR / REPORTAR** | red + | Create SOS / report (always reachable) |
| Yo | **Yo** | person | My status, identity, broadcasts |
| Ajustes | **Ajustes** | gear/battery | Settings, low-power, language, keys |

A **global status ribbon** is pinned at the very top of all five screens.

### 6.3 Global Status Ribbon (persistent)

A thin (28 dp) bar, tappable to expand. Three chips left-to-right, plus a power glyph:

1. **Mesh chip** — "Cerca: 4" with a peers-icon; gray "Cerca: 0 — solo tú" when alone; pulses when a peer joins.
2. **Bridge/Internet chip (the honesty centerpiece)** — three explicit *connectivity* states (distinct from per-record reach):
   - **Sin internet** (gray cloud-with-slash) — fully offline; everything in-mesh only.
   - **Puente activo** (amber cloud-up-arrow, animated) — a peer (possibly this phone) currently has signal and is bridging mesh ⇄ cloud. Subtext: "vía otro teléfono" / "este teléfono."
   - **Subido** (green cloud-check) — at least one sync completed since last edit; replies/tasking pulled.
3. **Sync chip** — "↑12 ↓3" pending counts. Tapping opens a sheet listing what is queued, what has bridged, and the age of the last successful cloud contact ("Último internet: hace 2 h"); stale (>6 h) turns amber.
4. **Power glyph** (far right) — battery state (Completo / Ahorro / Supervivencia), tappable straight to low-power controls.

> **Two levels of "reach," kept distinct:** the ribbon shows *device connectivity* (Sin internet / Puente activo / Subido); each individual record shows its own *reach ladder* (`in_mesh` → `bridged` → `anchored`, §4.6).

### 6.4 Screen 1 — Mapa (offline shared rescue picture)

The landing screen and the team's single source of truth.

**Base layer.** MapLibre GL rendering **pre-bundled offline OSM vector tiles** for Caracas/La Guaira (shipped + expandable via QR/peer transfer). A "Mapa sin conexión" watermark confirms tiles are local. No tile network calls; missing zoom shows "Acerca menos — no hay más detalle guardado" rather than blank tiles. Plus-Code grid overlay toggle for areas where street names are gone.

**Pins — type by glyph, confidence by color + ring.**
- *Types (glyph):* **SOS/persona en peligro** (red triangle, person), **Desaparecido** (purple silhouette + "?"), **Encontrado / a salvo** (green check-person), **Necesidad** (blue box — water/food/meds sub-glyph), **Peligro** (yellow-black hazard diamond — fire/gas/collapse/flood sub-glyph), **Zona buscada** (translucent gray hatched polygon).
- *Verification tier (ring + saturation):* **Reportado** (dashed thin ring, pale fill) · **Corroborado** (solid thin ring, +N stacked-people badge) · **En sitio** (solid double ring, footprint badge) · **Confirmado por dispositivo** (solid ring + BLE/QR badge, full saturation) · **Confirmado por la persona / Auto-confirmado** (solid ring + key badge) · **En disputa** (red/amber split ring + "!", drawn on top, never hidden).

A compact **legend FAB** (book icon) opens a one-screen visual key — the only "manual" most users read.

**Clustering & density.** At low zoom, same-type pins cluster into a numbered bubble colored by the *highest-urgency* member (an unverified SOS still shows red). Tapping a cluster zooms/spider-fies.

**Map controls (bottom thumb-zone, 64 dp):** **Centrar en mí** (GPS lock); **Filtro** chips (toggle types; quick "Solo sin verificar" / "Solo SOS"; "Ocultar zonas buscadas"); **"Aquí estoy / Marcar"** long-press drops a draft pin and opens Create pre-filled. Map respects power mode (capped frame rate, animations off, single-shot GPS in Ahorro). Tapping a pin opens **Report Detail (Screen 4)**.

### 6.5 Screen 2 — Señales (signed-record feed)

A reverse-chronological, **offline-first list** of every record the mesh has seen. Each row is a fat card (min 88 dp): type glyph + color, one-line summary ("SOS — 2 personas atrapadas — Calle Sucre"), **verification-tier badge**, **reach badge** (in-mesh vs internet), distance + bearing ("420 m · NE"), age ("hace 35 min"), corroboration count.

- **Top filter chips:** "Todo · SOS · Desaparecidos · Necesidades · Peligros · Sin verificar · Cerca de mí."
- **Sort toggle:** "Más urgente" (urgency-weighted) vs. "Más reciente."
- **New-record affordance:** incoming records slide in under a sticky "▼ 3 señales nuevas" pill so the list never jumps under the thumb.
- **Disputed records float to a pinned "Necesita revisión" section** at top — the trust conflicts that most need a human eye.
- Row long-press → quick actions: **Corroborar**, **Estoy yendo (claim task)**, **Compartir por QR**.

### 6.6 Screen 3 — Crear (SOS / Report) — the center FAB flow

The FAB is a permanent **red "+"** labeled "PEDIR / REPORTAR." Tapping opens a **type-picker grid** of six giant (96 dp) tiles, glyph + word + color, ordered by urgency: **SOS · Desaparecido · Encontrado/A salvo · Necesidad · Peligro · Zona buscada (marcar revisado)**.

Then a **single-question-per-step wizard** (3–4 steps; fat "SIGUIENTE" + back arrow + progress dots):

1. **¿Dónde?** — defaults to current GPS with accuracy radius on a mini-map; one tap "usar mi ubicación," or drag the pin, or type/scan a **Plus Code**. Coordinate-fuzzing option for sensitive cases (§5.5).
2. **¿Qué pasa? / ¿Quién?** — type-specific. *Desaparecido:* name/alias (optional), last-known site, description — all optional, with a privacy reminder. *Necesidad:* count + need sub-type icons (agua, comida, medicina, rescate, refugio) by tapping. *SOS:* number of people, trapped/injured toggles via icon switches.
3. **¿Cómo de seguro? / Pruebas (optional).** — the *reporter* may attach optional proximity proof now: "Estoy en el sitio" (GPS/Plus-Code), photo, short **voice note** (huge for low-literacy). Self-reports of one's own status can **self-confirm**.
4. **Revisar y enviar.** — plain-language summary card showing exactly what will broadcast, the **starting tier** ("Se enviará como: Reportado"), and a clear **PII warning** if a name/photo is attached ("Esto será visible para otros rescatistas y podría subirse a internet"). Big **"ENVIAR A LA RED"** button.

**On send:** the record is **Ed25519-signed** locally, written to the local CRDT store, with an immediate **"Guardado — se propagará"** confirmation and an in-mesh icon — **never** "delivered." A live reach indicator progresses honestly: *Solo en este teléfono → En la malla (N vecinos) → Subido a internet → Anclado.*

**Voice & camera shortcuts:** a persistent **"Hablar SOS"** mic button fires a minimal voice-note SOS in one tap (location auto-attached, transcription deferred until a bridge is available). A **"Recibir por cámara"** QR scanner lives one tap from the FAB and the Share sheet.

### 6.7 Screen 4 — Detalle del reporte (attest / verify)

Opened from a pin or feed row. Top-to-bottom:
- **Header:** type glyph + color, human title, and a **large verification-tier banner** that states the *rule*, not just a label — e.g. "REPORTADO — Una sola persona lo informó. Sin confirmar." vs. "EN SITIO — Confirmado por alguien que estuvo presente." Disputed: red banner "EN DISPUTA — Hay versiones que se contradicen. Revisa abajo."
- **Reach line:** "En la malla · aún no llega a internet" or "Subido a internet hace 12 min."
- **Map snippet** with the pin + Plus Code + distance/bearing + "Cómo llegar" (offline routing/compass arrow).
- **Details:** need counts, description, attached photo/voice (play inline), reporter's pseudonymous handle + key fingerprint (short emoji/word hash).
- **Provenance / attestation timeline (append-only):** a vertical signed history every rescuer can read — who reported, corroborated, marked on-site, disputed — each with tier, time, optional proof glyph. This *is* the trust audit trail; "edits" appear as new signed entries (§3.7).

**Action bar (bottom, thumb-zone, large buttons):**
- **"Confirmo — estoy cerca"** → proximity-attestation flow (§6.8). Raises tier toward On-site/Device-confirmed.
- **"Corroboro"** → signed Corroborated cosign without proximity (Reported→Corroborated). One tap.
- **"No es correcto / En disputa"** → dispute flow: pick a reason chip (ya no está aquí / persona a salvo / lugar equivocado / duplicado), optionally attach proof. Creates a signed `dispute`; surfaces conflict, never overwrites.
- **"Marcar a salvo / resuelto"** (SOS/Desaparecido) → signed `resolve` to *Encontrado*; original remains in history.
- **"Estoy yendo"** (claim) → signed task-claim so teams don't duplicate; shows "1 rescatista en camino" on the pin.
- **"Compartir"** → QR/NFC export for offline hand-off (§6.9).

**Verification-rule enforcement, shown honestly:** the UI allows tier elevation to Verified-class tiers only by **(a)** the original reporter (key matches) or **(b)** a firsthand proximity proof. If a user without standing taps a verify action, they're routed to *Corroborate* or *Provide proximity proof* with a one-line explanation — the app teaches the trust rule in context rather than failing silently.

### 6.8 Proximity-Attestation Flow (the core verify path)

Launched by "Confirmo — estoy cerca." A 56 dp-button single-question wizard offering whichever proofs are currently possible (greys out impossible ones):
1. **Coincidencia de ubicación (GPS / Plus Code).** Captures GPS, computes distance, shows a live readout: "Estás a 30 m del sitio — válido" (green) or "Estás a 1.2 km — demasiado lejos para confirmar en sitio" (amber, routes to Corroborate). Threshold visualized as a ring.
2. **Encuentro BLE del dispositivo del sujeto (Device-confirmed).** If the subject's device advertises a known rolling beacon, shows "Dispositivo de [handle] detectado cerca" — strongest practical tier, cryptographic.
3. **Auto-cosign del sujeto (Self-confirmed).** Hand the phone (or QR) to the subject to sign "estoy a salvo / soy yo" with their own key.
4. **QR/NFC en lugar conocido.** Scan a posted Plus-Code/landmark tag to anchor location without GPS.
5. **Foto / nota de voz** as optional supporting evidence (never sufficient alone for top tiers, but attached to the signed attestation).

Each produces a **signed attestation** appended to the timeline, elevating the tier per §3, with the proof type recorded. The confirmation screen states the new tier plainly: "Ahora: EN SITIO."

### 6.9 QR / NFC Offline Hand-off

For phones with zero radio peers (the carry-forward courier case): any record, filter view, or one's whole pending outbox can be exported as a **chain of QR codes** (or NFC tap) and **camera-scanned** by another phone, merging into their CRDT store with signatures intact. Used to (a) move data across mesh islands, (b) hand a tasking list to a team heading into a dead zone, (c) anchor location via posted QR placards.

### 6.10 Screen 5 — Yo (my status)

- **My broadcastable status** — large toggle tiles: **A salvo · Necesito ayuda · Buscando · Descansando · Sin batería pronto.** Flipping one signs and propagates a self-status (self-confirmed by definition).
- **My identity** — pseudonymous handle + key fingerprint (emoji/word hash) + a QR of my public key so teammates recognize my future signatures. "Rotar identidad" for at-risk users.
- **Mis reportes / mis confirmaciones** — everything I've signed, with current reach + tier.
- **Battery & duty-cycle summary** (current mode, est. runtime).
- **Panic / minimize-PII** — a fast "Modo discreto" that strips my visible name to handle-only and switches to the stealth theme.

### 6.11 Screen 6 — Ajustes / Bajo consumo

- **Three explicit power modes** (big radio tiles; each states the trade), mapping to the §4.8 engine buckets:
  - **Completo** (= Normal) — radios scan/advertise actively, GPS continuous, map animated. "Más alcance, menos batería."
  - **Ahorro** (= Conserve/Frugal; default when battery drops) — radios duty-cycle in short windows, GPS single-shot on demand, map static, grayscale-friendly, screen dims fast, no photo prefetch. "Equilibrio."
  - **Supervivencia** (= Lifeline) — radios wake only on a long interval or manual "Sincronizar ahora," screen mostly off, **SOS still always sendable** via one giant lock-style button. "Máxima duración. Tu SOS sigue saliendo."
- **"Sincronizar ahora"** — one aggressive scan/advertise/bridge burst; reports result honestly ("3 enviados, 0 a internet").
- **Battery-aware automation:** auto-switch at the engine boundaries; a toast explains each switch. Outbound SOS and self-status are exempt from suppression at every mode.
- **Idioma** — Español (default) / English / room for indigenous-language packs; **literacy-aids master toggle** (voice prompts, icon-only mode, text scale up to 200%).
- **Privacy & security:** sign-only vs. **sign + encrypt**; default coordinate-fuzzing radius for sensitive reports; "no subir fotos a internet"; panic-wipe; Duress PIN; key backup via QR.
- **Optional GenLayer anchoring** — clearly-labeled, **off-by-default** switch: "Anclar reportes verificados a un registro público inmutable (GenLayer) cuando haya internet." Explains it makes verified records censorship-proof but public; only verified-tier hashes eligible; at-risk records excluded by default.
- **Mapas** — manage offline tile regions, import a region pack via QR/peer, storage usage.

### 6.12 Accessibility, Literacy & Field-Hardening Checklist (binding)

- **Spanish-first copy**, 6th-grade reading level, no jargon; every screen passes an "icon-only legibility" review.
- **Voice everywhere it matters:** voice-note input on reports; optional TTS read-aloud of incoming SOS/feed.
- **Touch:** 56 dp min / 72 dp primary, 12 dp gaps, bottom-thumb zones, no required gestures, generous hit-slop; haptic confirmation on every signed action.
- **Vision:** AAA contrast, 200% text scaling, color **never** the sole signal (tier = ring shape + badge + word; type = glyph), daylight + stealth-dark themes, grayscale-safe.
- **Robustness:** every critical action (send SOS, send self-status) works offline, at every power mode, from a single tap; nothing critical behind a menu or network call.
- **Honesty invariants the build must never violate:** (1) no record shown as "delivered/true" — only reach + tier; (2) unverified reports visibly distinct from verified; (3) disputes never hidden or auto-resolved; (4) tier elevation respects reporter-or-proximity rules; (5) offline/bridge/sync state visible on every screen.

---

## 7. Tech Stack & Decisions

### 7.1 Android-First Justification

The target population runs cheap, often 2–4 GB RAM "Android Go"-class handsets on Android 9–14; iPhones are a rounding error in the affected barrios. Android is also the only major platform exposing the low-level radio primitives this app lives or dies by: raw BLE GATT server/client roles, Wi-Fi Aware (NAN), Wi-Fi Direct, local-hotspot control, Nearby Connections, NFC HCE, and long-running foreground services with developer-controlled duty cycling. iOS sandboxes or forbids most of these. **Decision: ship Android-first, single codebase, treat iOS as a degraded BLE-only follower (Phase 2).** Every choice below optimizes for low-RAM devices, aggressive battery duty-cycling, and zero-infrastructure peer radios.

### 7.2 App Framework — Native Kotlin + Jetpack Compose (pick)

**Decision: native Kotlin + Jetpack Compose. Reject React Native and Flutter.** The hard parts (BLE GATT, Wi-Fi Aware, Nearby Connections, NFC HCE, `connectedDevice` foreground services, Doze/battery-exemption handling, CameraX) are native Android surfaces; RN/Flutter would add a bridge over exactly the APIs we most need, with thin/unmaintained community plugins. Ditto ships a **first-class Kotlin SDK** (Flutter/RN bindings are second-class). Native gives the smallest APK, lowest GC pressure on Android Go hardware, and tightest control over background execution/wakelocks. Compose builds the map+list+capture UI fast with `AndroidView` interop for MapLibre. Trade-off: a future iOS port means a second Swift codebase — acceptable since iOS is Phase 2 and BLE-only.

### 7.3 Mesh / Sync Backbone — Ditto (the single most important pick)

**Decision: Ditto SDK (v5, Kotlin).**

| Option | What you get | Verdict |
|---|---|---|
| **Ditto (PICK)** | Embedded CRDT document store + multi-transport P2P sync (BLE, P2P Wi-Fi/Wi-Fi Aware, LAN) + automatic opportunistic Big Peer cloud bridge | Matches the brief ~1:1. The shared rescue picture *is* a replicated CRDT store. Mesh works with **no cloud, no Wi-Fi, no servers**; any one phone with signal transparently bridges the whole mesh up and pulls tasking back — exactly our store-carry-forward + gateway model. |
| **Bridgefy** | BLE mesh **message-passing** SDK | **Rejected.** Moves opaque messages, not a synced replicated store — we'd rebuild CRDT merge, dedup, the eventually-consistent map, and conflict→Disputed logic. Worse, **its license must be validated online at least once** — fatal under a blackout where a fresh install may never reach the internet. Closed-source. |
| **Roll-your-own on Nearby Connections** | Google's P2P transport | **Rejected as backbone.** Android-only with no iOS path, and only a transport — we'd still build CRDT, conflict resolution, transport-switching, persistence, and the bridge from scratch. Keep only as an *optional supplementary high-bandwidth transport* behind Ditto if BLE throughput proves inadequate. |

**Ditto caveats to engineer around:** obtain an **offline license token** and bake it into the build so fresh installs activate with zero connectivity (never depend on online activation in a blackout). Pin the Ditto identity to our own Ed25519 keys rather than Ditto cloud auth, so trust does not route through their servers. The Big Peer is configured but entirely optional — the app is fully functional if it's never reached.

### 7.4 Transport Layer & Radio Duty-Cycling

Let Ditto manage transport selection, constrained for battery (full policy in §4):
- Run sync inside a single **foreground service with `foregroundServiceType="connectedDevice"`** (mandatory on Android 14+, and required for background BLE scanning on Android 15+).
- **Adaptive duty cycle** (the §4.8 battery state machine): wide BLE windows when unsynced records exist or battery is high; long sleep otherwise. Prefer BLE for discovery + tiny records; negotiate up to P2P Wi-Fi / Wi-Fi Aware for bulk only when battery allows.
- **Epidemic gossip with TTL + content-hash dedup** (Ditto CRDT replication); cap record size and attachment policy.
- Expose a "Low Power" vs "Relay/Hub" mode so a phone on a car charger can become a high-availability relay.

### 7.5 Maps & Geocoding

- **MapLibre Native (Android)** via `AndroidView` in Compose. BSD-licensed, no API keys, no network calls.
- **Offline basemap: pre-seeded PMTiles (or MBTiles) vector tiles** of the Caracas/La Guaira AO, OSM-sourced, bundled in the APK + side-loadable via QR/SD/peer so a tile pack itself propagates over the mesh.
- **Plus Codes** via Google's `openlocationcode` for short, speakable location references — the canonical site identifier in records and a proximity-proof primitive.
- GPS via fused/`LocationManager`; degrade to manual Plus-Code / map-pin entry when no fix.

### 7.6 Cryptography & Identity

- **Ed25519** for signing, **X25519** for optional payload encryption (ECDH → XChaCha20-Poly1305), via **libsodium** (`lazysodium-android`, which bundles the native `.so`). Mature, constant-time, tiny.
- Each install generates a device keypair on first run; the **private seed is wrapped by an Android Keystore (TEE/StrongBox where available) AES key** so the signing key never sits in plaintext. We use libsodium for the actual Ed25519/X25519 because hardware-backed Ed25519 is inconsistent on cheap devices.
- Records are **signed CBOR** in a COSE-style envelope (compact, deterministic — critical when every byte rides BLE). Append-only + signed gives the no-silent-delete/overwrite guarantee; conflicting signed updates surface as **Disputed**. (Full crypto suite is fixed in §5.1.)
- Minimize PII: identities are pseudonymous public keys; names optional, local, never required.

### 7.7 Local Store & Data Model

- **Ditto's embedded document store is the local store** for all synced data (queried with DQL). No separate sync DB to keep coherent.
- Use **DataStore/Room only for purely local, non-synced state** (UI prefs, draft captures, key-wrapping metadata, tile-pack catalog, local-only `_meta` like read flags and reach cache).
- Record types are tiny signed documents across four collections (`identities`, `subjects`, `reports`, `attestations`; §2). Verification tiers are **derived** from the signed attestation set, never an in-place mutable field.

### 7.8 QR / NFC / Camera

- **CameraX + ML Kit Barcode Scanning** (on-device, free, no network) for QR — hand off records, keys, tile packs, and known-location proximity proofs phone-to-phone with zero radio pairing.
- **Android NFC (`android.nfc`, incl. HCE)** for tap-to-cosign (subject self-cosign, on-site corroboration) and reading NFC tags at known locations as proximity proof.
- Fallback everywhere: QR works when NFC hardware is absent on the cheapest handsets.

### 7.9 Optional Cloud Spine + GenLayer Anchoring

Strictly optional, off the hot path, engaged only at the internet edge:
- A **thin stateless bridge** (Big Peer / small serverless function) receives mesh data from whichever phone has signal and pushes replies/tasking back. Censorship-resilient hosting (multiple regions, domain-fronting-friendly).
- **GenLayer Intelligent Contract** anchors **SHA-256 hashes (batched as a Merkle root) of *verified* records** for an immutable, censorship-proof audit trail — hashes only, never PII (§5.8). Cost is per-anchor gas only; the app is fully functional with anchoring disabled.

### 7.10 Licensing & Cost Summary

| Component | License / cost | Notes |
|---|---|---|
| **Ditto SDK** | Commercial. Free tier: 10 cloud connections + 2 GB cloud storage; Pro adds 1,000+ connections / 50 GB (billed per additional 1,000, max 10,000); Enterprise = custom, BYOC/self-managed. | **Crucial:** offline P2P mesh needs *no cloud and is not metered*. Only the few phones that momentarily reach the internet consume a cloud connection, so metered usage stays tiny. **Pursue Ditto's startup/non-profit/disaster discount** and request an **offline license token**. |
| **Bridgefy** | Commercial, closed-source, online license validation required | Rejected (see §7.3). |
| **MapLibre Native** | BSD-2 — free | OSM tile data is **ODbL** (attribution + share-alike on derived tiles). |
| **PMTiles / MBTiles tooling** | Open source — free | One-time tile generation for the AO. |
| **libsodium / lazysodium-android** | ISC / MPL-2.0 — free | Native crypto. |
| **ML Kit Barcode, CameraX** | Free, on-device | No network, no key. |
| **openlocationcode (Plus Codes)** | Apache-2.0 — free | |
| **GenLayer** | Per-anchor gas/fees only | Optional; zero cost if disabled. |

Net: the offline core is effectively **zero recurring cost**; the only spend is the optional cloud bridge and optional chain anchoring.

### 7.11 Platform Caveats

- **Android 14+** requires typed foreground services; **Android 15+** further restricts background BLE scanning — both handled by the `connectedDevice` foreground service. Budget for per-OEM battery-optimization whitelisting prompts (Xiaomi/Transsion/Samsung kill background services aggressively — common on cheap LatAm devices).
- **Wi-Fi Aware is Android-only and device-gated** (not all chipsets expose it); always degrade to BLE + P2P Wi-Fi. Nearby Connections is Android-only.
- **Permissions:** runtime `BLUETOOTH_SCAN`/`ADVERTISE`/`CONNECT`, `NEARBY_WIFI_DEVICES` (Android 13+, with `neverForLocation` where possible), camera, NFC. Keep the ask minimal and explained — surveillance-wary users deny anything that looks like tracking.
- **iOS (Phase 2):** Ditto runs on iOS but only over **BLE + peer-to-peer Wi-Fi** (no Wi-Fi Aware, no Nearby Connections); iOS NFC is read-limited and background BLE throttled. iOS is a **BLE-only, lower-throughput follower** — acceptable given near-zero iOS presence in the AO.

### 7.12 Concrete Dependency List (Gradle)

```kotlin
// Mesh + CRDT sync backbone (offline P2P + opportunistic cloud bridge)
implementation("live.ditto:ditto:5.+")

// UI — Jetpack Compose
implementation(platform("androidx.compose:compose-bom:<current>"))
implementation("androidx.compose.ui:ui")
implementation("androidx.compose.material3:material3")
implementation("androidx.activity:activity-compose")
implementation("androidx.lifecycle:lifecycle-service")            // foreground sync service

// Offline maps
implementation("org.maplibre.gl:android-sdk:11.+")                // MapLibre Native (Android)
// PMTiles/MBTiles served locally from app storage (no runtime dep beyond MapLibre)

// Plus Codes
implementation("com.google.openlocationcode:openlocationcode:1.0.4")

// Crypto: Ed25519 sign + X25519/XChaCha20 encrypt
implementation("com.goterl:lazysodium-android:5.+")
implementation("net.java.dev.jna:jna:5.+@aar")
implementation("androidx.security:security-crypto:1.+")           // Keystore-wrapped key envelope

// Camera + QR
implementation("androidx.camera:camera-camera2:1.+")
implementation("androidx.camera:camera-lifecycle:1.+")
implementation("androidx.camera:camera-view:1.+")
implementation("com.google.mlkit:barcode-scanning:17.+")

// NFC: android.nfc (platform, no dependency) — HCE for tap-to-cosign

// Compact signed record encoding (deterministic CBOR)
implementation("com.upokecenter:cbor:4.+")

// Local-only (non-synced) prefs/state
implementation("androidx.datastore:datastore-preferences:1.+")

// Optional cloud spine / GenLayer anchoring (edge bridge only)
implementation("com.squareup.okhttp3:okhttp:4.+")                 // bridge calls when online
// GenLayer JSON-RPC client invoked from the bridge layer; no client-side hard dep
```

**Manifest essentials:** `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `NEARBY_WIFI_DEVICES`, `ACCESS_FINE_LOCATION` (pre-Android 13 BLE), `CAMERA`, `NFC`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, plus a `connectedDevice` foreground service declaration for the Ditto sync loop.

**Sources:** [Ditto pricing](https://www.ditto.com/pricing/cloud-sync) · [Ditto SDK docs](https://docs.ditto.live/sdk/latest/home) · [Bridgefy SDK](https://bridgefy.me/sdk/) · [Bridgefy Android SDK (GitHub)](https://github.com/bridgefy/sdk-android) · [Android Wi-Fi Aware](https://developer.android.com/develop/connectivity/wifi/wifi-aware) · [Android background BLE / Android 15 rules](https://developer.android.com/develop/connectivity/bluetooth/ble/background) · [Nearby Connections](https://developers.google.com/nearby/overview).

---

## 8. Build Plan, Demo Script, Test Plan & Risks

### 8.1 Phased Milestones

Ordered so **every phase ends in a demoable, independently useful artifact**, and so the offline mesh — the only thing guaranteed to exist — is solid before anything that depends on connectivity. Sized for a hackathon cadence (each phase ≈ one focused build session); the same order holds for a production roadmap. The locked data model is §2 (four collections of small append-only signed documents; no mutation of others' records — every change is a *new* signed record referencing a prior one, so CRDT merge never silently overwrites).

#### Phase 0 — Scaffold & Identity
- Ditto SDK integrated, offline `Sync` enabled across **BLE + Wi-Fi Aware/Direct + LAN/hotspot**; no Big Peer required for P2P.
- Per-device Ed25519 signing key + X25519 box key generated on first run, stored in Android Keystore. Public-key fingerprint = mesh identity. No accounts, no phone numbers, no PII required to function.
- Canonical-CBOR signing/verification helper; every write signed, every read verifies-or-rejects.
- **Acceptance:** two devices in airplane mode each generate keys; a hand-crafted signed record written on one appears verified on the other.

#### Phase 1 — MVP (the demo target)
- **Compose & sign** SOS, missing-person, need, hazard records from a 3-tap form (type → location auto-filled from GPS/Plus Code → optional note).
- **Propagate** automatically via Ditto P2P; incoming records verified and merged.
- **Shared rescue picture:** MapLibre + bundled offline OSM tiles for greater Caracas/La Guaira, pins colored by type + **reach badge** (in-mesh vs reached-internet); plus a sortable list view.
- **Minimal verification ladder:** Reported → Corroborated/On-site via a signed `attestation` (one tap on a pin: "Estoy aquí / Confirmo"). Original reporter can self-confirm.
- **Single-tap Gateway mode:** when a device has connectivity it toggles online, **bridges the whole mesh up and pulls replies/tasking down** (Big Peer sync or a thin cloud endpoint), then re-disseminates replies. Replies render as a distinct record type with the reached-internet badge.
- **Cloud dashboard (read + reply):** web view of all bridged records on a map/list; operator can post a `status`/reply record ("team dispatched") that flows back down.
- **Acceptance:** the full Demo Script (§8.2) runs end-to-end.

#### Phase 2 — Trust depth & conflict handling
- **Full tier ladder:** Reported / Corroborated / On-site / **Device-confirmed** / **Self-confirmed** / **Disputed**, with the §3 promotion rules.
- **Proximity proofs:** GPS/Plus-Code match, **BLE encounter** of the subject's device (signed rolling beacon), **subject self-cosign**, **QR/NFC** at a known location. Proof optional but raises tier and visibly increases trust.
- **Authority rules enforced in UI + at fold time:** tier raised only by (a) the original reporter or (b) firsthand proximity proof; anyone else's "confirm" records as Corroborated, not On-site.
- **Dispute surfacing:** a contradicting signed record flips the pin to a Disputed state showing both sides; append-only history viewable. No silent winner.
- **Acceptance:** the Verification & Conflict test matrix (§8.3) passes.

#### Phase 3 — Battery, range & store-carry-forward robustness
- **Adaptive duty-cycling:** advertise/scan windows scale with battery and peer density (§4.8); foreground service + WorkManager survive Android background limits.
- **Carry-forward hygiene:** TTL expiry, hop counters, content-hash dedup, and **record compaction** (drop superseded note bodies, keep hashes) to bound mesh size on cheap phones.
- **PII minimization & encryption:** sensitive fields stored as `name_hash` or X25519-sealed; map/list work without plaintext PII.
- **Acceptance:** Battery/Range tests; 6-device carry-forward chain with one mule device (§8.3).

#### Phase 4 — Censorship spine, polish & ops
- **GenLayer anchoring (optional):** gateway anchors hashes of verified records for an immutable audit trail (§5.8). Off by default; never blocks delivery.
- **Resilient endpoints:** pluggable/rotating gateway URLs, domain-fronting-friendly transport, no plaintext beacons that identify users; "panic" quick-wipe; Duress PIN.
- **Localization & onboarding:** full **Spanish** UI, low-literacy iconography, **QR-based app/key onboarding** for phones that can't reach a store.
- **Acceptance:** anchored hash verifiable on GenLayer; app fully usable in Spanish offline.

### 8.2 Demo Script — 4 Android phones

**Cast.** Phone **A** = Ana (finder), **B** = Bruno (runner/relay), **C** = Cira (on-site confirmer), **D** = Dani (gateway). A, B, C in **airplane mode** (Wi-Fi/BLE manually re-enabled so radios work but no cell/internet — the realistic field state). D starts in airplane mode, toggles cellular/Wi-Fi on at the bridge moment. A large screen mirrors the **cloud dashboard**.

**Pre-flight (off camera).** All four paired into the mesh once so keys are exchanged; then separated so only adjacent pairs are in radio range: **A↔B in range; B↔C in range after a walk; C↔D in range after a walk; A and C/D NOT in range.** This forces store-carry-forward, not a single broadcast.

| t | Action | What the audience sees |
|---|---|---|
| 0:00 | **A** creates an **SOS** ("collapse, 2 trapped") + a **missing-person** report ("Carlos lives at building Y, status unknown"). Both signed; tier **Reportado**; geo from Plus Code. | A's map: two pins, amber "Reportado / Solo en malla." |
| 0:30 | **A↔B** sync over BLE (A out of range of everyone else). | B lights up with both pins, same tier, signature-verified check. A has "handed off." |
| 1:00 | **B walks** ~30 m to **C**, leaving A's range. **B↔C** sync. | *"Store-carry-forward — B carried Ana's records out of Ana's range and delivered them."* C now shows both pins. |
| 1:30 | **C is at building Y.** C taps the missing-person pin → **"Estoy en sitio, confirmo la casa de Carlos,"** attaching a **Plus-Code/GPS proximity proof** (+ optional QR at the door). Creates a signed **attestation**. | Pin promotes **Reportado → En sitio**; tier turns green; provenance shows two signers (A + C). |
| 2:00 | **C walks** to **D**, syncs. D (offline) now holds SOS + missing(On-site) + attestation. | D shows the full verified picture — still all "Solo en malla" badges (honest: not yet internet-confirmed). |
| 2:20 | **D toggles online** → Gateway mode auto-bridges the mesh up. | Dashboard **populates live**: SOS + Carlos(On-site) with full signed history; map pins drop in. |
| 2:40 | **Operator** posts a **reply/tasking**: "Rescue team 4 dispatched to building Y, ETA 20 min" + marks SOS **acknowledged**. (Optional: GenLayer anchor of the verified record fires; tx hash shown.) | New reply record created server-side. |
| 3:00 | D pulls the reply down and **re-disseminates into the mesh**; D→C→B→A as proximity allows. | Each phone surfaces the reply with the **"Subido a internet"** badge — visibly different from in-mesh records. A finally sees "Equipo enviado" on the original SOS. |
| 3:20 | Close: open the SOS history on A. | Append-only signed chain: Ana → Cira(on-site) → operator(ack), every hop verifiable, nothing overwritten. |

**Fallback if radios misbehave on stage:** pre-stage the same record set; demonstrate hops by physically toggling Wi-Fi/BLE per pair, with a "force sync" debug button. The verification promotion and the bridge reply are the load-bearing moments — protect those.

### 8.3 Test Plan

Test bed: ≥4 physical Android devices (include one cheap ~Android 9 device), `adb` for airplane-mode/radio toggling and log capture, a Faraday bag or distance rig to force out-of-range, Ditto's presence/peers API behind a hidden **debug panel** (peer list, record count, last-sync, hop count), and a scriptable cloud dashboard.

**Mesh formation**
- *Pairwise discovery:* each transport in isolation (BLE only, Wi-Fi Aware only, hotspot/LAN only) — two devices discover and sync < 30 s (verify via debug peer list).
- *Multi-peer:* 4 devices in mutual range converge to identical record sets (compare record-id hashes across devices).
- *Transport failover:* kill Wi-Fi mid-sync, confirm BLE continues; re-enable, confirm upgrade.
- *Cold-join:* a 5th device joins late and back-fills full history.

**Store-carry-forward**
- *Mule test:* A→B sync, separate A; B walks into C's range (A never in C's range); assert A's records reach C with timestamps/signatures intact. Repeat to a 4-hop chain.
- *Persistence across restart:* force-kill app / reboot the mule mid-carry; records survive and still deliver.
- *TTL & dedup:* inject duplicates + an expired record; assert content-hash dedup and TTL drop; hop counter increments correctly.
- *Bounded growth:* flood 1,000 records; confirm compaction keeps the store within budget on the low-end device without OOM.

**Gateway bridge**
- *Up-bridge:* offline mesh accumulates N records; one device goes online; assert all N appear on the dashboard within SLA and signatures verify server-side (reject any failing signature).
- *Down-bridge round-trip:* operator reply reaches the **originating offline device** through ≥2 mesh hops; assert the reached-internet badge appears only on internet-confirmed records, never on in-mesh ones.
- *Gateway handoff:* online device goes offline, a *different* device gains signal and becomes gateway; no duplication, no lost replies (CRDT idempotency).
- *Intermittent link:* drop connectivity mid-bridge; assert resume-without-dupes.

**Verification tiers** — matrix over {reporter, on-site-with-proof, remote-no-proof, subject-cosign, QR/NFC} × {valid, missing, forged proof}:
- Reporter self-confirm → **Self-confirmed**.
- Stranger with valid GPS/Plus-Code proximity → **On-site**; without proof → only **Corroborated**.
- Subject device BLE encounter / self-cosign → **Device-confirmed / Self-confirmed**.
- **Forged/mismatched proof rejected** (geo not near site, bad signature, mock-location flag) → no promotion; flagged.
- *Authority rule:* a non-reporter, no-proof attempt to set "verified" cannot raise tier — assert UI blocks and the fold ignores it.

**Conflict / dispute handling**
- Two devices independently confirm **conflicting** statuses ("rescued" vs "still trapped") while partitioned, then merge → pin shows **Disputed** with both signed records, no silent winner.
- *Append-only guarantee:* attempt to delete/overwrite another's record → not possible; only a new signed record is added; full history reconstructable.
- *Convergence:* after partition heals, all devices show identical Disputed state and identical history ordering.

### 8.4 Top Risks & Mitigations

| Risk | Why it bites here | Mitigation |
|---|---|---|
| **Range & density** — BLE ~10–30 m; survivors sparse; rubble blocks RF | A lone phone may never meet a peer; mesh starves | Lean hard on **human store-carry-forward** (runners as mules) as a first-class flow, not a fallback; opportunistic Wi-Fi Direct/hotspot for longer reach; UI nudges ("lleva esto al punto de reunión"); QR/NFC as a manual last-resort transport when radios fail. |
| **Battery** — no recharging; radios + GPS drain fast | Devices die mid-rescue; mesh thins | **Adaptive duty-cycling** keyed to battery/density; foreground service to survive Doze without busy-looping; GPS sampled not continuous; compact records cut radio airtime; battery-aware "low-power relay" mode. |
| **Non-guaranteed / eventual delivery** | Lives at stake; false confidence kills | **Never fake certainty.** Two axes (tier + reach), explicit "Último internet hace N min," no read-receipt theater; acknowledgements are records, not guarantees; UI says "best-effort." |
| **Abuse / false verification** | Censorship state or bad actors plant fake SOS / fake "rescued" | Everything **signed** (Ed25519); unsigned/forge-failing dropped. **Proximity proofs** gate high tiers; reporter-or-proof authority rule. Append-only + **Disputed** surfaces conflicts instead of letting a forger overwrite. Optional **GenLayer anchoring** of verified hashes for tamper-evidence. Spam-key flagging. |
| **PII / surveillance exposure** | Spanish-speaking population under state surveillance + blackout | **Minimize PII** (name hashes, optional X25519 encryption); no phone numbers/accounts; no plaintext beacons that fingerprint users; pluggable/rotating gateway endpoints; quick-wipe "panic" mode; Duress PIN. |
| **Platform fragmentation** — Android BLE/Wi-Fi Aware quirks, OEM background killers, old OS | Cheap diverse phones behave inconsistently; background sync killed | Android-first via **Ditto** (transport abstraction + CRDT); multi-transport fallback so no single API is load-bearing; foreground service + WorkManager; test matrix includes a low-end Android 9 device; graceful degradation to manual QR sync. |
| **Cloud/bridge dependency creep** | Team over-invests in dashboard; offline core rots | Hard rule: **offline mesh ships and passes tests before any bridge work** (phase order enforces this). Bridge and GenLayer are strictly additive and never block in-mesh function. |

---

## Appendix A — Canonical Conventions

These decisions reconcile divergences between the source design sections; they are normative wherever a section restated something differently.

1. **Collections.** Exactly four synced collections: `identities`, `subjects`, `reports`, `attestations`, plus local-only projection docs (`*_proj`). Any earlier single `records` collection or `claim` type is mapped onto these: *claim ≡ report*, `reporterKey ≡ author_id`, `signerKey ≡ claimer_id`, `claimId/claimHash ≡ report_id/content_hash`, `subjectKey ≡ subjects.subject_device_id`, subject-token ≡ `subjects.name_hash`.
2. **Tier is always derived, never stored.** No report carries a `tier` field; tier comes from the §3.4 fold. (Corrects the illustrative `"tier": ...` in an early `records` schema.)
3. **Canonical wire form = deterministic CBOR** (COSE-style envelope, sorted keys). JSON in this document is illustrative/human-readable. `sig` = Ed25519 over the canonical bytes of `record \ {sig, _meta}`. (Supersedes the "JCS / RFC 8785 JSON" canonicalization from the data-model draft — we standardize on CBOR for byte-efficiency over BLE.)
4. **Hashing.** **BLAKE3** for `content_hash`, content-addressing, and salted privacy match-hashes (`name_hash`, `site_address_hash`). **SHA-256** only at the GenLayer anchoring edge. (Supersedes scattered SHA-256/BLAKE2s usages; the choices in any one section collapse to this rule.)
5. **Record IDs.** Primary `_id = author_id:author_seq` (reports) / `claimer_id:a:claimer_seq` (attestations) — stable, dedup, equivocation-detecting. `content_hash` is the **secondary** key that collapses byte-identical relayed copies. (Supersedes "content-address-as-primary.")
6. **Enum value style = snake_case** for all kinds/types/proofs (`victim_found`, `missing_person`, `on_site`, `device_confirm`, `self_confirm`, `gps_match`, `pluscode_match`, `ble_encounter`, `subject_cosign`, `qr_nfc`). `affirm` ≡ the earlier `verify_reporter`.
7. **Tiers (canonical, ordered):** `Reported(1) < Corroborated(2) < On-site(3) < Device-confirmed(4) < Self-confirmed(5)`; `Disputed` is an orthogonal overlay. Spanish: Reportado / Corroborado / En sitio / Confirmado por dispositivo / **Confirmado por la persona** (a.k.a. Auto-confirmado) / En disputa.
8. **Reach ladder (canonical):** `in_mesh` → `bridged` → `anchored`, tracked in local-only `_meta` and shown **separately from trust tier**. Distinct from the ribbon's *device-connectivity* states (Sin internet / Puente activo / Subido).
9. **Priority.** Numeric `prio` 0–5 (5 = life-critical) is the recomputed per-record sort key; it maps to coarse **class P0–P4** (P0 highest) that drives transport eligibility, TTL, and retention (mapping in §2.7). The two scales are complementary, not competing.
10. **TTL** values are the single table in §2.7 (SOS never auto-evicted while unresolved; victim_found/missing_person 14 d; etc.). Eviction is always cache-only/local and never removes data from the network.
11. **Battery.** Four internal engine buckets (Normal/Conserve/Frugal/Lifeline at 60/30/15%) are exposed as three user modes (Completo / Ahorro / Supervivencia). SOS and self-status are never suppressed.
12. **GenLayer anchoring** is optional, edge-only, hashes-only (SHA-256, batched Merkle root), verified-tier records only, at-risk subjects excluded by default. Nothing in the field ever depends on it.

---

## 9. Adversarial Review — Open Issues & Required Fixes

This spec passed an adversarial completeness review. Its instincts are right where it matters most (honest provenance, derived trust, reach≠truth), but the review found load-bearing claims softer than the prose, **two genuine security breaks**, and convergence-critical details left unpinned. **Do not start building before the P0 list is resolved.**

### 9.0 Resolution status → see `reference/App1-P0-resolutions.md`

All seven P0 blockers now have concrete, designed resolutions (schemas, algorithms, protocol flows) in **`reference/App1-P0-resolutions.md`**.

| P0 | Status | Note |
|---|---|---|
| **P0-1** Ditto single-vendor | ✅ Resolved (contingency) | `SyncTransport`/`SignedRecordStore` abstraction + Nearby Connections / open-source-CRDT fallback. **Still requires written vendor answers** (offline-license non-expiry, identity pinning, BLE throughput) before build. |
| **P0-2** Device-confirmed forgery | ✅ **Resolved** (design; pending HW) | Adopted corroborated-location model — **§11.1**: tier-4 location requires a subject-anchored cell or **≥2 independent attestors**, else presence-only with location UNVERIFIED; subject signature re-verified on every device. Pending a Phase-0 device test. |
| **P0-3** Clock-drift / expiry | ✅ **Resolved** (design; pending HW) | Adopted round-4 fix — **§11.2**: immutable HLC + class-gated ingress gate, `BOOT_COUNT` reboot bridge, causal `sort_key`, receiver-only clocks. Pending the mandatory two-device skewed-clock regression test. |
| **P0-4** `bridged` reach | ✅ Resolved | Big-Peer-signed `bridge` attestation gossiped back into the mesh feeds `reachOf`. |
| **P0-5** store-bound vs append-only | ✅ Resolved | Hot/Warm/Cold cache eviction + signed `hide` tombstones; record bodies are never dropped from the network. |
| **P0-6** coarse-geo vs proximity | ✅ Resolved | Prefix-match containment: an attester's precise 10–11-char code promotes On-site iff its 8-char prefix equals the report's coarse cell. |
| **P0-7** map flood control | ✅ Resolved (mitigation) | 4-layer offline defense (per-key rate limit · per-cell clustering · adaptive PoW · web-of-trust weighting). Raises attacker cost; does **not** stop an unlimited-key/physical-device state adversary — human judgment remains the backstop. |

**Security review complete (design level).** After three adversarial rounds, all seven P0s are resolved in design: five outright, and P0-2 / P0-3 via the **adopted decisions in §11** (corroborated-location model; immutable-HLC round-4 fix). Those two are *design-resolved, pending hardware validation* in Phase 0 — notably a two-device skewed-clock convergence test. **No remaining design-level blockers.** Full audit trail: resolutions doc Appendices A–C + `raw-agent-outputs/`.

### P0 — must fix before building (each kills the project or a core safety/security claim)
1. **Validate Ditto in writing.** The whole app is a thin layer over Ditto. Confirm with the vendor: (a) offline license tokens that will NOT expire-brick fresh installs mid-blackout (or are field-renewable); (b) an offline identity model compatible with per-device Ed25519 trust; (c) realistic BLE-primary sync throughput on 2–4 GB Android Go. No fallback exists if these fail. (§7.3)
2. **Device-confirmed proof is forgeable as written — redesign it.** §3.5 derives the BLE-encounter beacon from the *published* subject key, so anyone can fabricate an encounter anywhere. A published key cannot give real-time unforgeable proximity. Either drop the tier or base it on a live challenge–response the subject signs with its *private* key (collapsing it into a self-cosign variant). Stop claiming `ble_encounter` is Sybil-proof. (§3.5)
3. **Bound clock drift; make expiry clock-independent.** The HLC's dominant sort key is a wall clock, so one phone set to 2035 permanently ratchets every peer's logical clock forward; and TTL/eviction uses `wall_ms`, so a fast-clock phone instantly expires live SOS. Reject/clamp out-of-window HLCs and base TTL on relative age. (§2.1, §2.4, §4.4)
4. **Resolve the `bridged`-reach contradiction.** `_meta.reach` is local-only and never synced, yet the original reporter is promised it sees `bridged`. Define a signed, synced bridge-receipt (Big-Peer-signed) feeding `reachOf`, or stop promising non-gateway devices ever see `bridged`. (§1.6, §2.4, §4.6)
5. **Kill or replace record compaction.** Dropping signed bodies (§8.1/§8.3) breaks signature re-verification (§2.4/§5.3). Pick a real store-bounding strategy (geo/age-scoped local eviction of non-P0; tombstones hide-not-delete) or low-end devices OOM.
6. **Fix coarse-geo vs proximity-proof collision.** Sensitive reports are forced to 8-char Plus Codes, but On-site requires a 10–11-char `pluscode_match` — so the privacy default silently caps at-risk reports below On-site. Allow a prefix-match variant or document the cap. (§2.1/§2.5/§5.5)
7. **Add flood control for the shared picture, independent of the tier model.** Sybil-flatness protects the *tier* but not the *map*: many fake keys posting SOS pins make the core product useless even at "Reported." Add per-key/per-cell rate limits, optional lightweight proof-of-work on creation, and auto-clustering/suppression of low-trust spikes. (§3.6/§6.4)

### P1 — fix before claiming the property
- Specify what key **revocation/rotation** do to the trust fold (today the fold ignores them). (§3.4/§5.2)
- Persist `author_seq` in mnemonic backup/restore (else restore self-equivocates → self-Disputed). (§2.7/§5.2)
- Add an **un-merge / contest** path for `subjects` (auto-merge can permanently conflate two real people's life-safety status). (§2.3)
- Re-specify `name_hash` honestly (shared salt over a tiny name-space is offline-brute-forceable; don't market it "non-reversible"). (§2.3/§5.5)
- Pin one **deterministic-CBOR** library + profile (byte-identical encoding is required for signatures/convergence). (Appendix A.3)
- Down-rate "**guarantee**" language to "prioritized best-effort," especially first-round delivery. (§2.7/§4.4)
- **Replace the dead censorship story** — domain fronting was killed industry-wide ~2018; solve how an offline phone learns rotated gateway URLs (signed endpoint lists gossiped in-mesh) or accept the bridge is exposed. (§5.6/§7.9)
- Make **Lifeline-mode SOS** real (a 31-byte BLE advert can't carry a signed SOS; define the actual connection/sync path) or stop promising it. (§4.8)
- Specify **on-site proof freshness** (reject stale on-site confirmations) and `strongestPerSigner` ordering for mixed attestation types. (§3.4/§3.5)

### The 3 riskiest assumptions (named so they are not forgotten)
1. **"Ditto delivers everything, offline, on this hardware"** — unvalidated, single closed-source vendor; if any of the three §7.3 properties fail, there is no product.
2. **"Cheap phones sustain the mesh for hours/days with no recharging despite OEM background-killers"** — the weakest physical premise; store-carry-forward and Lifeline mode are the most affected.
3. **"Proximity = truth, and our strongest 3rd-party proof is unforgeable"** — a *single* present liar promotes a false report to On-site, and Device-confirmed is forgeable as written; the realistic apex tier for the common missing-person case is single-attacker-forgeable.

### Concrete dependency pins (supersede the §7.12 placeholders)
Verified current at spec time:
- `com.ditto:ditto-kotlin:5.0.2` · `org.maplibre.gl:android-sdk:13.3.1` (replaces the `:11.+` placeholder) · `com.google.openlocationcode:openlocationcode` · `com.google.android.gms:play-services-location` · ZXing / ML-Kit for QR.
- Build targets: **minSdk 24, compileSdk 36, JDK 17, Kotlin + Jetpack Compose** (Ditto Kotlin SDK 5 requirements).

## 10. Provenance
Assembled from a 10-agent design workflow (8 facet designers → assembler → adversarial critic) and cross-checked against two independent full-spec drafts — one bold/edge-case lens, one pragmatic/buildable lens. The pinned versions above came from the pragmatic draft; the duress / plausible-deniability and fuzzy-location hardening (reflected in §5) came from the bold draft. The §9 issue list is the critic's verdict, distilled.

## 11. Adopted Security Decisions (v1.1 — supersedes the round-3 designs)

After **three adversarial verification rounds** (resolutions doc, Appendices A–C), the two life-safety trust mechanisms are resolved at the **design level** by the decisions below. These are **authoritative** and supersede the originally-drafted §3.5 Device-confirmed proof and the §2/§4 clock-and-expiry handling. The only remaining work is **implementation + a real-hardware regression test** (Phase 0), not further design.

### 11.1 Device-confirmed tier — adopted model (supersedes §3.5)

**Crypto base (A.1):** the proof carries the subject's `response_payload` + `subject_sig`; **every device re-verifies** `Ed25519_verify(subject_pubkey, canonical(response_payload), subject_sig)`, binds `response_payload.attestor_id == attestation.claimer_id`, dedups `challenge_nonce` per subject, and includes `attestor_rssi` *inside* the signed payload (so it can't be inflated post-hoc).

**Location is corroborated-best-effort, never asserted.** Final verification proved that single-party location is *not self-provable* offline (a lone attestor controls both sides of any cell check, and the subject usually has no GPS to refute it). Therefore tier-4 **location** is granted only when:
- **(a) Subject-anchored** — the subject has its own location fix and signs its **own** coarse cell; the attestation's cell is validated against the *subject-signed* cell (the attestor cannot move it); **or**
- **(b) Corroborated** — **≥2 distinct, independent attestor keys** report the same coarse cell for the subject.

Otherwise the encounter confirms **presence/identity only**, at a lower tier, with location explicitly labeled **UNVERIFIED** in the UI. This keeps the tier consistent with the system creed — *trust is computed, never asserted*.
*Residual (accepted, disclosed in UI):* physics-level relay/wormhole of a genuine encounter.

### 11.2 Clock & expiry — adopted round-4 fix (supersedes §2.1/§2.4/§2.7/§4.3/§4.4)

1. **HLC is immutable — never clamped or mutated.** Store/sort/replicate the author's signed HLC, byte-identical on every device. The ±30 min drift bound is a pure **ingress accept/reject gate**, **class-gated**: P0/P1 are *always* accepted (never future-rejected); P2/P3 may be quarantined when `|author_wall − local| > 30 min`. The local HLC *issuer* bounds `wall_ms` against the device's own clock; an inbound record never ratchets the local issuer (advance the causal/counter component only).
2. **Expiry uses the receiver's own clocks only** (author `wall_ms` is display-only, forbidden from all security logic). In-session age = monotonic `elapsedRealtime` delta; the **reboot bridge** is `BOOT_COUNT`-detected and advances age by `clamp(now_wall − last_app_start_wall, 0, 12h)`, rejecting any delta exceeding monotonic evidence; absolute fallback ≤ 1.2× TTL. Cold-boot (epoch-1970 / unusable RTC) fallback is **class-dependent**: at-risk/privacy records **evict** (protect privacy), SOS records **retain** (never silence).
3. **Replication is clock-independent.** No `expires_at > now()` on subscriptions; P0/P1 always replicate; lower classes use a relative-age cursor on **full HLC string order** (inbound-dedup only).
4. **`sort_key = (author_id, author_seq, hlc_counter)`** for same-author causal order; `wall_ms` only as a cross-author tiebreak.
5. **`ttl_extend`** restricted to the author or a proximity-verified attester; numeric cap `min(orig + CAP, max(valid extends))`, CAP ≈ +30 d, reject-at-ingress.
6. **Privacy:** journal monotonic `received_at_elapsed` + boot-id; if `received_at_wall` is needed, coarse-bucket to 15 min.

**Mandatory before ship:** a convergence regression test on **two skewed-clock honest devices**.

### 11.3 Security review status

Design-level review **complete** after three adversarial rounds. Both items are **resolved in design, pending hardware validation** (Phase 0). The other five P0s (§9.0) stand resolved. **No remaining design-level blockers.**

## 12. Multi-Platform Delivery & API Seam (summary → full design in `Baran-MultiPlatform-and-API.md`)

Baran ships to **three targets that share one data model but not one runtime**. Full design is in the companion addendum `planning/Baran-MultiPlatform-and-API.md`; the load-bearing decisions:

### 12.1 The honest split
The offline phone-to-phone mesh (BLE / Wi-Fi Aware / Wi-Fi Direct / Nearby / Ditto P2P) is **native-mobile-only** — no browser or desktop can join it.
- **Android APK = the offline field mesh node** (everything in §1–§11; works with zero signal and zero infrastructure).
- **Desktop + Mobile Web = online-only coordinator / viewer consoles** that see the field *indirectly* through the cloud API and can never join the mesh. A record still `in_mesh` (not yet bridged) is **invisible to them by design** — they only ever see `bridged`/`anchored` records, so a remote responder never chases a signal that hasn't propagated.

### 12.2 Stack — hybrid (keep native for the mesh; share the contract, not the UI)
| Target | Stack | Ditto role |
|---|---|---|
| **Android APK** | native Kotlin + Jetpack Compose + Ditto Kotlin SDK | full mesh node (this spec, unchanged) |
| **Desktop** (Win/macOS/Linux) | **Tauri 2** + React 19/TypeScript (same web codebase) | Ditto JS as a Big-Peer **cloud client** |
| **Mobile Web / PWA** | React 19/TypeScript + service worker | Ditto JS as a Big-Peer **cloud client** |

Rejected: *one-runtime-everywhere* — Compose-Multiplatform **web is beta** (too risky for a first-class public web target); **Ditto JS in a browser is cloud-only, never a mesh node**; Capacitor-wrapping the APK would bury the safety-critical mesh behind a WebView. The genuinely shared layer is the **canonical record schema + the deterministic trust fold + the reach ladder + the crypto envelope**, authored once and **locked by cross-language test vectors** (`baran-test-vectors`) so every target computes identical trust from identical records. The coupling point is the **data-API contract + test vectors**, not a shared binary.

### 12.3 API seam (the attach-later backend)
A **REST + WebSocket API in front of Ditto Cloud** (not raw Ditto exposed to clients — online clients need auth, roles, moderation, redaction, rate limits). Flow: APK → mesh → gateway → Ditto Cloud → API → desktop/web. Coordinator tasking is **signed locally with the coordinator's Ed25519 key**, POSTed, and re-injected into the mesh by the next gateway — tagged `origin: online` and treated as **lower-trust until verified in-zone**. Records carry an `origin_plane` field (`field_mesh` / `online_web` / `desktop_console` / `api_import`). Contract sketch (`/records`, `/incidents`, `/reports`, `/verifications`, `/exports`, `WS /events`) is in the addendum.

### 12.4 Spec deltas
- **§1** gains the explicit planes: **Field Mesh Plane** (APK only) and **Online Coordination Plane** (desktop + web), bridged `Android Ditto mesh ↔ Ditto Cloud ↔ Baran API ↔ web/desktop`.
- **§6** gains the **desktop coordinator console** (multi-pane map + incident queue + provenance/verification panel + exports) and the **mobile-web viewer/reporter** (family lookup, remote report submission), both distinct from the rescuer field UI, with visible **origin/trust badges**.
- **§7** stack becomes the hybrid above (native Kotlin APK kept; React/TS + Tauri 2 added for the online surfaces).
- **§8** build/distribution adds three artifacts: **signed APK/AAB** · **Tauri desktop installers** (.dmg/.msi/AppImage, signed/notarized) · **PWA static deploy** (CDN).

### 12.5 Phased delivery
**Phase 0** scaffold + keys + Ditto offline validation → **Phase 1** the **APK mesh core** (the irreducible value; *freeze the record contract + test vectors here*) → **Phase 1b** desktop (wrap the web app in Tauri) → **Phase 2** the real cloud API + web/PWA on the seam → **Phase 3** battery / range / carry-forward robustness → **Phase 4** censorship spine + hardening. **The APK comes first, always** — it is the hardest part and the reason the product exists; the online surfaces are meaningless until the field record contract is correct.

→ **The full execution roadmap is in `planning/Baran-Implementation-Plan.md`** — monorepo layout, Phase 0–4 workstreams with tasks/deliverables/acceptance/tests, per-phase exit gates, the cross-cutting testing harness, CI/CD per target, the dependency/risk register, and the milestone sequencing matrix.
