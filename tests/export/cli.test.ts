import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/export/cli.ts";
import { saveStore, type StoredVehicle } from "../../src/store/store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "exportcli-"));
});

const rec = (key: string, score: number, status: "active" | "gone" = "active"): StoredVehicle => ({
  key,
  vehicle: {
    id: key, portal: "yapo", url: `https://yapo.cl/${key}`, title: key, make: "Kia", model: "Rio", version: null, year: 2022, km: 1,
    priceClp: 1, priceUf: null, currency: "CLP", condition: "usado", transmission: null, fuel: null, bodyType: null, sellerType: null,
    comuna: null, region: null, plate: null, description: null, postedDate: null,
  },
  sources: [{ portal: "yapo", url: `https://yapo.cl/${key}`, priceClp: 1, lastSeen: "x" }],
  priceHistory: [], priceDropped: false, firstSeen: "2026-10-28T00:00:00.000Z", lastSeen: "2026-10-28T00:00:00.000Z",
  status, flags: [], score, verdict: "Good", strengths: [], gaps: [],
});

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => err.push(c) } });
  return { code, out: out.join(""), err: err.join("") };
}

describe("export cli", () => {
  it("exports the store and reports path and counts as JSON", async () => {
    const store = join(dir, "s.json");
    saveStore(store, { version: 1, vehicles: { A: rec("A", 80), B: rec("B", 40), G: rec("G", 90, "gone") } });
    const out = join(dir, "o", "c.xlsx");
    const r = await run(["--store", store, "--out", out, "--profile", join(dir, "nope.json")]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ path: out, exported: 2 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    expect(wb.getWorksheet("Candidatos")!.rowCount).toBe(3);
  });

  it("honors --min-score and --include-gone", async () => {
    const store = join(dir, "s.json");
    saveStore(store, { version: 1, vehicles: { A: rec("A", 80), B: rec("B", 40), G: rec("G", 90, "gone") } });
    const out = join(dir, "c.xlsx");
    const r = await run(["--store", store, "--out", out, "--min-score", "50", "--include-gone", "--profile", join(dir, "nope.json")]);
    expect(JSON.parse(r.out).exported).toBe(2);
  });

  it("includes the profile summary when profile.json exists", async () => {
    const store = join(dir, "s.json");
    const profile = join(dir, "p.json");
    saveStore(store, { version: 1, vehicles: {} });
    writeFileSync(profile, JSON.stringify({ condition: "usado", budgetMaxClp: 5_000_000 }));
    const out = join(dir, "c.xlsx");
    expect((await run(["--store", store, "--out", out, "--profile", profile])).code).toBe(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    let text = "";
    wb.getWorksheet("Resumen")!.eachRow((row) => (text += `${(row.values as unknown[]).join("|")}\n`));
    expect(text).toContain("5.000.000");
  });

  it("exports an empty workbook when the store file is missing", async () => {
    const out = join(dir, "c.xlsx");
    const r = await run(["--store", join(dir, "missing.json"), "--out", out, "--profile", join(dir, "nope.json")]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).exported).toBe(0);
    expect(existsSync(out)).toBe(true);
  });

  it("rejects unknown flags and bad --min-score with JSON errors", async () => {
    const a = await run(["--bogus"]);
    expect(a.code).toBe(1);
    expect(JSON.parse(a.err).code).toBe("UNKNOWN_FLAG");
    const b = await run(["--min-score", "abc"]);
    expect(b.code).toBe(1);
    expect(JSON.parse(b.err).code).toBe("BAD_ARG");
  });

  it("fails with STORE_ERROR on a corrupted store and does not write output", async () => {
    const store = join(dir, "s.json");
    writeFileSync(store, "{not json");
    const out = join(dir, "c.xlsx");
    const r = await run(["--store", store, "--out", out]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).code).toBe("STORE_ERROR");
    expect(existsSync(out)).toBe(false);
  });
});
