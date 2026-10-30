import { describe, expect, it } from "vitest";
import type { Vehicle } from "../../src/lib/vehicle.ts";
import { ProfileSchema } from "../../src/matching/profile.ts";
import { applyAi, median, medianComparablePrice, scoreVehicle, verdictFor } from "../../src/matching/score.ts";

const profile = (over: Record<string, unknown> = {}) =>
  ProfileSchema.parse({ condition: "ambos", budgetMaxClp: 10_000_000, ...over });

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "1", portal: "yapo", url: "https://example.cl/1", title: "Suzuki Swift 2024",
  make: "Suzuki", model: "Swift", version: null, year: 2024, km: 5_000, priceClp: 7_000_000,
  priceUf: null, currency: "CLP", condition: "usado", transmission: "Automática", fuel: "Bencina",
  bodyType: "Hatchback", sellerType: "dealer", comuna: "Providencia", region: "Metropolitana",
  plate: null, description: "Un dueño, mantenciones al día", postedDate: null, ...over,
});
const ctx = (over: Record<string, unknown> = {}) => ({ currentYear: 2026, ...over });

describe("verdictFor", () => {
  it.each([
    [100, "Strong"], [75, "Strong"], [74, "Good"], [60, "Good"], [59, "Moderate"],
    [45, "Moderate"], [44, "Weak"], [30, "Weak"], [29, "Poor"], [0, "Poor"],
  ])("%i -> %s", (score, verdict) => {
    expect(verdictFor(score)).toBe(verdict);
  });
});

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("medianComparablePrice", () => {
  it("uses same make+model within year +-1, excluding self and unpriced", () => {
    const self = vehicle({ id: "self", priceClp: 7_000_000 });
    const others = [
      vehicle({ id: "a", priceClp: 8_000_000, year: 2025 }),
      vehicle({ id: "b", priceClp: 9_000_000, year: 2023 }),
      vehicle({ id: "c", priceClp: 1_000_000, year: 2020 }), // year too far
      vehicle({ id: "d", priceClp: 2_000_000, model: "Baleno" }), // other model
      vehicle({ id: "e", priceClp: null, priceUf: null }), // unpriced
      self,
    ];
    expect(medianComparablePrice(self, others, { minSamples: 2 })).toBe(8_500_000);
  });

  it("returns null below the minimum sample size", () => {
    const self = vehicle();
    expect(medianComparablePrice(self, [self, vehicle({ id: "x", priceClp: 8_000_000 })])).toBeNull();
  });
});

