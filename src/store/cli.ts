import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CliError, parseArgs, writeError } from "../lib/cliGuard.ts";
import { stripInvisible } from "../lib/sanitize.ts";
import { SearchOutputSchema } from "../lib/vehicle.ts";
import { loadProfile, DEFAULT_PROFILE_PATH, type Profile } from "../matching/profile.ts";
import { applyAi, medianComparablePrice, scoreVehicle, type Verdict } from "../matching/score.ts";
import { ingest } from "./ingest.ts";
import { DEFAULT_STORE_PATH, loadStore, saveStore, type StoreData, type StoredVehicle } from "./store.ts";

interface Out {
  write(chunk: string): unknown;
}

export interface Io {
  stdout: Out;
  stderr: Out;
  readStdin: () => Promise<string>;
}

const VERDICTS: Verdict[] = ["Strong", "Good", "Moderate", "Weak", "Poor"];
const COMMON = [{ name: "store" }, { name: "profile" }];

async function defaultReadStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function numberOption(value: string | undefined, name: string, min: number, max = Infinity): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new CliError("BAD_ARG", `--${name} must be a number between ${min} and ${max === Infinity ? "infinity" : max}`);
  }
  return n;
}

function openStore(path: string): StoreData {
  try {
    return loadStore(path);
  } catch (err) {
    throw new CliError("STORE_ERROR", (err as Error).message);
  }
}

function openProfile(path: string): Profile {
  try {
    return loadProfile(path);
  } catch (err) {
    throw new CliError("PROFILE_ERROR", (err as Error).message);
  }
}

function cmdIngest(data: StoreData, profile: Profile, input: string, o: Record<string, string>) {
  let json: unknown;
  try {
    json = JSON.parse(input);
  } catch {
    throw new CliError("BAD_ARG", "ingest input is not valid JSON");
  }
  const parsed = SearchOutputSchema.safeParse(json);
  if (!parsed.success) throw new CliError("BAD_ARG", "ingest input is not a valid SearchOutput");
  return ingest(data, parsed.data.results, profile, {
    ufClp: numberOption(o["uf-clp"], "uf-clp", 1),
    scannedPortals: o.portals?.split(",").map((p) => p.trim()).filter(Boolean),
  });
}

function cmdRank(data: StoreData, profile: Profile, o: Record<string, string>): { ranked: number } {
  const ufClp = numberOption(o["uf-clp"], "uf-clp", 1) ?? profile.ufClp;
  const active = Object.values(data.vehicles).filter((r) => r.status === "active");
  const market = active.map((r) => r.vehicle);
  for (const r of active) {
    const det = scoreVehicle(r.vehicle, profile, {
      ufClp,
      medianPriceClp: medianComparablePrice(r.vehicle, market, { ufClp }),
    });
    const final = applyAi(det, r.ai);
    r.deterministicScore = det.score;
    r.breakdown = det.breakdown;
    r.score = final.score;
    r.verdict = final.verdict;
    r.strengths = final.strengths;
    r.gaps = final.gaps;
  }
  return { ranked: active.length };
}

function cmdSetAi(data: StoreData, o: Record<string, string>): { key: string; ai: NonNullable<StoredVehicle["ai"]> } {
  const key = o.key!;
  const record = data.vehicles[key];
  if (!record) throw new CliError("NOT_FOUND", `No record with key ${key}`);
  const score = numberOption(o.score, "score", 0, 100)!;
  const split = (v: string | undefined) =>
    (v ?? "").split("|").map((s) => stripInvisible(s).trim()).filter(Boolean);
  record.ai = { score, strengths: split(o.strengths), gaps: split(o.gaps) };
  return { key, ai: record.ai };
}

function renderTable(rows: StoredVehicle[]): string {
  const lines = rows.map((r) =>
    [r.key, r.score ?? "-", r.verdict ?? "-", r.vehicle.title, r.vehicle.priceClp ?? "-", r.vehicle.year ?? "-", r.vehicle.km ?? "-", r.sources.map((s) => s.portal).join(",")].join(" | "),
  );
  return ["key | score | verdict | title | priceClp | year | km | sources", ...lines].join("\n") + "\n";
}

function cmdList(data: StoreData, o: Record<string, string>, includeGone: boolean): StoredVehicle[] {
  const minScore = numberOption(o["min-score"], "min-score", 0, 100);
  if (o.verdict !== undefined && !VERDICTS.includes(o.verdict as Verdict)) {
    throw new CliError("BAD_ARG", `--verdict must be one of ${VERDICTS.join(", ")}`);
  }
  return Object.values(data.vehicles)
    .filter((r) => includeGone || r.status === "active")
    .filter((r) => minScore === undefined || (r.score ?? -1) >= minScore)
    .filter((r) => o.verdict === undefined || r.verdict === o.verdict)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.key.localeCompare(b.key));
}

/** Run the CLI; returns the process exit code. Never throws. */
export async function main(
  argv: string[],
  io: Io = { stdout: process.stdout, stderr: process.stderr, readStdin: defaultReadStdin },
): Promise<number> {
  try {
    const [command, ...rest] = argv;
    const print = (value: unknown) => io.stdout.write(`${JSON.stringify(value)}\n`);

    if (command === "ingest") {
      const { options } = parseArgs(rest, { options: [...COMMON, { name: "file" }, { name: "uf-clp" }, { name: "portals" }] });
      const input = options.file !== undefined ? readInputFile(options.file) : await io.readStdin();
      const profile = openProfile(options.profile ?? DEFAULT_PROFILE_PATH);
      const path = options.store ?? DEFAULT_STORE_PATH;
      const data = openStore(path);
      const summary = cmdIngest(data, profile, input, options);
      saveStore(path, data);
      print(summary);
      return 0;
    }
    if (command === "rank") {
      const { options } = parseArgs(rest, { options: [...COMMON, { name: "uf-clp" }] });
      const profile = openProfile(options.profile ?? DEFAULT_PROFILE_PATH);
      const path = options.store ?? DEFAULT_STORE_PATH;
      const data = openStore(path);
      const result = cmdRank(data, profile, options);
      saveStore(path, data);
      print(result);
      return 0;
    }
    if (command === "set-ai") {
      const { options } = parseArgs(rest, {
        options: [{ name: "store" }, { name: "key", required: true }, { name: "score", required: true }, { name: "strengths" }, { name: "gaps" }],
      });
      const path = options.store ?? DEFAULT_STORE_PATH;
      const data = openStore(path);
      const result = cmdSetAi(data, options);
      saveStore(path, data);
      print(result);
      return 0;
    }
    if (command === "list") {
      const { options, flags } = parseArgs(rest, {
        options: [{ name: "store" }, { name: "min-score" }, { name: "verdict" }, { name: "format" }],
        flags: [{ name: "include-gone" }],
      });
      const format = options.format ?? "json";
      if (format !== "json" && format !== "table") throw new CliError("BAD_ARG", "--format must be json or table");
      const rows = cmdList(openStore(options.store ?? DEFAULT_STORE_PATH), options, flags["include-gone"] === true);
      io.stdout.write(format === "table" ? renderTable(rows) : `${JSON.stringify(rows)}\n`);
      return 0;
    }
    throw new CliError("BAD_ARG", "Usage: cli.ts ingest | rank | set-ai --key K --score N | list");
  } catch (err) {
    return writeError(err, io.stderr);
  }
}

function readInputFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new CliError("BAD_ARG", `Cannot read --file ${path}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
