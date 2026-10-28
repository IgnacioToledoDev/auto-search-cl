export interface KeyInput {
  portal: string;
  id: string;
  plate: string | null;
}

/** Uppercase the plate and drop every non-alphanumeric character. */
function normalizePlate(plate: string | null): string {
  return (plate ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Canonical dedupe key: the normalized plate (patente) when known, so the same
 * car listed on several portals collapses to one candidate; otherwise
 * `${portal}:${id}`.
 */
export function dedupeKey({ portal, id, plate }: KeyInput): string {
  const normalized = normalizePlate(plate);
  return normalized !== "" ? normalized : `${portal}:${id}`;
}
