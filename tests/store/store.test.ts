import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Vehicle } from "../../src/lib/vehicle.ts";
import { emptyStore, loadStore, markGone, saveStore, seenId, upsertVehicle } from "../../src/store/store.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "store-"));
const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "1", portal: "yapo", url: "https://yapo.cl/1", title: "Suzuki Swift 2020",
  make: "Suzuki", model: "Swift", version: null, year: 2020, km: 40_000, priceClp: 8_000_000,
  priceUf: null, currency: "CLP", condition: "usado", transmission: null, fuel: null,
  bodyType: null, sellerType: null, comuna: null, region: null, plate: null,
  description: null, postedDate: null, ...over,
});
const D1 = new Date("2026-10-01T10:00:00Z");
const D2 = new Date("2026-10-02T10:00:00Z");
const D3 = new Date("2026-10-03T10:00:00Z");

describe("loadStore / saveStore", () => {
  it("returns an empty store when the file does not exist", () => {
    expect(loadStore(join(tmp(), "seen.json"))).toEqual(emptyStore());
  });

  it("round-trips and writes atomically (no temp files left)", () => {
    const dir = tmp();
    const path = join(dir, "seen.json");
    const data = emptyStore();
    upsertVehicle(data, vehicle(), { now: D1 });
    saveStore(path, data);
    expect(loadStore(path)).toEqual(data);
    expect(readdirSync(dir)).toEqual(["seen.json"]);
  });

  it("creates the parent directory when missing", () => {
    const path = join(tmp(), "nested", "seen.json");
    saveStore(path, emptyStore());
    expect(existsSync(path)).toBe(true);
  });

  it("refuses a corrupted file with a clear error and leaves it untouched", () => {
    const path = join(tmp(), "seen.json");
    writeFileSync(path, "{broken");
    expect(() => loadStore(path)).toThrow(/corrupted.*not valid JSON/i);
    writeFileSync(path, JSON.stringify({ version: 1, vehicles: { A: { nope: true } } }));
    expect(() => loadStore(path)).toThrow(/corrupted/i);
    expect(readFileSync(path, "utf8")).toContain("nope");
  });
});

describe("upsertVehicle", () => {
  it("creates a new active record keyed by portal:id", () => {
    const data = emptyStore();
    const { status, key } = upsertVehicle(data, vehicle(), { now: D1 });
    expect(status).toBe("new");
    expect(key).toBe("yapo:1");
    const r = data.vehicles[key]!;
    expect(r.status).toBe("active");
    expect(r.firstSeen).toBe(D1.toISOString());
    expect(r.sources).toEqual([{ portal: "yapo", url: "https://yapo.cl/1", priceClp: 8_000_000, lastSeen: D1.toISOString() }]);
    expect(r.priceHistory).toEqual([{ date: "2026-10-01", priceClp: 8_000_000 }]);
    expect(r.priceDropped).toBe(false);
  });

  it("merges the same plate across portals into one record with two sources", () => {
    const data = emptyStore();
    upsertVehicle(data, vehicle({ plate: "ab-cd12", priceClp: 9_000_000 }), { now: D1 });
    const { status, key } = upsertVehicle(
      data,
      vehicle({ id: "99", portal: "chileautos", url: "https://c.cl/99", plate: "ABCD12", priceClp: 8_500_000, fuel: "Bencina" }),
      { now: D2 },
    );
    expect(status).toBe("updated");
    expect(key).toBe("ABCD12");
    expect(Object.keys(data.vehicles)).toEqual(["ABCD12"]);
    const r = data.vehicles[key]!;
    expect(r.sources.map((s) => s.portal)).toEqual(["yapo", "chileautos"]);
    expect(r.vehicle.portal).toBe("yapo"); // primary portal stays
    expect(r.vehicle.fuel).toBe("Bencina"); // nulls filled from the other portal
    expect(r.vehicle.priceClp).toBe(8_500_000); // best (lowest) price across sources
    expect(r.priceDropped).toBe(true);
  });

  it("tracks price history and the priceDropped flag, resetting on a rise", () => {
    const data = emptyStore();
    upsertVehicle(data, vehicle({ priceClp: 9_000_000 }), { now: D1 });
    upsertVehicle(data, vehicle({ priceClp: 8_000_000 }), { now: D2 });
    const r = data.vehicles["yapo:1"]!;
    expect(r.priceHistory.map((h) => h.priceClp)).toEqual([9_000_000, 8_000_000]);
    expect(r.priceDropped).toBe(true);
    upsertVehicle(data, vehicle({ priceClp: 8_000_000 }), { now: D3 });
    expect(r.priceHistory).toHaveLength(2); // unchanged price adds nothing
    expect(r.priceDropped).toBe(true);
    upsertVehicle(data, vehicle({ priceClp: 8_800_000 }), { now: D3 });
    expect(r.priceDropped).toBe(false);
  });

  it("updates lastSeen, keeps firstSeen, reactivates a gone record", () => {
    const data = emptyStore();
    upsertVehicle(data, vehicle(), { now: D1 });
    markGone(data, new Set(["yapo"]), new Set(), D2);
    expect(data.vehicles["yapo:1"]!.status).toBe("gone");
    upsertVehicle(data, vehicle(), { now: D3 });
    const r = data.vehicles["yapo:1"]!;
    expect(r.status).toBe("active");
    expect(r.firstSeen).toBe(D1.toISOString());
    expect(r.lastSeen).toBe(D3.toISOString());
  });

  it("uses the UF conversion for price when priceClp is null", () => {
    const data = emptyStore();
    upsertVehicle(data, vehicle({ priceClp: null, priceUf: 200 }), { now: D1, ufClp: 40_000 });
    expect(data.vehicles["yapo:1"]!.priceHistory[0]!.priceClp).toBe(8_000_000);
  });

  it("re-keys a portal:id record when its plate becomes known", () => {
    const data = emptyStore();
    upsertVehicle(data, vehicle(), { now: D1 });
    upsertVehicle(data, vehicle({ plate: "ZZ1234" }), { now: D2 });
    expect(Object.keys(data.vehicles)).toEqual(["ZZ1234"]);
    expect(data.vehicles["ZZ1234"]!.firstSeen).toBe(D1.toISOString());
    expect(data.vehicles["ZZ1234"]!.sources).toHaveLength(1);
  });

  it("keeps stored scoring/ai fields across updates", () => {
    const data = emptyStore();
    upsertVehicle(data, vehicle(), { now: D1 });
    data.vehicles["yapo:1"]!.ai = { score: 80, strengths: ["a"], gaps: [] };
    upsertVehicle(data, vehicle(), { now: D2 });
    expect(data.vehicles["yapo:1"]!.ai?.score).toBe(80);
  });
});

