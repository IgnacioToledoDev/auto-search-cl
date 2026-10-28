import type { Vehicle } from "../lib/vehicle.ts";
import type { Profile } from "./profile.ts";
import { containsFolded, fold } from "./text.ts";

export interface FilterResult {
  pass: boolean;
  /** Reasons the listing is excluded. */
  vetoes: string[];
  /** Missing data worth a human look; never excludes. */
  flags: string[];
}

/** Listing price in CLP: the CLP price, else the UF price converted with `ufClp`, else null. */
export function effectivePriceClp(v: Vehicle, ufClp?: number | null): number | null {
  if (v.priceClp !== null) return v.priceClp;
  if (v.priceUf !== null && ufClp != null) return Math.round(v.priceUf * ufClp);
  return null;
}

const matchesAny = (value: string, wanted: string[]): boolean => {
  const f = fold(value);
  return wanted.some((w) => {
    const x = fold(w);
    return x !== "" && (f.includes(x) || x.includes(f));
  });
};

/**
 * Location fit: true/false when the listing value is known and the profile
 * constrains it; null when nothing could be checked. A match on either the
 * region or the comuna is enough.
 */
export function locationMatch(v: Vehicle, p: Profile): boolean | null {
  const checks: boolean[] = [];
  if (p.regions.length > 0 && v.region) checks.push(matchesAny(v.region, p.regions));
  if (p.comunas.length > 0 && v.comuna) checks.push(matchesAny(v.comuna, p.comunas));
  return checks.length === 0 ? null : checks.some(Boolean);
}

/** Deterministic HARD filters. `ufClp` overrides profile.ufClp for UF conversion. */
export function applyHardFilters(v: Vehicle, p: Profile, ufClp?: number | null): FilterResult {
  const vetoes: string[] = [];
  const flags: string[] = [];

  const price = effectivePriceClp(v, ufClp ?? p.ufClp);
  if (price === null) flags.push("price-unknown");
  else if (price > p.budgetMaxClp) vetoes.push("over-budget");

  const makeText = v.make ?? v.title;
  if (p.makesExcluded.some((m) => containsFolded(makeText, m))) vetoes.push("excluded-make");

  if (p.condition !== "ambos" && v.condition !== p.condition) vetoes.push("condition-mismatch");

  if (p.yearMin !== null) {
    if (v.year === null) flags.push("year-unknown");
    else if (v.year < p.yearMin) vetoes.push("year-too-old");
  }

  if (p.kmMax !== null && v.condition === "usado") {
    if (v.km === null) flags.push("km-unknown");
    else if (v.km > p.kmMax) vetoes.push("km-too-high");
  }

  if (p.regions.length > 0 || p.comunas.length > 0) {
    const loc = locationMatch(v, p);
    if (loc === null) flags.push("location-unknown");
    else if (!loc) vetoes.push("outside-location");
  }

  const text = `${v.title} ${v.description ?? ""}`;
  for (const word of p.dealBreakers) {
    if (containsFolded(text, word)) vetoes.push(`deal-breaker:${fold(word)}`);
  }

  return { pass: vetoes.length === 0, vetoes, flags };
}
