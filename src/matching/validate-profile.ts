import { pathToFileURL } from "node:url";
import { CliError, parseArgs, writeError } from "../lib/cliGuard.ts";
import { DEFAULT_PROFILE_PATH, loadProfile } from "./profile.ts";

interface Out {
  write(chunk: string): unknown;
}

export interface Io {
  stdout: Out;
  stderr: Out;
}

/**
 * Validate a buyer profile file (default data/profile.json) against ProfileSchema.
 * Prints `{"ok":true,"profile":{...}}` (defaults applied) or a PROFILE_ERROR on stderr.
 */
export async function main(argv: string[], io: Io = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  try {
    const { options } = parseArgs(argv, { options: [{ name: "file" }] });
    let profile;
    try {
      profile = loadProfile(options.file ?? DEFAULT_PROFILE_PATH);
    } catch (err) {
      throw new CliError("PROFILE_ERROR", (err as Error).message);
    }
    io.stdout.write(`${JSON.stringify({ ok: true, profile })}\n`);
    return 0;
  } catch (err) {
    return writeError(err, io.stderr);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
