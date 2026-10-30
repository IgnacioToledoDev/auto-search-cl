import type { Vehicle } from "../lib/vehicle.ts";
import { effectivePriceClp, locationMatch } from "./filters.ts";
import { resolveBodyType } from "./bodytype.ts";
import type { Profile } from "./profile.ts";
import { containsFolded, fold } from "./text.ts";

export type Verdict = "Strong" | "Good" | "Moderate" | "Weak" | "Poor";
export type Dimension = "price" | "spec" | "condition" | "seller";

export interface DimensionScore {
  points: number;
  max: number;
}

export interface ScoreResult {
  /** Deterministic score, 0-100. */
  score: number;
  verdict: Verdict;
  breakdown: Record<Dimension, DimensionScore>;
  strengths: string[];
  gaps: string[];
}

export interface AiResult {
  score: number;
  strengths: string[];
  gaps: string[];
}

export interface ScoreContext {
  /** Median CLP price of comparable vehicles; absent when there are too few. */
  medianPriceClp?: number | null;
  ufClp?: number | null;
  /** Reference year for vehicle age; injectable for tests. */
  currentYear?: number;
}

export const DEFAULT_WEIGHTS: Record<Dimension, number> = { price: 30, spec: 25, condition: 25, seller: 20 };

/** Reference mileage when the profile sets no kmMax. */
const DEFAULT_KM_REFERENCE = 150_000;
/** A vehicle this many years old (or older) earns no age points. */
const MAX_AGE_YEARS = 12;
/** Price below 85% of the market median is full marks; 115% and above earns none. */
const MARKET_FULL_RATIO = 0.85;
const MARKET_SPAN = 0.3;
/** Share of price points decided by the budget fit when market data exists. */
const BUDGET_SHARE = 0.6;
const DEFAULT_IDEAL_SHARE = 0.8;
const MIN_COMPARABLES = 3;

