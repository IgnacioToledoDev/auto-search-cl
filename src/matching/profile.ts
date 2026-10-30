import { readFileSync } from "node:fs";
import { z } from "zod";

const list = () => z.array(z.string()).default([]);

/** Optional per-dimension weight overrides; the score is normalized by their sum. */
export const WeightsSchema = z
  .object({
    price: z.number().nonnegative(),
    spec: z.number().nonnegative(),
    condition: z.number().nonnegative(),
    seller: z.number().nonnegative(),
  })
  .partial();

/** Buyer profile written by /setup to data/profile.json. */
export const ProfileSchema = z.object({
  condition: z.enum(["nuevo", "usado", "ambos"]),
  budgetMaxClp: z.number().positive(),
  budgetIdealClp: z.number().positive().optional(),
  makesPreferred: list(),
  makesExcluded: list(),
  modelsPreferred: list(),
  bodyTypes: list(),
  /** When true, bodyTypes is a hard requirement: known non-matching body types are vetoed. */
  bodyTypeStrict: z.boolean().default(false),
  fuels: list(),
  transmissions: list(),
  yearMin: z.number().int().nullable().default(null),
  kmMax: z.number().nonnegative().nullable().default(null),
  regions: list(),
  comunas: list(),
  /** Free-text keywords that must appear in the listing (scored, not vetoed). */
  mustHaves: list(),
  /** Free-text keywords that discard a listing when found in title/description. */
  dealBreakers: list(),
  sellerTypePreference: z.enum(["dealer", "particular", "any"]).default("any"),
  /** CLP value of one UF, used to convert UF-only prices. */
  ufClp: z.number().positive().optional(),
  weights: WeightsSchema.optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const DEFAULT_PROFILE_PATH = "data/profile.json";

/** Read and validate the buyer profile; throws an Error with an actionable message. */
export function loadProfile(path: string = DEFAULT_PROFILE_PATH): Profile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Profile not found at ${path}; run /setup to create it`);
    }
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Profile at ${path} is not valid JSON`);
  }
  const parsed = ProfileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid profile at ${path}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
