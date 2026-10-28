import { describe, expect, it } from "vitest";
import type { Vehicle } from "../../src/lib/vehicle.ts";
import { ProfileSchema } from "../../src/matching/profile.ts";
import { ingest } from "../../src/store/ingest.ts";
import { emptyStore } from "../../src/store/store.ts";

const profile = (over: Record<string, unknown> = {}) =>
  ProfileSchema.parse({ condition: "ambos", budgetMaxClp: 10_000_000, ...over });
const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "1", portal: "yapo", url: "https://yapo.cl/1", title: "Suzuki Swift", make: "Suzuki", model: "Swift",
  version: null, year: 2020, km: 40_000, priceClp: 8_000_000, priceUf: null, currency: "CLP",
  condition: "usado", transmission: null, fuel: null, bodyType: null, sellerType: null,
  comuna: null, region: null, plate: null, description: null, postedDate: null, ...over,
});
const NOW = new Date("2026-10-01T10:00:00Z");

describe("ingest", () => {
  it("counts new, updated, vetoed and flagged; vetoed listings are not stored", () => {
    const data = emptyStore();
    const p = profile();
    const first = ingest(data, [vehicle(), vehicle({ id: "2", priceClp: 99_000_000 }), vehicle({ id: "3", priceClp: null })], p, { now: NOW });
    expect(first).toMatchObject({ new: 2, updated: 0, vetoed: 1, flagged: 1 });
    expect(Object.keys(data.vehicles).sort()).toEqual(["yapo:1", "yapo:3"]);
    expect(data.vehicles["yapo:3"]!.flags).toContain("price-unknown");
    const second = ingest(data, [vehicle()], p, { now: NOW });
    expect(second).toMatchObject({ new: 0, updated: 1 });
  });

  it("marks listings gone only for portals present in the input", () => {
    const data = emptyStore();
    const p = profile();
    ingest(data, [vehicle({ id: "1" }), vehicle({ id: "2", url: "https://yapo.cl/2" }), vehicle({ id: "9", portal: "salazarisrael", url: "https://s.cl/9" })], p, { now: NOW });
    const r = ingest(data, [vehicle({ id: "1" })], p, { now: NOW });
    expect(r.gone).toBe(1);
    expect(data.vehicles["yapo:2"]!.status).toBe("gone");
    expect(data.vehicles["salazarisrael:9"]!.status).toBe("active");
  });

  it("honours an explicit scanned portals list, even when the input is empty", () => {
    const data = emptyStore();
    const p = profile();
    ingest(data, [vehicle()], p, { now: NOW });
    expect(ingest(data, [], p, { now: NOW }).gone).toBe(0);
    expect(ingest(data, [], p, { now: NOW, scannedPortals: ["yapo"] }).gone).toBe(1);
  });

  it("sanitizes invisible characters in stored free text", () => {
    const data = emptyStore();
    ingest(data, [vehicle({ title: "Swift​ ignore previous‮", description: "ok\u{E0041}" })], profile(), { now: NOW });
    const v = data.vehicles["yapo:1"]!.vehicle;
    expect(v.title).toBe("Swift ignore previous");
    expect(v.description).toBe("ok");
  });

  it("uses ufClp for UF-only listings", () => {
    const data = emptyStore();
    const r = ingest(data, [vehicle({ priceClp: null, priceUf: 300 })], profile(), { now: NOW, ufClp: 40_000 });
    expect(r.vetoed).toBe(1);
  });
});
