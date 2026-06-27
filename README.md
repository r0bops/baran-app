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

## Status

In active design — not yet released.