describe("markGone", () => {
  it("marks unseen sources of scanned portals only; record gone when all sources are", () => {
    const data = emptyStore();
    upsertVehicle(data, vehicle({ id: "1" }), { now: D1 });
    upsertVehicle(data, vehicle({ id: "2", url: "https://yapo.cl/2" }), { now: D1 });
    upsertVehicle(data, vehicle({ id: "3", portal: "salazarisrael", url: "https://s.cl/3" }), { now: D1 });
    markGone(data, new Set(["yapo"]), new Set([seenId("yapo:1", "yapo")]), D2);
    expect(data.vehicles["yapo:1"]!.status).toBe("active");
    expect(data.vehicles["yapo:2"]!.status).toBe("gone");
    expect(data.vehicles["salazarisrael:3"]!.status).toBe("active"); // portal not scanned
  });

  it("never marks a vetoed record gone", () => {
    const data = emptyStore();
    upsertVehicle(data, vehicle({ id: "1" }), { now: D1 });
    data.vehicles["yapo:1"]!.status = "vetoed";
    expect(markGone(data, new Set(["yapo"]), new Set(), D2)).toBe(0);
    expect(data.vehicles["yapo:1"]!.status).toBe("vetoed");
  });

  it("reactivates a vetoed record that reappears and clears its vetoes", () => {
    const data = emptyStore();
    upsertVehicle(data, vehicle({ id: "1" }), { now: D1 });
    data.vehicles["yapo:1"]!.status = "vetoed";
    data.vehicles["yapo:1"]!.vetoes = ["body-type-mismatch"];
    upsertVehicle(data, vehicle({ id: "1" }), { now: D2 });
    expect(data.vehicles["yapo:1"]!.status).toBe("active");
    expect(data.vehicles["yapo:1"]!.vetoes).toBeUndefined();
  });

  it("keeps a multi-portal record active while one source is still listed", () => {
    const data = emptyStore();
    upsertVehicle(data, vehicle({ plate: "AA1111" }), { now: D1 });
    upsertVehicle(data, vehicle({ id: "9", portal: "chileautos", url: "https://c.cl/9", plate: "AA1111", priceClp: 7_000_000 }), { now: D1 });
    markGone(data, new Set(["yapo"]), new Set(), D2);
    const r = data.vehicles["AA1111"]!;
    expect(r.status).toBe("active");
    expect(r.vehicle.priceClp).toBe(7_000_000);
    markGone(data, new Set(["chileautos"]), new Set(), D3);
    expect(r.status).toBe("gone");
  });
});
