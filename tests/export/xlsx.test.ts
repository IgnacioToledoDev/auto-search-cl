import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildWorkbook, neutralizeFormula, selectRecords, writeWorkbook, CANDIDATE_HEADERS, type SelectOptions } from "../../src/export/xlsx.ts";
import type { Vehicle } from "../../src/lib/vehicle.ts";
import { emptyStore, type StoredVehicle, type StoreData } from "../../src/store/store.ts";

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "1", portal: "yapo", url: "https://yapo.cl/1", title: "Suzuki Swift 2024", make: "Suzuki", model: "Swift",
  version: "GLX", year: 2024, km: 5_000, priceClp: 7_000_000, priceUf: null, currency: "CLP",
  condition: "usado", transmission: "Automática", fuel: "Bencina", bodyType: "Hatchback", sellerType: "dealer",
  comuna: "Providencia", region: "Metropolitana", plate: "ABCD12", description: null, postedDate: null, ...over,
});

const record = (key: string, over: Partial<StoredVehicle> = {}, v: Partial<Vehicle> = {}): StoredVehicle => ({
  key,
  vehicle: vehicle(v),
  sources: [{ portal: "yapo", url: "https://yapo.cl/1", priceClp: 7_000_000, lastSeen: "2026-10-28T10:00:00.000Z" }],
  priceHistory: [{ date: "2026-10-27", priceClp: 7_500_000 }, { date: "2026-10-28", priceClp: 7_000_000 }],
  priceDropped: true,
  firstSeen: "2026-10-27T10:00:00.000Z",
  lastSeen: "2026-10-28T10:00:00.000Z",
  status: "active",
  flags: ["km-unknown"],
  score: 80,
  verdict: "Strong",
  strengths: ["Low mileage"],
  gaps: ["Price unknown"],
  ...over,
});

const store = (...records: StoredVehicle[]): StoreData => ({ version: 1, vehicles: Object.fromEntries(records.map((r) => [r.key, r])) });
const NOW = new Date("2026-10-28T12:00:00.000Z");

async function roundTrip(data: StoreData, opts: SelectOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "xlsx-"));
  const path = join(dir, "out", "c.xlsx");
  await writeWorkbook(path, buildWorkbook(selectRecords(data, opts), { now: NOW, ...opts }));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return { wb, dir, path };
}

const headerIndex = (ws: ExcelJS.Worksheet, name: string) => (ws.getRow(1).values as unknown[]).indexOf(name);

describe("neutralizeFormula", () => {
  it.each(["=SUM(A1)", "+1+1", "-2+3", "@cmd", "\tx", "\rx"])("prefixes %j", (t) => {
    expect(neutralizeFormula(t)).toBe(`'${t}`);
  });
  it("leaves safe text untouched", () => {
    expect(neutralizeFormula("Suzuki Swift")).toBe("Suzuki Swift");
    expect(neutralizeFormula("")).toBe("");
  });
});

describe("selectRecords", () => {
  const data = store(
    record("A", { score: 50 }),
    record("B", { score: 90 }),
    record("C", { score: undefined, verdict: undefined }),
    record("D", { score: 70, status: "gone" }),
    record("V", { score: 99, status: "vetoed" }),
  );
  it("sorts by score desc, unscored last, excludes gone and vetoed by default", () => {
    expect(selectRecords(data, {}).map((r) => r.key)).toEqual(["B", "A", "C"]);
  });
  it("includes gone on request", () => {
    expect(selectRecords(data, { includeGone: true }).map((r) => r.key)).toEqual(["V", "B", "D", "A", "C"]);
  });
  it("applies min score (unscored excluded)", () => {
    expect(selectRecords(data, { minScore: 60 }).map((r) => r.key)).toEqual(["B"]);
  });
});

