# Baran — Desktop coordinator (Phase 1b)

Tauri 2 desktop wrapper around the **same** React coordinator console
(`apps/coordinator-web`) — one codebase, build-time breakpoints. Online-only;
never joins the radio mesh.

## What's implemented

- **3-column desktop layout** (in the shared app, `App.tsx` → `useWide()`): on wide
  viewports (≥1200px, always true on desktop) the console becomes
  **Incidentes (rail) · Mapa/Registros (centro) · Detalle + acciones (panel)**, all
  visible at once. Narrow viewports keep the tabbed 2-pane layout. Verified by
  screenshot against the real backend.
- **OS-keychain key store**: the coordinator's Ed25519 seed is stored in the native
  keychain (macOS Keychain / Windows Credential Manager / Linux SecretService) via
  Rust commands `keychain_get` / `keychain_set` (`src-tauri/src/lib.rs`, `keyring`
  crate). The frontend (`lib/secureStore.ts`) uses it when running in Tauri
  (`withGlobalTauri`) and falls back to `localStorage` in a plain browser — so the
  private key never leaves the device and the web build is unaffected.
- **Signed multi-platform CI** (`.github/workflows/desktop-build.yml`): builds
  `.deb`/`.rpm`/AppImage (Linux), `.msi`/NSIS (Windows), `.dmg` (macOS) via
  `tauri-action`, with code-signing + notarization wired to repo secrets and a
  draft GitHub Release on `v*` tags.

## Why it isn't built/run here

Tauri on Linux links **webkit2gtk** (and the build pulls the Rust toolchain crates);
neither is available in this environment, so the GUI can't be compiled or launched
here. The visible desktop UX — the responsive 3-column layout — is verified through
the shared web app it wraps.

## Build (on a machine with the toolchain)

```bash
# Linux deps: libwebkit2gtk-4.1-dev libsecret-1-dev librsvg2-dev patchelf
cd apps/coordinator-desktop
npm install
npx tauri build        # signed installers in src-tauri/target/release/bundle/
npx tauri dev          # run against the live coordinator-web dev server
```

## Residual (needs accounts/certs)

- macOS notarization needs an Apple Developer account ($99/yr) — dev builds use
  `--skip-notarization`.
- Windows code-signing certificate (or Azure Trusted Signing) — self-signed dev
  builds show an install warning.
