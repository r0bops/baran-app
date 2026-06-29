// Local database (IndexedDB) for external API responses, so the coordinator keeps
// working OFFLINE with the last-known data. Every successful fetch is cached; when a
// fetch fails (offline / server down), the cached copy is served instead.
const DB_NAME = 'venrescate-cache';
const STORE = 'kv';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

export async function cacheSet(key: string, value: unknown, ts: number): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ value, ts }, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* cache is best-effort */
  }
}

export async function cacheGet<T>(key: string): Promise<{ value: T; ts: number } | null> {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const tx = d.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => res((r.result as { value: T; ts: number }) ?? null);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return null;
  }
}

export interface Cached<T> {
  data: T;
  fromCache: boolean;
  ts: number | null; // when the data was fetched/cached
}

/** Fetch and cache; on failure, fall back to the cached copy (or `empty`). */
export async function fetchCached<T>(key: string, fetcher: () => Promise<T>, empty: T): Promise<Cached<T>> {
  try {
    const data = await fetcher();
    const ts = Date.now();
    cacheSet(key, data, ts);
    return { data, fromCache: false, ts };
  } catch {
    const c = await cacheGet<T>(key);
    return c ? { data: c.value, fromCache: true, ts: c.ts } : { data: empty, fromCache: false, ts: null };
  }
}
