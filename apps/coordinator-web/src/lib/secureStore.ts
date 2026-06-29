// Coordinator key persistence.
// On desktop (Tauri) the seed lives in the OS keychain (macOS Keychain / Windows
// Credential Manager / Linux SecretService) via Rust commands. In a plain browser
// it falls back to localStorage. The private key never leaves the device.
const LS_KEY = 'venrescate.coordinator.seed';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function tauriInvoke(): Invoke | null {
  const t = (window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__;
  return t?.core?.invoke ?? null;
}

export async function loadSeedHex(): Promise<string | null> {
  const invoke = tauriInvoke();
  if (invoke) {
    try {
      const seed = (await invoke('keychain_get')) as string | null;
      if (seed) localStorage.setItem(LS_KEY, seed); // mirror for synchronous reads this session
      return seed;
    } catch {
      /* fall through to localStorage */
    }
  }
  return localStorage.getItem(LS_KEY);
}

export async function saveSeedHex(hex: string): Promise<void> {
  localStorage.setItem(LS_KEY, hex);
  const invoke = tauriInvoke();
  if (invoke) {
    try {
      await invoke('keychain_set', { seed: hex });
    } catch {
      /* keychain unavailable; localStorage mirror still holds it */
    }
  }
}

export function isDesktop(): boolean {
  return tauriInvoke() !== null;
}
