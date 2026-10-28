import { CliError } from "../../lib/cliGuard.ts";
import { type HtmlFetchOptions, htmlFetch } from "../../lib/http.ts";
import { DEFAULT_LIMIT, type SearchOptions, filterVehicles, slugify } from "../../lib/listing.ts";
import { visibleHtml } from "../../lib/sanitize.ts";
import type { SearchOutput, Vehicle } from "../../lib/vehicle.ts";

export const PORTAL = "brunofritsch";
export const BASE_URL = "https://www.brunofritsch.cl";

type Json = unknown;
export const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * robots.txt disallows the SEO filter paths `/autos-usados/usados-*` (and their
 * query forms), so they are never built. Verified 2026-10-28 as allowed:
 * `/autos-usados`, `/autos-usados?page=N` (14 cars per page) and the brand pages
 * `/<make>` (every new version of the brand in one page). New cars have no
 * all-brands listing, so a make is required for them.
 */
export function buildSearchUrls(opts: Pick<SearchOptions, "condition" | "make" | "page">): string[] {
  const urls: string[] = [];
  if (opts.condition !== "nuevo") {
    const query = opts.page !== undefined && opts.page > 1 ? `?page=${opts.page}` : "";
    urls.push(`${BASE_URL}/autos-usados${query}`);
  }
  if (opts.condition !== "usado" && opts.make) urls.push(`${BASE_URL}/${slugify(opts.make)}`);
  return urls;
}

/** Bot-protection interstitials are reported, never passed. */
export function assertNotBlocked(html: string): void {
  if (/<title>\s*(Just a moment|Attention Required|Access Denied)|captcha-delivery\.com|id="challenge-form"|_Incapsula_Resource/i.test(html)) {
    throw new CliError("API_ERROR", "brunofritsch.cl served a bot-protection challenge page; plain HTTP cannot read it");
  }
}

/**
 * The storefront (Oracle Commerce Cloud) embeds the data it renders as
 * `window.state = JSON.parse(decodeURI("..."))`; this decodes it exactly as the
 * page does.
 */
export function parseState(html: string): Record<string, Json> {
  const raw = /window\.state = JSON\.parse\(decodeURI\("([\s\S]*?)"\)\)/.exec(html)?.[1];
  if (raw === undefined) throw new CliError("API_ERROR", "brunofritsch.cl page has no embedded window.state; the layout may have changed");
  try {
    const state: Json = JSON.parse(decodeURI(raw));
    if (isObject(state)) return state;
  } catch {
    // Reported below.
  }
  throw new CliError("API_ERROR", "brunofritsch.cl embedded window.state could not be decoded");
}

/** Sanitize a string coming from the page: strips hidden markup and invisible characters. */
export function clean(v: Json): string | null {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  return visibleHtml(v) || null;
}

const number = (v: Json): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

export const formatClp = (n: number): string => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

const attr = (attributes: Record<string, Json>, key: string): string | null => {
  const v = attributes[key];
  return clean(Array.isArray(v) ? v[0] : v);
};

