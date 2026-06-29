const BASE = '/v1';

// Bearer token (set after challenge-response auth against the real backend).
// Stays null against the zero-auth Phase-1 stub, which accepts unauthenticated posts.
let authToken: string | null = null;
export function setAuthToken(t: string | null): void {
  authToken = t;
}
export function getAuthToken(): string | null {
  return authToken;
}

/** Request an auth challenge. Returns the nonce, or null if the backend has no
 *  auth endpoint (the stub) — callers then fall back to unauthenticated posting. */
export async function authChallenge(deviceId: string): Promise<string | null> {
  const res = await fetch(`${BASE}/auth/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`challenge ${res.status}`);
  return (await res.json()).nonce;
}

export async function authVerify(payload: {
  device_id: string;
  pub_b64u: string;
  sig: string;
}): Promise<{ token: string; role: string }> {
  const res = await fetch(`${BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`auth ${res.status}`);
  return res.json();
}

export interface ReachInfo {
  level: string;
}

export interface RecordMeta {
  reach: ReachInfo;
  tier: number;
  tierName: string;
  verified: boolean;
  disputed: boolean;
  locationVerified: boolean;
  origin?: string;
  received_at?: string;
}

export interface VenRescateRecord {
  record: Record<string, unknown>;
  meta: RecordMeta;
}

export interface Incident {
  id: string;
  cell: string;
  type: string;
  count: number;
  maxTier: number;
  maxReach: string;
  disputed: boolean;
}

export async function fetchRecords(params?: Record<string, string>): Promise<VenRescateRecord[]> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(`${BASE}/records${qs}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function fetchRecord(
  id: string
): Promise<{ record: VenRescateRecord['record']; meta: RecordMeta; attestations: VenRescateRecord[]; fold: RecordMeta }> {
  const res = await fetch(`${BASE}/records/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function fetchIncidents(): Promise<Incident[]> {
  const res = await fetch(`${BASE}/incidents`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

/** POST a fully-signed record (coordinator-authored). The server verifies the
 *  signature against the author's registered key and tags unknown keys online-origin. */
export async function postRecord(signed: Record<string, unknown>): Promise<VenRescateRecord> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}/records`, {
    method: 'POST',
    headers,
    body: JSON.stringify(signed),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json();
}

/** Register the coordinator's public key so the server's fold can verify its
 *  signatures. The server re-derives the device_id from the key (anti-spoof). */
export async function registerCoordinator(
  pubKeyB64u: string
): Promise<{ device_id: string }> {
  const res = await fetch(`${BASE}/coordinators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pub_b64u: pubKeyB64u }),
  });
  if (!res.ok) throw new Error(`register failed ${res.status}`);
  return res.json();
}

export function connectWebSocket(
  onEvent: (event: string, data: unknown) => void,
  onStatus?: (connected: boolean) => void
): () => void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let ws: WebSocket;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function open() {
    ws = new WebSocket(`${protocol}//${location.host}/v1/ws`);
    ws.onopen = () => onStatus?.(true);
    ws.onmessage = (msg) => {
      try {
        const { event, data } = JSON.parse(msg.data);
        onEvent(event, data);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      onStatus?.(false);
      if (!closed) retry = setTimeout(open, 3000);
    };
    ws.onerror = () => ws.close();
  }
  open();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    ws?.close();
  };
}
