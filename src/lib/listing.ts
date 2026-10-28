import { CliError } from "./cliGuard.ts";
import type { SearchOutput, Vehicle } from "./vehicle.ts";

export type Condition = "nuevo" | "usado" | "ambos";

export interface SearchOptions {
  query?: string;
  condition?: Condition;
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  priceMax?: number;
  kmMax?: number;
  region?: string;
  page?: number;
  limit?: number;
}

export const DEFAULT_LIMIT = 20;

/** Option names shared by every portal `search` command (see cliGuard.parseArgs). */
export const SEARCH_SPEC = {
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

const includes = (haystack: string | null, needle: string): boolean =>
  haystack !== null && haystack.toLowerCase().includes(needle.toLowerCase());

/**
 * Client-side filters, for criteria a portal cannot express in an allowed URL.
 * A listing whose value is unknown is dropped only when that filter is set.
 */
export function filterVehicles(vehicles: Vehicle[], o: SearchOptions): Vehicle[] {
  return vehicles.filter((v) => {
    if (o.condition === "nuevo" || o.condition === "usado") {
      if (v.condition !== o.condition) return false;
    }
    if (o.query && !includes(v.title, o.query)) return false;
    if (o.make && !includes(v.make, o.make)) return false;
    if (o.model && !includes(v.model, o.model)) return false;
    if (o.region && !includes(v.region, o.region)) return false;
    if (o.yearMin !== undefined && (v.year === null || v.year < o.yearMin)) return false;
    if (o.yearMax !== undefined && (v.year === null || v.year > o.yearMax)) return false;
    if (o.priceMax !== undefined && (v.priceClp === null || v.priceClp > o.priceMax)) return false;
    if (o.kmMax !== undefined && (v.km === null || v.km > o.kmMax)) return false;
    return true;
  });
}

/** Slice an already-filtered list into one page of a SearchOutput. */
export function paginate(vehicles: Vehicle[], page: number, perPage: number, total = vehicles.length): SearchOutput {
  const start = (page - 1) * perPage;
  return { meta: { total, page, perPage }, results: vehicles.slice(start, start + perPage) };
}

function intOption(value: string | undefined, name: string, min: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new CliError("BAD_ARG", `--${name} must be an integer >= ${min}`);
  return n;
}

/** Validate parsed CLI options and convert them to SearchOptions. */
export function toSearchOptions(o: Record<string, string | undefined>): SearchOptions {
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

export function renderTable(out: SearchOutput): string {
  const rows = out.results.map((v) =>
    [v.id, v.title, v.year ?? "-", v.km ?? "-", v.priceClp ?? "-", v.condition].join(" | "),
  );
  return (
    [
      `total=${out.meta.total} page=${out.meta.page} perPage=${out.meta.perPage}`,
      "id | title | year | km | priceClp | condition",
      ...rows,
    ].join("\n") + "\n"
  );
}
