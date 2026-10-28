import { CliError } from "../../lib/cliGuard.ts";
import type { HtmlFetchOptions } from "../../lib/http.ts";
import type { Vehicle } from "../../lib/vehicle.ts";
import { API_BASE, apiGet, itemToVehicle, parseJson } from "./search.ts";

const ID = /MLC-?(\d{6,})/i;

/**
 * Accept "MLC123...", "MLC-123..." or a mercadolibre.cl permalink containing
 * the id; return the canonical "MLC<digits>" used by the items API.
 */
export function normalizeItemId(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    let host: string;
    try {
      host = new URL(trimmed).hostname;
    } catch {
      throw new CliError("BAD_ARG", `Not a valid URL: ${input}`);
    }
    if (!/(^|\.)mercadolibre\.cl$/.test(host)) throw new CliError("BAD_ARG", `Not a mercadolibre.cl URL: ${input}`);
  }
  const match = ID.exec(trimmed);
  if (!match) throw new CliError("BAD_ARG", `Expected an MLC item id or a mercadolibre.cl listing URL, got "${input}"`);
  return `MLC${match[1]}`;
}

/** Parse a GET /items/<id> body. UNVERIFIED against the live API (anonymous access is refused). */
export function parseItemJson(text: string): Vehicle {
  const data = parseJson(text, "item");
  const vehicle = typeof data === "object" && data !== null && !Array.isArray(data) ? itemToVehicle(data as Record<string, unknown>) : null;
  if (!vehicle) throw new CliError("API_ERROR", "Unexpected Mercado Libre item payload: missing id");
  return vehicle;
}

export async function detail(
  input: string,
  fetchOptions: HtmlFetchOptions = {},
  env: Record<string, string | undefined> = process.env,
): Promise<Vehicle> {
  const id = normalizeItemId(input);
  return parseItemJson(await apiGet(`${API_BASE}/items/${id}`, fetchOptions, env));
}
