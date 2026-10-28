import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SearchOutputSchema } from "../../../src/lib/vehicle.ts";
import { main } from "../../../src/portals/chileautos/cli.ts";

const HOME = readFileSync(new URL("./fixtures/home-stockcards.html", import.meta.url), "utf8");

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: { write: (c: string) => out.push(c) },
    stderr: { write: (c: string) => err.push(c) },
  };
}

const deps = () => ({ fetch: vi.fn(async () => new Response(HOME, { status: 200 })) });

describe("chileautos cli", () => {
  it("search prints SearchOutput JSON on stdout and exits 0", async () => {
    const t = io();
    const code = await main(["search", "-q", "mazda", "--price-max", "30000000", "--limit", "5"], t, deps());
    expect(code).toBe(0);
    const parsed = SearchOutputSchema.parse(JSON.parse(t.out.join("")));
    expect(parsed.meta.perPage).toBe(5);
    expect(t.err).toEqual([]);
  });

  it("search --format table prints a text table", async () => {
    const t = io();
    expect(await main(["search", "--format", "table"], t, deps())).toBe(0);
    expect(t.out.join("")).toContain("Deepal S07");
    expect(() => JSON.parse(t.out.join(""))).toThrow();
  });

  it("unknown flags exit 1 with {error, code}", async () => {
    const t = io();
    expect(await main(["search", "--bogus"], t, deps())).toBe(1);
    expect(JSON.parse(t.err.join(""))).toMatchObject({ code: "UNKNOWN_FLAG" });
  });

  it("validates values", async () => {
    for (const argv of [
      ["search", "--condition", "roto"],
      ["search", "--price-max", "abc"],
      ["search", "--format", "xml"],
      ["search", "--page", "0"],
    ]) {
      const t = io();
      expect(await main(argv, t, deps())).toBe(1);
      expect(JSON.parse(t.err.join(""))).toMatchObject({ code: "BAD_ARG" });
    }
  });

  it("rejects a missing or unknown command", async () => {
    const t = io();
    expect(await main([], t, deps())).toBe(1);
    expect(JSON.parse(t.err.join("")).code).toBe("BAD_ARG");
    const t2 = io();
    expect(await main(["detail"], t2, deps())).toBe(1);
    expect(JSON.parse(t2.err.join("")).code).toBe("MISSING_REQUIRED");
  });

  it("maps a bot-protection block to API_ERROR exit 1", async () => {
    const t = io();
    const fetchFn = vi.fn(async () => new Response("denied", { status: 403 }));
    expect(await main(["search"], t, { fetch: fetchFn })).toBe(1);
    expect(JSON.parse(t.err.join(""))).toMatchObject({ code: "API_ERROR" });
  });
});
