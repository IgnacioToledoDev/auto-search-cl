import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import ExcelJS from "exceljs";
import type { Profile } from "../matching/profile.ts";
import type { StoredVehicle, StoreData } from "../store/store.ts";

export const CANDIDATE_HEADERS = [
  "Puntaje", "Veredicto", "Marca", "Modelo", "Versión", "Año", "Km", "Precio CLP", "Precio UF", "Condición",
  "Transmisión", "Combustible", "Carrocería", "Vendedor", "Comuna", "Región", "Patente", "Portales", "Link",
  "Bajó de precio", "Fortalezas", "Brechas", "Banderas", "Primera vez visto", "Última vez visto", "Estado",
] as const;

type Header = (typeof CANDIDATE_HEADERS)[number];

const COLUMN_WIDTHS: Record<Header, number> = {
  Puntaje: 10, Veredicto: 12, Marca: 14, Modelo: 16, Versión: 20, Año: 7, Km: 11, "Precio CLP": 14, "Precio UF": 11,
  Condición: 11, Transmisión: 14, Combustible: 13, Carrocería: 14, Vendedor: 11, Comuna: 15, Región: 18, Patente: 10,
  Portales: 20, Link: 45, "Bajó de precio": 14, Fortalezas: 50, Brechas: 50, Banderas: 25, "Primera vez visto": 16,
  "Última vez visto": 16, Estado: 10,
};

const VERDICT_FILL: Record<string, string> = {
  Strong: "FFC6EFCE",
  Good: "FFE2EFDA",
  Moderate: "FFFFF2CC",
  Weak: "FFFCE4D6",
  Poor: "FFFFC7CE",
};
const VERDICT_ORDER = ["Strong", "Good", "Moderate", "Weak", "Poor"] as const;
const UNSCORED = "Sin puntaje";
const CLP_FORMAT = "#,##0";
const DATE_FORMAT = "yyyy-mm-dd";
export const DISCLAIMER =
  "Los datos provienen de publicaciones públicas de los portales y deben verificarse con el vendedor antes de decidir.";

export interface SelectOptions {
  minScore?: number;
  includeGone?: boolean;
}

export interface WorkbookOptions {
  now?: Date;
  profile?: Partial<Profile> | null;
}

/**
 * Spreadsheet formula-injection protection: text starting with = + - @ (or a
 * tab/CR, which Excel also trims before evaluating) gets a leading apostrophe
 * so it is read as plain text.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const text = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value === "" ? null : neutralizeFormula(value);

/** Records to export: active (or all with includeGone), >= minScore, sorted by score desc (unscored last). */
export function selectRecords(data: StoreData, opts: SelectOptions = {}): StoredVehicle[] {
  return Object.values(data.vehicles)
    .filter((r) => opts.includeGone === true || r.status === "active")
    .filter((r) => opts.minScore === undefined || (r.score ?? -1) >= opts.minScore)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.key.localeCompare(b.key));
}

/** Sources still listed; a fully gone record falls back to all of its sources. */
function liveSources(r: StoredVehicle): StoredVehicle["sources"] {
  const live = r.sources.filter((s) => !s.gone);
  return live.length > 0 ? live : r.sources;
}

