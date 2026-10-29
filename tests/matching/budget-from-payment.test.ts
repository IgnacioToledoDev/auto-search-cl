import { describe, expect, it } from "vitest";
import { budgetFromPayment, main } from "../../src/matching/budget-from-payment.ts";

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => err.push(c) } });
  return { code, out: out.join(""), err: err.join("") };
}

describe("budgetFromPayment", () => {
  it("is payment * months when the rate is zero, plus down payment", () => {
    expect(budgetFromPayment({ monthlyClp: 300_000, months: 48, annualRatePct: 0, downPaymentClp: 2_000_000 })).toBe(16_400_000);
  });

  it("discounts interest with the annuity formula", () => {
    // 300k x 48 months at 12% annual (1% monthly) => PV = 300000 * (1 - 1.01^-48) / 0.01 ≈ 11,391,000
    const v = budgetFromPayment({ monthlyClp: 300_000, months: 48, annualRatePct: 12, downPaymentClp: 0 });
    expect(v).toBeGreaterThan(11_380_000);
    expect(v).toBeLessThan(11_400_000);
  });

  it("rounds to the nearest 10,000 CLP", () => {
    expect(budgetFromPayment({ monthlyClp: 333_333, months: 10, annualRatePct: 0, downPaymentClp: 0 }) % 10_000).toBe(0);
  });
});

describe("budget-from-payment CLI", () => {
  it("prints the computed budget", async () => {
    const r = await run(["--monthly", "300000", "--months", "48", "--rate", "0", "--down", "0"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ budgetMaxClp: 14_400_000 });
  });

  it("defaults down payment to 0", async () => {
    const r = await run(["--monthly", "100000", "--months", "12", "--rate", "0"]);
    expect(JSON.parse(r.out).budgetMaxClp).toBe(1_200_000);
  });

  it("rejects non-positive or non-numeric input", async () => {
    const r = await run(["--monthly", "abc", "--months", "48", "--rate", "10"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).code).toBe("BAD_ARG");
  });

  it("rejects unknown flags", async () => {
    const r = await run(["--monthly", "1", "--months", "1", "--rate", "0", "--x", "1"]);
    expect(JSON.parse(r.err).code).toBe("UNKNOWN_FLAG");
  });
});
