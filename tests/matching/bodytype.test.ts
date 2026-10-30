import { describe, expect, it } from "vitest";
import { resolveBodyType } from "../../src/matching/bodytype.ts";
import type { Vehicle } from "../../src/lib/vehicle.ts";

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "1", portal: "bruno-fritsch", url: "https://example.cl/1", title: "Nissan Qashqai 2020",
  make: "Nissan", model: "Qashqai", version: null, year: 2020, km: 40_000, priceClp: 8_000_000,
  priceUf: null, currency: "CLP", condition: "usado", transmission: null, fuel: null,
  bodyType: "Automovil", sellerType: "dealer", comuna: null, region: null,
  plate: null, description: null, postedDate: null, ...over,
});

const SUV = ["SUV"];

describe("resolveBodyType: make/model table", () => {
  it.each([
    ["Nissan", "Qashqai"], ["Renault", "Duster"], ["Chevrolet", "Tracker"], ["Chevrolet", "Captiva"],
    ["Chevrolet", "Groove"], ["Opel", "Crossland"], ["Dodge", "Journey"], ["Hyundai", "Tucson"],
    ["Kia", "Sportage"], ["Toyota", "RAV4"], ["Toyota", "Corolla Cross"], ["Mazda", "CX-5"],
    ["Suzuki", "Vitara"], ["Ford", "Ecosport"], ["Honda", "HR-V"], ["Subaru", "Forester"],
    ["Volkswagen", "T-Cross"], ["Citroën", "C3 Aircross"], ["Jeep", "Renegade"], ["Mitsubishi", "ASX"],
    ["Fiat", "Pulse"], ["Citroen", "C4 Cactus"],
  ])("%s %s is an SUV even when the portal says Automovil", (make, model) => {
    expect(resolveBodyType(vehicle({ make, model }), SUV)).toBe("match");
  });

  it.each([
    ["Nissan", "Versa"], ["Chevrolet", "Onix"], ["Kia", "Morning"], ["Fiat", "Uno"], ["Toyota", "Aygo"],
    ["Kia", "Rio"], ["Hyundai", "Grand i10"], ["Suzuki", "Dzire"], ["Suzuki", "Baleno"],
    ["Hyundai", "Accent"], ["Renault", "Soluto"], ["Kia", "Soluto"],
  ])("%s %s is vetoed for an SUV-only profile", (make, model) => {
    expect(resolveBodyType(vehicle({ make, model, bodyType: "Automovil" }), SUV)).toBe("mismatch");
  });

  it("is accent/case-insensitive and tolerates trim suffixes", () => {
    expect(resolveBodyType(vehicle({ make: "CITROËN", model: "c3 aircross 1.6" }), SUV)).toBe("match");
    expect(resolveBodyType(vehicle({ make: "volkswagen", model: "T-CROSS Comfortline" }), SUV)).toBe("match");
  });

  it("falls back to the title when model is null", () => {
    expect(resolveBodyType(vehicle({ make: null, model: null, title: "Nissan Qashqai 2019 Advance" }), SUV)).toBe("match");
    expect(resolveBodyType(vehicle({ make: null, model: null, title: "Chevrolet Onix 2021", bodyType: null }), SUV)).toBe("mismatch");
  });

  it("does not match a model of another make", () => {
    expect(resolveBodyType(vehicle({ make: "Toyota", model: "Qashqai", bodyType: null }), SUV)).toBe("unknown");
  });

  it("a known SUV is a mismatch for a non-SUV profile", () => {
    expect(resolveBodyType(vehicle({ make: "Nissan", model: "Qashqai" }), ["Sedán"])).toBe("mismatch");
  });

  it("a known non-SUV defers to the portal label when the profile wants other types too", () => {
    expect(resolveBodyType(vehicle({ make: "Nissan", model: "Versa", bodyType: "Sedán" }), ["Sedán", "SUV"])).toBe("match");
    expect(resolveBodyType(vehicle({ make: "Nissan", model: "Versa", bodyType: "Automovil" }), ["Sedán", "SUV"])).toBe("unknown");
  });
});

describe("resolveBodyType: portal label", () => {
  const unlisted = { make: "Foo", model: "Bar", title: "Foo Bar 2020" };
  it("uses a specific label", () => {
    expect(resolveBodyType(vehicle({ ...unlisted, bodyType: "SUV" }), SUV)).toBe("match");
    expect(resolveBodyType(vehicle({ ...unlisted, bodyType: "Todoterreno" }), SUV)).toBe("match");
    expect(resolveBodyType(vehicle({ ...unlisted, bodyType: "Hatchback" }), SUV)).toBe("mismatch");
    expect(resolveBodyType(vehicle({ ...unlisted, bodyType: "Sedán" }), SUV)).toBe("mismatch");
    expect(resolveBodyType(vehicle({ ...unlisted, bodyType: "Sedan" }), ["sedán"])).toBe("match");
  });

  it("treats generic or missing labels as unknown", () => {
    for (const bodyType of ["Automovil", "Automóvil", "Station Wagon", "", null]) {
      expect(resolveBodyType(vehicle({ ...unlisted, bodyType }), SUV)).toBe("unknown");
    }
  });

  it("a generic label still matches when the profile asks for it", () => {
    expect(resolveBodyType(vehicle({ ...unlisted, bodyType: "Station Wagon" }), ["Station Wagon"])).toBe("match");
  });

  it("returns unknown when the profile states no body types", () => {
    expect(resolveBodyType(vehicle(), [])).toBe("unknown");
  });
});
