import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CliError } from "../../../src/lib/cliGuard.ts";
import { VehicleSchema } from "../../../src/lib/vehicle.ts";
import { buildSearchUrl, parseSearchJson, search } from "../../../src/portals/mercadolibre/search.ts";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const SEARCH = fixture("synthetic-search.json");
const FORBIDDEN = fixture("api-forbidden.json");

describe("buildSearchUrl", () => {
  it("targets the public API on the vehicles category, never the HTML listing", () => {
    const url = new URL(buildSearchUrl({ query: "yaris", page: 2, limit: 10 }));
    expect(url.origin).toBe("https://api.mercadolibre.com");
    expect(url.pathname).toBe("/sites/MLC/search");
    expect(url.searchParams.get("category")).toBe("MLC1744");
    expect(url.searchParams.get("q")).toBe("yaris");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("offset")).toBe("10");
  });

  it("folds make/model into q and maps condition to ITEM_CONDITION", () => {
    const url = new URL(buildSearchUrl({ make: "Toyota", model: "Yaris", condition: "nuevo" }));
    expect(url.searchParams.get("q")).toBe("Toyota Yaris");
    expect(url.searchParams.get("ITEM_CONDITION")).toBe("2230284");
    expect(new URL(buildSearchUrl({ condition: "usado" })).searchParams.get("ITEM_CONDITION")).toBe("2230581");
    expect(new URL(buildSearchUrl({})).searchParams.has("ITEM_CONDITION")).toBe(false);
  });
});

describe("parseSearchJson (synthetic, documented API shape)", () => {
  const vehicles = parseSearchJson(SEARCH);

  it("skips entries without an id and returns schema-valid vehicles", () => {
    expect(vehicles).toHaveLength(3);
    for (const v of vehicles) expect(() => VehicleSchema.parse(v)).not.toThrow();
  });

  it("maps attributes, price, seller and location", () => {
    expect(vehicles[0]).toMatchObject({
      id: "MLC1000000001", portal: "mercadolibre", make: "Toyota", model: "Yaris", version: "1.5 Sport",
      year: 2019, km: 62000, priceClp: 9990000, priceUf: null, currency: "CLP", condition: "usado",
      transmission: "Automática", fuel: "Nafta", sellerType: "dealer", comuna: "Santiago", region: "Región Metropolitana",
    });
    expect(vehicles[0]!.images).toEqual(["https://http2.mlstatic.com/D_1000000001-I.jpg"]);
  });

  it("handles UF and USD prices, new condition, particular seller and alternate location shape", () => {
    expect(vehicles[1]).toMatchObject({ priceUf: 650, priceClp: null, currency: "UF", condition: "nuevo", sellerType: "particular", comuna: "Concón", region: "Valparaíso", km: 0 });
    expect(vehicles[2]).toMatchObject({ priceUf: null, priceClp: null, currency: "USD", sellerType: null, km: null, year: null, comuna: null });
  });

  it("strips hidden/invisible characters", () => {
    expect(vehicles[1]!.title).toBe("Hyundai Tucson 2.0 Premium");
    expect(JSON.stringify(vehicles)).not.toMatch(/[​‮\u{E0000}-\u{E007F}]/u);
  });

  it("rejects non-JSON and unexpected payloads with API_ERROR", () => {
    expect(() => parseSearchJson("<html>nope</html>")).toThrow(CliError);
    expect(() => parseSearchJson("{\"foo\":1}")).toThrow(/results/);
  });
});

describe("search", () => {
  const ok = () => vi.fn(async () => new Response(SEARCH, { status: 200 }));

  it("returns SearchOutput applying client-side filters and condition", async () => {
    const fetchFn = ok();
    const out = await search({ priceMax: 10_000_000, limit: 5 }, { fetch: fetchFn });
    expect(out.results.map((v) => v.id)).toEqual(["MLC1000000001"]);
    expect(out.meta).toMatchObject({ page: 1, perPage: 5 });
    expect((fetchFn.mock.calls as unknown as Array<[string]>)[0]![0]).toContain("api.mercadolibre.com/sites/MLC/search");
  });

  it("reports that the API requires authorization on the real 403 body, without retrying", async () => {
    const fetchFn = vi.fn(async () => new Response(FORBIDDEN, { status: 403 }));
    const sleep = vi.fn(async () => {});
    const err = await search({}, { fetch: fetchFn, sleep }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe("API_ERROR");
    expect((err as CliError).message).toMatch(/403.*MERCADOLIBRE_ACCESS_TOKEN/s);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("sends a bearer token only when the user supplied one", async () => {
    const fetchFn = ok();
    await search({}, { fetch: fetchFn }, { MERCADOLIBRE_ACCESS_TOKEN: "tok" });
    const init = (fetchFn.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const bare = ok();
    await search({}, { fetch: bare }, {});
    expect(((bare.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("retries 503 with backoff then succeeds, and passes a timeout signal", async () => {
    const queue = [new Response("", { status: 503 }), new Response(SEARCH, { status: 200 })];
    const fetchFn = vi.fn(async () => queue.shift()!);
    const sleep = vi.fn(async () => {});
    const out = await search({}, { fetch: fetchFn, sleep, random: () => 0, timeoutMs: 1234 }, {});
    expect(out.results).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].signal).toBeInstanceOf(AbortSignal);
  });
});