describe("scoreVehicle", () => {
  it("scores an ideal listing as Strong with every dimension at max", () => {
    const p = profile({
      budgetIdealClp: 8_000_000, makesPreferred: ["suzuki"], modelsPreferred: ["swift"],
      bodyTypes: ["hatchback"], fuels: ["bencina"], transmissions: ["automatica"],
      mustHaves: ["un dueño"], sellerTypePreference: "dealer", regions: ["Metropolitana"],
    });
    const r = scoreVehicle(vehicle(), p, ctx());
    expect(r.breakdown.price.points).toBe(30);
    expect(r.breakdown.spec.points).toBe(25);
    expect(r.breakdown.seller.points).toBe(20);
    expect(r.breakdown.condition.points).toBeGreaterThan(22);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.verdict).toBe("Strong");
    expect(r.strengths.length).toBeGreaterThan(0);
  });

  it("gives nuevo full condition points", () => {
    const r = scoreVehicle(vehicle({ condition: "nuevo", year: null, km: null }), profile(), ctx());
    expect(r.breakdown.condition).toEqual({ points: 25, max: 25 });
  });

  it("penalizes old, high-km usado and reports gaps", () => {
    const p = profile({ kmMax: 100_000 });
    const good = scoreVehicle(vehicle(), p, ctx());
    const bad = scoreVehicle(vehicle({ year: 2012, km: 150_000 }), p, ctx());
    expect(bad.breakdown.condition.points).toBeLessThan(good.breakdown.condition.points / 2);
    expect(bad.gaps.join(" ")).toMatch(/km/i);
  });

  it("scores price against ideal/max budget", () => {
    const p = profile({ budgetIdealClp: 7_000_000 });
    const cheap = scoreVehicle(vehicle({ priceClp: 6_000_000 }), p, ctx());
    const dear = scoreVehicle(vehicle({ priceClp: 9_900_000 }), p, ctx());
    expect(cheap.breakdown.price.points).toBe(30);
    expect(dear.breakdown.price.points).toBeLessThan(15);
  });

  it("blends market median when comparables exist", () => {
    const base = scoreVehicle(vehicle({ priceClp: 7_000_000 }), profile(), ctx());
    const cheapVsMarket = scoreVehicle(vehicle({ priceClp: 7_000_000 }), profile(), ctx({ medianPriceClp: 10_000_000 }));
    const dearVsMarket = scoreVehicle(vehicle({ priceClp: 7_000_000 }), profile(), ctx({ medianPriceClp: 5_000_000 }));
    expect(cheapVsMarket.breakdown.price.points).toBeGreaterThanOrEqual(base.breakdown.price.points - 1);
    expect(dearVsMarket.breakdown.price.points).toBeLessThan(cheapVsMarket.breakdown.price.points);
    expect(cheapVsMarket.strengths.join(" ")).toMatch(/below market/i);
    expect(dearVsMarket.gaps.join(" ")).toMatch(/above market/i);
  });

  it("gives half price points when price is unknown", () => {
    const r = scoreVehicle(vehicle({ priceClp: null }), profile(), ctx());
    expect(r.breakdown.price.points).toBe(15);
    expect(r.gaps.join(" ")).toMatch(/price unknown/i);
  });

  it("scores spec by matched preferences and must-haves", () => {
    const p = profile({ makesPreferred: ["Toyota"], bodyTypes: ["hatchback"], mustHaves: ["techo solar", "un dueño"] });
    const r = scoreVehicle(vehicle(), p, ctx());
    // criteria: make(miss), body(hit), must-have x2 (1 hit) -> 2/4
    expect(r.breakdown.spec.points).toBeCloseTo(12.5, 5);
    expect(r.gaps.join(" ")).toMatch(/techo solar/);
  });

  it("scores body type through the make/model resolver", () => {
    const p = profile({ bodyTypes: ["SUV"] });
    const suv = scoreVehicle(vehicle({ make: "Nissan", model: "Qashqai", bodyType: "Automovil" }), p, ctx());
    expect(suv.breakdown.spec.points).toBe(25);
    expect(suv.strengths.join(" ")).toMatch(/body type/i);
    const hatch = scoreVehicle(vehicle({ make: "Chevrolet", model: "Onix", bodyType: "Automovil" }), p, ctx());
    expect(hatch.breakdown.spec.points).toBe(0);
    const unknown = scoreVehicle(vehicle({ make: "Foo", model: "Bar", bodyType: "Automovil" }), p, ctx());
    expect(unknown.breakdown.spec.points).toBe(12.5);
    expect(unknown.gaps.join(" ")).toMatch(/body type unknown/i);
  });

  it("scores seller preference and location", () => {
    const p = profile({ sellerTypePreference: "particular", regions: ["Valparaíso"] });
    const r = scoreVehicle(vehicle(), p, ctx());
    expect(r.breakdown.seller.points).toBe(0);
    const ok = scoreVehicle(vehicle({ sellerType: "particular", region: "Valparaíso" }), p, ctx());
    expect(ok.breakdown.seller.points).toBe(20);
  });

  it("honours weight overrides and normalizes to 0-100", () => {
    const p = profile({ weights: { price: 100, spec: 0, condition: 0, seller: 0 }, budgetIdealClp: 8_000_000 });
    const r = scoreVehicle(vehicle(), p, ctx());
    expect(r.breakdown.price.max).toBe(100);
    expect(r.score).toBe(100);
  });
});

describe("applyAi", () => {
  const det = scoreVehicle(vehicle(), profile(), ctx());
  it("keeps the deterministic result without an ai result", () => {
    expect(applyAi(det)).toEqual({ score: det.score, verdict: det.verdict, strengths: det.strengths, gaps: det.gaps });
  });

  it("blends 0.7/0.3, recomputes verdict and merges unique strengths/gaps", () => {
    const base = { ...det, score: 80, strengths: ["a"], gaps: ["x"] };
    const r = applyAi(base, { score: 20, strengths: ["a", "b"], gaps: ["y"] });
    expect(r.score).toBe(Math.round(0.7 * 80 + 0.3 * 20)); // 62
    expect(r.verdict).toBe("Good");
    expect(r.strengths).toEqual(["a", "b"]);
    expect(r.gaps).toEqual(["x", "y"]);
  });
});
