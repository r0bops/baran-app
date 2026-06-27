// Minimal offline Open Location Code (Plus Code) decoder.
// Decodes a full or coarse (8-char) code to its cell CENTER {lat,lng}.
// Pair-level precision (~14 m at 10 digits, ~275 m at 8 digits) — enough to
// position pins on a schematic offline map without any network/basemap tiles.
const ALPHABET = '23456789CFGHJMPQRVWX';

export interface LatLng {
  lat: number;
  lng: number;
  /** approximate cell size in degrees (for jitter/precision display) */
  cell: number;
}

export function decodePlusCode(raw?: string | null): LatLng | null {
  if (!raw) return null;
  const code = raw.replace('+', '').replace(/0+$/, '').toUpperCase();
  if (code.length < 2) return null;

  let lat = -90;
  let lng = -180;
  let res = 20; // degrees per unit at the current pair
  let lastRes = 20;
  let i = 0;
  for (; i + 1 < code.length + 1 && i < 10 && i + 1 <= code.length; i += 2) {
    const latDigit = ALPHABET.indexOf(code[i]);
    const lngDigit = ALPHABET.indexOf(code[i + 1]);
    if (latDigit < 0 || lngDigit < 0) return null;
    lat += latDigit * res;
    lng += lngDigit * res;
    lastRes = res;
    res /= 20;
  }
  // center of the last decoded cell
  return { lat: lat + lastRes / 2, lng: lng + lastRes / 2, cell: lastRes };
}

/** Coarse (sensitive) 8-char cell from a fuller code, mirroring the contract. */
export function toPlusCodeCoarse(code?: string | null): string | null {
  if (!code) return null;
  const noPlus = code.replace('+', '');
  return noPlus.length >= 8 ? noPlus.substring(0, 8) : noPlus;
}
