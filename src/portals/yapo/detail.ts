import { parse } from "node-html-parser";
import { CliError } from "../../lib/cliGuard.ts";
import { type HtmlFetchOptions, htmlFetch } from "../../lib/http.ts";
import { parseClp, parseKm } from "../../lib/parse.ts";
import { stripInvisible, visibleHtml } from "../../lib/sanitize.ts";
import type { Vehicle } from "../../lib/vehicle.ts";
import { BASE_URL, PORTAL, assertNotBlocked } from "./search.ts";

const DETAIL_PATH = /^\/autos-(usados|nuevos)\/[^/]+\/(\d+)\/?$/;

/**
 * Accept a www.yapo.cl detail URL (query/hash dropped) or a bare numeric id.
 * A bare id is requested under a placeholder slug that the site redirects
 * (308) to the canonical URL; it assumes the used-car category.
 */
export function normalizeDetailUrl(input: string): string {
  const trimmed = input.trim();
  if (/^\d{5,}$/.test(trimmed)) return `${BASE_URL}/autos-usados/x/${trimmed}`;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CliError("BAD_ARG", `Expected a Yapo detail URL (${BASE_URL}/autos-usados/<slug>/<id>) or numeric id, got "${input}"`);
  }
  if (url.hostname !== "www.yapo.cl" || !DETAIL_PATH.test(url.pathname)) {
    throw new CliError("BAD_ARG", `Not a Yapo autos detail URL: ${input}`);
  }
  return `${BASE_URL}${url.pathname.replace(/\/$/, "")}`;
}

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: Json): string | null {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() !== "" ? stripInvisible(v).trim() : null;
}

function findVehicleLd(html: string): Record<string, Json> | null {
  for (const script of parse(html, { comment: false }).querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed: Json = JSON.parse(script.text);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (isObject(item) && [item["@type"]].flat().some((t) => t === "Car" || t === "Vehicle")) return item;
      }
    } catch {
      // Malformed JSON-LD is ignored; the og: fallback is used.
    }
  }
  return null;
}

/** Parse a detail page: schema.org Car JSON-LD (verified 2026-10-28) with og: meta as fallback. */
export function parseDetailHtml(html: string, url: string): Vehicle {
  assertNotBlocked(html);
  const root = parse(html, { comment: false });
  const meta = (name: string): string | null => str(root.querySelector(`meta[property="${name}"]`)?.getAttribute("content"));
  const ld = findVehicleLd(html);
  const offers = ld && isObject(ld.offers) ? ld.offers : {};
  const address = isObject(offers.seller) && isObject(offers.seller.address) ? offers.seller.address : {};
  const mileage = ld && isObject(ld.mileageFromOdometer) ? ld.mileageFromOdometer.value : null;
  const model = ld ? (isObject(ld.model) ? str(ld.model.name) : str(ld.model)) : null;
  const image = ld && isObject(ld.image) ? str(ld.image.contentUrl) : ld ? str(ld.image) : null;
  const images = [image ?? meta("og:image")].flatMap((i) => (i ? [i] : []));
  const rawDescription = ld && typeof ld.description === "string" ? ld.description : null;
  const description = rawDescription !== null ? visibleHtml(rawDescription) || null : meta("og:description");
  const year = ld ? Number.parseInt(String(ld.vehicleModelDate ?? ""), 10) : Number.NaN;
  const currency = str(offers.priceCurrency);
  const price = typeof offers.price === "number" ? offers.price : parseClp(typeof offers.price === "string" ? offers.price.replace(/,/g, "") : null);
  const mileageValue = mileage === null || mileage === undefined ? null : typeof mileage === "number" ? mileage : parseKm(String(mileage));
  const id = DETAIL_PATH.exec(new URL(url).pathname)?.[2] ?? url;

  return {
    id,
    portal: PORTAL,
    url,
    title: (ld ? str(ld.name) : null) ?? meta("og:title") ?? str(root.querySelector("h1")?.text) ?? url,
    make: ld ? str(ld.brand) : null,
    model,
    version: null,
    year: Number.isFinite(year) ? year : null,
    km: mileageValue,
    priceClp: currency === "UF" ? null : price,
    priceUf: currency === "UF" ? price : null,
    currency,
    condition: /NewCondition/.test(String(offers.itemCondition ?? "")) ? "nuevo" : "usado",
    transmission: ld ? str(ld.vehicleTransmission) : null,
    fuel: ld ? str(ld.fuelType) : null,
    bodyType: null,
    sellerType: null,
    comuna: str(address.addressLocality),
    region: str(address.addressRegion),
    plate: null,
    description,
    postedDate: null,
    ...(images.length > 0 ? { images } : {}),
  };
}

export async function detail(input: string, fetchOptions: HtmlFetchOptions = {}): Promise<Vehicle> {
  const url = normalizeDetailUrl(input);
  return parseDetailHtml(await htmlFetch(url, fetchOptions), url);
}
