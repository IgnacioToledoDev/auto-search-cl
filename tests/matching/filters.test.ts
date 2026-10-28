import { describe, expect, it } from "vitest";
import { applyHardFilters, effectivePriceClp } from "../../src/matching/filters.ts";
import { ProfileSchema } from "../../src/matching/profile.ts";
import type { Vehicle } from "../../src/lib/vehicle.ts";

const profile = (over: Record<string, unknown> = {}) =>
  ProfileSchema.parse({ condition: "ambos", budgetMaxClp: 10_000_000, ...over });

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "1", portal: "yapo", url: "https://example.cl/1", title: "Suzuki Swift 2020",
  make: "Suzuki", model: "Swift", version: null, year: 2020, km: 40_000, priceClp: 8_000_000,
  priceUf: null, currency: "CLP", condition: "usado", transmission: "Manual", fuel: "Bencina",
  bodyType: "Hatchback", sellerType: "dealer", comuna: "Providencia", region: "Metropolitana",
  plate: null, description: "Un solo dueño", postedDate: null, ...over,
});

describe("effectivePriceClp", () => {
  it("prefers CLP, converts UF with ufClp, else null", () => {
    expect(effectivePriceClp(vehicle())).toBe(8_000_000);
    expect(effectivePriceClp(vehicle({ priceClp: null, priceUf: 250 }), 40_000)).toBe(10_000_000);
    expect(effectivePriceClp(vehicle({ priceClp: null, priceUf: 250 }))).toBeNull();
    expect(effectivePriceClp(vehicle({ priceClp: null, priceUf: null }), 40_000)).toBeNull();
  });
});

describe("applyHardFilters", () => {
  it("passes a clean listing with no vetoes or flags", () => {
    expect(applyHardFilters(vehicle(), profile())).toEqual({ pass: true, vetoes: [], flags: [] });
  });

  it("vetoes above budget, keeps null price flagged", () => {
    expect(applyHardFilters(vehicle({ priceClp: 10_000_001 }), profile()).vetoes).toContain("over-budget");
    const unknown = applyHardFilters(vehicle({ priceClp: null }), profile());
    expect(unknown.pass).toBe(true);
    expect(unknown.flags).toContain("price-unknown");
  });

  it("converts UF-only prices with the profile ufClp", () => {
    const v = vehicle({ priceClp: null, priceUf: 300 });
    expect(applyHardFilters(v, profile({ ufClp: 40_000 })).vetoes).toContain("over-budget");
    expect(applyHardFilters(v, profile({ ufClp: 30_000 })).pass).toBe(true);
    expect(applyHardFilters(v, profile(), 40_000).vetoes).toContain("over-budget");
    expect(applyHardFilters(v, profile()).flags).toContain("price-unknown");
  });

  it("vetoes excluded makes, accent/case-insensitive", () => {
    const r = applyHardFilters(vehicle({ make: "SUZUKİ" }), profile({ makesExcluded: ["suzuki"] }));
    expect(r.vetoes).toContain("excluded-make");
    const t = applyHardFilters(vehicle({ make: null, title: "Citroën C3" }), profile({ makesExcluded: ["citroen"] }));
    expect(t.vetoes).toContain("excluded-make");
  });

  it("vetoes condition mismatch only when profile is not ambos", () => {
    expect(applyHardFilters(vehicle(), profile({ condition: "nuevo" })).vetoes).toContain("condition-mismatch");
    expect(applyHardFilters(vehicle({ condition: "nuevo" }), profile({ condition: "usado" })).vetoes).toContain("condition-mismatch");
    expect(applyHardFilters(vehicle(), profile({ condition: "usado" })).pass).toBe(true);
  });

  it("applies yearMin, flags unknown year", () => {
    expect(applyHardFilters(vehicle({ year: 2015 }), profile({ yearMin: 2018 })).vetoes).toContain("year-too-old");
    expect(applyHardFilters(vehicle({ year: null }), profile({ yearMin: 2018 })).flags).toContain("year-unknown");
  });

  it("applies kmMax to usado only, flags unknown km", () => {
    expect(applyHardFilters(vehicle({ km: 90_000 }), profile({ kmMax: 80_000 })).vetoes).toContain("km-too-high");
    expect(applyHardFilters(vehicle({ km: 90_000, condition: "nuevo" }), profile({ kmMax: 80_000 })).pass).toBe(true);
    expect(applyHardFilters(vehicle({ km: null }), profile({ kmMax: 80_000 })).flags).toContain("km-unknown");
    expect(applyHardFilters(vehicle({ km: null, condition: "nuevo" }), profile({ kmMax: 80_000 })).flags).toEqual([]);
  });

  it("checks region/comuna when known, flags when unknown", () => {
    expect(applyHardFilters(vehicle(), profile({ regions: ["Valparaíso"] })).vetoes).toContain("outside-location");
    expect(applyHardFilters(vehicle(), profile({ regions: ["metropolitana"] })).pass).toBe(true);
    expect(applyHardFilters(vehicle({ region: null, comuna: null }), profile({ regions: ["Valparaíso"] })).flags).toContain("location-unknown");
    // either a matching comuna or a matching region is enough
    expect(applyHardFilters(vehicle(), profile({ regions: ["Valparaíso"], comunas: ["providencia"] })).pass).toBe(true);
  });

  it("vetoes deal-breaker keywords in title or description", () => {
    const r = applyHardFilters(vehicle({ description: "Vehículo CHOCADO, papeles al día" }), profile({ dealBreakers: ["chocado"] }));
    expect(r.vetoes).toContain("deal-breaker:chocado");
    expect(applyHardFilters(vehicle({ title: "Swift ÚNICO dueño" }), profile({ dealBreakers: ["unico dueno"] })).pass).toBe(false);
  });

  it("collects several vetoes at once", () => {
    const r = applyHardFilters(vehicle({ priceClp: 99_000_000, year: 2010 }), profile({ yearMin: 2018 }));
    expect(r.pass).toBe(false);
    expect(r.vetoes).toEqual(expect.arrayContaining(["over-budget", "year-too-old"]));
  });
});
