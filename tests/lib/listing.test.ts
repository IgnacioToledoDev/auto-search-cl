import { describe, expect, it } from "vitest";
import { CliError } from "../../src/lib/cliGuard.ts";
import { filterVehicles, paginate, renderTable, slugify, toSearchOptions } from "../../src/lib/listing.ts";
import type { Vehicle } from "../../src/lib/vehicle.ts";

const base: Vehicle = {
  id: "1", portal: "x", url: "https://x.cl/1", title: "Toyota Yaris", make: "Toyota", model: "Yaris",
  version: null, year: 2019, km: 50000, priceClp: 9_000_000, priceUf: null, currency: "CLP",
  condition: "usado", transmission: null, fuel: null, bodyType: null, sellerType: null,
  comuna: null, region: "Metropolitana", plate: null, description: null, postedDate: null,
};
const other: Vehicle = { ...base, id: "2", title: "Kia Rio", make: "Kia", model: "Rio", year: null, km: null, priceClp: null, region: null };

describe("filterVehicles", () => {
  it("filters by text, numeric ranges and region", () => {
    expect(filterVehicles([base, other], { make: "toy" }).map((v) => v.id)).toEqual(["1"]);
    expect(filterVehicles([base, other], { query: "RIO" }).map((v) => v.id)).toEqual(["2"]);
    expect(filterVehicles([base, other], { region: "metro" }).map((v) => v.id)).toEqual(["1"]);
    expect(filterVehicles([base], { yearMin: 2020 })).toEqual([]);
    expect(filterVehicles([base], { priceMax: 8_000_000 })).toEqual([]);
    expect(filterVehicles([base], { kmMax: 60000, yearMax: 2019 })).toHaveLength(1);
  });

  it("drops unknown values only when that filter is set", () => {
    expect(filterVehicles([base, other], {})).toHaveLength(2);
    expect(filterVehicles([other], { kmMax: 1 })).toEqual([]);
  });

  it("filters by condition when it is nuevo or usado", () => {
    const nuevo = { ...base, id: "3", condition: "nuevo" as const };
    expect(filterVehicles([base, nuevo], { condition: "nuevo" }).map((v) => v.id)).toEqual(["3"]);
    expect(filterVehicles([base, nuevo], { condition: "ambos" })).toHaveLength(2);
  });
});

describe("paginate", () => {
  it("slices a page and reports total", () => {
    const out = paginate([base, other], 2, 1);
    expect(out.meta).toEqual({ total: 2, page: 2, perPage: 1 });
    expect(out.results.map((v) => v.id)).toEqual(["2"]);
  });
});

describe("toSearchOptions", () => {
  it("converts CLI options and validates them", () => {
    expect(toSearchOptions({ "price-max": "100", condition: "nuevo", q: undefined as never })).toMatchObject({ priceMax: 100, condition: "nuevo" });
    expect(() => toSearchOptions({ condition: "roto" })).toThrow(CliError);
    expect(() => toSearchOptions({ "year-min": "abc" })).toThrow(/year-min/);
    expect(() => toSearchOptions({ page: "0" })).toThrow(/page/);
  });
});

describe("renderTable", () => {
  it("renders a header and one row per vehicle", () => {
    const text = renderTable({ meta: { total: 1, page: 1, perPage: 20 }, results: [base] });
    expect(text).toContain("total=1 page=1 perPage=20");
    expect(text).toContain("1 | Toyota Yaris | 2019 | 50000 | 9000000 | usado");
  });
});

describe("slugify", () => {
  it("lowercases, strips accents and joins words with hyphens", () => {
    expect(slugify("Great Wall")).toBe("great-wall");
    expect(slugify("  Citroën C3  ")).toBe("citroen-c3");
    expect(slugify("Mercedes-Benz")).toBe("mercedes-benz");
    expect(slugify("RAV4")).toBe("rav4");
  });
});
