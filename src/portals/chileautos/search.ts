import { CliError } from "../../lib/cliGuard.ts";
import { type HtmlFetchOptions, htmlFetch } from "../../lib/http.ts";
import { parseClp, parseKm, parseUf } from "../../lib/parse.ts";
import { stripInvisible } from "../../lib/sanitize.ts";
import type { SearchOutput, Vehicle } from "../../lib/vehicle.ts";

export const PORTAL = "chileautos";
export const BASE_URL = "https://www.chileautos.cl";

export type Condition = "nuevo" | "usado" | "ambos";

export interface SearchOptions {
  query?: string;
  condition?: Condition;
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  priceMax?: number;
  kmMax?: number;
  region?: string;
  page?: number;
  limit?: number;
}

/**
 * robots.txt disallows every query-string search URL under /vehiculos/, so the
 * only legitimate search entry points are path-only landing pages. The
 * condition is the one filter expressible that way; the rest is applied
 * client-side by {@link filterVehicles}.
 */
const LANDING_PATH: Record<Condition, string> = {
  ambos: "/vehiculos/autos-veh%C3%ADculo/",
  nuevo: "/vehiculos/autos-veh%C3%ADculo/nuevo-tipo/",
  usado: "/vehiculos/autos-veh%C3%ADculo/usado-tipo/",
};

export function buildSearchUrl(opts: Pick<SearchOptions, "condition">): string {
  return `${BASE_URL}${LANDING_PATH[opts.condition ?? "ambos"]}`;
}

/** DataDome serves its JS challenge (HTTP 403, sometimes 200) instead of content. */
export function assertNotBlocked(html: string): void {
  if (html.includes("captcha-delivery.com") || html.includes("geo.captcha-delivery")) {
    throw new CliError(
      "API_ERROR",
      "chileautos.cl is protected by DataDome bot protection and served a challenge page; plain HTTP cannot read it",
    );
  }
}

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pull the Next.js data blob out of the page, or null when absent/invalid. */
export function extractNextData(html: string): Json {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]!);
  } catch {
    return null;
  }
}

/** Depth-first collection of every node whose `type` equals `type`. */
function findNodes(root: Json, type: string, out: Record<string, Json>[] = []): Record<string, Json>[] {
  if (Array.isArray(root)) {
    for (const item of root) findNodes(item, type, out);
  } else if (isObject(root)) {
    if (root.type === type) out.push(root);
    for (const value of Object.values(root)) findNodes(value, type, out);
  }
  return out;
}

/** Text values of every Text node under `root`, sanitized and in document order. */
function textValues(root: Json): string[] {
  return findNodes(root, "Text").flatMap((n) =>
    typeof n.value === "string" ? [stripInvisible(n.value).trim()] : [],
  );
}

function str(v: Json): string | null {
  return typeof v === "string" && v.trim() !== "" ? stripInvisible(v).trim() : null;
}

function tracking(card: Record<string, Json>): Record<string, string> {
  const action = card.action;
  const t = isObject(action) && isObject(action.tracking) ? action.tracking : {};
  const attrs = isObject(t.additionalAttributes) ? t.additionalAttributes : {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "string") out[key.split("/").pop()!] = value;
  }
  return out;
}

const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Split "Mercedes-Benz Actros" into make/model. The tracking make is a slug
 * ("mercedes_benz"), so the title prefix is matched ignoring punctuation.
 */
function splitMakeModel(title: string, trackMake: string | undefined, trackModel: string | undefined) {
  if (trackMake) {
    const target = normalize(trackMake);
    for (let end = 1; end <= title.length; end++) {
      if (normalize(title.slice(0, end)) === target) {
        const rest = title.slice(end).trim();
        return { make: title.slice(0, end).trim(), model: rest !== "" ? rest : (trackModel ?? null) };
      }
    }
  }
  return { make: trackMake ?? null, model: trackModel ?? null };
}

/** Under 100 km is treated as a new vehicle; unknown mileage defaults to used. */
function inferCondition(km: number | null): "nuevo" | "usado" {
  return km !== null && km < 100 ? "nuevo" : "usado";
}