export function verdictFor(score: number): Verdict {
  if (score >= 75) return "Strong";
  if (score >= 60) return "Good";
  if (score >= 45) return "Moderate";
  if (score >= 30) return "Weak";
  return "Poor";
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Median price of comparable vehicles: same make+model, year within +-1,
 * excluding the vehicle itself. Null below `minSamples` comparables.
 */
export function medianComparablePrice(
  self: Vehicle,
  all: Vehicle[],
  opts: { minSamples?: number; ufClp?: number | null } = {},
): number | null {
  if (!self.make || !self.model || self.year === null) return null;
  const prices: number[] = [];
  for (const v of all) {
    if (v === self || (v.portal === self.portal && v.id === self.id)) continue;
    if (!v.make || !v.model || v.year === null) continue;
    if (fold(v.make) !== fold(self.make) || fold(v.model) !== fold(self.model)) continue;
    if (Math.abs(v.year - self.year) > 1) continue;
    const price = effectivePriceClp(v, opts.ufClp);
    if (price !== null) prices.push(price);
  }
  return prices.length >= (opts.minSamples ?? MIN_COMPARABLES) ? median(prices) : null;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const fmtClp = (n: number): string => `$${Math.round(n).toLocaleString("es-CL")}`;

/** Canonical form so "Automática"/"automatico" and "Manual"/"Mecánica" compare equal. */
function canonical(value: string): string {
  const f = fold(value);
  if (f.includes("auto") || f.includes("cvt") || f.includes("dct")) return "automatica";
  if (f.includes("manual") || f.includes("mecanic")) return "manual";
  if (f.includes("gasolina") || f.includes("bencina")) return "bencina";
  return f;
}

function listMatches(listingValue: string, wanted: string[]): boolean {
  const l = canonical(listingValue);
  return wanted.some((w) => {
    const c = canonical(w);
    return c !== "" && (l.includes(c) || c.includes(l));
  });
}

interface Part {
  points: number;
  strengths: string[];
  gaps: string[];
}

function scorePrice(v: Vehicle, p: Profile, ctx: ScoreContext): Part {
  const price = effectivePriceClp(v, ctx.ufClp ?? p.ufClp);
  if (price === null) return { points: 0.5, strengths: [], gaps: ["Price unknown"] };
  const strengths: string[] = [];
  const gaps: string[] = [];

  const ideal = p.budgetIdealClp ?? p.budgetMaxClp * DEFAULT_IDEAL_SHARE;
  let budget: number;
  if (price <= ideal) {
    budget = 1;
    strengths.push(`Price ${fmtClp(price)} within ideal budget`);
  } else if (price <= p.budgetMaxClp) {
    budget = 1 - 0.6 * ((price - ideal) / (p.budgetMaxClp - ideal));
    gaps.push(`Price ${fmtClp(price)} above ideal budget`);
  } else {
    budget = 0;
    gaps.push(`Price ${fmtClp(price)} over budget`);
  }

  const marketMedian = ctx.medianPriceClp ?? null;
  if (marketMedian === null || marketMedian <= 0) return { points: budget, strengths, gaps };
  const ratio = price / marketMedian;
  const market = clamp01(1 - ((ratio - MARKET_FULL_RATIO) / MARKET_SPAN) * 0.8);
  if (ratio <= MARKET_FULL_RATIO) strengths.push(`Price ${Math.round((1 - ratio) * 100)}% below market median`);
  else if (ratio >= 1 + (1 - MARKET_FULL_RATIO)) gaps.push(`Price ${Math.round((ratio - 1) * 100)}% above market median`);
  return { points: BUDGET_SHARE * budget + (1 - BUDGET_SHARE) * market, strengths, gaps };
}

function scoreSpec(v: Vehicle, p: Profile): Part {
  const strengths: string[] = [];
  const gaps: string[] = [];
  let hits = 0;
  let criteria = 0;

  const check = (label: string, value: string | null, matcher: (x: string) => boolean): void => {
    criteria++;
    if (value === null) {
      hits += 0.5;
      gaps.push(`${label} unknown`);
    } else if (matcher(value)) {
      hits += 1;
      strengths.push(`${label}: ${value}`);
    } else {
      gaps.push(`${label} ${value} not preferred`);
    }
  };

  if (p.makesPreferred.length > 0) check("Make", v.make, (x) => listMatches(x, p.makesPreferred));
  if (p.modelsPreferred.length > 0) check("Model", v.model, (x) => listMatches(x, p.modelsPreferred));
  if (p.bodyTypes.length > 0) {
    criteria++;
    const body = resolveBodyType(v, p.bodyTypes);
    const shown = v.bodyType ?? v.model ?? "listed";
    if (body === "match") {
      hits += 1;
      strengths.push(`Body type: ${shown}`);
    } else if (body === "unknown") {
      hits += 0.5;
      gaps.push("Body type unknown");
    } else gaps.push(`Body type ${shown} not preferred`);
  }
  if (p.fuels.length > 0) check("Fuel", v.fuel, (x) => listMatches(x, p.fuels));
  if (p.transmissions.length > 0) check("Transmission", v.transmission, (x) => listMatches(x, p.transmissions));

  const text = `${v.title} ${v.description ?? ""}`;
  for (const word of p.mustHaves) {
    criteria++;
    if (containsFolded(text, word)) {
      hits += 1;
      strengths.push(`Mentions "${word}"`);
    } else {
      gaps.push(`Missing must-have "${word}"`);
    }
  }

  // No stated preferences means nothing can mismatch: full marks.
  return { points: criteria === 0 ? 1 : hits / criteria, strengths, gaps };
}

function scoreCondition(v: Vehicle, p: Profile, ctx: ScoreContext): Part {
  if (v.condition === "nuevo") return { points: 1, strengths: ["Brand new"], gaps: [] };
  const strengths: string[] = [];
  const gaps: string[] = [];
  const currentYear = ctx.currentYear ?? new Date().getFullYear();

  let year = 0.5;
  if (v.year === null) gaps.push("Year unknown");
  else {
    const age = Math.max(0, currentYear - v.year);
    year = clamp01(1 - Math.max(0, age - 1) / (MAX_AGE_YEARS - 1));
    if (year >= 0.75) strengths.push(`Recent year (${v.year})`);
    else if (year <= 0.25) gaps.push(`Old vehicle (${v.year})`);
  }

  let km = 0.5;
  if (v.km === null) gaps.push("Mileage unknown");
  else {
    km = clamp01(1 - v.km / (p.kmMax ?? DEFAULT_KM_REFERENCE));
    if (km >= 0.75) strengths.push(`Low mileage (${v.km} km)`);
    else if (km <= 0.25) gaps.push(`High mileage (${v.km} km)`);
  }
  return { points: (year + km) / 2, strengths, gaps };
}

function scoreSeller(v: Vehicle, p: Profile): Part {
  const strengths: string[] = [];
  const gaps: string[] = [];
  let seller = 1;
  if (p.sellerTypePreference !== "any") {
    if (v.sellerType === null) {
      seller = 0.5;
      gaps.push("Seller type unknown");
    } else if (v.sellerType === p.sellerTypePreference) strengths.push(`Preferred seller type (${v.sellerType})`);
    else {
      seller = 0;
      gaps.push(`Seller is ${v.sellerType}, preferred ${p.sellerTypePreference}`);
    }
  }
  let location = 1;
  if (p.regions.length > 0 || p.comunas.length > 0) {
    const loc = locationMatch(v, p);
    if (loc === null) {
      location = 0.5;
      gaps.push("Location unknown");
    } else if (loc) strengths.push("In preferred location");
    else {
      location = 0;
      gaps.push("Outside preferred location");
    }
  }
  return { points: (seller + location) / 2, strengths, gaps };
}

/** Deterministic 0-100 score with per-dimension breakdown and human-readable strengths/gaps. */
export function scoreVehicle(v: Vehicle, p: Profile, ctx: ScoreContext = {}): ScoreResult {
  const max: Record<Dimension, number> = { ...DEFAULT_WEIGHTS, ...p.weights };
  const parts: Record<Dimension, Part> = {
    price: scorePrice(v, p, ctx),
    spec: scoreSpec(v, p),
    condition: scoreCondition(v, p, ctx),
    seller: scoreSeller(v, p),
  };
  const dims = Object.keys(parts) as Dimension[];
  const breakdown = Object.fromEntries(
    dims.map((d) => [d, { points: parts[d].points * max[d], max: max[d] }]),
  ) as Record<Dimension, DimensionScore>;
  const totalMax = dims.reduce((s, d) => s + max[d], 0);
  const totalPoints = dims.reduce((s, d) => s + breakdown[d].points, 0);
  const score = totalMax === 0 ? 0 : Math.round((totalPoints / totalMax) * 100);
  return {
    score,
    verdict: verdictFor(score),
    breakdown,
    strengths: dims.flatMap((d) => parts[d].strengths),
    gaps: dims.flatMap((d) => parts[d].gaps),
  };
}

const unique = (items: string[]): string[] => [...new Set(items)];

/**
 * Final score: deterministic only, or 0.7*deterministic + 0.3*ai when an AI
 * qualitative result exists (strengths/gaps merged, duplicates dropped).
 */
export function applyAi(
  det: Pick<ScoreResult, "score" | "strengths" | "gaps">,
  ai?: AiResult | null,
): { score: number; verdict: Verdict; strengths: string[]; gaps: string[] } {
  if (!ai) return { score: det.score, verdict: verdictFor(det.score), strengths: det.strengths, gaps: det.gaps };
  const score = Math.round(0.7 * det.score + 0.3 * ai.score);
  return {
    score,
    verdict: verdictFor(score),
    strengths: unique([...det.strengths, ...ai.strengths]),
    gaps: unique([...det.gaps, ...ai.gaps]),
  };
}
