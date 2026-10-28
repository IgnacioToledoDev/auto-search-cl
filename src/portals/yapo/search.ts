import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import { CliError } from "../../lib/cliGuard.ts";
import { type HtmlFetchOptions, htmlFetch } from "../../lib/http.ts";
import { DEFAULT_LIMIT, type SearchOptions, filterVehicles } from "../../lib/listing.ts";
import { parseClp, parseKm, parseUf } from "../../lib/parse.ts";
import { stripInvisible, visibleHtml } from "../../lib/sanitize.ts";
import type { SearchOutput, Vehicle } from "../../lib/vehicle.ts";

export const PORTAL = "yapo";
export const BASE_URL = "https://www.yapo.cl";

const CATEGORY: Record<"nuevo" | "usado", string> = { usado: "/autos-usados", nuevo: "/autos-nuevos" };

const slug = (text: string): string =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * robots.txt allows these paths. Verified 2026-10-28: `/autos-usados`,
 * `/autos-nuevos`, `/autos-usados/<make>/<model>` and `?page=N`. Make/model
 * path segments are only used for used cars (not verified for new ones).
 */
export function buildSearchUrls(opts: Pick<SearchOptions, "condition" | "make" | "model" | "page">): string[] {
  const conditions: Array<"usado" | "nuevo"> =
    opts.condition === "nuevo" ? ["nuevo"] : opts.condition === "usado" ? ["usado"] : ["usado", "nuevo"];
  const query = opts.page !== undefined && opts.page > 1 ? `?page=${opts.page}` : "";
  return conditions.map((condition) => {
    let path = CATEGORY[condition];
    if (condition === "usado" && opts.make) {
      path += `/${slug(opts.make)}`;
      if (opts.model) path += `/${slug(opts.model)}`;
    }
    return `${BASE_URL}${path}${query}`;
  });
}

/** Cloudflare serves its challenge instead of content; report it, never try to pass it. */
export function assertNotBlocked(html: string): void {
  if (/<title>\s*(Just a moment|Attention Required)|id="challenge-form"|cf-browser-verification/i.test(html)) {
    throw new CliError("API_ERROR", "yapo.cl served a Cloudflare challenge page; plain HTTP cannot read it");
  }
}

const MULTI_WORD_MAKES = ["great wall", "land rover", "alfa romeo", "ssang yong", "aston martin", "rolls royce"];

/** Cards show a free-form title ("Toyota 4runner 4x4 Año 2015"): make = known prefix or first word, model = next word. */
export function splitMakeModel(title: string): { make: string | null; model: string | null } {
  const lower = title.toLowerCase();
  const multi = MULTI_WORD_MAKES.find((m) => lower.startsWith(`${m} `));
  const words = title.split(/\s+/).filter(Boolean);
  const makeWords = multi ? multi.split(" ").length : 1;
  const make = words.slice(0, makeWords).join(" ");
  const model = words[makeWords];
  return { make: make || null, model: model && !/^\d{4}$/.test(model) ? model : null };
}

/** Yapo writes thousands with commas ("19,580,000"), unlike the dot style parseClp expects. */
const dropCommas = (text: string): string => text.replace(/,/g, "");

const visible = (el: HTMLElement | null): string | null => {
  if (!el) return null;
  const text = visibleHtml(el.outerHTML);
  return text === "" ? null : text;
};

/** "Región Metropolitana, Conchalí" -> region + comuna; a single part is the region. */
export function splitLocation(text: string | null): { region: string | null; comuna: string | null } {
  if (!text) return { region: null, comuna: null };
  const [region, ...rest] = text.split(",").map((p) => p.trim());
  return { region: region || null, comuna: rest.join(", ") || null };
}

