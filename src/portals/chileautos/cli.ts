import { pathToFileURL } from "node:url";
import { CliError, parseArgs, writeError } from "../../lib/cliGuard.ts";
import type { HtmlFetchOptions } from "../../lib/http.ts";
import type { SearchOutput } from "../../lib/vehicle.ts";
import { detail } from "./detail.ts";
import { type Condition, type SearchOptions, search } from "./search.ts";

interface Out {
  write(chunk: string): unknown;
}

const SEARCH_SPEC = {
  options: [
    { name: "query", short: "q" },
    { name: "condition" },
    { name: "make" },
    { name: "model" },
    { name: "year-min" },
    { name: "year-max" },
    { name: "price-max" },
    { name: "km-max" },
    { name: "region" },
    { name: "page" },
    { name: "limit" },
    { name: "format" },
  ],
};

function intOption(value: string | undefined, name: string, min: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new CliError("BAD_ARG", `--${name} must be an integer >= ${min}`);
  return n;
}

function toSearchOptions(o: Record<string, string>): SearchOptions {
  if (o.condition !== undefined && !["nuevo", "usado", "ambos"].includes(o.condition)) {
    throw new CliError("BAD_ARG", "--condition must be nuevo, usado or ambos");
  }
  return {
    query: o.query,
    condition: o.condition as Condition | undefined,
    make: o.make,
    model: o.model,
    region: o.region,
    yearMin: intOption(o["year-min"], "year-min", 1900),
    yearMax: intOption(o["year-max"], "year-max", 1900),
    priceMax: intOption(o["price-max"], "price-max", 0),
    kmMax: intOption(o["km-max"], "km-max", 0),
    page: intOption(o.page, "page", 1),
    limit: intOption(o.limit, "limit", 1),
  };
}

function renderTable(out: SearchOutput): string {
  const rows = out.results.map((v) =>
    [v.id, v.title, v.year ?? "-", v.km ?? "-", v.priceClp ?? "-", v.condition].join(" | "),
  );
  return [`total=${out.meta.total} page=${out.meta.page} perPage=${out.meta.perPage}`, "id | title | year | km | priceClp | condition", ...rows].join("\n") + "\n";
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
      if (positionals.length !== 1) throw new CliError("MISSING_REQUIRED", "detail requires one <url>");
      io.stdout.write(`${JSON.stringify(await detail(positionals[0]!, fetchOptions))}\n`);
      return 0;
    }
    throw new CliError("BAD_ARG", "Usage: cli.ts search [flags] | detail <url>");
  } catch (err) {
    return writeError(err, io.stderr);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
