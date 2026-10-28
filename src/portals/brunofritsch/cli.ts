import { pathToFileURL } from "node:url";
import { CliError, parseArgs, writeError } from "../../lib/cliGuard.ts";
import type { HtmlFetchOptions } from "../../lib/http.ts";
import { SEARCH_SPEC, renderTable, toSearchOptions } from "../../lib/listing.ts";
import { detail } from "./detail.ts";
import { search } from "./search.ts";

interface Out {
  write(chunk: string): unknown;
}

/** Run the CLI; returns the process exit code. Never throws. */
export async function main(
  argv: string[],
  io: { stdout: Out; stderr: Out } = { stdout: process.stdout, stderr: process.stderr },
  fetchOptions: HtmlFetchOptions = {},
): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === "search") {
      const { options } = parseArgs(rest, SEARCH_SPEC);
      const format = options.format ?? "json";
      if (format !== "json" && format !== "table") throw new CliError("BAD_ARG", "--format must be json or table");
      const result = await search(toSearchOptions(options), fetchOptions);
      io.stdout.write(format === "table" ? renderTable(result) : `${JSON.stringify(result)}\n`);
      return 0;
    }
    if (command === "detail") {
      const { positionals } = parseArgs(rest, {});
      if (positionals.length !== 1) throw new CliError("MISSING_REQUIRED", "detail requires one <url-or-id>");
      io.stdout.write(`${JSON.stringify(await detail(positionals[0]!, fetchOptions))}\n`);
      return 0;
    }
    throw new CliError("BAD_ARG", "Usage: cli.ts search [flags] | detail <url-or-id>");
  } catch (err) {
    return writeError(err, io.stderr);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
