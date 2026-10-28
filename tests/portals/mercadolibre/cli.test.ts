import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SearchOutputSchema } from "../../../src/lib/vehicle.ts";
import { main } from "../../../src/portals/mercadolibre/cli.ts";

const SEARCH = readFileSync(new URL("./fixtures/synthetic-search.json", import.meta.url), "utf8");
const ITEM = readFileSync(new URL("./fixtures/synthetic-item.json", import.meta.url), "utf8");

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => err.push(c) } };
}
const deps = (body = SEARCH) => ({ fetch: vi.fn(async () => new Response(body, { status: 200 })) });

describe("mercadolibre cli", () => {
  it("search prints SearchOutput JSON and exits 0", async () => {
    const t = io();
    expect(await main(["search", "-q", "yaris", "--limit", "5"], t, deps(), {})).toBe(0);
    const parsed = SearchOutputSchema.parse(JSON.parse(t.out.join("")));
    expect(parsed.meta.perPage).toBe(5);
    expect(t.err).toEqual([]);
  });

  it("search --format table prints text", async () => {
    const t = io();
    expect(await main(["search", "--format", "table"], t, deps(), {})).toBe(0);
    expect(t.out.join("")).toContain("MLC1000000001");
  });

  it("detail prints a Vehicle", async () => {
    const t = io();
    expect(await main(["detail", "MLC1000000001"], t, deps(ITEM), {})).toBe(0);
    expect(JSON.parse(t.out.join("")).id).toBe("MLC1000000001");
  });

  it("unknown flags and bad values exit 1 with {error, code}", async () => {
    for (const [argv, code] of [
      [["search", "--bogus"], "UNKNOWN_FLAG"],
      [["search", "--condition", "roto"], "BAD_ARG"],
      [["search", "--format", "xml"], "BAD_ARG"],
      [["detail"], "MISSING_REQUIRED"],
      [[], "BAD_ARG"],
    ] as const) {
      const t = io();
      expect(await main([...argv], t, deps(), {})).toBe(1);
      expect(JSON.parse(t.err.join(""))).toMatchObject({ code });
    }
  });

  it("maps an API 403 to API_ERROR exit 1", async () => {
    const t = io();
    const fetchFn = vi.fn(async () => new Response("{}", { status: 403 }));
    expect(await main(["search"], t, { fetch: fetchFn }, {})).toBe(1);
    expect(JSON.parse(t.err.join(""))).toMatchObject({ code: "API_ERROR" });
  });
});