describe("candidates sheet", () => {
  it("writes every candidate row in score order with Spanish headers", async () => {
    const data = store(
      record("A", { score: 50, verdict: "Moderate" }, { id: "a", make: "Kia", model: "Rio" }),
      record("B", { score: 90 }, { id: "b" }),
      record("C", { score: 20, verdict: "Poor" }, { id: "c", make: "Chery", model: "Tiggo" }),
    );
    const { wb } = await roundTrip(data);
    const ws = wb.getWorksheet("Candidatos")!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(CANDIDATE_HEADERS);
    expect(ws.rowCount).toBe(4);
    const col = (n: string) => headerIndex(ws, n);
    expect([2, 3, 4].map((r) => ws.getRow(r).getCell(col("Puntaje")).value)).toEqual([90, 50, 20]);
    expect(ws.getRow(3).getCell(col("Marca")).value).toBe("Kia");
    expect(ws.getRow(2).getCell(col("Veredicto")).value).toBe("Strong");
    expect(ws.getRow(2).getCell(col("Año")).value).toBe(2024);
    expect(ws.getRow(2).getCell(col("Km")).value).toBe(5000);
    expect(ws.getRow(2).getCell(col("Patente")).value).toBe("ABCD12");
    expect(ws.getRow(2).getCell(col("Bajó de precio")).value).toBe("Sí");
    expect(ws.getRow(2).getCell(col("Fortalezas")).value).toBe("Low mileage");
    expect(ws.getRow(2).getCell(col("Brechas")).value).toBe("Price unknown");
    expect(ws.getRow(2).getCell(col("Banderas")).value).toBe("km-unknown");
    expect(ws.getRow(2).getCell(col("Estado")).value).toBe("Activo");
    expect(ws.getRow(2).getCell(col("Portales")).value).toBe("yapo");
  });

  it("links to the cheapest live source and lists all portals", async () => {
    const r = record("A", {
      sources: [
        { portal: "yapo", url: "https://yapo.cl/1", priceClp: 7_000_000, lastSeen: "x" },
        { portal: "salazarisrael", url: "https://salazarisrael.cl/9", priceClp: 6_800_000, lastSeen: "x" },
        { portal: "brunofritsch", url: "https://brunofritsch.cl/5", priceClp: 6_000_000, lastSeen: "x", gone: true },
      ],
    });
    const { wb } = await roundTrip(store(r));
    const ws = wb.getWorksheet("Candidatos")!;
    const cell = ws.getRow(2).getCell(headerIndex(ws, "Link"));
    expect((cell.value as ExcelJS.CellHyperlinkValue).hyperlink).toBe("https://salazarisrael.cl/9");
    expect(ws.getRow(2).getCell(headerIndex(ws, "Portales")).value).toBe("yapo, salazarisrael");
  });

  it("does not hyperlink non-http urls", async () => {
    const r = record("A", { sources: [{ portal: "yapo", url: "javascript:alert(1)", priceClp: 1, lastSeen: "x" }] });
    const { wb } = await roundTrip(store(r));
    const ws = wb.getWorksheet("Candidatos")!;
    const v = ws.getRow(2).getCell(headerIndex(ws, "Link")).value;
    expect(typeof v === "object" && v !== null && "hyperlink" in v).toBe(false);
  });

  it("applies number formats, frozen header, autofilter, widths and verdict fills", async () => {
    const { wb } = await roundTrip(store(record("A"), record("B", { score: 10, verdict: "Poor" })));
    const ws = wb.getWorksheet("Candidatos")!;
    expect(ws.getRow(2).getCell(headerIndex(ws, "Precio CLP")).numFmt).toBe("#,##0");
    expect(ws.getRow(2).getCell(headerIndex(ws, "Km")).numFmt).toBe("#,##0");
    expect(ws.getRow(2).getCell(headerIndex(ws, "Primera vez visto")).numFmt).toBe("yyyy-mm-dd");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.getColumn(1).width).toBeGreaterThan(5);
    expect(ws.getRow(1).font?.bold).toBe(true);
    const fill = (r: number) => (ws.getRow(r).getCell(headerIndex(ws, "Veredicto")).fill as ExcelJS.FillPattern).fgColor?.argb;
    expect(fill(2)).toBeDefined();
    expect(fill(3)).toBeDefined();
    expect(fill(2)).not.toBe(fill(3));
  });

  it("neutralizes formula injection in every text cell", async () => {
    const r = record(
      "A",
      { strengths: ["=HYPERLINK(\"http://evil\")"], gaps: ["+cmd|' /C calc'!A0"], flags: ["@SUM(1)"] },
      { make: "=1+1", model: "-2+3", version: "@x", comuna: "+x", plate: "=A1", region: "\t=x" },
    );
    const { wb } = await roundTrip(store(r));
    const ws = wb.getWorksheet("Candidatos")!;
    const get = (n: string) => ws.getRow(2).getCell(headerIndex(ws, n)).value as string;
    expect(get("Marca")).toBe("'=1+1");
    expect(get("Modelo")).toBe("'-2+3");
    expect(get("Versión")).toBe("'@x");
    expect(get("Comuna")).toBe("'+x");
    expect(get("Patente")).toBe("'=A1");
    expect(get("Región")).toBe("'\t=x");
    expect(get("Fortalezas").startsWith("'=")).toBe(true);
    expect(get("Brechas").startsWith("'+")).toBe(true);
    expect(get("Banderas")).toBe("'@SUM(1)");
    // No cell in the whole workbook may be a formula.
    for (const sheet of wb.worksheets) {
      sheet.eachRow((row) => row.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)));
    }
  });

  it("handles null fields and UF-only price", async () => {
    const r = record("A", { score: undefined, verdict: undefined, strengths: undefined, gaps: undefined, flags: [], priceDropped: false },
      { year: null, km: null, priceClp: null, priceUf: 250.5, make: null });
    const { wb } = await roundTrip(store(r));
    const ws = wb.getWorksheet("Candidatos")!;
    expect(ws.getRow(2).getCell(headerIndex(ws, "Precio UF")).value).toBe(250.5);
    expect(ws.getRow(2).getCell(headerIndex(ws, "Bajó de precio")).value).toBe("No");
    expect(ws.getRow(2).getCell(headerIndex(ws, "Km")).value ?? null).toBeNull();
  });

  it("marks gone records as Retirado when included", async () => {
    const { wb } = await roundTrip(store(record("D", { status: "gone" })), { includeGone: true });
    const ws = wb.getWorksheet("Candidatos")!;
    expect(ws.getRow(2).getCell(headerIndex(ws, "Estado")).value).toBe("Retirado");
  });

  it("marks vetoed records as Vetado when included", async () => {
    const { wb } = await roundTrip(store(record("V", { status: "vetoed" })), { includeGone: true });
    const ws = wb.getWorksheet("Candidatos")!;
    expect(ws.getRow(2).getCell(headerIndex(ws, "Estado")).value).toBe("Vetado");
  });

  it("produces a valid workbook with headers only for an empty store", async () => {
    const { wb } = await roundTrip(emptyStore());
    const ws = wb.getWorksheet("Candidatos")!;
    expect(ws.rowCount).toBe(1);
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(CANDIDATE_HEADERS);
    expect(wb.getWorksheet("Resumen")).toBeTruthy();
    expect(wb.getWorksheet("Historial de precios")).toBeTruthy();
  });
});