function cardToVehicle(card: Record<string, Json>, condition: Condition | undefined): Vehicle | null {
  const data = isObject(card.action) && isObject(card.action.data) ? card.action.data : null;
  const url = data ? str(data.url) : null;
  const id = data ? str(data.id) : null;
  if (!url || !id) return null;

  const title = textValues(card.head)[0] ?? "";
  const foot = textValues(card.foot);
  const kmText = foot.find((t) => /\bkm\b/i.test(t)) ?? null;
  const priceText = foot.find((t) => /^\s*(\$|UF)/i.test(t)) ?? null;
  const km = parseKm(kmText);
  const isUf = priceText !== null && /^\s*UF/i.test(priceText);

  const track = tracking(card);
  const { make, model } = splitMakeModel(title, track.make, track.model);
  const year = /^\d{4}$/.test(track.year ?? "") ? Number(track.year) : null;
  const hero = isObject(card.hero) ? str(card.hero.url) : null;

  return {
    id,
    portal: PORTAL,
    url,
    title: title || `${make ?? ""} ${model ?? ""}`.trim() || id,
    make,
    model,
    version: null,
    year,
    km,
    priceClp: isUf ? null : parseClp(priceText),
    priceUf: isUf ? parseUf(priceText) : null,
    currency: priceText === null ? null : isUf ? "UF" : "CLP",
    condition: condition === "nuevo" || condition === "usado" ? condition : inferCondition(km),
    transmission: null,
    fuel: null,
    bodyType: null,
    sellerType: null,
    comuna: null,
    region: null,
    plate: null,
    description: null,
    postedDate: null,
    ...(hero ? { images: [hero] } : {}),
  };
}

/** Parse the StockCard nodes of a results page (`__NEXT_DATA__` UI tree). */
export function parseSearchHtml(html: string, condition?: Condition): Vehicle[] {
  const data = extractNextData(html);
  if (data === null) return [];
  const seen = new Set<string>();
  const vehicles: Vehicle[] = [];
  for (const card of findNodes(data, "StockCard")) {
    const vehicle = cardToVehicle(card, condition);
    if (vehicle && !seen.has(vehicle.id)) {
      seen.add(vehicle.id);
      vehicles.push(vehicle);
    }
  }
  return vehicles;
}

const includes = (haystack: string | null, needle: string): boolean =>
  haystack !== null && haystack.toLowerCase().includes(needle.toLowerCase());

/**
 * Client-side filters (the portal's query-string filters are off limits).
 * A listing whose value is unknown is dropped only when that filter is set.
 */
export function filterVehicles(vehicles: Vehicle[], o: SearchOptions): Vehicle[] {
  return vehicles.filter((v) => {
    if (o.query && !includes(v.title, o.query)) return false;
    if (o.make && !includes(v.make, o.make)) return false;
    if (o.model && !includes(v.model, o.model)) return false;
    if (o.region && !includes(v.region, o.region)) return false;
    if (o.yearMin !== undefined && (v.year === null || v.year < o.yearMin)) return false;
    if (o.yearMax !== undefined && (v.year === null || v.year > o.yearMax)) return false;
    if (o.priceMax !== undefined && (v.priceClp === null || v.priceClp > o.priceMax)) return false;
    if (o.kmMax !== undefined && (v.km === null || v.km > o.kmMax)) return false;
    return true;
  });
}

export const DEFAULT_LIMIT = 20;

export async function search(opts: SearchOptions, fetchOptions: HtmlFetchOptions = {}): Promise<SearchOutput> {
  const html = await htmlFetch(buildSearchUrl(opts), fetchOptions);
  assertNotBlocked(html);
  const matches = filterVehicles(parseSearchHtml(html, opts.condition), opts);
  const page = opts.page ?? 1;
  const perPage = opts.limit ?? DEFAULT_LIMIT;
  const start = (page - 1) * perPage;
  return { meta: { total: matches.length, page, perPage }, results: matches.slice(start, start + perPage) };
}