const TRANSMISSION = /^(autom[aá]tic[ao]|manual|mec[aá]nic[ao]|semiautom[aá]tic[ao]|cvt|dct|tiptronic)$/i;
const DETAIL_HREF = /^\/autos-(usados|nuevos)\/[^/?#]+\/(\d+)$/;

function cardToVehicle(card: HTMLElement): Vehicle | null {
  const match = DETAIL_HREF.exec(card.getAttribute("href") ?? "");
  const title = visible(card.querySelector("h3"));
  if (!match || !title) return null;
  const spans = card.querySelectorAll("span").map((s) => visibleHtml(s.outerHTML));
  const priceText = spans.find((t) => /^(\$|UF)\s*\d/i.test(t)) ?? null;
  const isUf = priceText !== null && /^UF/i.test(priceText);
  const kmText = spans.find((t) => /^\d[\d.,]*\s*km$/i.test(t)) ?? null;
  const yearText = spans.find((t) => /^\d{4}$/.test(t));
  const location = card
    .querySelectorAll("p")
    .filter((p) => !p.hasAttribute("title"))
    .map((p) => visibleHtml(p.outerHTML))
    .find((t) => t !== "" && !t.startsWith("-") && !t.includes("%")) ?? null;
  const descAttr = card.querySelector("p[title]")?.getAttribute("title");
  const description = descAttr ? stripInvisible(descAttr).replace(/\s+/g, " ").trim() || null : null;
  const images = card
    .querySelectorAll("img")
    .map((i) => i.getAttribute("src") ?? "")
    .filter((src) => src.includes("/v1/cl/"));
  const { make, model } = splitMakeModel(title);

  return {
    id: match[2]!,
    portal: PORTAL,
    url: `${BASE_URL}${match[0]}`,
    title,
    make,
    model,
    version: null,
    year: yearText ? Number(yearText) : null,
    km: kmText ? parseKm(dropCommas(kmText)) : null,
    priceClp: priceText && !isUf ? parseClp(dropCommas(priceText)) : null,
    priceUf: priceText && isUf ? parseUf(priceText) : null,
    currency: priceText === null ? null : isUf ? "UF" : "CLP",
    condition: match[1] === "nuevos" ? "nuevo" : "usado",
    transmission: spans.find((t) => TRANSMISSION.test(t)) ?? null,
    fuel: null,
    bodyType: null,
    // Cards carry a seller name for dealers and individuals alike, so the type is unknown.
    sellerType: null,
    ...splitLocation(location),
    plate: null,
    description,
    postedDate: null,
    ...(images.length > 0 ? { images: [images[0]!] } : {}),
  };
}

/** Parse the listing cards of a results page (server-rendered Next.js HTML). */
export function parseSearchHtml(html: string): Vehicle[] {
  const root = parse(html, { comment: false });
  const seen = new Set<string>();
  const vehicles: Vehicle[] = [];
  for (const card of root.querySelectorAll("a[href]")) {
    const vehicle = cardToVehicle(card);
    if (vehicle && !seen.has(vehicle.id)) {
      seen.add(vehicle.id);
      vehicles.push(vehicle);
    }
  }
  return vehicles;
}

const has = (haystack: string | null, needle: string): boolean =>
  haystack !== null && haystack.toLowerCase().includes(needle.toLowerCase());

/** Page N of the portal is fetched server-side; every other filter runs client-side over its cards. */
export async function search(opts: SearchOptions, fetchOptions: HtmlFetchOptions = {}): Promise<SearchOutput> {
  const byId = new Map<string, Vehicle>();
  for (const url of buildSearchUrls(opts)) {
    const html = await htmlFetch(url, fetchOptions);
    assertNotBlocked(html);
    for (const v of parseSearchHtml(html)) if (!byId.has(v.id)) byId.set(v.id, v);
  }
  const { query, make, model, ...rest } = opts;
  const matches = filterVehicles([...byId.values()], rest).filter(
    (v) =>
      (!query || has(v.title, query) || has(v.description, query)) &&
      (!make || has(v.title, make)) &&
      (!model || has(v.title, model)),
  );
  const perPage = opts.limit ?? DEFAULT_LIMIT;
  return { meta: { total: matches.length, page: opts.page ?? 1, perPage }, results: matches.slice(0, perPage) };
}
