import { stripInvisible } from "../lib/sanitize.ts";
import type { Vehicle } from "../lib/vehicle.ts";
import { applyHardFilters } from "../matching/filters.ts";
import type { Profile } from "../matching/profile.ts";
import { markGone, seenId, upsertVehicle, type StoreData } from "./store.ts";

export interface IngestOptions {
  now?: Date;
  ufClp?: number | null;
  /** Portals this run scanned; defaults to the portals present in the input. */
  scannedPortals?: string[];
}

export interface IngestSummary {
  new: number;
  updated: number;
  vetoed: number;
  flagged: number;
  gone: number;
}

/** Recursively strip invisible characters from every string (listing text is data, never instructions). */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === "string") return stripInvisible(value) as T;
  if (Array.isArray(value)) return value.map(sanitizeDeep) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeDeep(v)])) as T;
  }
  return value;
}

/**
 * Apply hard filters to scanned listings, merge survivors into the store and
 * mark unseen listings of the scanned portals as gone. Mutates `data`.
 */
export function ingest(data: StoreData, vehicles: Vehicle[], profile: Profile, opts: IngestOptions = {}): IngestSummary {
  const now = opts.now ?? new Date();
  const summary: IngestSummary = { new: 0, updated: 0, vetoed: 0, flagged: 0, gone: 0 };
  const seen = new Set<string>();

  for (const raw of vehicles) {
    const v = sanitizeDeep(raw);
    const result = applyHardFilters(v, profile, opts.ufClp);
    if (!result.pass) {
      summary.vetoed++;
      continue;
    }
    if (result.flags.length > 0) summary.flagged++;
    const { key, status } = upsertVehicle(data, v, { now, ufClp: opts.ufClp ?? profile.ufClp, flags: result.flags });
    seen.add(seenId(key, v.portal));
    summary[status]++;
  }

  const scanned = new Set(opts.scannedPortals ?? vehicles.map((v) => v.portal));
  summary.gone = markGone(data, scanned, seen, now);
  return summary;
}
