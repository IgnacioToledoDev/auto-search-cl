import { describe, expect, it } from "vitest";
import { SearchOutputSchema, VehicleSchema, type Vehicle } from "../../src/lib/vehicle.ts";

const base: Vehicle = {
  id: "MLC-1",
  portal: "mercadolibre",
  url: "https://auto.mercadolibre.cl/MLC-1",
  title: "Toyota Yaris 1.5 2020",
  make: "Toyota",
  model: "Yaris",
  version: "1.5 GLi",
  year: 2020,
  km: 45000,
  priceClp: 9990000,
  priceUf: null,
  currency: "CLP",
  condition: "usado",
  transmission: "Automática",
  fuel: "Bencina",
  bodyType: "Hatchback",
  sellerType: "particular",
  comuna: "Providencia",
  region: "Metropolitana",
  plate: null,
  description: "Único dueño",
  postedDate: "2026-10-01",
};

describe("VehicleSchema", () => {
  it("accepts a complete vehicle", () => {
    expect(VehicleSchema.parse(base)).toEqual(base);
  });
  it("accepts all-null optional values and optional images", () => {
    const sparse = {
      ...base,
      make: null, model: null, version: null, year: null, km: null,
      priceClp: null, priceUf: null, currency: null, transmission: null,
      fuel: null, bodyType: null, sellerType: null, comuna: null,
      region: null, plate: null, description: null, postedDate: null,
      images: ["https://x.cl/a.jpg"],
    };
    expect(VehicleSchema.parse(sparse).images).toEqual(["https://x.cl/a.jpg"]);
  });
  it("rejects undefined (missing) fields instead of silently allowing them", () => {
    const { km: _km, ...rest } = base;
    expect(VehicleSchema.safeParse(rest).success).toBe(false);
  });
  it("rejects invalid enums", () => {
    expect(VehicleSchema.safeParse({ ...base, condition: "seminuevo" }).success).toBe(false);
    expect(VehicleSchema.safeParse({ ...base, sellerType: "agencia" }).success).toBe(false);
  });
  it("rejects invalid url", () => {
    expect(VehicleSchema.safeParse({ ...base, url: "nope" }).success).toBe(false);
  });
});

describe("SearchOutputSchema", () => {
  it("validates meta and results", () => {
    const out = { meta: { total: 1, page: 1, perPage: 20 }, results: [base] };
    expect(SearchOutputSchema.parse(out)).toEqual(out);
  });
  it("rejects bad meta", () => {
    expect(SearchOutputSchema.safeParse({ meta: { total: -1, page: 1, perPage: 20 }, results: [] }).success).toBe(false);
  });
});