describe("summary sheet", () => {
  const rows = (ws: ExcelJS.Worksheet) => {
    const out: unknown[][] = [];
    ws.eachRow((r) => out.push((r.values as unknown[]).slice(1)));
    return out;
  };
  it("shows generation date, disclaimer, verdict and portal counts, profile", async () => {
    const data = store(
      record("A", { score: 90, verdict: "Strong" }),
      record("B", { score: 50, verdict: "Moderate" }, { portal: "salazarisrael" }),
      record("C", { score: undefined, verdict: undefined }),
    );
    data.vehicles.B!.sources = [{ portal: "salazarisrael", url: "https://s.cl/b", priceClp: 1, lastSeen: "x" }];
    const dir = mkdtempSync(join(tmpdir(), "xlsx-"));
    const path = join(dir, "c.xlsx");
    const profile = { condition: "usado", budgetMaxClp: 12_000_000, makesPreferred: ["Toyota"] } as never;
    await writeWorkbook(path, buildWorkbook(selectRecords(data, {}), { now: NOW, profile }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const flat = rows(wb.getWorksheet("Resumen")!).map((r) => r.join("|"));
    const text = flat.join("\n");
    expect(text).toContain("2026-10-28");
    expect(text).toMatch(/publicaciones públicas.*verific/i);
    expect(flat).toContain("Strong|1");
    expect(flat).toContain("Moderate|1");
    expect(flat).toContain("Sin puntaje|1");
    expect(flat).toContain("yapo|2");
    expect(flat).toContain("salazarisrael|1");
    expect(text).toContain("12.000.000");
    expect(text).toContain("Toyota");
  });
});

describe("price history sheet", () => {
  it("lists key/date/price only for records with more than one entry", async () => {
    const multi = record("A");
    const single = record("B", { priceHistory: [{ date: "2026-10-28", priceClp: 5 }] });
    const { wb } = await roundTrip(store(multi, single));
    const ws = wb.getWorksheet("Historial de precios")!;
    expect(ws.rowCount).toBe(3);
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(["Clave", "Fecha", "Precio CLP"]);
    expect(ws.getRow(2).getCell(1).value).toBe("A");
    expect(ws.getRow(2).getCell(3).value).toBe(7_500_000);
    expect(ws.getRow(2).getCell(3).numFmt).toBe("#,##0");
  });
});

describe("writeWorkbook", () => {
  it("writes atomically (no temp file left) and creates the directory", async () => {
    const { dir } = await roundTrip(store(record("A")));
    expect(readdirSync(join(dir, "out"))).toEqual(["c.xlsx"]);
  });
});
