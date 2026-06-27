// baran-core-ts: canonical JSON serializer
// Mirrors gen-vectors.js canon() exactly

export function canon(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canon((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('non-integer number in record: ' + value);
    return String(value);
  }
  return JSON.stringify(value);
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canon(value));
}
