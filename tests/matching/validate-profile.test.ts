import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/matching/validate-profile.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "valprofile-"));
});

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => err.push(c) } });
  return { code, out: out.join(""), err: err.join("") };
}

describe("validate-profile", () => {
  it("accepts a valid profile and prints it with defaults applied", async () => {
    const file = join(dir, "p.json");
    writeFileSync(file, JSON.stringify({ condition: "usado", budgetMaxClp: 9_000_000 }));
    const r = await run(["--file", file]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out);
    expect(parsed.ok).toBe(true);
    expect(parsed.profile.condition).toBe("usado");
    expect(parsed.profile.makesPreferred).toEqual([]);
  });

  it("rejects an invalid profile with PROFILE_ERROR and a readable message", async () => {
    const file = join(dir, "p.json");
    writeFileSync(file, JSON.stringify({ condition: "flotante", budgetMaxClp: -1 }));
    const r = await run(["--file", file]);
    expect(r.code).toBe(1);
    const e = JSON.parse(r.err);
    expect(e.code).toBe("PROFILE_ERROR");
    expect(e.error).toContain("condition");
  });

  it("reports a missing file and points to /car-setup", async () => {
    const r = await run(["--file", join(dir, "nope.json")]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).error).toContain("/car-setup");
  });

  it("rejects unknown flags", async () => {
    const r = await run(["--bogus"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).code).toBe("UNKNOWN_FLAG");
  });

  it("validates the shipped example profile", async () => {
    const r = await run(["--file", "data/profile.example.json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).profile.bodyTypeStrict).toBe(false);
    expect(readFileSync("data/profile.example.json", "utf8")).toContain('"bodyTypeStrict"');
  });
});
