import type { Vehicle } from "../lib/vehicle.ts";
import { fold } from "./text.ts";

export type BodyTypeMatch = "match" | "mismatch" | "unknown";

interface MakeModels {
  /** Make names/aliases (matched as whole words after folding). */
  makes: string[];
  /** Models sold in Chile that are SUVs/crossovers. */
  suv: string[];
  /** Known non-SUV models (sedans, hatchbacks, ...) that portals often label generically. */
  other: string[];
}

/**
 * Data-only table: extend by adding makes/models. Portals such as Bruno
 * Fritsch label SUVs "Station Wagon" or "Automovil", so the model is the most
 * reliable signal. Choice: Citroen C4 Cactus is a crossover-styled hatch and is
 * treated as SUV (marketed as a crossover in Chile).
 */
export const MODEL_TABLE: MakeModels[] = [
  { makes: ["nissan"], suv: ["qashqai", "kicks", "x-trail", "murano", "pathfinder"], other: ["versa", "march", "sentra", "tiida", "note"] },
  { makes: ["renault"], suv: ["duster", "captur", "koleos", "arkana", "oroch"], other: ["sandero", "logan", "kwid", "clio", "symbol", "soluto", "fluence"] },
  { makes: ["chevrolet"], suv: ["tracker", "groove", "captiva", "equinox", "trailblazer", "tahoe", "suburban"], other: ["onix", "sail", "spark", "cruze", "aveo", "beat", "joy"] },
  { makes: ["opel"], suv: ["crossland", "mokka", "grandland"], other: ["corsa", "astra"] },
  { makes: ["dodge"], suv: ["journey", "durango"], other: ["attitude"] },
  { makes: ["hyundai"], suv: ["tucson", "creta", "kona", "santa fe", "venue", "palisade"], other: ["accent", "grand i10", "i10", "i20", "elantra", "verna"] },
  { makes: ["kia"], suv: ["sportage", "seltos", "sorento", "soul", "sonet", "niro", "stonic"], other: ["morning", "picanto", "rio", "cerato", "k3"] },
  { makes: ["toyota"], suv: ["rav4", "corolla cross", "yaris cross", "land cruiser", "fortuner", "4runner"], other: ["yaris", "aygo", "corolla", "etios", "camry"] },
  { makes: ["mazda"], suv: ["cx-3", "cx-30", "cx-5", "cx-9", "cx-50"], other: ["mazda2", "mazda3", "mazda 2", "mazda 3"] },
  { makes: ["suzuki"], suv: ["vitara", "jimny", "s-cross", "grand vitara", "ignis"], other: ["swift", "dzire", "baleno", "alto", "celerio", "ciaz"] },
  { makes: ["ford"], suv: ["escape", "ecosport", "territory", "edge", "explorer", "bronco"], other: ["fiesta", "focus", "ka", "mondeo"] },
  { makes: ["honda"], suv: ["hr-v", "cr-v", "wr-v"], other: ["civic", "fit", "city", "accord"] },
  { makes: ["subaru"], suv: ["xv", "forester", "outback", "crosstrek"], other: ["impreza", "legacy"] },
  { makes: ["volkswagen", "vw"], suv: ["t-cross", "tiguan", "taos", "touareg", "nivus"], other: ["gol", "polo", "virtus", "golf", "voyage", "up"] },
  { makes: ["citroen"], suv: ["c3 aircross", "c5 aircross", "c4 cactus"], other: ["c3", "c4", "c-elysee"] },
  { makes: ["jeep"], suv: ["renegade", "compass", "wrangler", "cherokee", "grand cherokee"], other: [] },
  { makes: ["mitsubishi"], suv: ["asx", "outlander", "montero", "eclipse cross"], other: ["mirage", "lancer"] },
  { makes: ["fiat"], suv: ["pulse", "fastback"], other: ["uno", "mobi", "argo", "cronos", "palio", "500"] },
  { makes: ["peugeot"], suv: ["2008", "3008", "5008"], other: ["208", "301", "308"] },
];

/** Portal labels that say nothing reliable about the body style. */
const GENERIC_LABELS = new Set(["", "automovil", "auto", "station wagon", "stationwagon", "wagon", "vehiculo"]);

const SUV_WORDS = ["suv", "crossover", "todoterreno", "4x4"];

/** Fold, drop punctuation and pad so whole-word containment is a plain substring test. */
const words = (text: string): string => ` ${fold(text).replace(/[^a-z0-9]+/g, " ").trim()} `;
const hasWord = (haystack: string, needle: string): boolean => haystack.includes(words(needle));

const wantsSuv = (wanted: string[]): boolean => wanted.some((w) => SUV_WORDS.some((s) => fold(w).includes(s)));
const wantsOtherThanSuv = (wanted: string[]): boolean => wanted.some((w) => !SUV_WORDS.some((s) => fold(w).includes(s)));

/** Table kind for the vehicle, trying longer model names first ("grand vitara" before "vitara"). */
function lookupModel(v: Vehicle): "suv" | "other" | null {
  const makeText = words(v.make ?? v.title);
  const modelText = words(v.model ?? v.title);
  for (const entry of MODEL_TABLE) {
    if (!entry.makes.some((m) => hasWord(makeText, m))) continue;
    const candidates = [
      ...entry.suv.map((m) => [m, "suv"] as const),
      ...entry.other.map((m) => [m, "other"] as const),
    ].sort((a, b) => b[0].length - a[0].length);
    for (const [model, kind] of candidates) if (hasWord(modelText, model)) return kind;
  }
  return null;
}

/**
 * Does the vehicle fit the wanted body types? Resolution order: make+model
 * table, then a specific portal label, then "unknown" (generic/missing label).
 */
export function resolveBodyType(v: Vehicle, wanted: string[]): BodyTypeMatch {
  if (wanted.length === 0) return "unknown";

  const known = lookupModel(v);
  if (known === "suv") return wantsSuv(wanted) ? "match" : "mismatch";
  if (known === "other" && !wantsOtherThanSuv(wanted)) return "mismatch";

  const label = fold(v.bodyType ?? "");
  const wantedFolded = wanted.map(fold).filter((w) => w !== "");
  if (label !== "" && wantedFolded.some((w) => label.includes(w) || w.includes(label))) return "match";
  if (GENERIC_LABELS.has(label)) return "unknown";
  if (SUV_WORDS.some((s) => label.includes(s)) && wantsSuv(wanted)) return "match";
  return "mismatch";
}
