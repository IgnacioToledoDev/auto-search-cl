import { parse } from "node-html-parser";
import { CliError } from "../../lib/cliGuard.ts";
import { type HtmlFetchOptions, htmlFetch } from "../../lib/http.ts";
import { parseClp, parseKm } from "../../lib/parse.ts";
import { stripInvisible } from "../../lib/sanitize.ts";
import type { Vehicle } from "../../lib/vehicle.ts";
import { BASE_URL, PORTAL, assertNotBlocked, textOf } from "./search.ts";

const DETAIL_PATH = /^\/marcas\/[^/]+\/(usado|nuevo)\/([^/]+)\/?$/;

/**
 * Accept a www.salazarisrael.cl detail URL (query/hash dropped). A bare id is
 * refused: the site redirects `/marcas/x/usado/x-<id>` to a `?marca=` search URL
 * that robots.txt disallows, so ids cannot be resolved politely.
 */
export function normalizeDetailUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CliError("BAD_ARG", `Salazar Israel detail needs the full URL (${BASE_URL}/marcas/<make>/usado|nuevo/<slug>); a bare id cannot be resolved, got "${input}"`);
  }
  if (url.hostname !== "www.salazarisrael.cl" || !DETAIL_PATH.test(url.pathname)) {
    throw new CliError("BAD_ARG", `Not a Salazar Israel vehicle detail URL: ${input}`);
  }
  return `${BASE_URL}${url.pathname.replace(/\/$/, "")}`;
}

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: Json): string | null {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() !== "" ? stripInvisible(v).trim() : null;
}

function findCarLd(html: string): Record<string, Json> | null {
  for (const script of parse(html, { comment: false }).querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed: Json = JSON.parse(script.text);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (isObject(item) && [item["@type"]].flat().some((t) => t === "Car" || t === "Vehicle")) return item;
      }
    } catch {
      // Malformed JSON-LD is ignored; the h1 fallback is used.
    }
  }
  return null;
}


/**
 * The site is a streamed React app: the vehicle sheet is delivered inside
 * `<div hidden id="S:n">` suspense segments that a script un-hides on load, so
 * a visibility-aware parse would see none of it. Only that exact React pattern
 * is un-hidden; every other hidden element is still dropped by the sanitizer.
 */
export function unwrapSuspense(html: string): string {
  return html.replace(/<div hidden(?:="")? id="(S:\d+)"/g, '<div id="$1"');
}

/**
 * Parse a detail page: schema.org Car JSON-LD (verified 2026-10-28) plus the
 * visible sheet for version, cash/financed price, installment, highlights,
 * warranty and branch. New cars show only "Desde $X IVA incluido".
 */