function recordToVehicle(record: Json): Vehicle | null {
  if (!isObject(record) || !isObject(record.attributes)) return null;
  const a = record.attributes;
  const id = attr(a, "sku.listingId");
  const make = attr(a, "product.x_marca") ?? attr(a, "product.brand");
  if (!id || !make) return null;
  const used = (attr(a, "product.type") ?? "").startsWith("automovil-usado");
  const categories = Array.isArray(a["product.category"]) ? a["product.category"].map(clean) : [];
  const branch = categories.find((c): c is string => c !== null && /^Autos Usados \S/.test(c))?.replace(/^Autos Usados /, "") ?? null;

  const priced = Array.isArray(record.records) && isObject(record.records[0]) && isObject(record.records[0].attributes) ? record.records[0].attributes : {};
  const price = number(attr(a, "sku.minActivePrice")) ?? number(attr(priced, "sku.activePrice"));
  const list = number(attr(priced, "sku.listPrice"));
  const route = attr(a, "product.route") ?? (used ? `/autos-usados/${id}` : `/${id}`);

  const year = number(attr(a, "product.x_agno"));
  const model = used ? attr(a, "product.x_modelo") : (categories[0] ?? null);
  const power = attr(a, "product.x_potencia");
  const range = number(attr(a, "product.x_autonomiaKm"));
  const notes = [
    branch ? `Sucursal: ${branch}` : null,
    attr(a, "product.x_unico_dueno") === "1" ? "Único dueño" : null,
    attr(a, "product.x_garantia_de_fabrica_vigente") === "1" ? "Garantía de fábrica vigente" : null,
    power ? `${power} HP` : null,
    range !== null ? `Autonomía ${Math.round(range)} km` : null,
    used ? null : "Precio lista referencial (incluye bonos aplicables)",
    used && price !== null && list !== null && list !== price ? `Precio lista ${formatClp(list)}` : null,
    (attr(a, "sku.availabilityStatus") ?? "INSTOCK") === "INSTOCK" ? null : "Sin stock",
  ].filter((n): n is string => n !== null);
  const image = attr(a, "product.primarySmallImageURL");

  return {
    id,
    portal: PORTAL,
    url: `${BASE_URL}${route}`,
    title: used ? [make, model, year !== null ? Math.round(year) : null].filter(Boolean).join(" ") : [make, model, attr(a, "product.displayName")].filter(Boolean).join(" "),
    make,
    model,
    version: used ? attr(a, "product.x_version") : attr(a, "product.displayName"),
    year: used && year !== null ? Math.round(year) : null,
    km: used ? number(attr(a, "product.x_kilometraje")) : null,
    priceClp: price,
    priceUf: null,
    currency: price === null ? null : "CLP",
    condition: used ? "usado" : "nuevo",
    transmission: attr(a, "product.x_transmision"),
    fuel: attr(a, "product.x_combustible"),
    bodyType: used ? attr(a, "product.x_tipo") : null,
    sellerType: "dealer",
    comuna: null,
    region: null,
    plate: used ? id : null,
    description: notes.length > 0 ? notes.join(". ") : null,
    postedDate: null,
    ...(image ? { images: [image.startsWith("/") ? `${BASE_URL}${image}` : image] } : {}),
  };
}

/** Parse the search results embedded in a listing or brand page. */
export function parseSearchHtml(html: string): Vehicle[] {
  const state = parseState(html);
  const repo = state.searchRepository;
  const page = isObject(repo) && isObject(repo.pages) ? Object.values(repo.pages)[0] : undefined;
  const records = isObject(page) && isObject(page.results) && Array.isArray(page.results.records) ? page.results.records : [];
  const seen = new Set<string>();
  const vehicles: Vehicle[] = [];
  for (const record of records) {
    const vehicle = recordToVehicle(record);
    if (vehicle && !seen.has(vehicle.id)) {
      seen.add(vehicle.id);
      vehicles.push(vehicle);
    }
  }
  return vehicles;
}

/** Used page N is fetched server-side; every other filter runs client-side over the fetched records. */
export async function search(opts: SearchOptions, fetchOptions: HtmlFetchOptions = {}): Promise<SearchOutput> {
  if (opts.condition === "nuevo" && !opts.make) {
    throw new CliError("BAD_ARG", "brunofritsch new-car search needs --make (new cars are listed per brand page)");
  }
  const byId = new Map<string, Vehicle>();
  for (const url of buildSearchUrls(opts)) {
    const html = await htmlFetch(url, fetchOptions);
    assertNotBlocked(html);
    for (const v of parseSearchHtml(html)) if (!byId.has(v.id)) byId.set(v.id, v);
  }
  const matches = filterVehicles([...byId.values()], opts);
  const perPage = opts.limit ?? DEFAULT_LIMIT;
  return { meta: { total: matches.length, page: opts.page ?? 1, perPage }, results: matches.slice(0, perPage) };
}
