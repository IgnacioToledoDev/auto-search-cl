import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SearchOutputSchema } from "../../../src/lib/vehicle.ts";
import { main } from "../../../src/portals/brunofritsch/cli.ts";

const CARDS = readFileSync(new URL("./fixtures/search-used.html", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("./fixtures/detail-used-TWDB-98.html", import.meta.url), "utf8");

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => err.push(c) } };
}
const deps = (body = CARDS) => ({ fetch: vi.fn(async () => new Response(body, { status: 200 })) });

describe("brunofritsch cli", () => {
  it("search prints SearchOutput JSON and exits 0", async () => {
    const t = io();
    expect(await main(["search", "--condition", "usado", "-q", "baleno", "--limit", "5"], t, deps())).toBe(0);
    const parsed = SearchOutputSchema.parse(JSON.parse(t.out.join("")));
    expect(parsed.results).toHaveLength(1);
    expect(parsed.meta.perPage).toBe(5);
    expect(t.err).toEqual([]);
  });

  it("search --format table prints text", async () => {
    const t = io();
    expect(await main(["search", "--condition", "usado", "--format", "table"], t, deps())).toBe(0);
    expect(t.out.join("")).toContain("TWDB-98");
    expect(() => JSON.parse(t.out.join(""))).toThrow();
  });

  it("detail prints a Vehicle", async () => {
    const t = io();
    expect(await main(["detail", "https://www.brunofritsch.cl/autos-usados/TWDB-98"], t, deps(PAGE))).toBe(0);
    expect(JSON.parse(t.out.join("")).id).toBe("TWDB-98");
  });

  it("unknown flags and bad values exit 1 with {error, code}", async () => {
    for (const [argv, code] of [
      [["search", "--bogus"], "UNKNOWN_FLAG"],
      [["search", "--condition", "nuevo"], "BAD_ARG"],
      [["search", "--condition", "roto"], "BAD_ARG"],
      [["search", "--price-max", "abc"], "BAD_ARG"],
      [["search", "--format", "xml"], "BAD_ARG"],
      [["detail"], "MISSING_REQUIRED"],
      [["detail", "nope"], "BAD_ARG"],
      [[], "BAD_ARG"],
    ] as const) {
      const t = io();
      expect(await main([...argv], t, deps())).toBe(1);
      expect(JSON.parse(t.err.join(""))).toMatchObject({ code });
    }
  });

  it("maps a block to API_ERROR exit 1", async () => {
    const t = io();
    const fetchFn = vi.fn(async () => new Response("denied", { status: 403 }));
    expect(await main(["search", "--condition", "usado"], t, { fetch: fetchFn })).toBe(1);
    expect(JSON.parse(t.err.join(""))).toMatchObject({ code: "API_ERROR" });
  });
});
