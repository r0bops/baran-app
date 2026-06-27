# Baran v1 Record Contract (Phase-0 frozen)

This is the **frozen, authoritative** definition of the Baran record contract for Phase 0/1. The
**`../test-vectors/*.json` files are the source of truth** — `baran-core` (Kotlin) and `baran-core-ts`
(TypeScript) MUST reproduce every signature, `content_hash`, and fold `expected` output in those files,
byte-for-byte. This document explains *what* the vectors encode; if this prose and the vectors ever
disagree, **the vectors win** (and fix this doc).

The reference implementation that produced the vectors is `../tools/gen-vectors.js` (zero-dependency
Node). Read it — it is short and exact.

---

## 1. Canonicalization (the byte-level contract)

Signing bytes = **deterministic JSON** of the record:
- recursively **sort object keys** (UTF-8 code-point order),
- **compact** (no whitespace),
- **UTF-8** encoded,
- **integers only** — no floats anywhere (so canonicalization is unambiguous). Geo precision is carried
  as Plus Code strings, never as float lat/lon, in v1.

> **Frozen choice & rationale.** v1 signs **canonical JSON (an RFC-8785/JCS subset)**, not CBOR. The field
> spec's Appendix A aspires to deterministic CBOR/COSE, but CBOR determinism is a known cross-language
> footgun (flagged in the P0 critique). Canonical JSON is trivially reproducible in Kotlin and TS with
> mature libs and lets us ship *real* vectors now. The schema is CBOR-ready; migrating the wire encoding
> later does not change the logical contract. **Do not change the v1 canonicalization** without
> regenerating all vectors.

## 2. Crypto envelope

- **Signature:** Ed25519 over `canonical(record \ {sig, content_hash})`. Field `sig` = base64url (no pad).
- **`content_hash`:** SHA-256 hex of the *same* canonical bytes (i.e. of the record minus `sig` and
  `content_hash`). **v1 uses SHA-256**; the spec's long-term target is BLAKE3 — a deliberate v1
  simplification for zero-dependency reproducibility. `content_hash` is a derived dedup key; it is **not**
  part of the signed bytes.
- **Identity / `device_id`:** base64url of the first 12 bytes of `SHA-256(ed25519_public_key)`.
- **Public key:** raw 32-byte Ed25519 key, base64url (`keys.json` lists every test identity + its seed,
  so implementations can derive the exact same keys deterministically).
- **Sealing (later phases):** X25519 + XChaCha20-Poly1305 for team-only payloads — out of scope for the v1
  vectors.

## 3. Record kinds & fields

Two synced kinds in v1 (`identities` and `subjects` collections come in Phase 1 — see the spec §2).

### 3.1 `report` (kind = `"report"`)
Immutable, signed, append-only. Fields (all signed except `content_hash`/`sig`):

| field | type | notes |
|---|---|---|
| `schema_version` | int | `1` |
| `kind` | string | `"report"` |
| `id` | string | `"<author_id>:<author_seq>"` |
| `author_id` | string | the signer's `device_id` |
| `author_seq` | int | per-author monotonic counter (equivocation detector) |
| `type` | string | `sos` \| `victim_found` \| `need` \| `hazard` \| `missing_person` \| `status` |
| `prio` | int | priority class 0–5; **0 = life-critical (P0)** |
| `created_wall_ms` | int | author wall clock — **display only**, never gates replication/expiry |
| `hlc` | string | `"<wall_ms>.<counter>.<node>"` — see clock rules below |
| `payload` | object | type-specific (strings/ints/arrays only); minimize PII |
| `subject_id` | string? | for `missing_person`/about-a-person reports: the subject's `device_id` |
| `content_hash` | string | derived (SHA-256 hex) — not signed |
| `sig` | string | Ed25519 base64url — not part of signed bytes |

### 3.2 `attestation` (kind = `"attestation"`)
The **only** way a report's status evolves. Signed, append-only.

| field | type | notes |
|---|---|---|
| `schema_version` | int | `1` |
| `kind` | string | `"attestation"` |
| `id` | string | `"<claimer_id>:a:<claimer_seq>"` |
| `claimer_id` | string | the signer's `device_id` |
| `claimer_seq` | int | per-claimer monotonic counter |
| `target_report_id` | string | the report `id` this attests to |
| `target_content_hash` | string | binds to that exact report body |
| `att_type` | string | `corroborate` \| `on_site` \| `device_confirm` \| `self_confirm` \| `affirm` \| `resolve` \| `dispute` |
| `fact` | string | the claim, e.g. `still_needs_help` \| `found_safe` \| `present` \| `false` |
| `prio` | int | inherits the target's class |
| `hlc` | string | as above |
| `proof` | object? | proximity proof (see §4) |
| `content_hash`,`sig` | string | as above |