/** Cheapest live source (unknown price last); only http(s) links are usable. */
function bestSource(r: StoredVehicle): StoredVehicle["sources"][number] | undefined {
  return [...liveSources(r)]
    .filter((s) => /^https?:\/\//i.test(s.url))
    .sort((a, b) => (a.priceClp ?? Infinity) - (b.priceClp ?? Infinity))[0];
}

const portalsOf = (r: StoredVehicle): string[] => [...new Set(liveSources(r).map((s) => s.portal))];

function candidateRow(r: StoredVehicle): Record<Header, ExcelJS.CellValue> {
  const v = r.vehicle;
  const best = bestSource(r);
  return {
    Puntaje: r.score ?? null,
    Veredicto: r.verdict ?? UNSCORED,
    Marca: text(v.make),
    Modelo: text(v.model),
    Versión: text(v.version),
    Año: v.year,
    Km: v.km,
    "Precio CLP": v.priceClp,
    "Precio UF": v.priceUf,
    Condición: text(v.condition),
    Transmisión: text(v.transmission),
    Combustible: text(v.fuel),
    Carrocería: text(v.bodyType),
    Vendedor: text(v.sellerType),
    Comuna: text(v.comuna),
    Región: text(v.region),
    Patente: text(v.plate),
    Portales: text(portalsOf(r).join(", ")),
    Link: best ? { text: best.url, hyperlink: best.url } : null,
    "Bajó de precio": r.priceDropped ? "Sí" : "No",
    Fortalezas: text((r.strengths ?? []).join("; ")),
    Brechas: text((r.gaps ?? []).join("; ")),
    Banderas: text(r.flags.join("; ")),
    "Primera vez visto": new Date(r.firstSeen),
    "Última vez visto": new Date(r.lastSeen),
    Estado: r.status === "active" ? "Activo" : r.status === "vetoed" ? "Vetado" : "Retirado",
  };
}

function addCandidates(wb: ExcelJS.Workbook, records: StoredVehicle[]): void {
  const ws = wb.addWorksheet("Candidatos");
  ws.columns = CANDIDATE_HEADERS.map((h) => ({ header: h, key: h, width: COLUMN_WIDTHS[h] }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: CANDIDATE_HEADERS.length } };

  const col = (h: Header) => CANDIDATE_HEADERS.indexOf(h) + 1;
  for (const r of records) {
    const row = ws.addRow(candidateRow(r));
    for (const h of ["Km", "Precio CLP"] as const) row.getCell(col(h)).numFmt = CLP_FORMAT;
    for (const h of ["Primera vez visto", "Última vez visto"] as const) row.getCell(col(h)).numFmt = DATE_FORMAT;
    const link = row.getCell(col("Link"));
    if (link.value) link.font = { color: { argb: "FF0563C1" }, underline: true };
    const argb = r.verdict ? VERDICT_FILL[r.verdict] : undefined;
    if (argb) row.getCell(col("Veredicto")).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  }
}

const fmtClp = (n: number): string => n.toLocaleString("es-CL");
const list = (items: string[] | undefined): string => (items && items.length > 0 ? items.join(", ") : "—");

function profileLines(p: Partial<Profile>): Array<[string, string]> {
  const lines: Array<[string, string]> = [];
  if (p.condition) lines.push(["Tipo", p.condition]);
  if (p.budgetMaxClp !== undefined) lines.push(["Presupuesto máximo (CLP)", fmtClp(p.budgetMaxClp)]);
  if (p.budgetIdealClp !== undefined) lines.push(["Presupuesto ideal (CLP)", fmtClp(p.budgetIdealClp)]);
  lines.push(["Marcas preferidas", list(p.makesPreferred)], ["Marcas excluidas", list(p.makesExcluded)]);
  lines.push(["Modelos preferidos", list(p.modelsPreferred)], ["Carrocería", list(p.bodyTypes)]);
  lines.push(["Combustible", list(p.fuels)], ["Transmisión", list(p.transmissions)]);
  if (p.yearMin) lines.push(["Año mínimo", String(p.yearMin)]);
  if (p.kmMax !== null && p.kmMax !== undefined) lines.push(["Km máximo", fmtClp(p.kmMax)]);
  lines.push(["Regiones", list(p.regions)], ["Comunas", list(p.comunas)]);
  lines.push(["Imprescindibles", list(p.mustHaves)], ["Descartan el aviso", list(p.dealBreakers)]);
  return lines;
}

function addSummary(wb: ExcelJS.Workbook, records: StoredVehicle[], opts: WorkbookOptions): void {
  const ws = wb.addWorksheet("Resumen");
  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 60;
  const section = (title: string) => {
    ws.addRow([]);
    ws.addRow([title]).font = { bold: true };
  };

  ws.addRow(["Resumen de búsqueda de vehículos"]).font = { bold: true, size: 14 };
  ws.addRow(["Fecha de generación", (opts.now ?? new Date()).toISOString().slice(0, 10)]);
  ws.addRow(["Candidatos exportados", records.length]);
  ws.addRow([DISCLAIMER]);

  if (opts.profile) {
    section("Perfil del comprador");
    for (const [label, value] of profileLines(opts.profile)) ws.addRow([label, neutralizeFormula(value)]);
  }

  section("Candidatos por veredicto");
  for (const verdict of [...VERDICT_ORDER, UNSCORED]) {
    ws.addRow([verdict, records.filter((r) => (r.verdict ?? UNSCORED) === verdict).length]);
  }

  section("Candidatos por portal");
  const byPortal = new Map<string, number>();
  for (const r of records) for (const p of portalsOf(r)) byPortal.set(p, (byPortal.get(p) ?? 0) + 1);
  for (const [portal, n] of [...byPortal].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    ws.addRow([neutralizeFormula(portal), n]);
  }
}

function addPriceHistory(wb: ExcelJS.Workbook, records: StoredVehicle[]): void {
  const ws = wb.addWorksheet("Historial de precios");
  ws.columns = [
    { header: "Clave", key: "key", width: 22 },
    { header: "Fecha", key: "date", width: 14 },
    { header: "Precio CLP", key: "price", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of records) {
    if (r.priceHistory.length <= 1) continue;
    for (const h of r.priceHistory) {
      const row = ws.addRow({ key: neutralizeFormula(r.key), date: h.date, price: h.priceClp });
      row.getCell(3).numFmt = CLP_FORMAT;
    }
  }
}

/** Build the three-sheet workbook (Candidatos, Resumen, Historial de precios) for the given records. */
export function buildWorkbook(records: StoredVehicle[], opts: WorkbookOptions = {}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.created = opts.now ?? new Date();
  addCandidates(wb, records);
  addSummary(wb, records, opts);
  addPriceHistory(wb, records);
  return wb;
}

/** Atomic write: temp file in the target directory, then rename; the temp file is removed on failure. */
export async function writeWorkbook(path: string, wb: ExcelJS.Workbook): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await wb.xlsx.writeFile(tmp);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
