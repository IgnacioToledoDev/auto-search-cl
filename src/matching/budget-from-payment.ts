import { pathToFileURL } from "node:url";
import { CliError, parseArgs, writeError } from "../lib/cliGuard.ts";

interface Out {
  write(chunk: string): unknown;
}

export interface Io {
  stdout: Out;
  stderr: Out;
}

export interface PaymentPlan {
  monthlyClp: number;
  months: number;
  /** Nominal annual interest rate in percent (0 = no interest). */
  annualRatePct: number;
  downPaymentClp: number;
}

const ROUND_TO = 10_000;

/** Max vehicle price affordable with a monthly payment: present value of the annuity plus the down payment. */
export function budgetFromPayment(plan: PaymentPlan): number {
  const r = plan.annualRatePct / 100 / 12;
  const financed = r === 0 ? plan.monthlyClp * plan.months : (plan.monthlyClp * (1 - (1 + r) ** -plan.months)) / r;
  return Math.round((financed + plan.downPaymentClp) / ROUND_TO) * ROUND_TO;
}

function num(options: Record<string, string>, name: string, opts: { min: number; strict?: boolean }, fallback?: number): number {
  const raw = options[name];
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new CliError("MISSING_REQUIRED", `Missing required option --${name}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || (opts.strict ? n <= opts.min : n < opts.min)) {
    throw new CliError("BAD_ARG", `--${name} must be a number ${opts.strict ? ">" : ">="} ${opts.min}`);
  }
  return n;
}

/**
 * Convert "monthly payment x months" into a max price for /car-setup.
 * Prints `{"budgetMaxClp":n}`; errors go to stderr as `{"error","code"}`.
 */
export async function main(argv: string[], io: Io = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  try {
    const { options } = parseArgs(argv, {
      options: [{ name: "monthly" }, { name: "months" }, { name: "rate" }, { name: "down" }],
    });
    const plan: PaymentPlan = {
      monthlyClp: num(options, "monthly", { min: 0, strict: true }),
      months: num(options, "months", { min: 0, strict: true }),
      annualRatePct: num(options, "rate", { min: 0 }),
      downPaymentClp: num(options, "down", { min: 0 }, 0),
    };
    io.stdout.write(`${JSON.stringify({ budgetMaxClp: budgetFromPayment(plan) })}\n`);
    return 0;
  } catch (err) {
    return writeError(err, io.stderr);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
