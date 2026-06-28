// The normalized point shape every overlay source produces (see sourceEngine.ts).
export interface OverlayPoint {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  color: string; // per-point marker colour
  radius: number;
  sourceId: string;
  sourceLabel: string;
  source_url?: string;
}