export function parseDetailHtml(html: string, url: string): Vehicle {
  assertNotBlocked(html);
  const root = parse(unwrapSuspense(html), { comment: false });
  const ld = findCarLd(html);
  const offers = ld && isObject(ld.offers) ? ld.offers : {};
  const seller = isObject(offers.seller) ? offers.seller : {};
  const address = isObject(seller.address) ? seller.address : {};
  const mileage = ld && isObject(ld.mileageFromOdometer) ? ld.mileageFromOdometer.value : null;
  const make = ld ? (isObject(ld.brand) ? str(ld.brand.name) : str(ld.brand)) : null;
  const model = ld ? str(ld.model) : null;
  const text = textOf(root.querySelector("body"));

  const paragraphs = root.querySelectorAll("p").map(textOf);
  const at = paragraphs.findIndex((t, i) => make !== null && model !== null && t === make && paragraphs[i + 1] === model);
  const version = at >= 0 ? (paragraphs[at + 2] || null) : null;

  const year = ld ? Number.parseInt(String(ld.vehicleModelDate ?? ""), 10) : Number.NaN;
  const cash = /Precio contado\s*\$\s*([\d.]+)/.exec(text)?.[1];
  const financed = /Con financiamiento\s*\$\s*([\d.]+)/.exec(text)?.[1];
  const cuota = /Cuota\s*\$\s*([\d.]+)\s*\/\s*(\d+)\s*meses/.exec(text);
  const desde = /Desde\s*\$\s*([\d.]+)(\s*IVA incluido)?/.exec(text);
  const ldPrice = typeof offers.price === "number" ? offers.price : parseClp(typeof offers.price === "string" ? offers.price : null);

  let highlights: string | null = null;
  if (version) {
    const start = text.indexOf(version);
    const tail = start >= 0 ? text.slice(start + version.length) : "";
    const end = /\s\d{4}\s+[\d.]+\s*km/i.exec(tail);
    const between = end ? tail.slice(0, end.index).trim() : "";
    highlights = between !== "" ? between.split(/\s+/).join(" ") : null;
  }
  // The sheet is served several times (mobile/desktop); keep each line once.
  const warranty = [
    ...new Set(
      root
        .querySelectorAll('[data-testid="pdp-trust-block"] li p')
        .map(textOf)
        .filter((t) => /garant|revisad/i.test(t)),
    ),
  ];
  const branch = textOf(root.querySelectorAll("p").find((p) => /^Disponible en:/.test(textOf(p))) ?? null).replace(/^Disponible en:\s*/, "");
  const street = textOf(root.querySelector('a[href*="google.com/maps"] span'));
  const sellerName = str(seller.name);
  const branchLine = branch ? `Sucursal: ${[branch, street].filter(Boolean).join(", ")}${sellerName ? ` (${sellerName})` : ""}` : null;
  const vin = ld ? str(ld.vehicleIdentificationNumber) : null;

  const notes = [
    highlights,
    cash ? `Precio contado $${cash}` : null,
    financed ? `Con financiamiento $${financed}` : null,
    cuota ? `Cuota $${cuota[1]} / ${cuota[2]} meses` : null,
    desde ? `Desde $${desde[1]}${desde[2] ? " IVA incluido" : ""}` : null,
    ...warranty,
    branchLine,
    vin ? `VIN ${vin}` : null,
  ].filter((n): n is string => n !== null);

  const images = ld && Array.isArray(ld.image) ? ld.image.map(str).filter((i): i is string => i !== null) : [];
  const urlMatch = DETAIL_PATH.exec(new URL(url).pathname);
  const slug = urlMatch?.[2] ?? url;
  const price = cash ? parseClp(cash) : desde ? parseClp(desde[1]) : ldPrice;
  const isNew = ld ? /NewCondition/.test(String(ld.itemCondition ?? "")) : urlMatch?.[1] === "nuevo";
  const title = make && model ? [make, model, version].filter(Boolean).join(" ") : (str(ld?.name) ?? textOf(root.querySelector("h1")) ?? url);

  return {
    id: isNew ? slug : (/-(\d+)$/.exec(slug)?.[1] ?? slug),
    portal: PORTAL,
    url,
    title: title || url,
    make,
    model,
    version,
    year: Number.isFinite(year) ? year : null,
    km: mileage === null || mileage === undefined ? null : typeof mileage === "number" ? mileage : parseKm(String(mileage)),
    priceClp: price,
    priceUf: null,
    currency: price === null ? null : (str(offers.priceCurrency) ?? "CLP"),
    condition: isNew ? "nuevo" : "usado",
    transmission: ld ? str(ld.vehicleTransmission) : null,
    fuel: ld ? str(ld.fuelType) : null,
    bodyType: ld ? str(ld.bodyType) : null,
    sellerType: "dealer",
    comuna: str(address.addressLocality) ?? (branch || null),
    region: str(address.addressRegion),
    plate: null,
    description: notes.length > 0 ? notes.join(". ") : null,
    postedDate: null,
    ...(images.length > 0 ? { images } : {}),
  };
}

export async function detail(input: string, fetchOptions: HtmlFetchOptions = {}): Promise<Vehicle> {
  const url = normalizeDetailUrl(input);
  return parseDetailHtml(await htmlFetch(url, fetchOptions), url);
}
