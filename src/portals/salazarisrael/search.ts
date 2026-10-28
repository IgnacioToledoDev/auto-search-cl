import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import { CliError } from "../../lib/cliGuard.ts";
import { type HtmlFetchOptions, htmlFetch } from "../../lib/http.ts";
import { DEFAULT_LIMIT, type SearchOptions, filterVehicles, slugify } from "../../lib/listing.ts";
import { parseClp, parseKm } from "../../lib/parse.ts";
import { visibleHtml } from "../../lib/sanitize.ts";
import type { SearchOutput, Vehicle } from "../../lib/vehicle.ts";

export const PORTAL = "salazarisrael";
export const BASE_URL = "https://www.salazarisrael.cl";

type Condition = "nuevo" | "usado";

/**
 * robots.txt disallows `?marca=`, `?categoria=`, `?utm*`, `?formulario-cotizacion=`,
 * `/buy-process/` and any path containing `vehicle/`. Allowed and verified
 * 2026-10-28: `/vehiculos/<condition>`, `/marcas/<make>/<condition>` and `?page=N`.
 * Model, year, price, km and region are therefore filtered client-side.
 */
export function buildSearchUrls(opts: Pick<SearchOptions, "condition" | "make" | "page">): string[] {
  const conditions: Condition[] =
    opts.condition === "nuevo" ? ["nuevo"] : opts.condition === "usado" ? ["usado"] : ["usado", "nuevo"];
  const query = opts.page !== undefined && opts.page > 1 ? `?page=${opts.page}` : "";
  return conditions.map((condition) => {
    const path = opts.make ? `/marcas/${slugify(opts.make)}/${condition}` : `/vehiculos/${condition}`;
    return `${BASE_URL}${path}${query}`;
  });
}

/** Bot-protection interstitials are reported, never passed. */
export function assertNotBlocked(html: string): void {
  if (/<title>\s*(Just a moment|Attention Required|Access Denied)|captcha-delivery\.com|id="challenge-form"|_Incapsula_Resource/i.test(html)) {
    throw new CliError("API_ERROR", "salazarisrael.cl served a bot-protection challenge page; plain HTTP cannot read it");
  }
}

/** Visible text of an element; tags are separated by a space so adjacent spans do not fuse. */
export function textOf(el: HTMLElement | null): string {
  return el ? visibleHtml(el.outerHTML.replace(/></g, "> <")) : "";
}

const CARD_HREF = /^\/marcas\/[^/]+\/(usado|nuevo)\/([^/?#]+)$/;

/** The title block is the first element whose children are all spans (title, body type, make, model[, version]). */
function titleSpans(card: HTMLElement): string[] {
  for (const el of card.querySelectorAll("*")) {
    const kids = el.childNodes.filter((n): n is HTMLElement => "tagName" in n);
    if (kids.length >= 3 && kids.every((k) => k.tagName === "SPAN")) return kids.map(textOf).filter((t) => t !== "");
  }
  return [];
}

function imageOf(card: HTMLElement): string | null {
  for (const img of card.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    if (!src.startsWith("/_next/image?")) continue;
    const real = new URLSearchParams(src.slice(src.indexOf("?") + 1)).get("url");
    if (real?.startsWith("https://")) return real;
  }
  return null;
}

function cardToVehicle(card: HTMLElement): Vehicle | null {
  const anchor = card.querySelectorAll("a[href]").find((a) => CARD_HREF.test(a.getAttribute("href") ?? ""));
  const href = anchor?.getAttribute("href") ?? "";
  const match = CARD_HREF.exec(href);
  const [title, bodyType, make, model, version] = titleSpans(card);
  if (!match || !title) return null;
  const condition = match[1] as Condition;
  const slug = match[2]!;

  const specs = card
    .querySelectorAll("span")
    .map(textOf)
    .find((t) => /^\d{4}\s*\|/.test(t));
  const [year, km, transmission, fuel] = specs ? specs.split("|").map((p) => p.trim()) : [];

  const cardText = textOf(card);
  const priceText = textOf(card.querySelector('[data-testid="card-price-centred"]'));
  const price = /\$\s*([\d.]+)/.exec(priceText)?.[1];
  const bono = /(Incluye bono de|Bono de)\s*\$\s*([\d.]+)/i.exec(priceText);
  const cuota = /Cuota\s*\$\s*([\d.]+)\*?\s*\/\s*(\d+)\s*meses/i.exec(cardText);
  const notes = [
    price ? `${/^Desde/i.test(priceText) ? "Desde " : ""}$${price}${/IVA incluido/i.test(priceText) ? " IVA incluido" : ""}` : null,
    bono ? `${bono[1]} $${bono[2]}` : null,
    cuota ? `Cuota $${cuota[1]} / ${cuota[2]} meses` : null,
  ].filter((n): n is string => n !== null);
  const image = imageOf(card);
  const branch = textOf(card.querySelector('[data-testid="card-branch-location"]'));

  return {
    id: condition === "usado" ? (/-(\d+)$/.exec(slug)?.[1] ?? slug) : slug,
    portal: PORTAL,
    url: `${BASE_URL}${href}`,
    title,
    make: make ?? null,
    model: model ?? null,
    version: version ?? null,
    year: year && /^\d{4}$/.test(year) ? Number(year) : null,
    km: km ? parseKm(km) : null,
    priceClp: price ? parseClp(price) : null,
    priceUf: null,
    currency: price ? "CLP" : null,
    condition,
    transmission: transmission || null,
    fuel: fuel || null,
    bodyType: bodyType ?? null,
    sellerType: "dealer",
    comuna: branch || null,
    region: null,
    plate: null,
    description: notes.length > 0 ? notes.join(". ") : null,
    postedDate: null,
    ...(image ? { images: [image] } : {}),
  };
}

/** Parse the `<article>` cards of a results page (server-rendered Next.js HTML). */
export function parseSearchHtml(html: string): Vehicle[] {
  const seen = new Set<string>();
  const vehicles: Vehicle[] = [];
  for (const card of parse(html, { comment: false }).querySelectorAll("article")) {
    const vehicle = cardToVehicle(card);
    if (vehicle && !seen.has(vehicle.url)) {
      seen.add(vehicle.url);
      vehicles.push(vehicle);
    }
  }
  return vehicles;
}

/** Page N is fetched server-side; every other filter runs client-side over its cards. */
export async function search(opts: SearchOptions, fetchOptions: HtmlFetchOptions = {}): Promise<SearchOutput> {
  const byUrl = new Map<string, Vehicle>();
  for (const url of buildSearchUrls(opts)) {
    const html = await htmlFetch(url, fetchOptions);
    assertNotBlocked(html);
    for (const v of parseSearchHtml(html)) if (!byUrl.has(v.url)) byUrl.set(v.url, v);
  }
  const matches = filterVehicles([...byUrl.values()], opts);
  const perPage = opts.limit ?? DEFAULT_LIMIT;
  return { meta: { total: matches.length, page: opts.page ?? 1, perPage }, results: matches.slice(0, perPage) };
}
