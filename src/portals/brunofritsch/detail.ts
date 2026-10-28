import { parse } from "node-html-parser";
import { CliError } from "../../lib/cliGuard.ts";
import { type HtmlFetchOptions, htmlFetch } from "../../lib/http.ts";
import type { Vehicle } from "../../lib/vehicle.ts";
import { BASE_URL, PORTAL, assertNotBlocked, clean, formatClp, isObject, parseState } from "./search.ts";

const USED_PATH = /^\/autos-usados\/([A-Za-z0-9]{2,5}-[A-Za-z0-9]{2,4})\/?$/;
const NEW_PATH = /^\/([a-z0-9-]+)\/([A-Za-z0-9_-]+)\/?$/;

/**
 * Accept a www.brunofritsch.cl detail URL (query/hash dropped) or a bare plate.
 * Used: `/autos-usados/<PLATE>`; new: `/<model-slug>/<VERSION_CODE>`. The
 * robots-disallowed `/autos-usados/usados-*` filter paths are refused.
 */
export function normalizeDetailUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9]{2,5}-[A-Za-z0-9]{2,4}$/.test(trimmed) && !/^usados-/i.test(trimmed)) {
    return `${BASE_URL}/autos-usados/${trimmed.toUpperCase()}`;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CliError("BAD_ARG", `Expected a Bruno Fritsch detail URL (${BASE_URL}/autos-usados/<PLATE>) or a plate, got "${input}"`);
  }
  const path = url.pathname.replace(/\/$/, "");
  const used = USED_PATH.exec(path);
  const isNew = !used && !path.startsWith("/autos-usados") && NEW_PATH.test(path);
  if (url.hostname !== "www.brunofritsch.cl" || !(used || isNew)) {
    throw new CliError("BAD_ARG", `Not a Bruno Fritsch vehicle detail URL: ${input}`);
  }
  return `${BASE_URL}${path}`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

function findCarLd(html: string): Record<string, unknown> | null {
  for (const script of parse(html, { comment: false }).querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed: unknown = JSON.parse(script.text);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (isObject(item) && [item["@type"]].flat().some((t) => t === "Car" || t === "Vehicle")) return item;
      }
    } catch {
      // Malformed JSON-LD is ignored.
    }
  }
  return null;
}

/**
 * Parse a detail page from the product embedded in `window.state` (verified
 * 2026-10-28 for a used and a new car); the schema.org Car JSON-LD is the
 * fallback when the product is missing.
 */
export function parseDetailHtml(html: string, url: string): Vehicle {
  assertNotBlocked(html);
  const path = new URL(url).pathname;
  const id = path.split("/").filter(Boolean).pop() ?? url;
  const state = parseState(html);
  const catalog = isObject(state.catalogRepository) && isObject(state.catalogRepository.products) ? state.catalogRepository.products : {};
  const product = isObject(catalog[id]) ? catalog[id] : null;
  const prices = isObject(state.priceRepository) && isObject(state.priceRepository.products) && isObject(state.priceRepository.products[id]) ? state.priceRepository.products[id] : {};
  const ld = findCarLd(html);

  if (!product) {
    if (!ld) throw new CliError("API_ERROR", `brunofritsch.cl page has no product data for ${id}`);
    const offers = isObject(ld.offers) ? ld.offers : {};
    const price = num(offers.price);
    return {
      id, portal: PORTAL, url, title: clean(ld.name) ?? url,
      make: clean(ld.brand), model: null, version: null, year: null, km: null,
      priceClp: price, priceUf: null, currency: price === null ? null : (clean(offers.priceCurrency) ?? "CLP"),
      condition: /NewCondition/.test(String(offers.itemCondition ?? "")) ? "nuevo" : "usado",
      transmission: null, fuel: null, bodyType: null, sellerType: "dealer", comuna: null, region: null,
      plate: null, description: clean(ld.description), postedDate: null,
    };
  }

  const used = String(product.type ?? "").startsWith("automovil-usado") || USED_PATH.test(path);
  const make = clean(product.x_marca) ?? clean(product.brand);
  const year = num(product.x_agno);
  const model = used ? clean(product.x_modelo) : (clean(product.x_family) ?? clean(product.x_modelo));
  const version = used ? clean(product.x_version) : clean(product.displayName);
  const list = num(prices.list) ?? num(product.listPrice) ?? num(product.x_precioDeLista);
  const sale = num(prices.sale);
  const price = sale ?? list;
  const place = clean(product.x_Ubicacion_Fisica);
  const power = clean(product.x_potencia);
  const range = num(product.x_autonomiaKm);
  const warranty = clean(product.x_garantia);
  const warrantyType = clean(product.x_tipoDeGaranta);
  const cc = clean(product.x_cilindrada);
  const color = clean(product.x_color);

  const notes = [
    place ? `Sucursal: ${place}` : null,
    color ? `Color ${color}` : null,
    cc && cc !== "0" ? `${cc} cc` : null,
    power ? `${power} HP` : null,
    range !== null ? `Autonomía ${Math.round(range)} km` : null,
    used && warranty ? `Garantía: ${warranty}${warrantyType ? ` (tipo ${warrantyType})` : ""}` : null,
    product.x_unico_dueno === true ? "Único dueño" : null,
    product.x_mantenciones_al_dia === true ? "Mantenciones al día" : null,
    product.x_garantia_de_fabrica_vigente === true ? "Garantía de fábrica vigente" : null,
    used ? null : "Precio lista referencial (incluye bonos aplicables)",
    sale !== null && list !== null ? `Precio lista ${formatClp(list)}` : null,
    used ? null : clean(product.x_textoLegal),
  ].filter((n): n is string => n !== null);

  const images = (Array.isArray(product.mediumImageURLs) ? product.mediumImageURLs : [])
    .map(clean)
    .filter((i): i is string => i !== null)
    .map((i) => (i.startsWith("/") ? `${BASE_URL}${i}` : i))
    .slice(0, 5);
  const comuna = place ? (place.split(" - ").at(-1)?.trim() || null) : null;

  return {
    id,
    portal: PORTAL,
    url,
    title: [make, model, year !== null ? Math.round(year) : null].filter(Boolean).join(" ") || url,
    make,
    model,
    version,
    year: year !== null ? Math.round(year) : null,
    km: used ? num(product.x_kilometraje) : null,
    priceClp: price,
    priceUf: null,
    currency: price === null ? null : "CLP",
    condition: used ? "usado" : "nuevo",
    transmission: clean(product.x_transmision),
    fuel: clean(product.x_combustible),
    bodyType: used ? clean(product.x_tipo) : clean(product.x_tipoDeVehiculo),
    sellerType: "dealer",
    comuna: used ? comuna : null,
    region: null,
    plate: used ? clean(product.x_patente) : null,
    description: notes.length > 0 ? notes.join(". ") : null,
    postedDate: null,
    ...(images.length > 0 ? { images } : {}),
  };
}

export async function detail(input: string, fetchOptions: HtmlFetchOptions = {}): Promise<Vehicle> {
  const url = normalizeDetailUrl(input);
  return parseDetailHtml(await htmlFetch(url, fetchOptions), url);
}
