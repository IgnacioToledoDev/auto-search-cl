import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProfileSchema, loadProfile } from "../../src/matching/profile.ts";

const dir = () => mkdtempSync(join(tmpdir(), "profile-"));

describe("ProfileSchema", () => {
  it("accepts a minimal profile and fills list defaults", () => {
    const p = ProfileSchema.parse({ condition: "usado", budgetMaxClp: 12_000_000 });
    expect(p.makesPreferred).toEqual([]);
    expect(p.dealBreakers).toEqual([]);
    expect(p.sellerTypePreference).toBe("any");
    expect(p.yearMin).toBeNull();
    expect(p.kmMax).toBeNull();
  });

  it("rejects an invalid condition and a non-positive budget", () => {
    expect(() => ProfileSchema.parse({ condition: "seminuevo", budgetMaxClp: 1 })).toThrow();
    expect(() => ProfileSchema.parse({ condition: "nuevo", budgetMaxClp: 0 })).toThrow();
  });

  it("accepts partial weights", () => {
    const p = ProfileSchema.parse({ condition: "ambos", budgetMaxClp: 1, weights: { price: 50 } });
    expect(p.weights).toEqual({ price: 50 });
  });
});

describe("loadProfile", () => {
  it("loads and validates a JSON file", () => {
    const file = join(dir(), "profile.json");
    writeFileSync(file, JSON.stringify({ condition: "nuevo", budgetMaxClp: 20_000_000, ufClp: 38000 }));
    const p = loadProfile(file);
    expect(p.condition).toBe("nuevo");
    expect(p.ufClp).toBe(38000);
  });

  it("throws a clear error when the file is missing", () => {
    expect(() => loadProfile(join(dir(), "nope.json"))).toThrow(/profile.*not found.*\/setup/i);
  });

  it("throws a clear error on invalid JSON or schema", () => {
    const file = join(dir(), "profile.json");
    writeFileSync(file, "{oops");
    expect(() => loadProfile(file)).toThrow(/not valid JSON/);
    writeFileSync(file, JSON.stringify({ condition: "x" }));
    expect(() => loadProfile(file)).toThrow(/invalid profile/i);
  });
});
