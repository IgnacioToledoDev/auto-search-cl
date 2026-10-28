import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Vehicle } from "../../src/lib/vehicle.ts";
import { main } from "../../src/store/cli.ts";

let dir: string;
let storePath: string;
let profilePath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "storecli-"));
  storePath = join(dir, "seen.json");
  profilePath = join(dir, "profile.json");
  writeFileSync(
    profilePath,
    JSON.stringify({ condition: "ambos", budgetMaxClp: 10_000_000, budgetIdealClp: 8_000_000, makesPreferred: ["suzuki"], dealBreakers: ["chocado"] }),
  );
});

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "1", portal: "yapo", url: "https://yapo.cl/1", title: "Suzuki Swift 2024", make: "Suzuki", model: "Swift",
  version: null, year: 2024, km: 5_000, priceClp: 7_000_000, priceUf: null, currency: "CLP",
  condition: "usado", transmission: null, fuel: null, bodyType: null, sellerType: null,
  comuna: null, region: null, plate: null, description: null, postedDate: null, ...over,
});
const searchOutput = (...results: Vehicle[]) => JSON.stringify({ meta: { total: results.length, page: 1, perPage: 20 }, results });

async function run(argv: string[], stdin = "") {
  const out: string[] = [];
  const err: string[] = [];
  const needsProfile = argv[0] === "ingest" || argv[0] === "rank";
  const code = await main([...argv, "--store", storePath, ...(needsProfile ? ["--profile", profilePath] : [])], {
    stdout: { write: (c: string) => out.push(c) },
    stderr: { write: (c: string) => err.push(c) },
    readStdin: async () => stdin,
  });
  return { code, out: out.join(""), err: err.join("") };
}

describe("store cli", () => {
  it("ingest reads stdin, prints a summary and persists the store", async () => {
    const r = await run(["ingest"], searchOutput(vehicle(), vehicle({ id: "2", priceClp: 99_000_000 })));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ new: 1, updated: 0, vetoed: 1, flagged: 0 });
    expect(Object.keys(JSON.parse(readFileSync(storePath, "utf8")).vehicles)).toEqual(["yapo:1"]);
  });

  it("ingest reads --file", async () => {
    const file = join(dir, "scan.json");
    writeFileSync(file, searchOutput(vehicle()));
    const r = await run(["ingest", "--file", file]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).new).toBe(1);
  });

  it("ingest rejects invalid input without touching the store", async () => {
    const r = await run(["ingest"], "{not json");
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err)).toMatchObject({ code: "BAD_ARG" });
    const r2 = await run(["ingest"], JSON.stringify({ results: [{ id: 1 }] }));
    expect(r2.code).toBe(1);
    expect(() => readFileSync(storePath)).toThrow();
  });

  it("fails with PROFILE_ERROR when the profile is missing", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(["ingest", "--store", storePath, "--profile", join(dir, "none.json")], {
      stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => err.push(c) }, readStdin: async () => searchOutput(vehicle()),
    });
    expect(code).toBe(1);
    expect(JSON.parse(err.join(""))).toMatchObject({ code: "PROFILE_ERROR" });
  });

  it("refuses a corrupted store with STORE_ERROR and does not overwrite it", async () => {
    writeFileSync(storePath, "{broken");
    const r = await run(["ingest"], searchOutput(vehicle()));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err)).toMatchObject({ code: "STORE_ERROR" });
    expect(readFileSync(storePath, "utf8")).toBe("{broken");
  });

  it("rank scores active records and list filters/sorts them", async () => {
    await run(["ingest"], searchOutput(vehicle(), vehicle({ id: "2", url: "https://yapo.cl/2", make: "Chery", title: "Chery Tiggo", priceClp: 9_900_000, year: 2012, km: 160_000 })));
    const ranked = await run(["rank"]);
    expect(ranked.code).toBe(0);
    expect(JSON.parse(ranked.out)).toEqual({ ranked: 2 });

    const all = JSON.parse((await run(["list"])).out);
    expect(all).toHaveLength(2);
    expect(all[0].key).toBe("yapo:1");
    expect(all[0].score).toBeGreaterThan(all[1].score);
    expect(all[0].breakdown.price.max).toBe(30);

    const strong = JSON.parse((await run(["list", "--verdict", "Strong"])).out);
    expect(strong.map((r: { key: string }) => r.key)).toEqual(["yapo:1"]);
    const min = JSON.parse((await run(["list", "--min-score", String(all[0].score)])).out);
    expect(min).toHaveLength(1);
  });

  it("list --format table prints rows", async () => {
    await run(["ingest"], searchOutput(vehicle()));
    await run(["rank"]);
    const r = await run(["list", "--format", "table"]);
    expect(r.out).toMatch(/key \| score \| verdict/);
    expect(r.out).toContain("yapo:1");
  });

  it("set-ai stores the qualitative result and rank blends it 70/30", async () => {
    await run(["ingest"], searchOutput(vehicle()));
    await run(["rank"]);
    const det = JSON.parse((await run(["list"])).out)[0].score as number;
    const r = await run(["set-ai", "--key", "yapo:1", "--score", "10", "--strengths", "clean history|one owner", "--gaps", "no service book"]);
    expect(r.code).toBe(0);
    await run(["rank"]);
    const rec = JSON.parse((await run(["list"])).out)[0];
    expect(rec.ai).toEqual({ score: 10, strengths: ["clean history", "one owner"], gaps: ["no service book"] });
    expect(rec.deterministicScore).toBe(det);
    expect(rec.score).toBe(Math.round(0.7 * det + 0.3 * 10));
    expect(rec.strengths).toContain("one owner");
    expect(rec.gaps).toContain("no service book");
  });

  it("set-ai validates score range and key existence", async () => {
    await run(["ingest"], searchOutput(vehicle()));
    const bad = await run(["set-ai", "--key", "yapo:1", "--score", "101"]);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.err).code).toBe("BAD_ARG");
    const nan = await run(["set-ai", "--key", "yapo:1", "--score", "abc"]);
    expect(JSON.parse(nan.err).code).toBe("BAD_ARG");
    const missing = await run(["set-ai", "--key", "nope", "--score", "50"]);
    expect(JSON.parse(missing.err).code).toBe("NOT_FOUND");
  });

  it("set-ai sanitizes invisible characters", async () => {
    await run(["ingest"], searchOutput(vehicle()));
    await run(["set-ai", "--key", "yapo:1", "--score", "50", "--strengths", "ok​"]);
    expect(JSON.parse((await run(["list"])).out)[0].ai.strengths).toEqual(["ok"]);
  });

  it("unknown flags and commands exit 1 with {error, code}", async () => {
    const r = await run(["list", "--bogus"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err)).toMatchObject({ code: "UNKNOWN_FLAG" });
    const c = await run(["nope"]);
    expect(JSON.parse(c.err)).toMatchObject({ code: "BAD_ARG" });
    const f = await run(["list", "--format", "xml"]);
    expect(JSON.parse(f.err).code).toBe("BAD_ARG");
  });
});
