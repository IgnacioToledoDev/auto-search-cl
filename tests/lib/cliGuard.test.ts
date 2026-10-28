import { describe, expect, it } from "vitest";
import { CliError, parseArgs, writeError, type CliSpec } from "../../src/lib/cliGuard.ts";

const spec: CliSpec = {
  options: [
    { name: "query", short: "q", required: true },
    { name: "page" },
  ],
  flags: [{ name: "json", short: "j" }],
};

function catchErr(fn: () => unknown): CliError {
  try {
    fn();
  } catch (e) {
    return e as CliError;
  }
  throw new Error("expected throw");
}

describe("parseArgs", () => {
  it("parses long options, short options, flags and equals form", () => {
    const r = parseArgs(["--query", "yaris", "--page=2", "-j"], spec);
    expect(r.options).toEqual({ query: "yaris", page: "2" });
    expect(r.flags.json).toBe(true);
    const s = parseArgs(["-q", "rav4"], spec);
    expect(s.options.query).toBe("rav4");
    expect(s.flags.json).toBe(false);
  });
  it("collects positionals", () => {
    expect(parseArgs(["--query", "a", "detail"], spec).positionals).toEqual(["detail"]);
  });
  it("rejects unknown long flags with UNKNOWN_FLAG", () => {
    const e = catchErr(() => parseArgs(["--query", "a", "--bogus"], spec));
    expect(e).toBeInstanceOf(CliError);
    expect(e.code).toBe("UNKNOWN_FLAG");
  });
  it("rejects unknown short flags with UNKNOWN_FLAG", () => {
    expect(catchErr(() => parseArgs(["-q", "a", "-z"], spec)).code).toBe("UNKNOWN_FLAG");
  });
  it("rejects options with missing value with BAD_ARG", () => {
    expect(catchErr(() => parseArgs(["--query"], spec)).code).toBe("BAD_ARG");
    expect(catchErr(() => parseArgs(["--query", "--page", "2"], spec)).code).toBe("BAD_ARG");
    expect(catchErr(() => parseArgs(["--query="], spec)).code).toBe("BAD_ARG");
  });
  it("rejects a value on a boolean flag with BAD_ARG", () => {
    expect(catchErr(() => parseArgs(["--query", "a", "--json=1"], spec)).code).toBe("BAD_ARG");
  });
  it("reports MISSING_REQUIRED", () => {
    const e = catchErr(() => parseArgs(["--page", "1"], spec));
    expect(e.code).toBe("MISSING_REQUIRED");
    expect(e.message).toContain("query");
  });
  it("accepts negative numbers as values", () => {
    expect(parseArgs(["--query", "a", "--page", "-1"], spec).options.page).toBe("-1");
  });
});

describe("writeError", () => {
  it("writes {error, code} JSON to the stream and returns exit code 1", () => {
    let buf = "";
    const code = writeError(new CliError("BAD_ARG", "oops"), { write: (s: string) => ((buf += s), true) });
    expect(code).toBe(1);
    expect(JSON.parse(buf)).toEqual({ error: "oops", code: "BAD_ARG" });
    expect(buf.endsWith("\n")).toBe(true);
  });
  it("maps unknown errors to API_ERROR", () => {
    let buf = "";
    writeError(new Error("boom"), { write: (s: string) => ((buf += s), true) });
    expect(JSON.parse(buf)).toEqual({ error: "boom", code: "API_ERROR" });
  });
});
