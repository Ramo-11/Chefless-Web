/**
 * Shared timezone helpers. The client sends its current UTC offset (Dart's
 * `DateTime.now().timeZoneOffset.inMinutes`, e.g. `-240` for New York DST) on
 * requests that need to reason about the user's local day or local wall-clock
 * time. Computed device-side, so it is always DST-correct for "now".
 */

/**
 * Sanitises a raw client-supplied offset (minutes east of UTC). Returns
 * `undefined` for missing / non-finite / out-of-range values so bad client
 * data can never wedge downstream math. Clipped to `-14h..+14h` — no inhabited
 * zone is outside Etc/GMT±14.
 */
export function normalizeOffset(
  raw: number | null | undefined
): number | undefined {
  if (raw == null || !Number.isFinite(raw)) return undefined;
  const clipped = Math.round(raw);
  if (clipped < -840 || clipped > 840) return undefined;
  return clipped;
}

/**
 * Reads `timezoneOffsetMinutes` from an Express query string and parses it to a
 * number, or `undefined` when absent / unparseable. Mirrors the parser used by
 * the AI routes so every GET that needs the offset reads it the same way.
 */
export function offsetFromQuery(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}
