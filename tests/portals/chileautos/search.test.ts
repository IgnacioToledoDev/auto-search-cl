import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CliError } from "../../../src/lib/cliGuard.ts";
import { HttpError } from "../../../src/lib/http.ts";
import { VehicleSchema } from "../../../src/lib/vehicle.ts";
import {
  assertNotBlocked,
  buildSearchUrl,
  filterVehicles,
  parseSearchHtml,
  search,
} from "../../../src/portals/chileautos/search.ts";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const HOME = fixture("home-stockcards.html");
const BLOCKED = fixture("blocked-datadome.html");

/** Wrap StockCard-like nodes in a minimal __NEXT_DATA__ page. */
function pageWith(cards: unknown[]): string {
  const tree = { props: { pageProps: { initialRoot: { wide: { children: cards } } } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(tree)}</script></body></html>`;
}

describe("buildSearchUrl", () => {
  it("uses only path segments and never a query string (robots.txt)", () => {
    for (const condition of [undefined, "nuevo", "usado", "ambos"] as const) {
      expect(buildSearchUrl({ condition })).not.toContain("?");
    }
  });

  it("maps condition to the landing path", () => {
    expect(buildSearchUrl({ condition: "usado" })).toBe(
      "https://www.chileautos.cl/vehiculos/autos-veh%C3%ADculo/usado-tipo/",
    );
    expect(buildSearchUrl({ condition: "nuevo" })).toBe(
      "https://www.chileautos.cl/vehiculos/autos-veh%C3%ADculo/nuevo-tipo/",
    );
    expect(buildSearchUrl({ condition: "ambos" })).toBe(
      "https://www.chileautos.cl/vehiculos/autos-veh%C3%ADculo/",
    );
  });
});

describe("assertNotBlocked", () => {
  it("throws API_ERROR naming DataDome on the captured challenge page", () => {
    expect(() => assertNotBlocked(BLOCKED)).toThrow(CliError);
    expect(() => assertNotBlocked(BLOCKED)).toThrow(/DataDome|bot protection/i);
  });

  it("accepts a normal page", () => {
    expect(() => assertNotBlocked(HOME)).not.toThrow();
  });
});

describe("parseSearchHtml (real StockCard fixture)", () => {
  const vehicles = parseSearchHtml(HOME);

  it("extracts every card as a schema-valid Vehicle", () => {
    expect(vehicles).toHaveLength(3);
    for (const v of vehicles) expect(() => VehicleSchema.parse(v)).not.toThrow();
  });

  it("maps fields from the card", () => {
    expect(vehicles[0]).toMatchObject({
      id: "GI-AD-945645",
      portal: "chileautos",
      url: "https://www.chileautos.cl/vehiculos/detalles/deepal-s07/GI-AD-945645",
      title: "Deepal S07",
      make: "Deepal",
      model: "S07",
      km: 9918,
      priceClp: 25590000,
      priceUf: null,
      currency: "CLP",
      year: null,
      plate: null,
      description: null,
    });
    expect(vehicles[0]!.images?.[0]).toContain("pxcrush.net");
    expect(vehicles[2]).toMatchObject({ make: "Mercedes-Benz", model: "Actros", km: 141921 });
  });

  it("returns null for fields the card does not expose", () => {
    const v = vehicles[0]!;
    expect([v.version, v.transmission, v.fuel, v.bodyType, v.sellerType, v.comuna, v.region, v.postedDate]).toEqual(
      Array(8).fill(null),
    );
  });

  it("infers condition from the requested filter, else from km", () => {
    expect(vehicles.every((v) => v.condition === "usado")).toBe(true);
    expect(parseSearchHtml(HOME, "nuevo").every((v) => v.condition === "nuevo")).toBe(true);
    const zeroKm = pageWith([
      {
        type: "StockCard",
        action: { data: { url: "https://www.chileautos.cl/vehiculos/detalles/a-b/X-1", id: "X-1" } },
        head: { children: [{ type: "Text", value: "A B" }] },
        foot: { children: [{ type: "Text", value: "0 km" }, { type: "Text", value: "$10.000.000" }] },
      },
    ]);
    expect(parseSearchHtml(zeroKm)[0]!.condition).toBe("nuevo");
  });

  it("reads UF prices into priceUf", () => {
    const html = pageWith([
      {
        type: "StockCard",
        action: { data: { url: "https://www.chileautos.cl/vehiculos/detalles/a-b/X-2", id: "X-2" } },
        head: { children: [{ type: "Text", value: "A B" }] },
        foot: { children: [{ type: "Text", value: "UF 450,5" }] },
      },
    ]);
    expect(parseSearchHtml(html)[0]).toMatchObject({ priceUf: 450.5, priceClp: null, currency: "UF" });
  });

  it("returns an empty list when there is no __NEXT_DATA__", () => {
    expect(parseSearchHtml("<html><body>nothing</body></html>")).toEqual([]);
  });

  it("strips hidden/invisible characters from fetched text", () => {
    const evil = "Honda​ Civic\u{E0049}\u{E0047}‮";
    const html = pageWith([
      {
        type: "StockCard",
        action: { data: { url: "https://www.chileautos.cl/vehiculos/detalles/h-c/X-3", id: "X-3" } },
        head: { children: [{ type: "Text", value: evil }] },
        foot: { children: [] },
      },
    ]);
    const [v] = parseSearchHtml(html);
    expect(v!.title).toBe("Honda Civic");
    expect(JSON.stringify(v)).not.toMatch(/[​‮\u{E0000}-\u{E007F}]/u);
  });
});

describe("filterVehicles", () => {
  const vehicles = parseSearchHtml(HOME);

  it("filters by price, km, make/model and free text", () => {
    expect(filterVehicles(vehicles, { priceMax: 10_000_000 }).map((v) => v.id)).toEqual(["CP-AD-8563470"]);
    expect(filterVehicles(vehicles, { kmMax: 10_000 })).toHaveLength(1);
    expect(filterVehicles(vehicles, { make: "mercedes" })).toHaveLength(1);
    expect(filterVehicles(vehicles, { model: "s07" })).toHaveLength(1);
    expect(filterVehicles(vehicles, { query: "ACTROS" })).toHaveLength(1);
  });

  it("drops listings with an unknown value only when that filter is set", () => {
    expect(filterVehicles(vehicles, { yearMin: 2020 })).toEqual([]);
    expect(filterVehicles(vehicles, {})).toHaveLength(3);
  });
});

describe("search", () => {
  const ok = () => vi.fn(async () => new Response(HOME, { status: 200 }));

  it("fetches the allowed path and returns SearchOutput with paging", async () => {
    const fetchFn = ok();
    const out = await search({ condition: "usado", limit: 2, page: 1 }, { fetch: fetchFn });
    expect((fetchFn.mock.calls as unknown as Array<[string]>)[0]![0]).toBe("https://www.chileautos.cl/vehiculos/autos-veh%C3%ADculo/usado-tipo/");
    expect(out.meta).toEqual({ total: 3, page: 1, perPage: 2 });
    expect(out.results).toHaveLength(2);
    const page2 = await search({ limit: 2, page: 2 }, { fetch: ok() });
    expect(page2.results.map((v) => v.id)).toHaveLength(1);
  });

  it("surfaces a DataDome challenge served with status 200", async () => {
    const fetchFn = vi.fn(async () => new Response(BLOCKED, { status: 200 }));
    await expect(search({}, { fetch: fetchFn })).rejects.toThrow(/DataDome|bot protection/i);
  });

  it("does not retry a 403 block (non-retryable) and reports it", async () => {
    const fetchFn = vi.fn(async () => new Response(BLOCKED, { status: 403 }));
    const sleep = vi.fn(async () => {});
    const err = await search({}, { fetch: fetchFn, sleep }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(403);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries 503 with backoff then succeeds", async () => {
    const queue = [new Response("", { status: 503 }), new Response(HOME, { status: 200 })];
    const fetchFn = vi.fn(async () => queue.shift()!);
    const sleep = vi.fn(async () => {});
    const out = await search({}, { fetch: fetchFn, sleep, random: () => 0 });
    expect(out.results).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("passes a timeout signal to fetch", async () => {
    const fetchFn = ok();
    await search({}, { fetch: fetchFn, timeoutMs: 1234 });
    const init = (fetchFn.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