## 4. Proximity proofs

- **`on_site`** proof: `{ type:"gps"|"pluscode", match:true, plus_code8:"<8-char cell>" }`. `match:true`
  means the attester's own precise location fell inside the report's coarse cell (prefix containment).
- **`device_confirm`** proof (the P0-2 design): a `ble_encounter_challenge` carrying the subject's signed
  `response_payload` + `subject_sig`:
  ```
  proof = {
    type: "ble_encounter_challenge",
    own_plus_code8: "<attestor's coarse cell>",
    response_payload: { subject_id, attestor_id, challenge_nonce, attestor_plus_code, subject_rssi, timestamp_ms, timestamp_response_ms },
    subject_sig: "<Ed25519 by the SUBJECT over canonical(response_payload)>"
  }
  ```
  See `fold-vectors.json` scenarios `S4a`–`S4d` for the exact bytes.

## 5. Verification fold (the trust logic)

Tiers: `1 reported < 2 corroborated < 3 on_site < 4 device_confirmed < 5 self_confirmed`; `disputed` is an
orthogonal overlay. The fold is **deterministic and identical on every device**. Inputs: one report + the
set of attestations targeting it + the subject's `device_id` (if any). Rules (exactly as in
`gen-vectors.js`):

1. **Signature gate.** Drop the report and any attestation whose signature does not verify. Free
   (unknown) keys are allowed; *forgeries* are not.
2. **`verified` flag.** True iff the original reporter signed an `affirm`/`resolve` on their own report.
3. **Corroborated (2).** ≥ 2 **distinct, independent** keys (≠ the reporter) assert the same primary
   fact. *(Sybil-flat: one key attesting twice is still one key → vector `S7`.)*
4. **On-site (3).** ≥ 1 `on_site` attestation with a valid proximity proof (`proof.match === true`).
5. **Device-confirmed (4) — P0-2 corroborated-location.** A `device_confirm` whose `subject_sig` verifies
   against the **subject's** public key (binding `subject_id` + `attestor_id`). Presence is then proven,
   but **location** is confirmed (tier 4, `location_verified=true`) only if **(a)** the subject signed its
   *own* cell (subject-anchored: `response_payload.attestor_plus_code === proof.own_plus_code8`) **or**
   **(b)** ≥ 2 independent attestors agree on the same cell. Otherwise it is **presence-only** —
   `location_verified=false`, tier capped at On-site. A forged/absent `subject_sig` yields **no**
   device-confirm (vector `S4d`).
6. **Self-confirmed (5).** The subject's own device signs a `self_confirm`.
7. **Disputed.** Independent valid attestations assert contradictory primary facts (e.g. `found_safe` vs
   `still_needs_help`) → set the `disputed` overlay; never auto-resolve.

The fold returns `{ tier, tierName, verified, disputed, location_verified }`. See `fold-vectors.json` for
the 11 frozen scenarios and their expected outputs.

## 6. Clock & HLC rules (P0-3 round-4)

- **Sort key = `(author_id, author_seq, hlc_counter)`.** `wall_ms` is **display-only** and MUST NOT gate
  replication, ordering, or expiry.
- **HLC is never mutated/clamped.** Ingress drift handling is a class-gated *accept/reject* gate: P0/P1
  are always accepted; P2/P3 may be quarantined when `|author_wall − local| > 30 min`.
- **TTL** uses the receiver's monotonic clock (`elapsedRealtime` deltas) + a `BOOT_COUNT` reboot bridge —
  never author `wall_ms`. A skewed author clock **cannot** suppress a P0 SOS (vector
  `clock-vectors.json → p0_future_clock_not_suppressed`).

See `docs/04-P0-Security-Resolutions.md` Appendix B/C and field-spec §11 for the full derivation.

## 7. What "done" means for the shared core

`baran-core` (Kotlin) and `baran-core-ts` (TypeScript) are **done** when a test that loads
`../test-vectors/*.json`:
- re-derives every `keys.json` identity from its seed,
- re-signs each `crypto-vectors` record and gets the **same `sig` and `content_hash`**,
- verifies the valid case `true`, the tampered + wrong-key cases `false`,
- runs the fold on every `fold-vectors` scenario and gets the **exact** `expected` object,
- and both languages agree with each other and with the JSON.

This cross-language vector test is the **Phase-0 exit gate** and runs in CI on every change.
