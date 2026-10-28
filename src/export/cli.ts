import { pathToFileURL } from "node:url";
import { CliError, parseArgs, writeError } from "../lib/cliGuard.ts";
import { DEFAULT_PROFILE_PATH, loadProfile, type Profile } from "../matching/profile.ts";
import { DEFAULT_STORE_PATH, loadStore, type StoreData } from "../store/store.ts";
import { buildWorkbook, selectRecords, writeWorkbook } from "./xlsx.ts";

export const DEFAULT_OUT_PATH = "output/candidatos.xlsx";

interface Out {
  write(chunk: string): unknown;
}

export interface Io {
  stdout: Out;
  stderr: Out;
}

function readStore(path: string): StoreData {
  try {
    return loadStore(path);
  } catch (err) {
    throw new CliError("STORE_ERROR", (err as Error).message);
  }
}

/** The profile only enriches the summary sheet: a missing or invalid one is skipped. */
function readProfileIfPresent(path: string): Profile | null {
  try {
    return loadProfile(path);
  } catch {
    return null;
  }
}

/** Run the CLI; returns the process exit code. Never throws. */
export async function main(argv: string[], io: Io = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  try {
    const { options, flags } = parseArgs(argv, {
      options: [{ name: "out" }, { name: "min-score" }, { name: "store" }, { name: "profile" }],
      flags: [{ name: "include-gone" }],
    });
    let minScore: number | undefined;
    if (options["min-score"] !== undefined) {
      minScore = Number(options["min-score"]);
      if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
        throw new CliError("BAD_ARG", "--min-score must be a number between 0 and 100");
      }
    }
    const data = readStore(options.store ?? DEFAULT_STORE_PATH);
    const records = selectRecords(data, { minScore, includeGone: flags["include-gone"] });
    const path = options.out ?? DEFAULT_OUT_PATH;
    await writeWorkbook(path, buildWorkbook(records, { profile: readProfileIfPresent(options.profile ?? DEFAULT_PROFILE_PATH) }));
    io.stdout.write(`${JSON.stringify({ path, exported: records.length })}\n`);
    return 0;
  } catch (err) {
    return writeError(err, io.stderr);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
