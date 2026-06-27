# Baran — Execution Checklist

Work top to bottom. Each item references the workstream in `docs/01-Implementation-Plan.md`. Do not start
a phase until the previous phase's **EXIT GATE** is green. `[HW]` = needs physical Android devices (stop
and hand back). `[EXT]` = external dependency (Ditto/cert/account).

---

## Phase 0 — Foundations, contracts, security gates
- [ ] Scaffold the monorepo: `apps/android` (Gradle), `apps/coordinator-web` (React/Vite), `apps/coordinator-desktop` (Tauri 2), `packages/*`, `tooling/`, CI workflows. Pin every version (no `+`).
- [ ] `packages/baran-record-schema`: encode the v1 schema (`contract/v1-record-contract.md` §3) + canonical JSON serializer (§1).
- [ ] `packages/baran-crypto-contract`: Ed25519 sign/verify + `device_id` + content_hash (§2), in **both** Kotlin and TS.
- [ ] `packages/baran-verification-fold`: the deterministic fold (§5) **including** the P0-2 corroborated-location rule and Sybil-flatness, in **both** languages.
- [ ] Time/HLC module: causal `sort_key`, class-gated ingress accept/reject, monotonic-TTL + `BOOT_COUNT` reboot bridge, no `expires_at > now()` anywhere (§6 + P0-3).
- [ ] `packages/baran-test-vectors`: import `test-vectors/*.json`; write the **cross-language vector test** (re-derive keys from seeds, re-sign → equal `sig`/`content_hash`, verify true/false cases, run the fold → exact `expected`). Green in Kotlin AND TS.
- [ ] CI `convergence-gate`: run the vector test in both languages on every PR; block merge on mismatch.
- [ ] `[EXT]` Send the **Ditto vendor questions** (plan §10 / spec P0-1): offline license non-expiry, identity pinning to our Ed25519 trust, BLE throughput on Android Go. Record answers or the fallback decision.
- [ ] `[HW]` Stand up the device bench (≥4 phones incl. 2 low-end 2–4 GB).
- [ ] **EXIT GATE:** cross-language vectors pass in CI; Ditto licensing answered (or fallback committed); a hand-signed record on one phone verifies on another (airplane mode).

## Phase 1 — APK mesh core (deepest)
- [ ] W1.1 Schema/crypto/vectors wired into the Android app module (reuse `baran-core`).
- [ ] W1.2 Ditto integration behind `SyncTransport`/`SignedRecordStore`; subscriptions are **class-gated, no wall-clock**; dedup/priority/TTL; 4-bucket duty cycle. Verify signatures **before** merge.
- [ ] W1.2b `NearbyTransport` fallback spike (hedge against Ditto answers).
- [ ] W1.3 The verification fold in-app + the P0 round-4 fixes (Device-confirmed corroborated-location; immutable-HLC). Must reproduce `S4*` and `clock` vectors.
- [ ] W1.4 The 6 Compose rescuer screens (Mapa, Señales, Crear, Detalle, Yo, Ajustes) + the create-SOS and proximity-attestation flows; honest reach/tier badges; Spanish-first.
- [ ] W1.5 Offline map: MapLibre native + bundled Caracas/La Guaira PMTiles + Plus Codes; zero network for base map.
- [ ] W1.6 Opportunistic gateway bridge + store-carry-forward; pull signed replies/bridge receipts back into the mesh.
- [ ] API seam **stub** that serves real signed records + signed coordinator replies (no fake data).
- [ ] Minimal coordinator PWA (map/list/detail) against the stub; coordinator can sign a `status` reply with its own Ed25519 key.
- [ ] `[HW]` **EXIT GATE — the 4-phone demo:** offline SOS on A → carry-forward A→B→C → C adds on-site proof → D gets signal and bridges up → coordinator PWA sees it + signs a reply → D re-injects → A/B/C receive it; all devices compute identical tier/reach; a skewed-clock phone does not suppress P0 or mutate HLC.

## Phase 1b — Desktop wrapper
- [ ] Wrap the coordinator React app in Tauri 2; 3-column desktop layout; OS-encrypted coordinator key store.
- [ ] `[EXT]` signing/notarization for installers (where available).
- [ ] **EXIT GATE:** signed desktop builds (Win/macOS/Linux) show the same bridged records and author the same signed replies as the PWA.

## Phase 2 — Cloud API seam + full trust depth
- [ ] All 5 tiers + dispute/resolve/retract/ttl_extend wired to real data; all proximity proof types (GPS, Plus Code prefix-containment, QR/NFC, subject cosign, BLE challenge-response).
- [ ] Implement the REST + WebSocket API (records/incidents/reports/verifications/exports + `WS events`) in front of Ditto Cloud (or the chosen bridge). Swap the stub for the real API — client code unchanged except endpoint/auth.
- [ ] Big-Peer/API-signed `bridge` receipts (pinned key) → `bridged` reach. Coordinator auth/RBAC; `origin:online` lower-trust tagging.
- [ ] Web/PWA + desktop production coordinator features; never render `in_mesh` records.
- [ ] `[HW]` **EXIT GATE:** end-to-end field↔coordinator↔field on real devices; **two-device skewed-clock convergence test passes**; security replay/tamper/forgery suite passes; all targets agree on the vector trust outputs.

## Phase 3 — Field robustness
- [ ] `[HW]` Duty-cycle tuning (Normal/Conserve/Frugal/Lifeline) + foreground service surviving Doze/OEM killers.
- [ ] `[HW]` BLE range/density + 6-device store-carry-forward mule chain across a ~2 km gap.
- [ ] Hot/Warm/Cold store bounding with signed `hide` tombstones (never drop signed bodies); P0 never evicted before resolve+bridged.
- [ ] Flood control: per-key/per-cell rate limits + adaptive PoW + clustering (P0 skips PoW).
- [ ] Reboot/skew TTL validation; `ttl_extend` authorization + cap.
- [ ] **EXIT GATE:** 6-device drill converges; low-end phone no-OOM under load; ≥72 h standby; skewed-clock convergence repeats after reboot.

## Phase 4 — Hardening & ops
- [ ] Coercion spine: duress PIN, decoy state, quick-wipe, stealth icon, key rotation/revoke.
- [ ] Key recovery + `author_seq` backup (no self-equivocation on restore).
- [ ] Online RBAC + redaction; CSV/GeoJSON export preserving provenance + signatures.
- [ ] Replace dead domain-fronting with signed endpoint-list gossip; optional GenLayer edge anchoring (hashes only, non-blocking, last).
- [ ] Full es-VE i18n + low-literacy/voice/icon flows; crash reporting that respects PII; update channels.
- [ ] `[EXT]` **EXIT GATE:** signed reproducible release artifacts on all 3 targets; duress/quick-wipe pass; Spanish offline field review; ops runbook (Ditto/API outage, key rotation, bridge compromise).
