import { describe, expect, it } from "vitest";
import { parseClp, parseKm, parseUf } from "../../src/lib/parse.ts";

describe("parseClp", () => {
  it("parses dotted Chilean prices", () => {
    expect(parseClp("$12.990.000")).toBe(12990000);
    expect(parseClp("$ 9.500.000")).toBe(9500000);
    expect(parseClp("CLP 15.000.000")).toBe(15000000);
  });
  it("parses plain digits", () => {
    expect(parseClp("8500000")).toBe(8500000);
  });
  it("returns null for missing or non-numeric input", () => {
    expect(parseClp(null)).toBeNull();
    expect(parseClp(undefined)).toBeNull();
    expect(parseClp("")).toBeNull();
    expect(parseClp("Consultar")).toBeNull();
  });
});

describe("parseUf", () => {
  it("parses UF with decimal comma", () => {
    expect(parseUf("UF 450,5")).toBe(450.5);
  });
  it("parses thousands separators plus decimals", () => {
    expect(parseUf("UF 1.234,56")).toBe(1234.56);
  });
  it("parses integer UF", () => {
    expect(parseUf("UF 450")).toBe(450);
  });
  it("returns null for garbage", () => {
    expect(parseUf("UF")).toBeNull();
    expect(parseUf(null)).toBeNull();
  });
});

describe("parseKm", () => {
  it("parses km with dotted thousands", () => {
    expect(parseKm("85.000 km")).toBe(85000);
    expect(parseKm("120.500 Km")).toBe(120500);
  });
  it("parses km without separators", () => {
    expect(parseKm("85000")).toBe(85000);
  });
  it("returns null for missing input", () => {
    expect(parseKm("")).toBeNull();
    expect(parseKm(null)).toBeNull();
    expect(parseKm("sin dato")).toBeNull();
  });
});
