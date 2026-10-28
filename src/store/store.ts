import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { dedupeKey } from "../lib/key.ts";
import { VehicleSchema, type Vehicle } from "../lib/vehicle.ts";
import { effectivePriceClp } from "../matching/filters.ts";

export const DEFAULT_STORE_PATH = "data/seen_vehicles.json";

const SourceSchema = z.object({
  portal: z.string(),
  url: z.string(),
  priceClp: z.number().nullable(),
  lastSeen: z.string(),
  /** True when a re-scan of this portal no longer returned the listing. */
  gone: z.boolean().optional(),
});

const AiSchema = z.object({
  score: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
});

const DimensionSchema = z.object({ points: z.number(), max: z.number() });

export const StoredVehicleSchema = z.object({
  key: z.string(),
  /** Merged listing data; the first portal that reported the vehicle is primary. */
  vehicle: VehicleSchema,
  sources: z.array(SourceSchema),
  priceHistory: z.array(z.object({ date: z.string(), priceClp: z.number() })),
  priceDropped: z.boolean(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  status: z.enum(["active", "gone"]),
  flags: z.array(z.string()),
  ai: AiSchema.optional(),
  deterministicScore: z.number().optional(),
  score: z.number().optional(),
  verdict: z.enum(["Strong", "Good", "Moderate", "Weak", "Poor"]).optional(),
  breakdown: z
    .object({ price: DimensionSchema, spec: DimensionSchema, condition: DimensionSchema, seller: DimensionSchema })
    .optional(),
  strengths: z.array(z.string()).optional(),
  gaps: z.array(z.string()).optional(),
});

export const StoreFileSchema = z.object({
  version: z.literal(1),
  vehicles: z.record(z.string(), StoredVehicleSchema),
});

export type StoredVehicle = z.infer<typeof StoredVehicleSchema>;
export type StoreData = z.infer<typeof StoreFileSchema>;
export type AiRecord = z.infer<typeof AiSchema>;

export const emptyStore = (): StoreData => ({ version: 1, vehicles: {} });

/** Load the store; a missing file is empty, a corrupted one throws (and is never overwritten). */
export function loadStore(path: string = DEFAULT_STORE_PATH): StoreData {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Store at ${path} is corrupted (not valid JSON); fix or remove it manually, it was not modified`);
  }
  const parsed = StoreFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Store at ${path} is corrupted (${z.prettifyError(parsed.error)}); fix or remove it manually, it was not modified`);
  }
  return parsed.data;
}

/** Atomic write: temp file in the same directory, then rename. */
export function saveStore(path: string, data: StoreData): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

export interface UpsertOptions {
  now?: Date;
  ufClp?: number | null;
  flags?: string[];
}

/** Identifies one listing of one record, for the "seen this run" set used by markGone. */
export const seenId = (key: string, portal: string): string => `${key}|${portal}`;

const day = (d: Date): string => d.toISOString().slice(0, 10);

/** Fill from `incoming`: its non-null values win when `incomingWins`, otherwise only nulls are filled. */
function mergeVehicle(base: Vehicle, incoming: Vehicle, incomingWins: boolean): Vehicle {
  const out: Record<string, unknown> = { ...base };
  for (const [k, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue;
    if (incomingWins || out[k] === null || out[k] === undefined) out[k] = value;
  }
  return out as Vehicle;
}

/** Record price = lowest price among live sources; logs history and sets priceDropped on change. */
function refreshPrice(r: StoredVehicle, now: Date): void {
  const live = r.sources.filter((s) => !s.gone && s.priceClp !== null).map((s) => s.priceClp!);
  if (live.length === 0) return;
  const price = Math.min(...live);
  r.vehicle.priceClp = price;
  const last = r.priceHistory.at(-1);
  if (last && last.priceClp === price) return;
  if (last) r.priceDropped = price < last.priceClp;
  const entry = { date: day(now), priceClp: price };
  if (last && last.date === entry.date) r.priceHistory[r.priceHistory.length - 1] = entry;
  else r.priceHistory.push(entry);
}

/** Insert or merge one listing. Same plate across portals collapses into one record. */
export function upsertVehicle(
  data: StoreData,
  v: Vehicle,
  opts: UpsertOptions = {},
): { key: string; status: "new" | "updated" } {
  const now = opts.now ?? new Date();
  const stamp = now.toISOString();
  const key = dedupeKey(v);
  const legacyKey = dedupeKey({ portal: v.portal, id: v.id, plate: null });

  let existing = data.vehicles[key];
  // A listing first stored without a plate is re-keyed once the plate is known.
  const legacy = key !== legacyKey ? data.vehicles[legacyKey] : undefined;
  if (legacy) {
    delete data.vehicles[legacyKey];
    if (existing) {
      for (const s of legacy.sources) {
        if (!existing.sources.some((x) => x.portal === s.portal && x.url === s.url)) existing.sources.push(s);
      }
    } else {
      existing = { ...legacy, key };
      data.vehicles[key] = existing;
    }
  }

  const source = {
    portal: v.portal,
    url: v.url,
    priceClp: effectivePriceClp(v, opts.ufClp),
    lastSeen: stamp,
  };

  if (!existing) {
    const record: StoredVehicle = {
      key,
      vehicle: { ...v, priceClp: source.priceClp },
      sources: [source],
      priceHistory: [],
      priceDropped: false,
      firstSeen: stamp,
      lastSeen: stamp,
      status: "active",
      flags: opts.flags ?? [],
    };
    refreshPrice(record, now);
    data.vehicles[key] = record;
    return { key, status: "new" };
  }

  const i = existing.sources.findIndex((s) => s.portal === v.portal);
  if (i === -1) existing.sources.push(source);
  else existing.sources[i] = source;
  existing.vehicle = mergeVehicle(existing.vehicle, v, existing.vehicle.portal === v.portal);
  existing.lastSeen = stamp;
  existing.status = "active";
  existing.flags = opts.flags ?? existing.flags;
  refreshPrice(existing, now);
  return { key, status: "updated" };
}

/**
 * After a scan: every source of a scanned portal that was not returned (not in
 * `seen`) is marked gone; a record is gone once all its sources are.
 */
export function markGone(data: StoreData, scannedPortals: Set<string>, seen: Set<string>, now: Date = new Date()): number {
  let gone = 0;
  for (const r of Object.values(data.vehicles)) {
    if (r.status === "gone") continue;
    for (const s of r.sources) {
      if (scannedPortals.has(s.portal) && !seen.has(seenId(r.key, s.portal))) s.gone = true;
    }
    if (r.sources.every((s) => s.gone)) {
      r.status = "gone";
      gone++;
    } else refreshPrice(r, now);
  }
  return gone;
}
