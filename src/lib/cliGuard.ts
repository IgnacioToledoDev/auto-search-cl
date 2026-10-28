export type CliErrorCode = "UNKNOWN_FLAG" | "BAD_ARG" | "MISSING_REQUIRED" | "API_ERROR";

export class CliError extends Error {
  readonly code: CliErrorCode;
  constructor(code: CliErrorCode, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

export interface OptionSpec {
  /** Long name without dashes, e.g. "query" for --query. */
  name: string;
  /** Optional single-letter alias, e.g. "q" for -q. */
  short?: string;
  required?: boolean;
}

export interface FlagSpec {
  name: string;
  short?: string;
}

export interface CliSpec {
  /** Options that take a value. */
  options?: OptionSpec[];
  /** Boolean switches. */
  flags?: FlagSpec[];
}

export interface ParsedArgs {
  options: Record<string, string>;
  flags: Record<string, boolean>;
  positionals: string[];
}

/** A token is a value unless it looks like another flag (negative numbers are values). */
function looksLikeFlag(token: string): boolean {
  return token.startsWith("-") && !/^-\d/.test(token);
}

/**
 * Strictly parse argv: unknown flags, options without a value and missing
 * required options all throw CliError instead of being silently ignored.
 */
export function parseArgs(argv: string[], spec: CliSpec): ParsedArgs {
  const optionDefs = spec.options ?? [];
  const flagDefs = spec.flags ?? [];
  const result: ParsedArgs = {
    options: {},
    flags: Object.fromEntries(flagDefs.map((f) => [f.name, false])),
    positionals: [],
  };

  const findOption = (token: string): OptionSpec | undefined =>
    token.startsWith("--")
      ? optionDefs.find((o) => `--${o.name}` === token)
      : optionDefs.find((o) => o.short !== undefined && `-${o.short}` === token);
  const findFlag = (token: string): FlagSpec | undefined =>
    token.startsWith("--")
      ? flagDefs.find((f) => `--${f.name}` === token)
      : flagDefs.find((f) => f.short !== undefined && `-${f.short}` === token);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!looksLikeFlag(arg)) {
      result.positionals.push(arg);
      continue;
    }
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const token = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    const option = findOption(token);
    if (option) {
      let value = inline;
      if (value === undefined) {
        const next = argv[i + 1];
        if (next === undefined || looksLikeFlag(next)) {
          throw new CliError("BAD_ARG", `Option ${token} requires a value`);
        }
        value = next;
        i++;
      }
      if (value === "") throw new CliError("BAD_ARG", `Option ${token} requires a value`);
      result.options[option.name] = value;
      continue;
    }

    const flag = findFlag(token);
    if (flag) {
      if (inline !== undefined) throw new CliError("BAD_ARG", `Flag ${token} does not take a value`);
      result.flags[flag.name] = true;
      continue;
    }

    throw new CliError("UNKNOWN_FLAG", `Unknown flag: ${token}`);
  }

  for (const def of optionDefs) {
    if (def.required && result.options[def.name] === undefined) {
      throw new CliError("MISSING_REQUIRED", `Missing required option --${def.name}`);
    }
  }
  return result;
}

/**
 * Write `{"error","code"}` as one JSON line and return the exit code (1).
 * Non-CliError values map to API_ERROR.
 */
export function writeError(
  err: unknown,
  stream: { write(chunk: string): unknown } = process.stderr,
): number {
  const code: CliErrorCode = err instanceof CliError ? err.code : "API_ERROR";
  const message = err instanceof Error ? err.message : String(err);
  stream.write(`${JSON.stringify({ error: message, code })}\n`);
  return 1;
}
