export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

export interface HtmlFetchOptions {
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injectable sleep (tests). Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable randomness for jitter, in [0, 1). */
  random?: () => number;
  headers?: Record<string, string>;
  /** Retries after the first attempt. Default 6. */
  retries?: number;
  /** Per-attempt timeout. Default 15000 ms. */
  timeoutMs?: number;
}

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;
const MAX_JITTER_MS = 250;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Fetch a page as text, retrying 429/5xx and network errors with backoff. */
export async function htmlFetch(url: string, options: HtmlFetchOptions = {}): Promise<string> {
  const fetchFn = options.fetch ?? fetch;
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;
  const retries = options.retries ?? 6;
  const timeoutMs = options.timeoutMs ?? 15000;
  const headers = { "User-Agent": DEFAULT_UA, ...options.headers };

  for (let attempt = 0; ; attempt++) {
    let failure: unknown;
    try {
      const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return await res.text();
      failure = new HttpError(res.status, url);
      if (!isRetryableStatus(res.status)) throw failure;
    } catch (err) {
      if (err instanceof HttpError && !isRetryableStatus(err.status)) throw err;
      failure = err;
    }
    if (attempt >= retries) throw failure;
    const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
    await sleep(delay + Math.floor(random() * MAX_JITTER_MS));
  }
}
