import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CliError } from "../../../src/lib/cliGuard.ts";
import { VehicleSchema } from "../../../src/lib/vehicle.ts";
import { detail, normalizeItemId, parseItemJson } from "../../../src/portals/mercadolibre/detail.ts";

const ITEM = readFileSync(new URL("./fixtures/synthetic-item.json", import.meta.url), "utf8");
const FORBIDDEN = readFileSync(new URL("./fixtures/api-forbidden.json", import.meta.url), "utf8");

describe("normalizeItemId", () => {
  it("accepts ids and MLC- permalinks", () => {
    expect(normalizeItemId("MLC1000000001")).toBe("MLC1000000001");
    expect(normalizeItemId("mlc-1000000001")).toBe("MLC1000000001");
    expect(normalizeItemId("https://auto.mercadolibre.cl/MLC-1000000001-toyota-yaris-_JM?x=1")).toBe("MLC1000000001");
  });

  it("rejects other hosts and garbage", () => {
    expect(() => normalizeItemId("https://evil.example/MLC-1000000001-x")).toThrow(CliError);
    expect(() => normalizeItemId("hello")).toThrow(/MLC/);
  });
});

describe("parseItemJson (synthetic, documented API shape)", () => {
  it("maps a full item to a schema-valid Vehicle", () => {
    const v = parseItemJson(ITEM);
    expect(() => VehicleSchema.parse(v)).not.toThrow();
    expect(v).toMatchObject({
      id: "MLC1000000001", portal: "mercadolibre", make: "Toyota", model: "Yaris", version: "1.5 Sport",
      year: 2019, km: 62000, priceClp: 9990000, bodyType: "Hatchback", fuel: "Nafta", transmission: "Automática",
      sellerType: "dealer", comuna: "Santiago", region: "Región Metropolitana", postedDate: "2026-09-30T14:03:11.000Z",
    });
    expect(v.images).toHaveLength(2);
  });

  it("sanitizes hidden text in titles", () => {
    const item = JSON.parse(ITEM);
    item.title = "Yaris​\u{E0049}‮ ok";
    expect(parseItemJson(JSON.stringify(item)).title).toBe("Yaris ok");
  });

  it("rejects invalid payloads", () => {
    expect(() => parseItemJson("not json")).toThrow(CliError);
    expect(() => parseItemJson("{}")).toThrow(/item/);
  });
});

describe("detail", () => {
  it("fetches /items/<id> with retry support", async () => {
    const queue = [new Response("", { status: 502 }), new Response(ITEM, { status: 200 })];
    const fetchFn = vi.fn(async () => queue.shift()!);
    const v = await detail("MLC-1000000001", { fetch: fetchFn, sleep: async () => {}, random: () => 0 }, {});
    expect((fetchFn.mock.calls as unknown as Array<[string]>)[0]![0]).toBe("https://api.mercadolibre.com/items/MLC1000000001");
    expect(v.make).toBe("Toyota");
  });

  it("explains the authorization requirement on 403", async () => {
    const fetchFn = vi.fn(async () => new Response(FORBIDDEN, { status: 403 }));
    await expect(detail("MLC1000000001", { fetch: fetchFn }, {})).rejects.toThrow(/403.*MERCADOLIBRE_ACCESS_TOKEN/s);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
