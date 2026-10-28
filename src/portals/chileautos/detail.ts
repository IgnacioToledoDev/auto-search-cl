import { CliError } from "../../lib/cliGuard.ts";
import { type HtmlFetchOptions, htmlFetch } from "../../lib/http.ts";
import { parseClp, parseKm } from "../../lib/parse.ts";
import { stripInvisible, visibleHtml } from "../../lib/sanitize.ts";
import type { Vehicle } from "../../lib/vehicle.ts";
import { parse } from "node-html-parser";
import { BASE_URL, PORTAL, assertNotBlocked } from "./search.ts";

const DETAIL_PATH = /^\/vehiculos\/detalles\/[^/]+\/[^/]+\/?$/;

/**
 * Accept a detail URL on chileautos.cl and drop query/hash (robots.txt
 * disallows parameters on detail pages). A bare id is rejected: the URL needs
 * the model slug, which cannot be derived from the id.
 */
export function normalizeDetailUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CliError("BAD_ARG", `Expected a full detail URL (${BASE_URL}/vehiculos/detalles/<slug>/<id>), got "${input}"`);
  }
  if (url.hostname !== "www.chileautos.cl" || !DETAIL_PATH.test(url.pathname)) {
    throw new CliError("BAD_ARG", `Not a chileautos.cl detail URL: ${input}`);
  }
  return `${BASE_URL}${url.pathname.replace(/\/$/, "")}`;
}

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: Json): string | null {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() !== "" ? stripInvisible(v).trim() : null;
}

function num(v: Json): number | null {
  return typeof v === "number" ? v : parseClp(typeof v === "string" ? v : null);
}

/** First JSON-LD object describing a vehicle/product, or null. */
function findVehicleLd(html: string): Record<string, Json> | null {
  const root = parse(html, { comment: false });
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed: Json = JSON.parse(script.text);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const hit = items.find(
        (i) => isObject(i) && ["Car", "Vehicle", "Product"].includes(String(i["@type"])),
      );
      if (hit && isObject(hit)) return hit;
    } catch {
      // Malformed JSON-LD is ignored; other sources are tried.
    }
  }
  return null;
}

/**
 * Parse a detail page. UNVERIFIED against the live site (blocked by DataDome):
 * reads schema.org JSON-LD and falls back to og: meta tags. All text passes
 * through the shared sanitizers.
 */
export function parseDetailHtml(html: string, url: string): Vehicle {
  assertNotBlocked(html);
  const ld = findVehicleLd(html);
  const meta = (name: string): string | null => {
    const el = parse(html, { comment: false }).querySelector(`meta[property="${name}"]`);
    return str(el?.getAttribute("content"));
  };

  const offers = ld && isObject(ld.offers) ? ld.offers : {};
  const mileage = ld && isObject(ld.mileageFromOdometer) ? ld.mileageFromOdometer.value : null;
  const brand = ld ? (isObject(ld.brand) ? str(ld.brand.name) : str(ld.brand)) : null;
  const images = ld ? [ld.image].flat().flatMap((i) => (str(i) ? [str(i)!] : [])) : [];
  const ogImage = meta("og:image");
  if (images.length === 0 && ogImage) images.push(ogImage);
  const rawDescription = ld ? (typeof ld.description === "string" ? ld.description : null) : null;
  const description = rawDescription !== null ? visibleHtml(rawDescription) || null : meta("og:description");
  const year = ld ? Number.parseInt(String(ld.vehicleModelDate ?? ld.productionDate ?? ""), 10) : Number.NaN;
  const priceCurrency = str(offers.priceCurrency);
  const price = num(offers.price);
  const title = (ld ? str(ld.name) : null) ?? meta("og:title") ?? url;

  return {
    id: url.split("/").pop()!,
    portal: PORTAL,
    url,
    title,
    make: brand,
    model: ld ? str(ld.model) : null,
    version: null,
    year: Number.isFinite(year) ? year : null,
    km: mileage === null || mileage === undefined ? null : typeof mileage === "number" ? mileage : parseKm(String(mileage)),
    priceClp: priceCurrency === "UF" ? null : price,
    priceUf: priceCurrency === "UF" ? price : null,
    currency: priceCurrency,
    condition: ld && /NewCondition/.test(String(ld.itemCondition ?? "")) ? "nuevo" : "usado",
    transmission: ld ? str(ld.vehicleTransmission) : null,
    fuel: ld ? str(ld.fuelType) : null,
    bodyType: ld ? str(ld.bodyType) : null,
    sellerType: null,
    comuna: null,
    region: null,
    plate: null,
    description,
    postedDate: null,
    ...(images.length > 0 ? { images } : {}),
  };
}

export async function detail(input: string, fetchOptions: HtmlFetchOptions = {}): Promise<Vehicle> {
  const url = normalizeDetailUrl(input);
  const html = await htmlFetch(url, fetchOptions);
  return parseDetailHtml(html, url);
}
