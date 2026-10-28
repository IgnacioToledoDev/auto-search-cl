import { CliError } from "../../lib/cliGuard.ts";
import { HttpError, type HtmlFetchOptions, htmlFetch } from "../../lib/http.ts";
import { DEFAULT_LIMIT, type SearchOptions, filterVehicles } from "../../lib/listing.ts";
import { parseKm } from "../../lib/parse.ts";
import { stripInvisible } from "../../lib/sanitize.ts";
import type { SearchOutput, Vehicle } from "../../lib/vehicle.ts";

export const PORTAL = "mercadolibre";
export const API_BASE = "https://api.mercadolibre.com";
/** "Autos y Camionetas" under Vehículos on MLC. UNVERIFIED: the API refuses anonymous reads. */
export const CATEGORY = "MLC1744";
/** ITEM_CONDITION value ids. 2230284 (new) appears in robots.txt; 2230581 (used) is UNVERIFIED. */
const CONDITION_ID = { nuevo: "2230284", usado: "2230581" } as const;

type Env = Record<string, string | undefined>;

export function buildSearchUrl(opts: SearchOptions): string {
  const url = new URL(`${API_BASE}/sites/MLC/search`);
  const q = [opts.make, opts.model, opts.query].filter(Boolean).join(" ");
  const limit = opts.limit ?? DEFAULT_LIMIT;
  url.searchParams.set("category", CATEGORY);
  if (q) url.searchParams.set("q", q);
  if (opts.condition === "nuevo" || opts.condition === "usado") {
    url.searchParams.set("ITEM_CONDITION", CONDITION_ID[opts.condition]);
  }
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(((opts.page ?? 1) - 1) * limit));
  return url.toString();
}

/**
 * GET a public API URL as text. Sends a bearer token only if the user exported
 * MERCADOLIBRE_ACCESS_TOKEN; anonymous 401/403 is reported, never worked around.
 */
export async function apiGet(url: string, fetchOptions: HtmlFetchOptions, env: Env): Promise<string> {
  const headers: Record<string, string> = { Accept: "application/json", ...fetchOptions.headers };
  if (env.MERCADOLIBRE_ACCESS_TOKEN) headers.Authorization = `Bearer ${env.MERCADOLIBRE_ACCESS_TOKEN}`;
  try {
    return await htmlFetch(url, { ...fetchOptions, headers });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      throw new CliError(
        "API_ERROR",
        `api.mercadolibre.com answered HTTP ${err.status}: the API requires an OAuth access token. ` +
          "Export your own token as MERCADOLIBRE_ACCESS_TOKEN to use it; the HTML site is not scraped.",
      );
    }
    throw err;
  }
}

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseJson(text: string, what: string): Json {
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError("API_ERROR", `Mercado Libre returned a non-JSON ${what} response`);
  }
}

function str(v: Json): string | null {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() !== "" ? stripInvisible(v).trim() : null;
}

/** attributes[] as an id -> {text, number} lookup. */
function attributes(item: Record<string, Json>): Map<string, { text: string | null; number: number | null }> {
  const map = new Map<string, { text: string | null; number: number | null }>();
  for (const a of Array.isArray(item.attributes) ? item.attributes : []) {
    if (!isObject(a) || typeof a.id !== "string") continue;
    const struct = isObject(a.value_struct) && typeof a.value_struct.number === "number" ? a.value_struct.number : null;
    map.set(a.id, { text: str(a.value_name), number: struct });
  }
  return map;
}

function place(item: Record<string, Json>): { comuna: string | null; region: string | null } {
  const addr = isObject(item.address) ? item.address : null;
  if (addr) return { comuna: str(addr.city_name), region: str(addr.state_name) };
  const loc = isObject(item.seller_address) ? item.seller_address : isObject(item.location) ? item.location : null;
  const name = (v: Json): string | null => (isObject(v) ? str(v.name) : null);
  return loc ? { comuna: name(loc.city), region: name(loc.state) } : { comuna: null, region: null };
}

/** Map one API item (search result or /items/<id> body) to a Vehicle; null when it has no id. */
export function itemToVehicle(item: Record<string, Json>): Vehicle | null {
  const id = str(item.id);
  if (!id) return null;
  const attrs = attributes(item);
  const text = (k: string): string | null => attrs.get(k)?.text ?? null;
  const yearText = text("VEHICLE_YEAR");
  const km = attrs.get("KILOMETERS");
  const currency = str(item.currency_id);
  const price = typeof item.price === "number" ? item.price : null;
  const seller = isObject(item.seller) ? item.seller : null;
  const pictures = (Array.isArray(item.pictures) ? item.pictures : []).flatMap((p) =>
    isObject(p) && str(p.secure_url) ? [str(p.secure_url)!] : [],
  );
  const thumb = str(item.thumbnail);
  const images = pictures.length > 0 ? pictures : thumb ? [thumb] : [];
  const permalink = str(item.permalink);
  const title = str(item.title) ?? id;

  return {
    id,
    portal: PORTAL,
    url: permalink ?? `https://articulo.mercadolibre.cl/${id}`,
    title,
    make: text("BRAND"),
    model: text("MODEL"),
    version: text("TRIM"),
    year: yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : null,
    km: km ? (km.number ?? parseKm(km.text)) : null,
    priceClp: currency === "CLP" ? price : null,
    priceUf: currency === "UF" ? price : null,
    currency,
    condition: item.condition === "new" ? "nuevo" : "usado",
    transmission: text("TRANSMISSION"),
    fuel: text("FUEL_TYPE"),
    bodyType: text("BODY_TYPE"),
    sellerType: seller && typeof seller.car_dealer === "boolean" ? (seller.car_dealer ? "dealer" : "particular") : null,
    ...place(item),
    plate: null,
    description: null,
    postedDate: str(item.date_created) ?? str(item.start_time),
    ...(images.length > 0 ? { images } : {}),
  };
}

export function parseSearchJson(text: string): Vehicle[] {
  const data = parseJson(text, "search");
  if (!isObject(data) || !Array.isArray(data.results)) {
    throw new CliError("API_ERROR", "Unexpected Mercado Libre search payload: missing results[]");
  }
  return data.results.flatMap((r) => {
    const v = isObject(r) ? itemToVehicle(r) : null;
    return v ? [v] : [];
  });
}

/**
 * The API pages server-side (offset/limit), so the page is already the
 * requested one; the remaining filters run client-side over it.
 */
export async function search(
  opts: SearchOptions,
  fetchOptions: HtmlFetchOptions = {},
  env: Env = process.env,
): Promise<SearchOutput> {
  const text = await apiGet(buildSearchUrl(opts), fetchOptions, env);
  const matches = filterVehicles(parseSearchJson(text), opts);
  return { meta: { total: matches.length, page: opts.page ?? 1, perPage: opts.limit ?? DEFAULT_LIMIT }, results: matches };
}
